/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Support performance dashboard (Suitelet).
 *
 * Renders business-hours KPIs for support cases assigned to one employee:
 *   - Time to resolution  (created -> closed, closed non-spam cases)
 *   - First response      (created -> first employee email, cases that got a reply)
 *   - Correspondences     (employee emails per case, cases that got a reply)
 *
 * Each metric shows mean and median, filtered by a date range in the browser.
 * All three queries run server-side on every page load, so the figures are live.
 *
 * ---------------------------------------------------------------------------
 * TIMEZONE WARNING -- read before changing anything
 * ---------------------------------------------------------------------------
 * NetSuite returns these two fields in DIFFERENT timezones via SuiteQL:
 *
 *   supportcase.datecreated / supportcase.enddate -> account/user timezone
 *   message.messagedate                           -> UTC
 *
 * Verified empirically: on an email-created case, the inbound message is
 * exactly 5h (EDT) or 6h (EST) ahead of datecreated for the same event. That
 * puts the case fields at UTC-5/UTC-6, i.e. US Central, DST-aware.
 *
 * Business hours are defined in Eastern, so:
 *   case fields  -> Eastern = value + CASE_FIELD_OFFSET_HOURS  (Central -> Eastern = +1)
 *   messagedate  -> Eastern = value - 4 (EDT) or - 5 (EST)
 *
 * If your account timezone is not Central, change CASE_FIELD_OFFSET_HOURS.
 * Setup > Company > General Preferences > Time Zone.
 * ---------------------------------------------------------------------------
 *
 * Governance: 3 x runSuiteQL = 30 units. Suitelet limit is 1,000.
 */

define(['N/query', 'N/log'], (query, log) => {

  // =========================================================================
  // CONFIG
  // =========================================================================
  const CONFIG = {
    // Who and what to measure
    assignedEmployeeId: 653584,   // Moshe Naiman
    spamCategoryId: 8,            // supportcase.category value to exclude
    closedStatusId: 5,            // supportcase.status = Closed

    // Eastern offset to apply to supportcase date fields.
    // Central account -> Eastern is +1. Set to 0 if your account is Eastern.
    caseFieldOffsetHours: 1,

    // Business week, minutes per day, Monday first. Fri closes at 1pm.
    // Index 0 = Monday ... 6 = Sunday.
    dayCapacityMinutes: [480, 480, 480, 480, 240, 0, 0],
    dayStartMinute: 540,          // 09:00

    // Any Monday strictly before the earliest case. Anchors the week maths.
    epochMonday: '2025-10-06',

    // Business closures. Extend this list each year -- nothing else changes.
    holidays: [
      '2025-11-27', // Thanksgiving
      '2025-12-25', // Christmas
      '2026-01-01', // New Year's Day
      '2026-05-25', // Memorial Day
      '2026-07-03', // Independence Day (observed)
      '2025-09-01', // Labor Day
      '2026-11-26', // Thanksgiving
      '2026-12-25',  // Christmas
      '2026-03-03',  // Purim
      '2026-04-01',  // Passover
      '2026-04-02',  // Passover
      '2026-04-03',  // Passover
      '2026-04-06',  // Passover
      '2026-04-07',  // Passover
      '2026-04-08',  // Passover
      '2026-04-09',  // Passover
      '2026-05-21',  // Shvout
      '2026-05-22',  // Shvout
      '2026-05-25',  // Shvout
      '2026-07-23',  // Tisha B'Av
      '2026-09-07',  // Labour Day
      '2026-09-21',  // Yom Kippur
      '2026-09-28',  // Sukkot
      '2026-09-29',  // Sukkot
      '2026-09-30',  // Sukkot
      '2026-10-01',  // Sukkot
      '2026-10-02'  // Sukkot
    ],

    // Years to generate US daylight-saving boundaries for (messagedate is UTC).
    dstYears: [2025, 2026, 2027, 2028, 2029, 2030]
  };

  const SQL_DATE = "'YYYY-MM-DD'";
  const MINUTES_PER_WEEK = CONFIG.dayCapacityMinutes.reduce((a, b) => a + b, 0);

  // =========================================================================
  // SQL FRAGMENT BUILDERS
  // =========================================================================

  const toDate = iso => `TO_DATE('${iso}','YYYY-MM-DD')`;
  const toDateTime = s => `TO_DATE('${s}','YYYY-MM-DD HH24:MI')`;

  /** Weekday index for an ISO date, Monday = 0. */
  function weekdayIndex(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return (d.getUTCDay() + 6) % 7;
  }

  /** Cumulative capacity of complete days earlier in the same week. */
  function cumulativeDayCase(dowExpr) {
    let running = 0;
    const whens = CONFIG.dayCapacityMinutes.map((cap, i) => {
      const clause = `WHEN ${i} THEN ${running}`;
      running += cap;
      return clause;
    });
    return `CASE ${dowExpr} ${whens.join(' ')} ELSE ${MINUTES_PER_WEEK} END`;
  }

  /** Capacity of the day a timestamp falls on. */
  function dayCapacityCase(dowExpr) {
    const whens = CONFIG.dayCapacityMinutes
      .map((cap, i) => `WHEN ${dowExpr} = ${i} THEN ${cap}`)
      .join(' ');
    return `CASE ${whens} ELSE 0 END`;
  }

  /**
   * Cumulative business minutes from the epoch Monday to `t`, where `t` is
   * already an Eastern-local Oracle DATE.
   *
   * Taking the difference of this at two timestamps gives elapsed business
   * minutes, and it clamps for free: a timestamp outside the working window
   * scores the same as the close of the previous working period, so a Sunday
   * night arrival is identical to Monday 08:59.
   */
  function cumulativeMinutes(t) {
    const epoch = toDate(CONFIG.epochMonday);
    const dayNum = `FLOOR(${t} - ${epoch})`;
    const dow = `MOD(${dayNum},7)`;
    const weeks = `FLOOR(${dayNum}/7)`;

    const holidayList = CONFIG.holidays.map(toDate).join(',');

    // Minutes worked so far today, zero if today is a holiday.
    const minutesToday =
      `CASE WHEN TRUNC(${t}) IN (${holidayList}) THEN 0 ELSE ` +
      `LEAST(GREATEST((${t} - TRUNC(${t}))*1440 - ${CONFIG.dayStartMinute}, 0), ` +
      `${dayCapacityCase(dow)}) END`;

    // Remove capacity for every holiday strictly before today.
    // Grouped by capacity so the SQL stays compact.
    const byCapacity = {};
    CONFIG.holidays.forEach(iso => {
      const cap = CONFIG.dayCapacityMinutes[weekdayIndex(iso)];
      if (!cap) return; // holiday on a weekend costs nothing
      (byCapacity[cap] = byCapacity[cap] || []).push(iso);
    });
    const holidayDebt = Object.keys(byCapacity).map(cap => {
      const terms = byCapacity[cap]
        .map(iso => `SIGN(GREATEST(TRUNC(${t}) - ${toDate(iso)},0))`)
        .join('+');
      return `${cap}*(${terms})`;
    }).join(' - ');

    return `(${weeks}*${MINUTES_PER_WEEK} + ${cumulativeDayCase(dow)} + ${minutesToday}` +
           (holidayDebt ? ` - ${holidayDebt}` : '') + `)`;
  }

  /** Nth given weekday of a month, as an ISO date. weekday: 0 = Sunday. */
  function nthWeekday(year, month, weekday, n) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const shift = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + shift + (n - 1) * 7;
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  /**
   * UTC -> Eastern offset in hours for a UTC column.
   * DST runs 2nd Sunday of March 07:00 UTC to 1st Sunday of November 06:00 UTC.
   */
  function easternOffsetHours(col) {
    const windows = CONFIG.dstYears.map(y => {
      const start = `${nthWeekday(y, 3, 0, 2)} 07:00`;
      const end = `${nthWeekday(y, 11, 0, 1)} 06:00`;
      return `WHEN ${col} >= ${toDateTime(start)} AND ${col} < ${toDateTime(end)} THEN 4`;
    }).join(' ');
    return `CASE ${windows} ELSE 5 END`;
  }

  /** supportcase date field shifted into Eastern. */
  const caseFieldEastern = col => `(${col} + ${CONFIG.caseFieldOffsetHours}/24)`;

  /** message.messagedate shifted into Eastern. */
  const messageEastern = col => `(${col} - (${easternOffsetHours(col)})/24)`;

  /** Shared case-scope predicate. */
  function caseScope(alias, requireClosed) {
    const parts = [
      `${alias}.assigned = ${CONFIG.assignedEmployeeId}`,
      `${alias}.category <> ${CONFIG.spamCategoryId}`
    ];
    if (requireClosed) {
      parts.push(`${alias}.status = ${CONFIG.closedStatusId}`);
      parts.push(`${alias}.enddate IS NOT NULL`);
    }
    return parts.join(' AND ');
  }

  /** Only employee-authored, customer-facing emails count as ours. */
  const OUTBOUND_PREDICATE =
    "m.internalonly = 'F' AND m.messagetype = 'EMAIL' AND e.id IS NOT NULL";

  // =========================================================================
  // QUERIES
  // =========================================================================

  /**
   * Elapsed business minutes are computed as a difference of two cumulative
   * values. Rather than writing the (long) cumulative expression twice, each
   * case is fanned out into two rows -- +1 for the end timestamp, -1 for the
   * start -- and summed back per case.
   */
  const SIGN_PAIR = '(SELECT 1 AS sgn FROM DUAL UNION ALL SELECT -1 AS sgn FROM DUAL)';

  function resolutionSql() {
    const pairs =
      `SELECT sc.id AS cid, TO_CHAR(sc.enddate,'YYYY-MM-DD') AS bucket, ` +
      `${caseFieldEastern('sc.datecreated')} AS t_start, ` +
      `${caseFieldEastern('sc.enddate')} AS t_end ` +
      `FROM supportcase sc WHERE ${caseScope('sc', true)}`;

    return `
      SELECT bucket, LISTAGG(ROUND(bm), ',') WITHIN GROUP (ORDER BY bm) AS vals
      FROM (
        SELECT cid, bucket, SUM(sgn * ${cumulativeMinutes('t')}) AS bm
        FROM (
          SELECT p.cid, p.bucket, g.sgn,
                 CASE WHEN g.sgn = 1 THEN p.t_end ELSE p.t_start END AS t
          FROM (${pairs}) p CROSS JOIN ${SIGN_PAIR} g
        )
        GROUP BY cid, bucket
      )
      GROUP BY bucket ORDER BY bucket`;
  }

  function firstResponseSql() {
    const firstReply =
      `SELECT m.activity AS cid, MIN(m.messagedate) AS first_reply ` +
      `FROM message m JOIN employee e ON e.id = m.author ` +
      `WHERE ${OUTBOUND_PREDICATE} GROUP BY m.activity`;

    const pairs =
      `SELECT sc.id AS cid, ` +
      `TRUNC(${caseFieldEastern('sc.datecreated')}) AS bucket, ` +
      `${caseFieldEastern('sc.datecreated')} AS t_start, ` +
      `${messageEastern('x.first_reply')} AS t_end ` +
      `FROM supportcase sc JOIN (${firstReply}) x ON x.cid = sc.id ` +
      `WHERE ${caseScope('sc', false)}`;

    return `
      SELECT TO_CHAR(bucket,'YYYY-MM-DD') AS bucket,
             LISTAGG(ROUND(bm), ',') WITHIN GROUP (ORDER BY bm) AS vals
      FROM (
        SELECT cid, bucket, SUM(sgn * ${cumulativeMinutes('t')}) AS bm
        FROM (
          SELECT p.cid, p.bucket, g.sgn,
                 CASE WHEN g.sgn = 1 THEN p.t_end ELSE p.t_start END AS t
          FROM (${pairs}) p CROSS JOIN ${SIGN_PAIR} g
        )
        GROUP BY cid, bucket
      )
      GROUP BY bucket ORDER BY bucket`;
  }

  function correspondenceSql() {
    return `
      SELECT bucket, LISTAGG(outbound, ',') WITHIN GROUP (ORDER BY outbound) AS vals
      FROM (
        SELECT sc.id AS cid,
               TO_CHAR(sc.enddate,'YYYY-MM-DD') AS bucket,
               COUNT(CASE WHEN ${OUTBOUND_PREDICATE} THEN 1 END) AS outbound
        FROM supportcase sc
        LEFT JOIN message  m ON m.activity = sc.id
        LEFT JOIN employee e ON e.id = m.author
        WHERE ${caseScope('sc', true)}
        GROUP BY sc.id, TO_CHAR(sc.enddate,'YYYY-MM-DD')
      )
      WHERE outbound > 0
      GROUP BY bucket ORDER BY bucket`;
  }

  /**
   * Current time, in Eastern, for the "live as of" stamp.
   *
   * Do not use JavaScript for this. Measured simultaneously in this account:
   *   new Date().toISOString()  ->  01:18  (UTC)
   *   SYSDATE                   ->  18:18  (Pacific, NetSuite's server)
   *   CURRENT_DATE              ->  20:18  (Central, the account timezone)
   *
   * CURRENT_DATE resolves to the session timezone, which is the same zone
   * supportcase.datecreated comes back in -- so caseFieldOffsetHours converts
   * both of them to Eastern, and there is only one setting to get wrong.
   */
  function fetchGeneratedAt() {
    const sql =
      `SELECT TO_CHAR(CURRENT_DATE + ${CONFIG.caseFieldOffsetHours}/24, ` +
      `'Mon DD, YYYY HH12:MI AM') AS stamp FROM DUAL`;
    const rows = query.runSuiteQL({ query: sql }).asMappedResults();
    return rows.length ? rows[0].stamp : '';
  }

  /** Run a bucket/vals query and flatten to the compact wire format. */
  function runSeries(label, sql) {
    const rows = query.runSuiteQL({ query: sql }).asMappedResults();
    const parts = [];
    let cases = 0;
    rows.forEach(r => {
      const bucket = r.bucket;
      const vals = r.vals;
      if (!bucket || !vals) return;
      // Only digits, commas and minus signs reach the browser.
      const clean = String(vals).replace(/[^0-9,.\-]/g, '');
      if (!clean) return;
      cases += clean.split(',').length;
      parts.push(bucket + ':' + clean);
    });
    log.audit({ title: 'KPI series loaded', details: `${label}: ${rows.length} days, ${cases} cases` });
    return { wire: parts.join(';'), days: rows.length, cases };
  }

  // =========================================================================
  // VIEW
  // =========================================================================

  function buildHtml(series, bounds, generatedAt) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Support performance</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#EDF0F3; --card:#FFFFFF; --ink:#101418;
    --muted:#6E7A87; --faint:#98A3AE; --rule:#E1E7EC;
    --accent:#0F5F63; --accent-soft:#E4EEEE; --radius:14px;
    --display:"Space Grotesk",ui-sans-serif,system-ui,sans-serif;
    --body:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:var(--paper);color:var(--ink);font-family:var(--body);
    font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;padding:40px 24px 64px}
  .wrap{max-width:920px;margin:0 auto}
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
    flex-wrap:wrap;padding-bottom:20px;margin-bottom:28px;border-bottom:1px solid var(--rule)}
  h1{font-family:var(--display);font-size:26px;font-weight:500;letter-spacing:-0.02em;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13.5px;margin:0}
  .stamp{font-family:var(--display);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;
    color:var(--faint);text-align:right;line-height:1.6}
  .controls{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);
    padding:16px 18px;margin-bottom:28px;display:flex;justify-content:space-between;
    align-items:center;gap:20px;flex-wrap:wrap}
  .dates{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .dates label{font-size:13px;color:var(--muted)}
  input[type=date]{font-family:var(--body);font-size:13.5px;color:var(--ink);
    border:1px solid var(--rule);border-radius:8px;padding:7px 10px;background:#fff}
  input[type=date]:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .presets{display:flex;gap:6px;flex-wrap:wrap}
  .presets button{font-family:var(--body);font-size:12.5px;font-weight:500;color:var(--muted);
    background:transparent;border:1px solid var(--rule);border-radius:999px;padding:6px 13px;
    cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease}
  .presets button:hover{color:var(--ink);border-color:var(--faint)}
  .presets button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
  .metrics{display:flex;flex-direction:column;gap:16px}
  .metric{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);
    overflow:hidden;opacity:0;transform:translateY(8px);
    animation:rise .5s cubic-bezier(.2,.7,.3,1) forwards}
  .metric:nth-child(1){animation-delay:.04s}
  .metric:nth-child(2){animation-delay:.12s}
  .metric:nth-child(3){animation-delay:.20s}
  @keyframes rise{to{opacity:1;transform:none}}
  .metric-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;
    flex-wrap:wrap;padding:16px 22px 14px;border-bottom:1px solid var(--rule)}
  .eyebrow{font-family:var(--display);font-size:12px;font-weight:500;letter-spacing:0.11em;
    text-transform:uppercase;color:var(--accent);display:flex;align-items:center;gap:9px}
  .eyebrow::before{content:"";width:16px;height:2px;background:var(--accent);border-radius:2px}
  .basis{font-size:12.5px;color:var(--faint)}
  .pair{display:grid;grid-template-columns:1fr 1fr}
  .half{padding:22px 22px 20px}
  .half + .half{border-left:1px solid var(--rule)}
  .half-label{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
    color:var(--muted);margin-bottom:10px}
  .value{font-family:var(--display);font-size:46px;font-weight:500;letter-spacing:-0.03em;
    line-height:1;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;
    gap:2px;flex-wrap:wrap}
  .value .unit{font-size:19px;font-weight:400;color:var(--faint);letter-spacing:0;margin-right:8px}
  .gloss{font-size:12.5px;color:var(--muted);margin-top:10px}
  .chartwrap{padding:16px 22px 6px;border-top:1px solid var(--rule)}
  .chartlegend{display:flex;gap:16px;font-size:12px;color:var(--muted);margin-bottom:10px}
  .chartlegend span{display:flex;align-items:center;gap:6px}
  .chartlegend .gran{margin-left:auto;color:var(--faint)}
  .chartlegend i{width:15px;height:0;display:inline-block}
  .chartlegend i.dash{border-top:2px dashed #C4623A}
  .chartlegend i.solid{border-top:2px solid #2A6F97}
  .chart svg{display:block;width:100%;height:auto}
  .chart .empty{font-size:12.5px;color:var(--faint);padding:26px 0 30px;text-align:center}
  .metric-foot{padding:12px 22px;background:#F8FAFB;border-top:1px solid var(--rule);
    font-size:12.5px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .count{font-variant-numeric:tabular-nums}
  .notes{margin-top:32px;padding-top:22px;border-top:1px solid var(--rule);
    display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px}
  .note h3{font-family:var(--display);font-size:12px;font-weight:500;letter-spacing:.09em;
    text-transform:uppercase;color:var(--ink);margin:0 0 7px}
  .note p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.6}
  @media (max-width:640px){
    body{padding:26px 16px 48px}
    .pair{grid-template-columns:1fr}
    .half + .half{border-left:none;border-top:1px solid var(--rule)}
    .value{font-size:40px}
    .masthead{align-items:flex-start}.stamp{text-align:left}
  }
  @media (prefers-reduced-motion:reduce){
    .metric{animation:none;opacity:1;transform:none}
    *{transition:none !important}
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="masthead">
    <div>
      <h1>Support performance</h1>
      <p class="sub">Non-spam cases &middot; measured in business hours</p>
    </div>
    <div class="stamp">
      Mon&ndash;Thu 9&ndash;5 &middot; Fri 9&ndash;1 ET<br>
      Holidays excluded<br>
      Live as of ${generatedAt} ET
    </div>
  </header>

  <section class="controls" aria-label="Date range">
    <div class="dates">
      <label for="from">From</label>
      <input type="date" id="from" />
      <label for="to">to</label>
      <input type="date" id="to" />
    </div>
    <div class="presets" id="presets">
      <button data-d="tw">This week</button>
      <button data-d="lw">Last week</button>
      <button data-d="7">7 days</button>
      <button data-d="30">30 days</button>
      <button data-d="90">90 days</button>
      <button data-d="mtd">Month</button>
      <button data-d="qtd">Quarter</button>
      <button data-d="all" aria-pressed="true">All</button>
    </div>
  </section>

  <div class="metrics">
    <article class="metric">
      <div class="metric-head">
        <span class="eyebrow">Time to resolution</span>
        <span class="basis">Filtered by date closed</span>
      </div>
      <div class="pair">
        <div class="half">
          <div class="half-label">Average</div>
          <div class="value" id="r-mean">&mdash;</div>
          <p class="gloss">Pulled upward by a small number of long-running cases.</p>
        </div>
        <div class="half">
          <div class="half-label">Median</div>
          <div class="value" id="r-med">&mdash;</div>
          <p class="gloss">What a typical case actually takes.</p>
        </div>
      </div>
      <div class="chartwrap">
        <div class="chartlegend">
          <span><i class="dash"></i>average</span>
          <span><i class="solid"></i>median</span>
          <span class="gran" id="r-gran"></span>
        </div>
        <div class="chart" id="r-chart"></div>
      </div>
      <div class="metric-foot">
        <span>Case opened through case closed</span>
        <span class="count"><strong id="r-n">0</strong> cases closed</span>
      </div>
    </article>

    <article class="metric">
      <div class="metric-head">
        <span class="eyebrow">First response</span>
        <span class="basis">Filtered by date created</span>
      </div>
      <div class="pair">
        <div class="half">
          <div class="half-label">Average</div>
          <div class="value" id="p-mean">&mdash;</div>
          <p class="gloss">Includes cases that waited days for a first reply.</p>
        </div>
        <div class="half">
          <div class="half-label">Median</div>
          <div class="value" id="p-med">&mdash;</div>
          <p class="gloss">How long most customers wait to hear back.</p>
        </div>
      </div>
      <div class="chartwrap">
        <div class="chartlegend">
          <span><i class="dash"></i>average</span>
          <span><i class="solid"></i>median</span>
          <span class="gran" id="p-gran"></span>
        </div>
        <div class="chart" id="p-chart"></div>
      </div>
      <div class="metric-foot">
        <span>Case opened through first employee email</span>
        <span class="count"><strong id="p-n">0</strong> cases answered</span>
      </div>
    </article>

    <article class="metric">
      <div class="metric-head">
        <span class="eyebrow">Correspondences</span>
        <span class="basis">Filtered by date closed</span>
      </div>
      <div class="pair">
        <div class="half">
          <div class="half-label">Average</div>
          <div class="value" id="q-mean">&mdash;</div>
          <p class="gloss">Emails sent per case that received any reply.</p>
        </div>
        <div class="half">
          <div class="half-label">Median</div>
          <div class="value" id="q-med">&mdash;</div>
          <p class="gloss">Most cases are settled in a single email.</p>
        </div>
      </div>
      <div class="chartwrap">
        <div class="chartlegend">
          <span><i class="dash"></i>average</span>
          <span><i class="solid"></i>median</span>
          <span class="gran" id="q-gran"></span>
        </div>
        <div class="chart" id="q-chart"></div>
      </div>
      <div class="metric-foot">
        <span>Employee emails to the customer, internal notes excluded</span>
        <span class="count"><strong id="q-n">0</strong> cases with a reply</span>
      </div>
    </article>
  </div>

  <section class="notes">
    <div class="note">
      <h3>The clock</h3>
      <p>Time only accrues Monday to Thursday 9&ndash;5 and Friday 9&ndash;1, Eastern. A case arriving Sunday night starts counting Monday at 9:00.</p>
    </div>
    <div class="note">
      <h3>Why two numbers</h3>
      <p>A handful of cases run for weeks and drag the average far above the median. Read the median for typical performance and the average for how heavy the tail is.</p>
    </div>
    <div class="note">
      <h3>Different denominators</h3>
      <p>Resolution counts every closed case. First response and correspondences count only cases that got a reply, so their totals are smaller.</p>
    </div>
  </section>

</div>

<script>
var DATA = {
  resolution: ${JSON.stringify(series.resolution.wire)},
  response: ${JSON.stringify(series.response.wire)},
  correspondence: ${JSON.stringify(series.correspondence.wire)}
};
var MIN = ${JSON.stringify(bounds.min)};
var MAX = ${JSON.stringify(bounds.max)};

function parseSeries(s){
  if(!s) return [];
  return s.split(";").map(function(chunk){
    var i = chunk.indexOf(":");
    return { d: chunk.slice(0,i), v: chunk.slice(i+1).split(",").map(Number) };
  });
}
var SERIES = {
  resolution: parseSeries(DATA.resolution),
  response: parseSeries(DATA.response),
  correspondence: parseSeries(DATA.correspondence)
};

var fromEl = document.getElementById("from");
var toEl = document.getElementById("to");
[fromEl,toEl].forEach(function(el){ el.min = MIN; el.max = MAX; });
fromEl.value = MIN; toEl.value = MAX;

function shiftDays(iso,n){
  // Anchored to UTC on purpose. Parsing as local midnight and formatting via
  // toISOString shifts the day for anyone east of UTC.
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}
/** Today in the viewer's own timezone, built from local parts (not UTC). */
function todayLocal(){
  var d = new Date();
  var mm = String(d.getMonth()+1);
  var dd = String(d.getDate());
  if(mm.length < 2) mm = "0" + mm;
  if(dd.length < 2) dd = "0" + dd;
  return d.getFullYear() + "-" + mm + "-" + dd;
}
/** Monday of the week containing iso. Weeks run Monday to Sunday. */
function mondayOf(iso){
  var d = new Date(iso + "T00:00:00Z");
  return shiftDays(iso, -((d.getUTCDay() + 6) % 7));
}
/**
 * Apply a range, trimmed to the span the data actually covers. If the
 * requested week sits entirely outside that span the true dates are kept, so
 * a quiet week reads as empty rather than silently snapping onto the last
 * day that happened to have activity.
 */
function applyRange(a,b){
  if(a <= MAX && b >= MIN){
    if(a < MIN) a = MIN;
    if(b > MAX) b = MAX;
  }
  fromEl.value = a;
  toEl.value = b;
}
function collect(series,a,b){
  var out = [];
  series.forEach(function(row){
    if(row.d >= a && row.d <= b) out = out.concat(row.v);
  });
  return out.sort(function(x,y){ return x-y; });
}
function summarise(values){
  var n = values.length;
  if(!n) return null;
  var total = values.reduce(function(x,y){ return x+y; },0);
  var median = n % 2 ? values[(n-1)/2] : (values[n/2-1] + values[n/2]) / 2;
  return { n:n, mean: total/n, median: median };
}
function renderDuration(el,minutes){
  if(minutes === null || minutes === undefined){ el.textContent = "\\u2014"; return; }
  var total = Math.round(minutes);
  var h = Math.floor(total/60), m = total % 60;
  el.innerHTML = "<span>" + h + "</span><span class='unit'>h</span>" +
                 "<span>" + String(m).padStart(2,"0") + "</span><span class='unit'>m</span>";
}
/**
 * Group the per-case values inside [a,b] into buckets and return mean and
 * median for each. The median is taken across the actual case values in that
 * bucket, never averaged from per-day medians.
 *
 * Short ranges bucket by day. A one-week range grouped by week is a single
 * point with no line, which reads as broken -- and the week presets make that
 * the common case rather than the edge case.
 */
function bucketStats(series,a,b,mode){
  var buck = {};
  series.forEach(function(row){
    if(row.d < a || row.d > b) return;
    var k = mode === "day" ? row.d : mondayOf(row.d);
    if(!buck[k]) buck[k] = [];
    buck[k] = buck[k].concat(row.v);
  });
  return Object.keys(buck).sort().map(function(k){
    var v = buck[k].slice().sort(function(x,y){ return x-y; });
    var n = v.length;
    var sum = v.reduce(function(x,y){ return x+y; },0);
    return { w:k, n:n, mean:sum/n,
             med: n % 2 ? v[(n-1)/2] : (v[n/2-1] + v[n/2]) / 2 };
  });
}

/** Days spanned by the range, inclusive. */
function spanDays(a,b){
  return Math.round((Date.parse(b+"T00:00:00Z") - Date.parse(a+"T00:00:00Z")) / 86400000) + 1;
}

function niceMax(v){
  if(!(v > 0)) return 1;
  var mag = Math.pow(10, Math.floor(Math.log(v)/Math.LN10));
  var norm = v / mag;
  var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
function fmtAxis(v,isTime){
  if(!isTime) return (Math.round(v*10)/10).toString();
  if(v === 0) return "0";
  return Math.round(v/60) + "h";
}
function fmtPoint(v,isTime){
  if(!isTime) return (Math.round(v*100)/100).toFixed(2) + " emails";
  var t = Math.round(v);
  return Math.floor(t/60) + "h " + (t%60 < 10 ? "0" : "") + (t%60) + "m";
}
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/**
 * Two-line chart drawn as plain SVG. Deliberately dependency-free: a Suitelet
 * pulling a charting library off a CDN is exactly what a strict Content
 * Security Policy blocks, and a blank panel is worse than no panel.
 */
function drawChart(elId, weeks, isTime){
  var el = document.getElementById(elId);
  if(!weeks.length){ el.innerHTML = '<div class="empty">No cases in this range</div>'; return; }

  var W = 640, H = 170, padL = 46, padR = 10, padT = 10, padB = 24;
  var plotW = W - padL - padR, plotH = H - padT - padB;

  var top = 0;
  weeks.forEach(function(d){ top = Math.max(top, d.mean, d.med); });
  top = niceMax(top);

  var n = weeks.length;
  var xAt = function(i){ return n === 1 ? padL + plotW/2 : padL + (plotW * i / (n-1)); };
  var yAt = function(v){ return padT + plotH - (plotH * (v/top)); };

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Weekly average and median, ' + n + ' weeks">';

  for(var g = 0; g <= 2; g++){
    var gv = top * g / 2, gy = yAt(gv);
    svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W-padR) + '" y2="' + gy +
           '" stroke="#E1E7EC" stroke-width="1"/>';
    svg += '<text x="' + (padL-8) + '" y="' + (gy+4) + '" text-anchor="end" font-size="11" fill="#98A3AE">' +
           esc(fmtAxis(gv,isTime)) + '</text>';
  }

  var stride = Math.max(1, Math.ceil(n/6));
  weeks.forEach(function(d,i){
    if(i % stride && i !== n-1) return;
    svg += '<text x="' + xAt(i) + '" y="' + (H-6) + '" text-anchor="middle" font-size="11" fill="#98A3AE">' +
           esc(d.w.slice(5)) + '</text>';
  });

  var meanPts = weeks.map(function(d,i){ return xAt(i) + ',' + yAt(d.mean); }).join(' ');
  var medPts  = weeks.map(function(d,i){ return xAt(i) + ',' + yAt(d.med);  }).join(' ');
  if(n > 1){
    svg += '<polyline points="' + meanPts + '" fill="none" stroke="#C4623A" stroke-width="2" ' +
           'stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>';
    svg += '<polyline points="' + medPts + '" fill="none" stroke="#2A6F97" stroke-width="2" ' +
           'stroke-linejoin="round" stroke-linecap="round"/>';
  }
  if(n <= 16){
    weeks.forEach(function(d,i){
      svg += '<circle cx="' + xAt(i) + '" cy="' + yAt(d.mean) + '" r="3" fill="#C4623A"/>';
      svg += '<circle cx="' + xAt(i) + '" cy="' + yAt(d.med)  + '" r="3" fill="#2A6F97"/>';
    });
  }

  var band = n === 1 ? plotW : plotW / (n-1);
  weeks.forEach(function(d,i){
    var cx = xAt(i);
    svg += '<rect x="' + (cx - band/2) + '" y="' + padT + '" width="' + band + '" height="' + plotH +
           '" fill="transparent"><title>' +
           esc('Week of ' + d.w + '\\nAverage: ' + fmtPoint(d.mean,isTime) +
               '\\nMedian: ' + fmtPoint(d.med,isTime) + '\\n' + d.n + ' cases') +
           '</title></rect>';
  });

  svg += '</svg>';
  el.innerHTML = svg;
}

function update(){
  var a = fromEl.value || MIN, b = toEl.value || MAX;
  if(a > b){ b = a; toEl.value = b; }
  var res = summarise(collect(SERIES.resolution,a,b));
  var rsp = summarise(collect(SERIES.response,a,b));
  var cor = summarise(collect(SERIES.correspondence,a,b));

  renderDuration(document.getElementById("r-mean"), res && res.mean);
  renderDuration(document.getElementById("r-med"), res && res.median);
  document.getElementById("r-n").textContent = res ? res.n.toLocaleString() : "0";

  renderDuration(document.getElementById("p-mean"), rsp && rsp.mean);
  renderDuration(document.getElementById("p-med"), rsp && rsp.median);
  document.getElementById("p-n").textContent = rsp ? rsp.n.toLocaleString() : "0";

  document.getElementById("q-mean").textContent = cor ? cor.mean.toFixed(2) : "\\u2014";
  document.getElementById("q-med").textContent = cor
    ? (Number.isInteger(cor.median) ? cor.median : cor.median.toFixed(1)) : "\\u2014";
  document.getElementById("q-n").textContent = cor ? cor.n.toLocaleString() : "0";

  var mode = spanDays(a,b) <= 21 ? "day" : "week";
  var label = mode === "day" ? "by day" : "by week";
  ["r-gran","p-gran","q-gran"].forEach(function(id){
    document.getElementById(id).textContent = label;
  });
  drawChart("r-chart", bucketStats(SERIES.resolution,a,b,mode), true);
  drawChart("p-chart", bucketStats(SERIES.response,a,b,mode), true);
  drawChart("q-chart", bucketStats(SERIES.correspondence,a,b,mode), false);
}
function setPressed(active){
  var all = document.querySelectorAll("#presets button");
  Array.prototype.forEach.call(all, function(b){
    if(b === active) b.setAttribute("aria-pressed","true");
    else b.removeAttribute("aria-pressed");
  });
}
Array.prototype.forEach.call(document.querySelectorAll("#presets button"), function(btn){
  btn.addEventListener("click", function(){
    var v = btn.dataset.d;
    if(v === "tw"){
      applyRange(mondayOf(todayLocal()), todayLocal());
    }
    else if(v === "lw"){
      var lastMon = shiftDays(mondayOf(todayLocal()), -7);
      applyRange(lastMon, shiftDays(lastMon, 6));
    }
    else if(v === "all"){ fromEl.value = MIN; toEl.value = MAX; }
    else if(v === "mtd"){ fromEl.value = MAX.slice(0,8) + "01"; toEl.value = MAX; }
    else if(v === "qtd"){
      var month = Number(MAX.slice(5,7));
      var qStart = String(Math.floor((month-1)/3)*3 + 1);
      if(qStart.length < 2) qStart = "0" + qStart;
      fromEl.value = MAX.slice(0,5) + qStart + "-01";
      toEl.value = MAX;
    } else {
      fromEl.value = shiftDays(MAX, -(Number(v)-1));
      toEl.value = MAX;
    }
    setPressed(btn);
    update();
  });
});
[fromEl,toEl].forEach(function(el){
  el.addEventListener("change", function(){ setPressed(null); update(); });
});
update();
</script>
</body>
</html>`;
  }

  function errorHtml(message) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Support performance</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#EDF0F3;color:#101418;
padding:48px 24px;line-height:1.6}.box{max-width:620px;margin:0 auto;background:#fff;
border:1px solid #E1E7EC;border-radius:14px;padding:26px}h1{font-size:19px;margin:0 0 10px}
code{background:#F3F5F7;padding:2px 6px;border-radius:4px;font-size:13px}
p{color:#6E7A87;font-size:14px}</style></head><body><div class="box">
<h1>The dashboard could not load</h1>
<p>${message}</p>
<p>The most common cause is message-level access. The role running this Suitelet needs
<code>Messages for Analytics and REST</code> (Setup &gt; Users/Roles &gt; Manage Roles &gt;
Permissions &gt; Lists) set to View. Without it the message queries return only rows the
role authored or received, and the reply-based metrics come back near zero rather than
failing outright.</p>
<p>Check the script execution log for the underlying error.</p>
</div></body></html>`;
  }

  // =========================================================================
  // ENTRY POINT
  // =========================================================================

  function onRequest(context) {
    if (context.request.method !== 'GET') {
      context.response.write({ output: errorHtml('This page only responds to GET requests.') });
      return;
    }

    try {
      const series = {
        resolution: runSeries('resolution', resolutionSql()),
        response: runSeries('first response', firstResponseSql()),
        correspondence: runSeries('correspondence', correspondenceSql())
      };

      // Date bounds come from the data itself, so the pickers never allow an
      // empty range and the presets anchor on the most recent activity.
      const allDays = [];
      Object.keys(series).forEach(k => {
        (series[k].wire ? series[k].wire.split(';') : []).forEach(chunk => {
          allDays.push(chunk.slice(0, chunk.indexOf(':')));
        });
      });
      allDays.sort();

      if (!allDays.length) {
        context.response.write({
          output: errorHtml('The queries ran but returned no cases for the configured employee and filters.')
        });
        return;
      }

      const bounds = { min: allDays[0], max: allDays[allDays.length - 1] };

      context.response.write({
        output: buildHtml(series, bounds, fetchGeneratedAt())
      });

    } catch (e) {
      log.error({ title: 'Support dashboard failed', details: e.stack || e.message });
      context.response.write({ output: errorHtml(String(e.message || e)) });
    }
  }

  return { onRequest };
});