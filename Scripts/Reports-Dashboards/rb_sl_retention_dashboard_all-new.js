/**
 * RoyalBag Retention Dashboard — live Suitelet
 * ─────────────────────────────────────────────────────────────────────────────
 * One self-contained file. No other scripts, files or libraries are referenced:
 * the SuiteQL pulls, the data assembly, the full retention engine (a verified
 * port of process_pod.py, rev 2026-10-30), the HTML, the client-side filter,
 * sorting and the charts are all inside this file.
 *
 * DEPLOY
 *   1. Upload this file to the File Cabinet (SuiteScripts/...).
 *   2. Customization ▸ Scripting ▸ Scripts ▸ New ▸ pick this file ▸ Create Script Record.
 *   3. Deploy it: Status = Released, Audience = the sales team + managers.
 *      Log Level = Audit is enough (timings and governance are logged per run).
 *   4. Open the deployment's URL. No parameters are needed.
 *
 * WHO SEES WHAT (see ACCESS below)
 *   • Sara (7) and Nabeegh (546334): everything — whole team, both pods, every rep.
 *   • Mendy (8): Mendy pod — all, plus each member of that pod. Nothing else.
 *   • Fay (749): Fay pod — all, plus each member of that pod. Nothing else.
 *   • Other reps on a roster: their own book only, with no rep selector (ACCESS.OTHER_REPS).
 *   • Anyone else: denied.
 *   • URL parameters: view=team | pod_fay | pod_mendy | rep   (&rep=Full Name)
 *     e.g. …&view=rep&rep=Riki%20Friedman  → a one-rep dashboard, exactly as the
 *     skill's "individual build".
 *
 * DATES AND TIMEZONE
 *   "Today" is the logged-in user's date in THEIR timezone preference, so overdue
 *   maths matches the calendar on their desk. Every number is computed from the
 *   live NetSuite data at the moment the page is opened — there is no stale pull.
 *
 * MAINTENANCE — the only things that normally change
 *   • RB_CONFIG.REPS / PODS  — the pod registry (a new hire is one line).
 *   • RB_CONFIG.EXCLUSIONS   — account snoozes / notes / transfers. A snooze with no
 *     `until` date or no reason is rejected by design and shown as a note.
 *   Everything below the CONFIGURATION block is the engine; rules and constants
 *   are documented in "Retention System - Build Spec". Do not edit casually: the
 *   engine was verified figure-for-figure against the Python on live data.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/runtime', 'N/format', 'N/url', 'N/log'], function (query, runtime, format, url, log) {

  // ═══ CONFIGURATION ═══════════════════════════════════════════════════════
  // ACCESS — keyed on employee internal ID. Checked on every request, so editing the
  // URL can never widen what someone sees.
  var ACCESS = {
    FULL: [7, 546334],                              // Sara Ziegler, Nabeegh Ahmed — every view
    POD_LEADS: { 8: 'pod_mendy', 749: 'pod_fay' },  // Mendy, Fay — their pod (all) + each member of it
    OTHER_REPS: 'self',    // any other rep on a roster: 'self' (own book only, no rep selector) | 'pod' (their pod) | 'none'
    EVERYONE_ELSE: 'none'  // anyone not listed above: 'none' (access denied) | 'full'
  };
  var WEB_FONTS = true;          // false = no Google Fonts request (falls back to Arial/Georgia)
  var TOUCH_WINDOW_DAYS = 60;    // "What we actually did" window — covers last week + last month-end
  // ── CONFIGURATION — the pod registry and account exceptions (from the retention-pod skill) ──
  var RB_CONFIG = {
    REPS: { 'Fay Singer': 749, 'Taylor Kennedy': 496615, 'Gianna Saviano': 1006783, 'Riki Friedman': 20,
            'Mendy Eagle': 8, 'Renee Goldenberg': 21, 'Sruly Marsow': 317501 },
    PODS: [
      { id: 'pod_fay', name: 'Retention Pod — Fay, Taylor, Gianna & Riki', group: 'Fay pod',
        members: ['Fay Singer', 'Taylor Kennedy', 'Gianna Saviano', 'Riki Friedman'] },
      { id: 'pod_mendy', name: 'Retention Pod — Mendy, Renee & Sruly', group: 'Mendy pod',
        members: ['Mendy Eagle', 'Renee Goldenberg', 'Sruly Marsow'] }
    ],
    TEAM_NAME: 'Retention — Whole Team',
    EXCLUSIONS: [
      {"name": "Mario Badescu", "owner": "Mendy Eagle", "type": "snooze", "until": "2026-12-31", "reason": "Large order last year; expected to reorder around year-end."},
      {"name": "SMM Holdings LLC", "owner": "Mendy Eagle", "type": "snooze", "until": null, "reason": "$77K blanket PO draws down over time (false decline)."},
      {"name": "Oh Nuts", "owner": "Mendy Eagle", "type": "snooze", "until": null, "reason": "$20K blanket PO, same false-decline mechanism."},
      {"name": "AMR Management", "owner": "Mendy Eagle", "type": "snooze", "until": null, "reason": "Company closed down."},
      {"name": "FAROUK Systems", "owner": "Mendy Eagle", "type": "snooze", "until": "2026-08-31", "reason": "Blanket PO; new one to be arranged, then it resurfaces."},
      {"name": "Spice Kingdom", "owner": "Mendy Eagle", "type": "snooze", "until": "2026-09-30", "reason": "Still has stock from last order."},
      {"name": "Richard Bauer & Co.", "owner": "Mendy Eagle", "type": "note", "until": null, "reason": "Genuinely declining for a real reason — reseller's end customer reduced usage. New lower baseline."},
      {"name": "Robin Industries", "owner": "Renee Goldenberg", "type": "snooze", "until": "2026-10-15", "reason": "Overstocked; resurfaces mid-October."},
      {"name": "Bag Factory", "owner": "Renee Goldenberg", "type": "snooze", "until": null, "reason": "OK to be lost — cheaper backup supplier."},
      {"name": "Crown Staple", "owner": "Renee Goldenberg", "type": "snooze", "until": null, "reason": "OK to be lost — lost on price."},
      {"name": "Wilmington Fibre", "owner": "Renee Goldenberg", "type": "snooze", "until": null, "reason": "Deprioritized — ceiling ~$300-600."},
      {"name": "Ken Craft", "owner": "Renee Goldenberg", "type": "snooze", "until": null, "reason": "Long-dormant; Renee's call."},
      {"name": "Tara & Sons", "owner": "Renee Goldenberg", "type": "snooze", "until": null, "reason": "Low-priority pile."},
      {"name": "Matachi", "owner": "Renee Goldenberg", "type": "snooze", "until": null, "reason": "Explicitly told not to reach out."},
      {"name": "Smith & Warren", "owner": "Renee Goldenberg", "type": "note", "until": null, "reason": "Real cadence ~5-7 months, not 3. Don't chase as overdue."},
      {"name": "Precision Resource", "owner": "Renee Goldenberg", "type": "note", "until": null, "reason": "Real cadence ~6 months, not 4."},
      {"name": "Lions Services", "owner": "Fay Singer", "type": "note", "until": null, "reason": "Orders every ~2.5 months; the extra spot order was a one-off."},
      {"name": "Tedder Industries", "owner": "Fay Singer", "type": "snooze", "until": "2026-10-01", "reason": "Ordered extra to last longer; expected Fall 2026."},
      {"name": "The Smart Group", "owner": "Fay Singer", "type": "snooze", "until": null, "reason": "Now orders through Bizink."},
      {"name": "Schoolhouse Supplies", "owner": "Fay Singer", "type": "snooze", "until": "2027-06-01", "reason": "Stocked until summer 2027."},
      {"name": "Selkirk Sport", "owner": "Fay Singer", "type": "snooze", "until": "2026-10-01", "reason": "Will reorder Fall 2026."},
      {"name": "Tri Pro Graphics & Packaging", "owner": "Fay Singer", "type": "transferred", "until": null, "reason": "End customer moved the business; regained via another reseller."}
    ]
  };

  // ── SuiteQL builders (shared verbatim by the Suitelet and the test harness) ──
  function rbQueries(ids, todayISO, winISO) {
    var IDS = ids.join(',');
    var TODAY = "TO_DATE('" + todayISO + "','YYYY-MM-DD')";
    var WIN = "TO_DATE('" + winISO + "','YYYY-MM-DD')";
    var NM = "NVL(c.companyname,c.entityid)";
    var SUBJ = "UPPER(NVL(m.subject,' '))";
    // The AR / machine-noise filter. 2d and 2i MUST share it unchanged, or an account
    // reads "touched" on one tab and "no contact on record" on another.
    var AR = ""
      + " AND (m.message IS NULL OR (m.message NOT LIKE '<?xml%' AND m.message NOT LIKE '%<!DOCTYPE pdf%'))"
      + " AND NOT (m.incoming = 'F' AND m.transaction IS NOT NULL AND m.hasattachment = 'T'"
      + "   AND " + SUBJ + " NOT LIKE 'RE:%' AND " + SUBJ + " NOT LIKE 'FW%')"
      + " AND " + SUBJ + " NOT LIKE 'AUTOMATIC REPLY%' AND " + SUBJ + " NOT LIKE 'OUT OF OFFICE%'"
      + " AND " + SUBJ + " NOT LIKE 'UNDELIVERABLE%'"
      + ['STATEMENT', 'OPEN INVOICE', 'PAST DUE', 'OVERDUE', 'REMITTANCE', 'COLLECTION',
         'PAYMENT #', 'PAYMENT APPLIED', 'YOUR PAYMENT', 'PREPAYMENT REQUIRED']
          .map(function (w) { return " AND " + SUBJ + " NOT LIKE '%" + w + "%'"; }).join('')
      + " AND LOWER(NVL(m.authoremail,' ')) <> 'suri@royalbag.com'";
    var REORDER = ['reorder', 're-order', 'restock', 're-stock', 'stock up', 'order due',
                   'time to order', 'due to order']
      .map(function (w) { return "LOWER(ta.title) LIKE '%" + w + "%'"; }).join(' OR ');
    return {
      orders:
        "SELECT " + NM + " AS customer, c.salesrep AS ownerid, TO_CHAR(t.trandate,'YYYY-MM') AS ym,"
        + " SUM(t.foreigntotal) AS amt, COUNT(*) AS cnt, MAX(TO_CHAR(t.trandate,'MM/DD/YYYY')) AS maxd"
        + " FROM transaction t JOIN customer c ON c.id = t.entity"
        + " WHERE t.recordtype = 'salesorder' AND c.salesrep IN (" + IDS + ")"
        + " AND t.trandate >= TO_DATE('2025-01-01','YYYY-MM-DD')"
        + " GROUP BY " + NM + ", c.salesrep, TO_CHAR(t.trandate,'YYYY-MM')",
      invoices:
        "SELECT " + NM + " AS customer, c.salesrep AS ownerid, TO_CHAR(t.trandate,'YYYY-MM') AS ym,"
        + " SUM(t.foreigntotal) AS amt, COUNT(*) AS cnt, MAX(TO_CHAR(t.trandate,'MM/DD/YYYY')) AS maxd"
        + " FROM transaction t JOIN customer c ON c.id = t.entity"
        + " WHERE t.recordtype = 'invoice' AND c.salesrep IN (" + IDS + ")"
        + " AND t.trandate BETWEEN TO_DATE('2023-01-01','YYYY-MM-DD') AND TO_DATE('2024-12-31','YYYY-MM-DD')"
        + " GROUP BY " + NM + ", c.salesrep, TO_CHAR(t.trandate,'YYYY-MM')",
      items:
        "SELECT a.customer, a.itemid, COUNT(*) AS n_months,"
        + " LISTAGG(a.ym, ',') WITHIN GROUP (ORDER BY a.ym) AS months,"
        + " LISTAGG(a.maxd, ',') WITHIN GROUP (ORDER BY a.ym) AS dates,"
        + " LISTAGG(TO_CHAR(ROUND(a.amt,2)), ',') WITHIN GROUP (ORDER BY a.ym) AS amts"
        + " FROM (SELECT " + NM + " AS customer, tl.item AS itemid, TO_CHAR(t.trandate,'YYYY-MM') AS ym,"
        + "  SUM(ABS(tl.netamount)) AS amt, MAX(TO_CHAR(t.trandate,'MM/DD/YYYY')) AS maxd"
        + "  FROM transaction t JOIN transactionline tl ON tl.transaction = t.id"
        + "  JOIN customer c ON c.id = t.entity"
        + "  WHERE t.recordtype = 'salesorder' AND c.salesrep IN (" + IDS + ")"
        + "  AND t.trandate >= TO_DATE('2025-01-01','YYYY-MM-DD') AND tl.item > 0"
        + "  GROUP BY " + NM + ", tl.item, TO_CHAR(t.trandate,'YYYY-MM')) a"
        + " GROUP BY a.customer, a.itemid HAVING COUNT(*) >= 3",
      contacts:
        "SELECT c.salesrep AS ownerid, m.entity AS i, " + NM + " AS customer,"
        + " TO_CHAR(MAX(m.messagedate),'YYYY-MM-DD') AS last_msg, COUNT(*) AS n,"
        + " MAX(m.incoming) KEEP (DENSE_RANK LAST ORDER BY m.messagedate, m.id) AS last_dir,"
        + " SUBSTR(MAX(m.subject) KEEP (DENSE_RANK LAST ORDER BY m.messagedate, m.id),1,70) AS last_subj"
        + " FROM message m JOIN customer c ON c.id = m.entity"
        + " WHERE c.salesrep IN (" + IDS + ") AND m.messagedate >= TO_DATE('2025-01-01','YYYY-MM-DD')"
        + " AND m.messagedate <= " + TODAY + AR
        + " GROUP BY c.salesrep, m.entity, " + NM,
      activity:
        "SELECT c.salesrep AS ownerid, ta.company AS i, " + NM + " AS customer,"
        + " TO_CHAR(MAX(ta.duedate),'YYYY-MM-DD') AS d, COUNT(*) AS n,"
        + " SUBSTR(MAX(ta.title) KEEP (DENSE_RANK LAST ORDER BY ta.duedate, ta.id),1,120) AS title,"
        + " TO_CHAR(MAX(ta.completeddate) KEEP (DENSE_RANK LAST ORDER BY ta.duedate, ta.id),'YYYY-MM-DD') AS last_done,"
        + " SUBSTR(MAX(ta.message) KEEP (DENSE_RANK LAST ORDER BY ta.duedate, ta.id),1,160) AS last_note,"
        + " SUM(CASE WHEN ta.completeddate IS NULL THEN 1 ELSE 0 END) AS n_open"
        + " FROM task ta JOIN customer c ON c.id = ta.company"
        + " WHERE c.salesrep IN (" + IDS + ") AND ta.duedate >= TO_DATE('2024-01-01','YYYY-MM-DD')"
        + " AND ta.duedate <= " + TODAY
        + " GROUP BY c.salesrep, ta.company, " + NM,
      reptasks:
        "SELECT ta.company AS i, " + NM + " AS customer, TO_CHAR(MIN(ta.duedate),'YYYY-MM-DD') AS d,"
        + " SUBSTR(MIN(ta.title) KEEP (DENSE_RANK FIRST ORDER BY ta.duedate, ta.id),1,90) AS title"
        + " FROM task ta JOIN customer c ON c.id = ta.company"
        + " WHERE c.salesrep IN (" + IDS + ") AND ta.duedate > " + TODAY + " AND (" + REORDER + ")"
        + " GROUP BY ta.company, " + NM,
      touchtasks:
        "SELECT ta.id AS tid, ta.company AS i, " + NM + " AS customer, c.salesrep AS ownerid,"
        + " ta.assigned AS assignedid, TO_CHAR(ta.duedate,'YYYY-MM-DD') AS d,"
        + " TO_CHAR(ta.completeddate,'YYYY-MM-DD') AS done, SUBSTR(ta.title,1,90) AS title"
        + " FROM task ta JOIN customer c ON c.id = ta.company"
        + " WHERE c.salesrep IN (" + IDS + ") AND ta.duedate >= " + WIN + " AND ta.duedate <= " + TODAY,
      touchmsgs:
        "SELECT m.id AS mid, m.entity AS i, " + NM + " AS customer, c.salesrep AS ownerid,"
        + " m.author AS authorid, m.incoming AS inc, TO_CHAR(m.messagedate,'YYYY-MM-DD') AS d,"
        + " SUBSTR(m.subject,1,90) AS subj"
        + " FROM message m JOIN customer c ON c.id = m.entity"
        + " WHERE c.salesrep IN (" + IDS + ") AND c.stage = 'CUSTOMER'"
        + " AND m.messagedate >= " + WIN + " AND m.messagedate <= " + TODAY + AR,
      employees:
        "SELECT e.id, e.firstname || ' ' || e.lastname AS full_name, e.issalesrep AS isrep, e.isinactive AS inact FROM employee e"
    };
  }

  // ── STEP 3: query rows → ns_raw_data.json contract (shared with the Suitelet) ──
  function rbAssemble(R, cfg) {
    // R: {orders, invoices, items, contacts, activity, reptasks, touchtasks, touchmsgs, employees}
    // cfg: {rep_name, dashboard_id, pod_members:[names], pod_groups:{}|null, ids:{name:id}, exclusions:[]}
    function s(v) { return (v === null || v === undefined) ? '' : String(v); }
    function nm(v) { return s(v).replace(/^\s+|\s+$/g, '').replace(/^C\d+\s+/, ''); }
    var emp = {};
    (R.employees || []).forEach(function (e) { emp[String(e.id)] = s(e.full_name).replace(/^\s+|\s+$/g, ''); });
    var ownerName = {};
    cfg.pod_members.forEach(function (m) { if (cfg.ids[m] !== undefined) ownerName[String(cfg.ids[m])] = m; });
    var keep = function (r) { return ownerName[String(r.ownerid)] !== undefined; };
    var raw = { rep_name: cfg.rep_name, pod_mode: true, dashboard_id: cfg.dashboard_id,
      pod_members: cfg.pod_members.slice(), orders: [], invoices: [], items: [], activity: [], contacts: [],
      touchlog: [], rep_tasks: {}, exclusions: cfg.exclusions || [] };
    if (cfg.pod_groups) raw.pod_groups = cfg.pod_groups;
    var podCust = {};
    ['orders', 'invoices'].forEach(function (k) {
      (R[k] || []).forEach(function (r) {
        if (!keep(r)) return;
        var cnt = parseInt(r.cnt, 10) || 1, amt = Number(r.amt) || 0, c = nm(r.customer);
        podCust[c] = 1;
        for (var i = 0; i < cnt; i++) raw[k].push({ date: r.maxd, customer: c, amount: amt / cnt, owner: ownerName[String(r.ownerid)] });
      });
    });
    (R.items || []).forEach(function (r) {
      var c = nm(r.customer);
      if (!podCust[c] || r.months === null || r.dates === null || r.amts === null || r.months === undefined) return;
      var ms = s(r.months).split(','), ds = s(r.dates).split(','), as = s(r.amts).split(',');
      if (ms.length !== ds.length || ms.length !== as.length) return;
      for (var i = 0; i < ms.length; i++)
        raw.items.push({ customer: c, item: s(r.itemid), month: ms[i], qty: 0, amount: Number(as[i]) || 0, date: ds[i] });
    });
    (R.activity || []).forEach(function (r) {
      if (!keep(r)) return;
      raw.activity.push({ customer: nm(r.customer), title: s(r.title), last_activity_date: r.d,
        done: r.last_done || null, note: s(r.last_note), n_open: parseInt(r.n_open, 10) || 0 });
    });
    (R.contacts || []).forEach(function (r) {
      if (!keep(r)) return;
      raw.contacts.push({ customer: nm(r.customer), date: r.last_msg, direction: (r.last_dir === 'T' || r.last_dir === true) ? 'in' : 'out',
        subject: s(r.last_subj), n: parseInt(r.n, 10) || 0 });
    });
    // forward reorder tasks: keep the earliest per customer name, only for this roster's accounts
    var podIds = {};
    ['activity', 'contacts', 'touchtasks', 'touchmsgs'].forEach(function (k) {
      (R[k] || []).forEach(function (r) { if (keep(r)) podIds[String(r.i)] = 1; });
    });
    (R.reptasks || []).forEach(function (r) {
      var c = nm(r.customer);
      if (!podCust[c] && !podIds[String(r.i)]) return;
      var ex = raw.rep_tasks[c];
      if (!ex || r.d < ex.due) raw.rep_tasks[c] = { due: r.d, title: s(r.title) };
    });
    var seenT = {}, seenM = {};
    (R.touchtasks || []).forEach(function (r) {
      if (!keep(r) || seenT[r.tid]) return; seenT[r.tid] = 1;
      var who = emp[String(r.assignedid)] || ownerName[String(r.ownerid)];
      raw.touchlog.push({ customer: nm(r.customer), date: r.d, dir: 'out', kind: 'task', who: who, done: r.done || null, subject: s(r.title) });
    });
    (R.touchmsgs || []).forEach(function (r) {
      if (!keep(r) || seenM[r.mid]) return; seenM[r.mid] = 1;
      var inbound = (r.inc === 'T' || r.inc === true);
      var who = emp[String(r.authorid)] || (inbound ? 'Customer' : ownerName[String(r.ownerid)]);
      raw.touchlog.push({ customer: nm(r.customer), date: r.d, dir: inbound ? 'in' : 'out', kind: 'email', who: who, done: null, subject: s(r.subj) });
    });
    return raw;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RETENTION ENGINE — faithful JavaScript port of process_pod.py (rev 2026-10-30)
  // rbEngine(raw, todayYMD) → { html, summary[] }
  // `raw` is exactly the ns_raw_data.json contract. Every rule, constant, tab,
  // chart and panel of the Python engine is reproduced here; nothing is
  // re-derived. Python numeric semantics (banker's rounding, float repr,
  // timedelta flooring) are emulated so both engines print the same figures.
  // ═══════════════════════════════════════════════════════════════════════════
  function rbEngine(raw, TODAY_YMD, OPT) {
    OPT = OPT || {};
    var DAY = 86400000000; // one day in microseconds (Python datetime resolution)

    // ─── PYTHON-COMPAT NUMERICS ─────────────────────────────────────────────
    function twoProdErr(a, b, p) {
      var S = 134217729, c, ah, al, bh, bl;
      c = S * a; ah = c - (c - a); al = a - ah;
      c = S * b; bh = c - (c - b); bl = b - bh;
      return ((ah * bh - p) + ah * bl + al * bh) + al * bl;
    }
    // round-half-even of |x|·10^nd on the exact binary value → integer N
    function _scaledN(ax, nd) {
      var P = Math.pow(10, nd), y = ax * P, e = twoProdErr(ax, P, y);
      var fl = Math.floor(y), f = y - fl;
      if (f > 0.5) return fl + 1;
      if (f < 0.5) { if (f === 0 && e < 0) return fl; return fl; }
      if (e > 0) return fl + 1;
      if (e < 0) return fl;
      return (fl % 2 === 0) ? fl : fl + 1;
    }
    function pyRound(x, nd) {              // Python round(x, nd) / round(x)
      if (x === null || x === undefined) return x;
      if (!isFinite(x)) return x;
      nd = nd || 0;
      var neg = x < 0 || (x === 0 && 1 / x < 0), N = _scaledN(Math.abs(x), nd);
      var r = nd ? N / Math.pow(10, nd) : N;
      return neg ? -r : r;
    }
    function pyFmt(x, nd) {                // Python '%.{nd}f' % x
      var neg = x < 0 || (x === 0 && 1 / x < 0), N = _scaledN(Math.abs(x), nd);
      var s = String(N);
      if (nd > 0) {
        while (s.length <= nd) s = '0' + s;
        s = s.slice(0, s.length - nd) + '.' + s.slice(s.length - nd);
      }
      return (neg ? '-' : '') + s;
    }
    function pyFloat(x) {                  // Python str()/repr() of a float
      if (x === 0) return (1 / x < 0) ? '-0.0' : '0.0';
      if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(0) + '.0';
      return String(x);
    }
    function pyNum(x, isInt) { return isInt ? String(x) : pyFloat(x); }
    function comma(n) {                    // '{:,}'.format(int)
      var s = String(Math.abs(n)), o = '';
      while (s.length > 3) { o = ',' + s.slice(-3) + o; s = s.slice(0, -3); }
      return (n < 0 ? '-' : '') + s + o;
    }
    function pyTrunc(x) { return x < 0 ? Math.ceil(x) : Math.floor(x); }
    // exact (Shewchuk) summation → correctly-rounded mean, as statistics.mean
    function _partials(arr) {
      var p = [];
      for (var k = 0; k < arr.length; k++) {
        var x = arr[k], i = 0;
        for (var j = 0; j < p.length; j++) {
          var y = p[j]; if (Math.abs(x) < Math.abs(y)) { var t = x; x = y; y = t; }
          var hi = x + y, lo = y - (hi - x);
          if (lo) p[i++] = lo; x = hi;
        }
        p.length = i; p.push(x);
      }
      return p;
    }
    function fsum(arr) {
      var p = _partials(arr), n = p.length, hi = 0, lo = 0;
      if (n > 0) {
        hi = p[--n];
        while (n > 0) { var x = hi, y = p[--n]; hi = x + y; var yr = hi - x; lo = y - yr; if (lo) break; }
        if (n > 0 && ((lo < 0 && p[n - 1] < 0) || (lo > 0 && p[n - 1] > 0))) {
          var y2 = lo * 2, x2 = hi + y2, yr2 = x2 - hi; if (y2 === yr2) hi = x2;
        }
      }
      return hi;
    }
    function mean(arr) {
      var n = arr.length, p = _partials(arr), q = fsum(p) / n;
      var ph = q * n, pl = twoProdErr(q, n, ph);
      var r = fsum(p.concat([-ph, -pl]));
      return q + r / n;
    }
    function stdev(arr) {
      var m = mean(arr), d = arr.map(function (x) { return (x - m) * (x - m); });
      return Math.sqrt(fsum(d) / (arr.length - 1));
    }
    function median(arr) {
      var s = arr.slice().sort(function (a, b) { return a - b; }), n = s.length;
      if (n % 2 === 1) return s[(n - 1) / 2];
      return (s[n / 2 - 1] + s[n / 2]) / 2;
    }
    function sum(arr) {                   // CPython >=3.12 builtin sum(): Neumaier-compensated
      var f = 0, c = 0;
      for (var i = 0; i < arr.length; i++) {
        var x = arr[i], t = f + x;
        if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x; else c += (x - t) + f;
        f = t;
      }
      if (c && isFinite(c)) f += c;
      return f;
    }
    function mvals(m) { return Array.from(m.values()); }
    function pySlice(s, n) {
      s = String(s);
      if (!/[\uD800-\uDFFF]/.test(s)) return s.slice(0, n);
      return Array.from(s).slice(0, n).join('');
    }
    function lower(s) { return String(s).toLowerCase(); }
    function strip(s) { return String(s).replace(/^\s+|\s+$/g, ''); }
    function pyStr(v) { return (v === null || v === undefined) ? 'None' : String(v); }
    function stableSort(arr, keyFn) {      // Python list.sort(key=...) with tuple keys
      var idx = arr.map(function (v, i) { return [keyFn(v), i, v]; });
      idx.sort(function (a, b) { var c = cmpKey(a[0], b[0]); return c || (a[1] - b[1]); });
      return idx.map(function (x) { return x[2]; });
    }
    function cmpKey(a, b) {
      if (Array.isArray(a)) {
        for (var i = 0; i < a.length && i < b.length; i++) { var c = cmpKey(a[i], b[i]); if (c) return c; }
        return a.length - b.length;
      }
      if (typeof a === 'boolean') { a = a ? 1 : 0; b = b ? 1 : 0; }
      return a < b ? -1 : a > b ? 1 : 0;
    }
    function strSort(arr) { return arr.slice().sort(); }

    // ─── DATES (microseconds since epoch, UTC calendar) ─────────────────────
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                 'September', 'October', 'November', 'December'];
    var WDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    function mk(y, m, d) { return (Date.UTC(y, m - 1, d) / 86400000) * DAY; }
    function parts(us) {
      var dt = new Date(Math.floor(us / 1000));
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
               wd: (dt.getUTCDay() + 6) % 7 };
    }
    function validYMD(y, m, d) {
      if (m < 1 || m > 12 || d < 1) return false;
      return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    }
    function parseDate(s) {
      if (s === null || s === undefined || s === '' || s === false) return null;
      s = strip(String(s)); var r, y, m, d;
      if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { m = +r[1]; d = +r[2]; y = +r[3]; }
      else if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
      else if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s))) {
        m = +r[1]; d = +r[2]; y = +r[3]; y += (y <= 68 ? 2000 : 1900);
      } else return null;
      return validYMD(y, m, d) ? mk(y, m, d) : null;
    }
    function floorDay(us) { return Math.floor(us / DAY) * DAY; }
    function ymd(us) { var p = parts(floorDay(us)); return p.y + '-' + pad2(p.m) + '-' + pad2(p.d); }
    function ym(us) { var p = parts(us); return p.y + '-' + pad2(p.m); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function addDays(us, days) {           // + timedelta(days=float)
      var whole = pyTrunc(days), frac = days - whole;
      return us + whole * DAY + Math.round(frac * DAY);
    }
    function tdDays(a, b) { return Math.floor((a - b) / DAY); }   // (a - b).days
    function monthsDiff(a, b) {
      return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
    }
    function strptimeYMD(s) { return parseDate(s); }
    function fmtDate(us, f) {
      var p = parts(us);
      return f.replace(/%[bBdYAm]/g, function (t) {
        switch (t) {
          case '%b': return MON[p.m - 1]; case '%B': return MONTH[p.m - 1];
          case '%d': return pad2(p.d); case '%Y': return String(p.y);
          case '%A': return WDAY[p.wd]; case '%m': return pad2(p.m);
        }
      });
    }
    function replaceDay(us, d) { var p = parts(us); return mk(p.y, p.m, d); }
    function replaceYear(us, y) {
      var p = parts(us), d = p.d;
      if (!validYMD(y, p.m, d)) d = new Date(Date.UTC(y, p.m, 0)).getUTCDate();
      return mk(y, p.m, d);
    }
    function nextMonthStart(us) { return replaceDay(addDays(replaceDay(us, 28), 4), 1); }
    function prevMonthEnd(us) { return addDays(replaceDay(us, 1), -1); }
    function getAmt(v) {
      var s = (v === null || v === undefined) ? 'None' : String(v);
      s = s.replace(/,/g, '').replace(/\$/g, '');
      if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s)) return 0.0;
      return Number(s);
    }
    function mapGet(m, k, init) { var v = m.get(k); if (v === undefined) { v = init(); m.set(k, v); } return v; }

    var TODAY = parseDate(TODAY_YMD);
    var TP = parts(TODAY);
    var MONTHS_2026 = Math.max(1, TP.m - 1);
    var Y0 = TP.y, Y1 = Y0 - 1, Y2 = Y0 - 2, Y3 = Y0 - 3;
    var YEARS = [Y3, Y2, Y1, Y0];
    var INVOICE_MAX_YEAR = 2024, ORDER_MIN_YEAR = 2025;

    var GRACE_FRACTION = 0.20, GRACE_MIN_MONTHS = 0.5, THIN_BOOK_MIN = 15, GONE_MONTHS = 12.0;
    var BIG_ORDER_MULT = 1.75, SMALL_ORDER_MULT = 0.5, SUSTAINED_GAPS = 2, SUSTAINED_RATIO = 1.30;
    var DROPPED_LINE_MONTHS = 9, DROPPED_LINE_MULT = 2.0, DROPPED_MIN_SPEND = 250.0, DROPPED_MIN_SHARE = 0.03;
    var NEW_CUSTOMER_MONTHS = 6;
    var TASK_TOO_EARLY_MONTHS = 2.0, TASK_LIVE_MONTHS = 9.0, TASK_COLD_MONTHS = 18.0;
    var REP_NAME = raw.rep_name || 'Rep';
    var POD_MODE = !!raw.pod_mode;
    var DASH_ID = raw.dashboard_id || lower(REP_NAME).replace(/[^a-z0-9]+/g, '_');

    // ─── POD ROSTER + PER-REP COLORS ─────────────────────────────────────────
    var _POD_PALETTE = ['#6c5ce7', '#00897b', '#c8490c', '#2980b9', '#8e44ad', '#16a085', '#d35400', '#2c3e50', '#c0392b', '#27ae60'];
    var POD_MEMBERS = [], POD_COLORS = {}, _pi = 0;
    (raw.pod_members || []).forEach(function (m) {
      var nm, col;
      if (typeof m === 'string') { nm = m; col = null; } else { nm = (m.name === undefined ? '' : m.name); col = m.color; }
      nm = strip(String(nm));
      if (!nm) return;
      POD_MEMBERS.push(nm);
      if (!col) { col = _POD_PALETTE[_pi % _POD_PALETTE.length]; _pi += 1; }
      POD_COLORS[lower(nm)] = col;
      var fn = lower(nm).split(/\s+/)[0];
      if (!(fn in POD_COLORS)) POD_COLORS[fn] = col;
    });
    function _owner_color(o) {
      if (!o) return '#7f8c8d';
      var k = lower(strip(String(o)));
      if (k in POD_COLORS) return POD_COLORS[k];
      var ps = k.split(/\s+/).filter(Boolean);
      if (ps.length && (ps[0] in POD_COLORS)) return POD_COLORS[ps[0]];
      return '#7f8c8d';
    }

    // ─── ACCOUNT EXCLUSIONS ─────────────────────────────────────────────────
    var EXCLUSIONS = [], INVALID_SNOOZES = [];
    (raw.exclusions || []).forEach(function (ex) {
      var nm = lower(strip(pyStr(ex.name === undefined ? '' : ex.name)));
      var until = parseDate(ex.until);
      var etype = lower(strip(pyStr(ex.type === undefined ? 'snooze' : ex.type))) || 'snooze';
      var owner = lower(strip(pyStr(ex.owner === undefined ? '' : ex.owner)));
      var reason = strip(pyStr(ex.reason === undefined ? '' : ex.reason));
      if (etype === 'snooze' && (until === null || !reason)) {
        INVALID_SNOOZES.push({ name: ex.name === undefined ? '' : ex.name,
          missing: (until === null ? 'reactivate date' : '') + ((until === null && !reason) ? ' and ' : '') + (!reason ? 'reason' : '') });
        etype = 'note';
      }
      if (nm && (etype === 'note' || etype === 'transferred' || until === null || until > TODAY)) {
        EXCLUSIONS.push({ name: nm, until: until, reason: pyStr(ex.reason === undefined ? '' : ex.reason), type: etype, owner: owner });
      }
    });
    function _ex_match(ex, cname, cowner) {
      var cl = lower(strip(String(cname)));
      if (!(cl.indexOf(ex.name) >= 0 || ex.name.indexOf(cl) >= 0)) return false;
      if (ex.owner) {
        var co = lower(strip(String(cowner || '')));
        if (co.indexOf(ex.owner) < 0 && ex.owner.indexOf(co) < 0) return false;
      }
      return true;
    }
    function excluded_info(cname, cowner) {
      var snooze = null, note = null;
      EXCLUSIONS.forEach(function (ex) {
        if (_ex_match(ex, cname, cowner)) {
          if (ex.type === 'note' && note === null) note = ex;
          else if (ex.type !== 'note' && snooze === null) snooze = ex;
        }
      });
      return snooze || note;
    }
    function transferred_info(cname, cowner) {
      for (var i = 0; i < EXCLUSIONS.length; i++) { var ex = EXCLUSIONS[i];
        if (ex.type === 'transferred' && _ex_match(ex, cname, cowner)) return ex; }
      return null;
    }
    function note_info(cname, cowner) {
      for (var i = 0; i < EXCLUSIONS.length; i++) { var ex = EXCLUSIONS[i];
        if (ex.type === 'note' && _ex_match(ex, cname, cowner)) return ex; }
      return null;
    }

    // ─── REP REORDER TASKS ──────────────────────────────────────────────────
    var REP_TASKS = {}, REP_TASK_TITLE = {};
    var _rt = raw.rep_tasks || {};
    Object.keys(_rt).forEach(function (k) {
      var v = _rt[k], ttl = '';
      if (v && typeof v === 'object') { ttl = (v.title ? String(v.title) : ''); v = v.due; }
      var d = parseDate(v);
      if (d !== null) { var kk = lower(strip(String(k))); REP_TASKS[kk] = d; if (ttl) REP_TASK_TITLE[kk] = ttl; }
    });
    function _rep_task_for(c) { var k = lower(strip(String(c))); return (k in REP_TASKS) ? REP_TASKS[k] : null; }
    function _rep_task_title(c) { var k = lower(strip(String(c))); return (k in REP_TASK_TITLE) ? REP_TASK_TITLE[k] : ''; }

    // ─── OWNER ATTRIBUTION ──────────────────────────────────────────────────
    var cust_owner_rev = new Map(), cust_owner_cnt = new Map();
    [['invoices', null, INVOICE_MAX_YEAR], ['orders', ORDER_MIN_YEAR, null]].forEach(function (src) {
      (raw[src[0]] || []).forEach(function (row) {
        var d = parseDate(row.date); if (d === null) return;
        var yr = parts(d).y;
        if (src[2] !== null && yr > src[2]) return;
        if (src[1] !== null && yr < src[1]) return;
        var amt = getAmt(row.amount === undefined ? 0 : row.amount);
        var cust = strip(pyStr(row.customer === undefined ? '' : row.customer)).replace(/^C\d+\s+/, '');
        if (!cust) return;
        var ow = strip(pyStr(row.owner === undefined ? '' : row.owner)) || '—';
        var mr = mapGet(cust_owner_rev, cust, function () { return new Map(); });
        mr.set(ow, (mr.get(ow) || 0) + amt);
        var mc = mapGet(cust_owner_cnt, cust, function () { return new Map(); });
        mc.set(ow, (mc.get(ow) || 0) + 1);
      });
    });
    function _owner_of(cname) {
      var mr = cust_owner_rev.get(cname);
      if (mr && mr.size) {
        var best = null, bk = null, mc = cust_owner_cnt.get(cname);
        mr.forEach(function (rev, ow) {
          var key = [rev, mc.get(ow) || 0];
          if (best === null || cmpKey(key, bk) > 0) { best = ow; bk = key; }
        });
        return best;
      }
      return '—';
    }

    // ─── STATE BUILDER (as-of aware) ────────────────────────────────────────
    function build_state(AS_OF) {
      var AP = parts(AS_OF);
      // Completed months in the as-of year. (Python hard-coded `== 2026`; this is
      // the same rule generalised to whichever year is current.)
      var _months_elapsed = Math.max(1, (AP.y >= Y0) ? (AP.m - 1) : 12);

      var txns = new Map();
      (raw.invoices || []).forEach(function (row) {
        var d = parseDate(row.date);
        if (d === null || parts(d).y > INVOICE_MAX_YEAR || d > AS_OF) return;
        var amt = getAmt(row.amount === undefined ? 0 : row.amount);
        var cust = strip(pyStr(row.customer === undefined ? '' : row.customer)).replace(/^C\d+\s+/, '');
        if (cust) mapGet(txns, cust, function () { return []; }).push({ date: d, amount: amt });
      });
      (raw.orders || []).forEach(function (row) {
        var d = parseDate(row.date);
        if (d === null || parts(d).y < ORDER_MIN_YEAR || d > AS_OF) return;
        var amt = getAmt(row.amount === undefined ? 0 : row.amount);
        var cust = strip(pyStr(row.customer === undefined ? '' : row.customer));
        if (cust) mapGet(txns, cust, function () { return []; }).push({ date: d, amount: amt });
      });

      var activity = new Map();
      (raw.activity || []).forEach(function (row) {
        var cust = strip(pyStr(row.customer === undefined ? '' : row.customer));
        if (!cust) return;
        var d = parseDate(row.last_activity_date || row.duedate);
        if (d !== null && d > AS_OF) d = null;
        var rec = { date: d, title: pyStr(row.title === undefined ? '' : row.title), type: 'Task',
                    done: row.done || null, note: String(row.note || ''),
                    n_open: parseInt(row.n_open || 0, 10) || 0 };
        var ex = activity.get(cust);
        if (ex === undefined) activity.set(cust, rec);
        else if (d !== null && (ex.date === null || d > ex.date)) activity.set(cust, rec);
      });

      var item_hist = new Map();
      (raw.items || []).forEach(function (row) {
        var d = parseDate(row.date);
        if (d === null || d > AS_OF) return;
        var cu = strip(pyStr(row.customer === undefined ? '' : row.customer));
        var it = strip(pyStr(row.item === undefined ? '' : row.item));
        var mo = strip(pyStr(row.month === undefined ? '' : row.month));
        if (!(cu && it && mo)) return;
        var q = parseFloat(row.qty || 0) || 0, am = parseFloat(row.amount || 0) || 0;
        var im = mapGet(mapGet(item_hist, cu, function () { return new Map(); }), it, function () { return new Map(); });
        im.set(mo, [q, am, d]);
      });

      function _dropped_lines(cname) {
        var items = item_hist.get(cname) || new Map();
        var regular = [];
        items.forEach(function (ms, i) { if (ms.size >= 3) regular.push([i, ms]); });
        if (regular.length < 2) return [0, 0, []];
        var acct_spend = sum(mvals(items).map(function (ms) { return sum(mvals(ms).map(function (v) { return v[1]; })); })) || 1.0;
        var live = 0, dropped = [];
        regular.forEach(function (pr) {
          var i = pr[0], ms = pr[1];
          var mkk = strSort(Array.from(ms.keys()));
          var igaps = [];
          for (var k = 0; k < mkk.length - 1; k++) igaps.push(monthsDiff(mkk[k], mkk[k + 1]));
          var igap = igaps.length ? median(igaps) : null, igInt = igaps.length % 2 === 1;
          var last = null; ms.forEach(function (v) { if (last === null || v[2] > last) last = v[2]; });
          var quiet = tdDays(AS_OF, last) / 30.44;
          var limit = igap ? (igap * DROPPED_LINE_MULT) : DROPPED_LINE_MONTHS;
          if (quiet <= limit) { live += 1; return; }
          var spend = sum(mvals(ms).map(function (v) { return v[1]; }));
          if (spend < DROPPED_MIN_SPEND || (spend / acct_spend) < DROPPED_MIN_SHARE) return;
          dropped.push([i, igap, quiet, spend, igInt]);
        });
        return [live, dropped.length, dropped];
      }

      (raw.contacts || []).forEach(function (row) {
        var cust = strip(pyStr(row.customer === undefined ? '' : row.customer));
        if (!cust) return;
        var d = parseDate(row.date);
        if (d === null || d > AS_OF) return;
        var lbl = lower(pyStr(row.direction === undefined ? '' : row.direction)).indexOf('in') === 0 ? 'Email in' : 'Email out';
        var ex = activity.get(cust);
        if (ex === undefined || ex.date === null || d > ex.date) {
          activity.set(cust, { date: d, title: String(row.subject || ''), type: lbl, done: null, note: '',
                               n_open: (ex || {}).n_open || 0 });
        }
      });

      var customers = new Map();
      txns.forEach(function (txl, cname) {
        txl = stableSort(txl, function (x) { return x.date; });
        var dates = txl.map(function (t) { return t.date; });
        var amounts = txl.map(function (t) { return t.amount; });
        var rev_by_year = new Map(), monthly_rev = {};
        txl.forEach(function (t) {
          var y = parts(t.date).y; rev_by_year.set(y, (rev_by_year.get(y) || 0) + t.amount);
          var mkk = ym(t.date); monthly_rev[mkk] = (monthly_rev[mkk] || 0) + t.amount;
        });
        var total_rev = sum(amounts);
        var first_order = dates[0], last_order = dates[dates.length - 1], n_orders = dates.length;
        var amSet = {}; dates.forEach(function (d) { amSet[ym(d)] = 1; });
        var active_months = strSort(Object.keys(amSet));
        var n_active_months = active_months.length;
        var gaps = [];
        for (var i = 0; i < active_months.length - 1; i++) gaps.push(monthsDiff(active_months[i], active_months[i + 1]));
        var avg_gap = gaps.length ? mean(gaps) : null;
        var std_gap = gaps.length >= 2 ? stdev(gaps) : 0.0;
        var cv_gap = (avg_gap && avg_gap > 0 && gaps.length >= 2) ? (std_gap / avg_gap) : 0.0;
        var month_amounts = Object.keys(monthly_rev).map(function (k) { return monthly_rev[k]; });
        var cv_amount = 0.0;
        if (month_amounts.length >= 2) {
          var mean_ma = mean(month_amounts), std_ma = stdev(month_amounts);
          cv_amount = mean_ma > 0 ? std_ma / mean_ma : 0.0;
        }

        var med_gap = gaps.length ? median(gaps) : null;
        var rhythm = med_gap, pattern_flag = null;
        if (gaps.length && gaps.length >= SUSTAINED_GAPS + 1) {
          var recent = gaps.slice(-SUSTAINED_GAPS), older = gaps.slice(0, -SUSTAINED_GAPS);
          var r_med = median(recent), o_med = median(older);
          if (o_med > 0) {
            var _r = r_med / o_med;
            if (_r <= 1 / SUSTAINED_RATIO && Math.max.apply(null, recent) < o_med) { rhythm = r_med; pattern_flag = 'ordering faster'; }
            else if (_r >= SUSTAINED_RATIO && Math.min.apply(null, recent) > o_med) { rhythm = r_med; pattern_flag = 'ordering slower'; }
          }
        }
        var expected_next = rhythm ? addDays(last_order, rhythm * 30.44) : null;
        var reorder_date_source = expected_next !== null ? 'rhythm' : null;
        var _t = _rep_task_for(cname), needs_reorder_date = false;
        if (_t !== null) { expected_next = _t; reorder_date_source = 'rep task'; }
        else if (expected_next === null) needs_reorder_date = true;
        var months_overdue = expected_next !== null ? pyRound(tdDays(AS_OF, expected_next) / 30.44, 2) : null;

        var watch = [];
        if (amounts.length && amounts.length >= 3) {
          var _usual = median(amounts.slice(0, -1)), _last = amounts[amounts.length - 1];
          if (_usual > 0) {
            if (_last >= _usual * BIG_ORDER_MULT) watch.push('stocked up (last order ' + pyFmt(_last / _usual, 1) + 'x their usual) — watch');
            else if (_last <= _usual * SMALL_ORDER_MULT) watch.push('last order was a small top-up — pattern unchanged');
          }
        }
        if (pattern_flag === 'ordering faster') watch.push('ordering more often lately — possible growth');
        else if (pattern_flag === 'ordering slower') watch.push('ordering less often lately');
        var dl = _dropped_lines(cname), _live = dl[0], _drop = dl[1], _dropped_detail = dl[2];
        if (_drop) watch.push('was buying ' + (_live + _drop) + ' regular lines, ' + _drop + ' have gone quiet');

        var cutoff_12mo = addDays(AS_OF, -365);
        var recent_amts = txl.filter(function (t) { return t.date >= cutoff_12mo; }).map(function (t) { return t.amount; });
        var expected_value;
        if (recent_amts.length) expected_value = pyRound(mean(recent_amts), 2);
        else if (amounts.length) expected_value = pyRound(mean(amounts), 2);
        else expected_value = 0.0;

        var _Y0 = AP.y, _Y1 = _Y0 - 1, _Y2 = _Y0 - 2, _Y3 = _Y0 - 3;
        function bucket(y) { return rev_by_year.has(y) ? pyRound(rev_by_year.get(y), 2) : 0; }
        var rev_2023 = bucket(_Y3), rev_2024 = bucket(_Y2), rev_2025 = bucket(_Y1), rev_2026_ytd = bucket(_Y0);
        var rev_2026_ann = rev_2026_ytd > 0 ? pyRound((rev_2026_ytd / _months_elapsed) * 12, 2) : 0.0;
        var has_2026 = rev_2026_ytd > 0;

        var months_since = tdDays(AS_OF, last_order) / 30.44, status;
        if (n_orders < 2) {
          status = tdDays(AS_OF, first_order) <= NEW_CUSTOMER_MONTHS * 30.44 ? 'new' : 'one_time';
        } else {
          var _g = rhythm ? rhythm : 3.0;
          var _due = expected_next !== null ? expected_next : addDays(last_order, _g * 30.44);
          var late = tdDays(AS_OF, _due) / 30.44;
          var grace = Math.max(GRACE_FRACTION * _g, GRACE_MIN_MONTHS);
          if (months_since > GONE_MONTHS) status = 'gone';
          else if (late > grace) status = late >= _g * 1.5 ? 'significantly_overdue' : 'overdue';
          else if (has_2026 && rev_2025 > 0) {
            var ratio = rev_2026_ann / rev_2025;
            status = ratio >= 1.15 ? 'growing' : ratio >= 0.70 ? 'on_track' : 'declining';
          } else if (has_2026) status = 'on_track';
          else status = 'not_yet_due';
        }
        if (n_active_months >= 3 && cv_gap > 1.0 && cv_amount > 1.0 && status !== 'new' && status !== 'one_time') status = 'erratic';

        var _owner = _owner_of(cname);
        if (transferred_info(cname, _owner)) status = 'transferred';
        var excl = excluded_info(cname, _owner);
        if (excl && excl.type !== 'note' && excl.type !== 'transferred') status = 'snoozed';
        var _note = note_info(cname, _owner);

        var act = activity.get(cname) || null;
        var act_d = act ? act.date : null;
        var gap_for_cadence = avg_gap ? avg_gap : 3.0, cadence;
        if (act_d === null || act_d === undefined) cadence = 'no_activity';
        else cadence = (tdDays(AS_OF, act_d) / 30.44 <= gap_for_cadence) ? 'in_cadence' : 'out_of_cadence';

        var mr = {}; Object.keys(monthly_rev).forEach(function (k) { mr[k] = pyRound(monthly_rev[k], 2); });
        var mr2 = {}; Object.keys(monthly_rev).forEach(function (k) { mr2[k] = pyRound(monthly_rev[k], 2); });
        customers.set(cname, {
          name: cname, owner: _owner, total_rev: pyRound(total_rev, 2),
          rev_2023: rev_2023, rev_2024: rev_2024, rev_2025: rev_2025, rev_2026_ytd: rev_2026_ytd,
          rev_2026_ann: rev_2026_ann,
          _i25: !rev_by_year.has(_Y1), _i26: !rev_by_year.has(_Y0),
          monthly_rev: mr,
          first_order: ymd(first_order), last_order: ymd(last_order),
          n_orders: n_orders, n_active_months: n_active_months,
          avg_gap: avg_gap ? pyRound(avg_gap, 2) : null, _agInt: avg_gap !== null && Number.isInteger(avg_gap),
          cv_gap: pyRound(cv_gap, 3), cv_amount: pyRound(cv_amount, 3),
          expected_next: expected_next !== null ? ymd(expected_next) : null,
          months_overdue: months_overdue, has_2026: has_2026, expected_value: expected_value,
          snooze_until: (excl && excl.type !== 'note' && excl.until !== null) ? ymd(excl.until) : null,
          snooze_reason: (excl && excl.type !== 'note') ? excl.reason : null,
          note_reason: _note ? _note.reason : null,
          status: status, cadence: cadence,
          reorder_date_source: reorder_date_source, needs_reorder_date: needs_reorder_date,
          rhythm: rhythm ? pyRound(rhythm, 1) : null, watch: watch,
          dropped_items: _dropped_detail.map(function (x) {
            return { item: x[0], gap: x[1] ? pyRound(x[1], 1) : null, _gInt: x[4], quiet: pyRound(x[2], 1), spend: pyRound(x[3], 2) };
          }).slice(0, 6),
          monthly_rev_raw: mr2,
          last_activity_date: act_d ? ymd(act_d) : null,
          last_activity_title: act ? act.title : '',
          last_activity_type: act ? act.type : '',
          last_activity_done: act ? act.done : null,
          last_activity_note: act ? act.note : '',
          open_tasks: act ? act.n_open : 0
        });
      });
      return customers;
    }

    var customers = build_state(TODAY);
    function vals(m) { return Array.from(m.values()); }

    // ─── ABC / PARETO ───────────────────────────────────────────────────────
    vals(customers).forEach(function (c) { c.book = pyRound(Math.max(c.rev_2025, c.rev_2026_ann), 2); });
    var _ranked = stableSort(vals(customers), function (x) { return -x.book; });
    var _total_book = sum(vals(customers).filter(function (c) { return c.book > 0; }).map(function (c) { return c.book; })) || 1.0;
    var _cum = 0.0;
    _ranked.forEach(function (c) {
      if (c.book <= 0) { c.tier = 'B'; return; }
      var _prev = _cum / _total_book; _cum += c.book; c.tier = _prev < 0.80 ? 'A' : 'B';
    });
    var _a_list = vals(customers).filter(function (c) { return c.tier === 'A'; });
    var _b_list = vals(customers).filter(function (c) { return c.tier === 'B'; });
    var _a_rev = sum(_a_list.map(function (c) { return c.book; })), _b_rev = sum(_b_list.map(function (c) { return c.book; }));
    var _n_rev = vals(customers).filter(function (c) { return c.book > 0; }).length || 1;
    var pareto = { a_n: _a_list.length, b_n: _b_list.length, a_rev: _a_rev, b_rev: _b_rev,
      a_pct_n: pyRound(_a_list.length / _n_rev * 100, 1), a_pct_rev: pyRound(_a_rev / _total_book * 100, 1),
      b_pct_n: pyRound(_b_list.length / _n_rev * 100, 1), b_pct_rev: pyRound(_b_rev / _total_book * 100, 1) };

    // ═══ SECTION 7 — RETENTION CADENCE AND THE TOUCHPOINT ROTATION (Rev 4) ═══
    var TIER_A_MIN_TTM = 8000.0, STRATEGIC_SHARE = 0.10, RHYTHM_WEEKLY_MAX = 2.0, RHYTHM_QUARTERLY_MAX = 6.0;
    var TOUCHPOINTS = {
      order_thankyou: ['A', 'Order Thank-You', 'Email'],
      post_delivery: ['A', 'Post-Delivery Check', 'Email or call'],
      fit_check: ['B', 'Fit Check', 'Call'],
      spec_review: ['B', 'Spec Review', 'Call'],
      price_review: ['C', 'Price Review', 'Email, then call'],
      heads_up: ['C', 'Heads-Up', 'Email or call'],
      their_news: ['D', 'Their News', 'Call'],
      pre_season: ['D', 'Pre-Season', 'Email'],
      milestone: ['D', 'Milestone card', 'Card'],
      personal: ['D', 'Personal Recognition', 'Card or short email'],
      annual_review: ['E', 'Annual Account Review', 'Call, booked by email']
    };
    var GROUP_NAMES = { A: 'About the order they just got', B: 'About what they buy', C: 'About their pricing and the market', D: 'About their business', E: 'How are things going' };
    var GROUP_COLORS = { A: '#2980b9', B: '#27ae60', C: '#c8490c', D: '#8e44ad', E: '#16a085' };
    var CADENCE = {
      'A|weekly_monthly': [3, ['heads_up', 'post_delivery', 'fit_check', 'annual_review']],
      'A|quarterly': [4, ['post_delivery', 'pre_season', 'annual_review']],
      'A|episodic': [6, ['post_delivery', 'fit_check']],
      'A|strategic': [3, ['annual_review', 'price_review', 'fit_check', 'their_news']],
      'B|weekly_monthly': [4, ['post_delivery', 'heads_up', 'fit_check']],
      'B|quarterly': [6, ['post_delivery', 'fit_check']]
    };
    var RHYTHM_LABELS = { weekly_monthly: 'Weekly or monthly', quarterly: 'Quarterly', episodic: 'Episodic / project', strategic: 'Strategic / growth' };
    var TOUCH_PATTERNS = [
      ['annual_review', ['annual account review', 'annual review', 'account review']],
      ['post_delivery', ['post-delivery', 'post delivery', 'delivery check']],
      ['order_thankyou', ['order thank-you', 'order thank you', 'thank-you', 'thank you for the order']],
      ['fit_check', ['fit check', 'fit-check']],
      ['spec_review', ['spec review', 'spec-review']],
      ['price_review', ['price review', 'price-review', 're-tier', 'retier']],
      ['heads_up', ['heads-up', 'heads up']],
      ['their_news', ['their news', 'congratulations', 'congrats']],
      ['pre_season', ['pre-season', 'pre season', 'preseason']],
      ['milestone', ['milestone', 'anniversary']],
      ['personal', ['personal recognition', 'birthday']]
    ];
    function _touch_of(text) {
      var t = lower(text === null || text === undefined ? '' : String(text));
      for (var i = 0; i < TOUCH_PATTERNS.length; i++)
        for (var j = 0; j < TOUCH_PATTERNS[i][1].length; j++)
          if (t.indexOf(TOUCH_PATTERNS[i][1][j]) >= 0) return TOUCH_PATTERNS[i][0];
      return null;
    }
    var TOUCH_LOG = new Map();
    (raw.activity || []).forEach(function (r) {
      var cu = strip(pyStr(r.customer === undefined ? '' : r.customer));
      var d = parseDate(r.last_activity_date || r.duedate), k = _touch_of(r.title);
      if (cu && d !== null && k && d <= TODAY) mapGet(TOUCH_LOG, cu, function () { return []; }).push([d, k, 'Task']);
    });
    (raw.contacts || []).forEach(function (r) {
      var cu = strip(pyStr(r.customer === undefined ? '' : r.customer));
      var d = parseDate(r.date), k = _touch_of(r.subject);
      if (cu && d !== null && k && d <= TODAY) mapGet(TOUCH_LOG, cu, function () { return []; }).push([d, k, 'Email']);
    });
    TOUCH_LOG.forEach(function (v, k) { TOUCH_LOG.set(k, stableSort(v, function (x) { return x[0]; })); });
    function _touches_upto(cname, as_of) { return (TOUCH_LOG.get(cname) || []).filter(function (t) { return t[0] <= as_of; }); }
    function _rhythm_bucket(c, share) {
      if (share >= STRATEGIC_SHARE) return 'strategic';
      if (c.status === 'erratic') return 'episodic';
      var g = c.rhythm;
      if (!g || c.n_orders < 2) return 'episodic';
      if (g <= RHYTHM_WEEKLY_MAX) return 'weekly_monthly';
      if (g <= RHYTHM_QUARTERLY_MAX) return 'quarterly';
      return 'episodic';
    }
    function _ttm(c, as_of) {
      as_of = as_of || TODAY;
      var cut = ym(addDays(as_of, -365)), m = c.monthly_rev_raw || {};
      return pyRound(sum(Object.keys(m).filter(function (k) { return k >= cut; }).map(function (k) { return m[k]; })), 2);
    }
    var SEASON_MIN_YEARS = 2, SEASON_MIN_SHARE = 0.50, PRICE_MIN_TTM = 20000.0, PRICE_MIN_GROWTH = 2.0;
    function _season_of(c) {
      var by = new Map(), m = c.monthly_rev_raw || {};
      Object.keys(m).forEach(function (k) {
        var y = +k.split('-')[0], mo = +k.split('-')[1];
        var bm = mapGet(by, y, function () { return new Map(); }); bm.set(mo, (bm.get(mo) || 0) + m[k]);
      });
      var years = [];
      by.forEach(function (mm, y) {
        var xs = mvals(mm), n = xs.filter(function (x) { return x > 0; }).length;
        if (sum(xs) > 0 && n >= 3) years.push(y);
      });
      if (years.length < SEASON_MIN_YEARS) return null;
      var best = null;
      for (var s = 1; s <= 12; s++) {
        var hits = 0;
        years.forEach(function (y) {
          var bm = by.get(y), tot = sum(mvals(bm));
          if (tot <= 0) return;
          var wl = [];
          for (var i = 0; i < 3; i++) { var mo = ((s - 1 + i) % 12) + 1; if (!bm.has(mo)) bm.set(mo, 0.0); wl.push(bm.get(mo)); }
          var w = sum(wl);
          if (w / tot >= SEASON_MIN_SHARE) hits += 1;
        });
        if (hits >= SEASON_MIN_YEARS && (best === null || hits > best[1])) best = [s, hits];
      }
      return best;
    }
    function _price_gate(c, as_of) {
      as_of = as_of || TODAY;
      var ttm = c.ttm || 0, ap = parts(as_of);
      var cut1 = ym(replaceYear(as_of, ap.y - 1)), cut2 = ym(replaceYear(as_of, ap.y - 2));
      var m = c.monthly_rev_raw || {};
      var prior = sum(Object.keys(m).filter(function (k) { return cut2 <= k && k < cut1; }).map(function (k) { return m[k]; }));
      return !!(ttm >= PRICE_MIN_TTM && prior > 0 && (ttm / prior) >= PRICE_MIN_GROWTH);
    }
    function _touch_applies(key, c, as_of) {
      as_of = as_of || TODAY;
      if (key === 'pre_season') return _season_of(c) !== null;
      if (key === 'price_review') return _price_gate(c, as_of);
      if (key === 'milestone') {
        var fo = parseDate(c.first_order); if (fo === null) return false;
        var anniv = parts(fo).m, d = ((parts(as_of).m - anniv) % 12 + 12) % 12;
        return Math.abs(d) <= 1;
      }
      return true;
    }
    function compute_checkins(custs, as_of, annotate) {
      if (annotate === undefined) annotate = true;
      var checkins = [];
      var book_total = sum(vals(custs).map(function (c) { return Math.max(c.rev_2025 || 0, 0); })) || 1.0;
      vals(custs).forEach(function (_c) {
        var _ttm_v = _ttm(_c, as_of), _tier = _ttm_v >= TIER_A_MIN_TTM ? 'A' : 'B';
        var _share = Math.max(_c.rev_2025 || 0, 0) / book_total, _bucket = _rhythm_bucket(_c, _share);
        if (annotate) { _c.ttm = _ttm_v; _c.ctier = _tier; _c.rhythm_bucket = _bucket; }
        if (_c.status === 'snoozed' || _c.status === 'transferred' || _c.status === 'gone') return;
        var _plan = CADENCE[_tier + '|' + _bucket];
        if (!_plan) { if (annotate) _c.checkin_note = 'Operational only — no scheduled check-in for this row'; return; }
        var _interval = _plan[0], _seq = _plan[1];
        var _log = _touches_upto(_c.name, as_of);
        var _last_d = _log.length ? _log[_log.length - 1][0] : null, _last_k = _log.length ? _log[_log.length - 1][1] : null;
        var _anchor = parseDate(_c.first_order), _pos;
        if (_last_k && _seq.indexOf(_last_k) >= 0) _pos = (_seq.indexOf(_last_k) + 1) % _seq.length;
        else { var _el = Math.max(0, pyTrunc(tdDays(as_of, _anchor) / (_interval * 30.44))); _pos = _el % _seq.length; }
        var _lastg = _last_k ? TOUCHPOINTS[_last_k][0] : null, _skipped = [];
        for (var q = 0; q < _seq.length; q++) {
          var _cand = _seq[_pos];
          if (TOUCHPOINTS[_cand][0] === _lastg) { _pos = (_pos + 1) % _seq.length; continue; }
          if (!_touch_applies(_cand, _c, as_of)) { _skipped.push(TOUCHPOINTS[_cand][1]); _pos = (_pos + 1) % _seq.length; continue; }
          break;
        }
        var _due;
        if (_last_d !== null) _due = addDays(_last_d, _interval * 30.44);
        else {
          var _steps = Math.max(0, pyTrunc(tdDays(as_of, _anchor) / (_interval * 30.44))) + 1;
          _due = addDays(_anchor, _steps * _interval * 30.44);
        }
        var _key = _seq[_pos], tp = TOUCHPOINTS[_key];
        var _overdue = pyRound(tdDays(as_of, _due) / 30.44, 1);
        checkins.push({ name: _c.name, owner: _c.owner, tier: _tier, rhythm: _bucket, ttm: _ttm_v, status: _c.status,
          interval: _interval, slots: _seq.length, due: ymd(_due), overdue: _overdue,
          next_key: _key, next_group: tp[0], next_label: tp[1], next_format: tp[2], skipped: _skipped,
          season: _season_of(_c),
          last_date: _last_d !== null ? ymd(_last_d) : null,
          last_label: _last_k ? TOUCHPOINTS[_last_k][1] : null,
          last_group: _last_k ? TOUCHPOINTS[_last_k][0] : null,
          never: _last_d === null });
      });
      return stableSort(checkins, function (x) { return [x.tier !== 'A', -x.overdue, -x.ttm]; });
    }
    var CHECKINS = compute_checkins(customers, TODAY);

    var REORDER_LEAD_DAYS = 14;
    function compute_cadence(custs, checkins, as_of, annotate) {
      if (annotate === undefined) annotate = true;
      var plan_interval = {}; checkins.forEach(function (x) { plan_interval[x.name] = x.interval; });
      var out = new Map();
      vals(custs).forEach(function (_c) {
        var _d = _c.last_activity_date;
        var _since = _d ? tdDays(as_of, parseDate(_d)) / 30.44 : null;
        var _iv = Object.prototype.hasOwnProperty.call(plan_interval, _c.name) ? plan_interval[_c.name] : null, _cad;
        if (_since === null) _cad = 'no_activity';
        else if (_iv === null) _cad = 'not_scheduled';
        else if (_since > _iv) _cad = 'out_of_cadence';
        else _cad = 'in_cadence';
        var _task = _rep_task_for(_c.name), _cov;
        if (_c.status === 'snoozed' || _c.status === 'transferred' || _c.status === 'gone') _cov = 'parked';
        else if (!_c.expected_next) _cov = 'no_rhythm';
        else {
          var _due = parseDate(_c.expected_next);
          if (_due > as_of) _cov = 'not_due';
          else if (_task !== null) _cov = 'covered_task';
          else if (_d && parseDate(_d) >= addDays(_due, -REORDER_LEAD_DAYS)) _cov = 'covered_touch';
          else _cov = 'uncovered';
        }
        out.set(_c.name, { cadence: _cad, on_rotation: _iv !== null, checkin_window: _iv, reorder_cover: _cov,
                           task_due: _task !== null ? ymd(_task) : null });
        if (annotate) {
          _c.cadence = _cad; _c.on_rotation = _iv !== null; _c.checkin_window = _iv; _c.reorder_cover = _cov;
          _c.task_due = _task !== null ? ymd(_task) : null;
        }
      });
      return out;
    }
    compute_cadence(customers, CHECKINS, TODAY);
    CHECKINS = stableSort(CHECKINS, function (x) { return [x.tier !== 'A', -x.overdue, -x.ttm]; });

    var EVENTS = [];
    vals(customers).forEach(function (_c) {
      if (_c.status === 'snoozed' || _c.status === 'transferred' || _c.status === 'gone') return;
      var _g = _c.rhythm, _mo = _c.months_overdue;
      if (_g && _mo !== null && _mo >= _g * 0.5)
        EVENTS.push({ trigger: 'Reorder running late', name: _c.name, owner: _c.owner, ttm: _c.ttm === undefined ? 0 : _c.ttm,
          detail: 'Normally every ' + pyFmt(_g, 1) + ' months, ' + pyFmt(_mo, 1) + ' months past due',
          window: 'At 1.5x their normal gap', kind: 'late' });
      (_c.dropped_items || []).forEach(function (_di) {
        EVENTS.push({ trigger: 'Item dropped from the mix', name: _c.name, owner: _c.owner, ttm: _c.ttm === undefined ? 0 : _c.ttm,
          detail: _di.item + ' — normally every ' + (_di.gap ? pyNum(_di.gap, _di._gInt) : '?') + ' months, quiet ' + pyFmt(_di.quiet, 1)
            + ' (' + '$' + comma(pyTrunc(_di.spend)) + ' with us)',
          window: "At 2x that item's normal gap", kind: 'dropped' });
      });
      (_c.watch || []).forEach(function (_w) {
        if (_w.indexOf('stocked up') >= 0)
          EVENTS.push({ trigger: 'Order well out of pattern', name: _c.name, owner: _c.owner, ttm: _c.ttm === undefined ? 0 : _c.ttm,
            detail: _w, window: 'Within a few days', kind: 'big' });
      });
    });
    EVENTS = stableSort(EVENTS, function (x) { return [x.kind !== 'late', -(x.ttm || 0)]; });

    // ─── THE SCORE ──────────────────────────────────────────────────────────
    var retained_statuses = { growing: 1, on_track: 1, not_yet_due: 1, 'new': 1, snoozed: 1, transferred: 1 };
    function isScored(v) { return v.n_orders >= 2 && (v.rev_2024 > 0 || v.rev_2025 > 0); }
    var materially_active = vals(customers).filter(isScored);
    var retained = materially_active.filter(function (v) { return retained_statuses[v.status]; });
    var acct_pct = materially_active.length ? retained.length / materially_active.length * 100 : 0;
    var rev_2025_total = sum(materially_active.map(function (v) { return v.rev_2025; }));
    var rev_2025_retained = sum(retained.map(function (v) { return v.rev_2025; }));
    var rev_pct = rev_2025_total > 0 ? rev_2025_retained / rev_2025_total * 100 : 0;
    var composite = pyRound(0.4 * acct_pct + 0.6 * rev_pct, 1);
    var at_risk_statuses = { significantly_overdue: 1, gone: 1, overdue: 1 };
    var at_risk = sum(vals(customers).filter(function (v) { return at_risk_statuses[v.status]; }).map(function (v) { return v.rev_2025; }));
    var declining_gap = sum(vals(customers).filter(function (v) { return v.status === 'declining'; }).map(function (v) { return Math.max(0, v.rev_2025 - v.rev_2026_ann); }));
    var total_exposure = at_risk + declining_gap;
    var total_2025 = sum(vals(customers).map(function (v) { return v.rev_2025; }));
    var total_2026_ytd = sum(vals(customers).map(function (v) { return v.rev_2026_ytd; }));
    var total_2026_ann = (total_2026_ytd / MONTHS_2026) * 12;
    var status_counts = {}, cadence_counts = {}, monthly_totals = {};
    vals(customers).forEach(function (v) {
      status_counts[v.status] = (status_counts[v.status] || 0) + 1;
      cadence_counts[v.cadence] = (cadence_counts[v.cadence] || 0) + 1;
      Object.keys(v.monthly_rev).forEach(function (mo) { monthly_totals[mo] = (monthly_totals[mo] || 0) + v.monthly_rev[mo]; });
    });
    function sc(o, k) { return o[k] || 0; }

    // ─── PER-REP AGGREGATES (rep filter + per-rep scores) ───────────────────
    var _STAT_ORDER = ['growing', 'on_track', 'new', 'not_yet_due', 'declining', 'overdue', 'significantly_overdue', 'gone'];
    var _ALL_STATS = ['growing', 'on_track', 'new', 'not_yet_due', 'snoozed', 'declining', 'overdue', 'significantly_overdue', 'gone', 'erratic', 'one_time', 'one_time_old'];
    var CMS = ymd(replaceDay(TODAY, 1)).slice(0, 8) + '01';
    var NMS = ymd(nextMonthStart(TODAY)).slice(0, 8) + '01';
    var NNMS = ymd(nextMonthStart(nextMonthStart(TODAY))).slice(0, 8) + '01';
    function compute_view(subset) {
      var sv = vals(subset);
      var ma = sv.filter(isScored), ret = ma.filter(function (v) { return retained_statuses[v.status]; });
      var ap = ma.length ? ret.length / ma.length * 100 : 0;
      var r25t = sum(ma.map(function (v) { return v.rev_2025; })), r25r = sum(ret.map(function (v) { return v.rev_2025; }));
      var rp = r25t > 0 ? r25r / r25t * 100 : 0;
      var comp = pyRound(0.4 * ap + 0.6 * rp, 1);
      var ar = sum(sv.filter(function (v) { return at_risk_statuses[v.status]; }).map(function (v) { return v.rev_2025; }));
      var dg = sum(sv.filter(function (v) { return v.status === 'declining'; }).map(function (v) { return Math.max(0, v.rev_2025 - v.rev_2026_ann); }));
      var t25 = sum(sv.map(function (v) { return v.rev_2025; })), t26 = sum(sv.map(function (v) { return v.rev_2026_ytd; }));
      var scn = {}, cc = {}, mt = {};
      sv.forEach(function (v) {
        scn[v.status] = (scn[v.status] || 0) + 1; cc[v.cadence] = (cc[v.cadence] || 0) + 1;
        Object.keys(v.monthly_rev).forEach(function (mo) { mt[mo] = (mt[mo] || 0) + v.monthly_rev[mo]; });
      });
      var ry = {}; YEARS.forEach(function (y) { ry[y] = {}; });
      Object.keys(mt).forEach(function (k) {
        var yr = +k.slice(0, 4), mn = +k.slice(5, 7);
        if (ry[yr]) ry[yr][mn] = (ry[yr][mn] || 0) + mt[k];
      });
      function yrArr(y) { var o = []; for (var i = 1; i <= 12; i++) o.push(pyRound(ry[y][i] || 0, 2)); return o; }
      var due = sv.filter(function (v) { return v.status !== 'snoozed' && v.expected_next && CMS <= v.expected_next && v.expected_next < NMS; });
      var nxt = sv.filter(function (v) { return v.status !== 'snoozed' && v.expected_next && NMS <= v.expected_next && v.expected_next < NNMS; });
      function cadBy(cad) { return _STAT_ORDER.map(function (s) { return sv.filter(function (v) { return v.status === s && v.cadence === cad; }).length; }); }
      var stc = {}; _ALL_STATS.forEach(function (s) { stc[s] = scn[s] || 0; });
      return {
        composite: comp, acct_pct: pyRound(ap, 1), rev_pct: pyRound(rp, 1), _rpInt: !(r25t > 0),
        ma: ma.length, ret: ret.length,
        total_2025: pyRound(t25), total_2026_ytd: pyRound(t26), total_2026_ann: pyRound((t26 / MONTHS_2026) * 12),
        at_risk: pyRound(ar), declining_gap: pyRound(dg), total_exposure: pyRound(ar + dg),
        status_counts: stc,
        cadence_counts: { in_cadence: cc.in_cadence || 0, out_of_cadence: cc.out_of_cadence || 0, no_activity: cc.no_activity || 0 },
        rev_2023: yrArr(Y3), rev_2024: yrArr(Y2), rev_2025: yrArr(Y1), rev_2026: yrArr(Y0),
        cad_in: cadBy('in_cadence'), cad_out: cadBy('out_of_cadence'), cad_no: cadBy('no_activity'), cad_ns: cadBy('not_scheduled'),
        exp_this: pyRound(sum(due.map(function (v) { return v.expected_value; }))), due_n: due.length,
        exp_next: pyRound(sum(nxt.map(function (v) { return v.expected_value; }))), next_n: nxt.length,
        overdue_n: (scn.overdue || 0) + (scn.significantly_overdue || 0), sig_n: scn.significantly_overdue || 0,
        nyd_n: scn.not_yet_due || 0,
        cin: cc.in_cadence || 0, cout: cc.out_of_cadence || 0, cno: cc.no_activity || 0
      };
    }
    var _view_members = POD_MEMBERS.slice();
    vals(customers).forEach(function (v) {
      var o = v.owner === undefined ? '—' : v.owner;
      if (o && o !== '—' && !_view_members.some(function (m) { return lower(o) === lower(m); })) _view_members.push(o);
    });
    var POD_GROUPS = new Map();
    var _pgr = raw.pod_groups || {};
    Object.keys(_pgr).forEach(function (pg) {
      var clean = (_pgr[pg] || []).map(function (x) { return strip(String(x)); }).filter(Boolean);
      if (clean.length) POD_GROUPS.set(strip(String(pg)), clean);
    });
    var TEAM_MODE = POD_GROUPS.size > 0;
    var SCOPE_MEMBERS = {};
    SCOPE_MEMBERS.__ALL__ = _view_members.map(lower);
    POD_GROUPS.forEach(function (mm, pg) { SCOPE_MEMBERS[pg] = mm.map(lower); });
    _view_members.forEach(function (m) { SCOPE_MEMBERS[m] = [lower(m)]; });
    function _in_scope(v, scope) {
      if (scope === '__ALL__') return true;
      return (SCOPE_MEMBERS[scope] || []).indexOf(lower(strip(String(v.owner === undefined ? '' : v.owner)))) >= 0;
    }
    function filterMap(m, fn) { var o = new Map(); m.forEach(function (v, k) { if (fn(v)) o.set(k, v); }); return o; }
    var VIEW_AGG = { __ALL__: compute_view(customers) };
    Array.from(POD_GROUPS.keys()).concat(_view_members).forEach(function (s) {
      VIEW_AGG[s] = compute_view(filterMap(customers, function (v) { return _in_scope(v, s); }));
    });
    function q(s) { return String(s).replace(/"/g, ''); }
    function _rep_options() {
      var o;
      if (TEAM_MODE) {
        o = '<option value="__ALL__">Whole team</option>';
        POD_GROUPS.forEach(function (mm, pg) {
          o += '<optgroup label="' + q(pg) + '">';
          o += '<option value="' + q(pg) + '">' + pg + ' &mdash; all</option>';
          mm.forEach(function (m) { o += '<option value="' + q(m) + '">&nbsp;&nbsp;' + m + '</option>'; });
          o += '</optgroup>';
        });
        var loose = _view_members.filter(function (m) {
          var hit = false; POD_GROUPS.forEach(function (mm) { if (mm.map(lower).indexOf(lower(m)) >= 0) hit = true; }); return !hit;
        });
        if (loose.length) {
          o += '<optgroup label="Unassigned">';
          loose.forEach(function (m) { o += '<option value="' + q(m) + '">' + m + '</option>'; });
          o += '</optgroup>';
        }
        return o;
      }
      o = '<option value="__ALL__">All reps — whole pod</option>';
      _view_members.forEach(function (m) { o += '<option value="' + q(m) + '">' + m + '</option>'; });
      return o;
    }
    var repbar = '';
    if (POD_MODE && !OPT.hideRepFilter) {
      repbar = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:8px 10px;background:#fff;border:1px solid #e2ddd6;border-radius:8px;width:fit-content">'
        + '<span style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9e9086">'
        + (TEAM_MODE ? 'View by pod or rep' : 'View by rep') + '</span>'
        + '<select class="repsel" onchange="applyRep(this.value)" style="padding:6px 10px;border-radius:7px;border:1px solid #e2ddd6;background:#fff;font-size:13px;font-weight:600;color:#1a1714">' + _rep_options() + '</select></div>';
    }

    // ─── MONTH SCHEDULE ─────────────────────────────────────────────────────
    var cur_month_start = replaceDay(TODAY, 1), next_month_start = nextMonthStart(cur_month_start);
    var week_starts = [];
    for (var _d = cur_month_start; _d < next_month_start; _d = addDays(_d, 7)) week_starts.push(_d);
    var _lastDay = parts(addDays(next_month_start, -1)).d;
    var july_schedule = new Map(), seen = {};
    function schedRow(v, reason, pri) {
      return { name: v.name, reason: reason, expected_next: v.expected_next, rev_2025: v.rev_2025,
        rev_2026_ytd: v.rev_2026_ytd, status: v.status, cadence: v.cadence, last_activity_date: v.last_activity_date,
        last_activity_title: v.last_activity_title, priority: pri, avg_gap: v.avg_gap, _agInt: v._agInt };
    }
    stableSort(vals(customers), function (x) { return -x.rev_2025; }).forEach(function (v) {
      if (v.status === 'snoozed' || v.status === 'transferred') return;
      if (v.expected_next) {
        var en = parseDate(v.expected_next);
        if (cur_month_start <= en && en < next_month_start) {
          var wk = Math.min(pyTrunc(tdDays(en, cur_month_start) / 7) + 1, week_starts.length);
          var ws = parts(week_starts[wk - 1]).d;
          var label = 'Week ' + wk + ' (' + fmtDate(cur_month_start, '%b') + ' ' + ws + '-' + Math.min(ws + 6, _lastDay) + ')';
          mapGet(july_schedule, label, function () { return []; }).push(schedRow(v, 'Expected Order Due', 'medium'));
          seen[v.name] = 1;
        }
      }
    });
    stableSort(vals(customers).filter(function (x) { return x.status === 'significantly_overdue'; }), function (x) { return -x.rev_2025; }).slice(0, 8).forEach(function (v) {
      if (!seen[v.name]) {
        var label = 'Week 1 (' + fmtDate(cur_month_start, '%b %d') + '-' + Math.min(parts(cur_month_start).d + 6, _lastDay) + ')';
        mapGet(july_schedule, label, function () { return []; }).push(schedRow(v, 'Significantly Overdue - Urgent', 'high'));
        seen[v.name] = 1;
      }
    });
    stableSort(vals(customers).filter(function (x) { return x.status === 'overdue'; }), function (x) { return -x.rev_2025; }).slice(0, 6).forEach(function (v) {
      if (!seen[v.name]) {
        var label = week_starts.length > 1 ? 'Week 2' : 'Week 1';
        var ks = Array.from(july_schedule.keys());
        for (var i = 0; i < ks.length; i++) if (ks[i].indexOf('Week 2') >= 0) { label = ks[i]; break; }
        mapGet(july_schedule, label, function () { return []; }).push(schedRow(v, 'Overdue - Follow Up', 'high'));
        seen[v.name] = 1;
      }
    });
    var priority_order = { high: 0, medium: 1, low: 2 };
    july_schedule.forEach(function (rows, wk) {
      july_schedule.set(wk, stableSort(rows, function (x) { return [x.priority in priority_order ? priority_order[x.priority] : 2, -x.rev_2025]; }));
    });

    // ─── RENDER HELPERS ─────────────────────────────────────────────────────
    var STATUS_COLORS = { gone: '#c0392b', significantly_overdue: '#e74c3c', overdue: '#e67e22', growing: '#27ae60', on_track: '#2980b9', declining: '#8e44ad', not_yet_due: '#16a085', 'new': '#3498db', erratic: '#d35400', one_time: '#7f8c8d', one_time_old: '#7f8c8d', snoozed: '#95a5a6', transferred: '#5d6d7e' };
    var STATUS_LABELS = { gone: 'Gone', significantly_overdue: 'Sig. Overdue', overdue: 'Overdue', growing: 'Growing', on_track: 'On Track', declining: 'Declining', not_yet_due: 'Not Yet Due', 'new': 'New', erratic: 'Erratic', one_time: 'One-Time', one_time_old: 'One-Time', snoozed: 'Snoozed', transferred: 'Moved Account' };
    var CADENCE_COLORS = { in_cadence: '#27ae60', out_of_cadence: '#e67e22', no_activity: '#7f8c8d', not_scheduled: '#b9b0a6' };
    var CADENCE_LABELS = { in_cadence: 'Check-in on time', out_of_cadence: 'Check-in overdue', no_activity: 'No Activity', not_scheduled: 'No scheduled check-in' };
    function lk(o, k, d) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d; }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function fm(v) { return v ? '$' + comma(pyRound(v)) : '$0'; }
    function fd(s) { if (!s) return '—'; var p = String(s).split('-'); return p.length === 3 ? (p[1] + '/' + p[2] + '/' + p[0]) : s; }
    function sbadge(s) { return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:' + lk(STATUS_COLORS, s, '#7f8c8d') + '">' + lk(STATUS_LABELS, s, s) + '</span>'; }
    function cbadge(c) { return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:' + lk(CADENCE_COLORS, c, '#7f8c8d') + '">' + lk(CADENCE_LABELS, c, c) + '</span>'; }
    function pbadge(p) { var c = lk({ high: '#c8490c', medium: '#e67e22', low: '#27ae60' }, p, '#7f8c8d'); return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:' + c + '">' + p.toUpperCase() + '</span>'; }
    function days_ago(ds) {
      if (!ds) return null;
      var d = parseDate(ds); if (d === null || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(strip(ds))) return null;
      var n = tdDays(TODAY, d);
      if (n === 0) return 'today';
      if (n === 1) return 'yesterday';
      if (n < 7) return n + ' days ago';
      if (n < 30) { var w = Math.floor(n / 7); return w + (w === 1 ? ' week ago' : ' weeks ago'); }
      var m = pyRound(n / 30.44); return m + (m === 1 ? ' month ago' : ' months ago');
    }
    function activity_cell(c, compact) {
      var _d = c.last_activity_date;
      if (!_d) return '<span style="color:#c8490c;font-size:12px;font-weight:600">No activity on record</span>';
      var _ty = c.last_activity_type || 'Task', _is_task = lower(_ty).indexOf('task') === 0, _ago = days_ago(_d) || '';
      var _icon = _ty === 'Email in' ? '<span style="color:#2980b9;font-weight:800">&#8600;</span>'
        : _ty === 'Email out' ? '<span style="color:#27ae60;font-weight:800">&#8599;</span>'
        : '<span style="color:#6c5ce7;font-weight:800">&#9679;</span>';
      var o = ['<div style="white-space:nowrap">' + _icon + ' <b style="font-size:12px">' + fd(_d) + '</b> <span style="font-size:11px;color:#9e9086">' + esc(_ago) + '</span></div>'];
      var _ttl = strip(c.last_activity_title || '');
      if (_ttl) o.push('<div style="font-size:11px;color:#4a4540">' + esc(pySlice(_ttl, 64)) + '</div>');
      if (_is_task) {
        if (c.last_activity_done) o.push('<div style="font-size:10px;color:#27ae60">task &middot; done ' + fd(c.last_activity_done) + '</div>');
        else {
          var _dd = parseDate(_d), _late = _dd === null ? 0 : tdDays(TODAY, _dd);
          o.push('<div style="font-size:10px;color:#c8490c;font-weight:700">task still open &middot; ' + Math.max(0, _late) + ' days overdue</div>');
        }
      }
      var _note = strip(c.last_activity_note || '');
      if (_note && !compact) o.push('<div style="font-size:10px;color:#9e9086;font-style:italic">' + esc(pySlice(_note, 110)) + '</div>');
      var _no = c.open_tasks || 0;
      if (_no > 1 && !compact) o.push('<div style="font-size:10px;color:#c8490c">' + _no + ' open past-due tasks on this account</div>');
      return o.join('');
    }
    function task_cell(c) {
      var _t = c.task_due;
      if (!_t) return '<span style="color:#b9b0a6;font-size:12px">&mdash; none set</span>';
      var _en = c.expected_next, _late = !!(_en && _t > _en), _col = _late ? '#c8490c' : '#27ae60';
      var _ttl = _rep_task_title(c.name === undefined ? '' : c.name);
      return '<span style="color:' + _col + ';font-weight:700;white-space:nowrap">' + fd(_t) + '</span>'
        + (_late ? '<div style="font-size:10px;color:#c8490c">after the reorder date</div>' : '')
        + (_ttl ? '<div style="font-size:10px;color:#9e9086">' + esc(pySlice(_ttl, 42)) + '</div>' : '');
    }
    function obadge(o) {
      if (!POD_MODE || !o || o === '—') return '';
      return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:' + _owner_color(o) + '">' + strip(String(o)).split(/\s+/)[0] + '</span>';
    }
    function notetag(c) {
      var reason = c ? c.note_reason : null;
      if (!reason) return '';
      return ' <span title="' + String(reason).replace(/"/g, '&quot;') + '" style="display:inline-block;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;color:#8a5700;background:#fef3cd;border:1px solid #f0d98a;cursor:help">NOTE</span>';
    }
    function tbadge(tt) {
      if (tt === 'A') return '<span title="Key account (top ~20%)" style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;color:#fff;background:#c8490c">A</span>';
      return '<span title="Long tail" style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;color:#4a4540;background:#e2ddd6">B</span>';
    }
    function tile(label, val, sub, red) {
      var vc = red ? ' style="color:#c8490c"' : '';
      return '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:16px 18px">'
        + '<div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#9e9086;margin-bottom:5px">' + label + '</div>'
        + '<div style="font-size:22px;font-weight:700"' + vc + '>' + val + '</div>'
        + (sub ? '<div style="font-size:12px;color:#9e9086;margin-top:3px">' + sub + '</div>' : '')
        + '</div>';
    }
    function cust(nm) { return customers.get(nm) || {}; }
    function pct100(v) { return v <= 0 ? '0' : v >= 100 ? '100' : pyFloat(v); } // str(min(100,max(0,v)))

    // ─── SUMMARY ────────────────────────────────────────────────────────────
    var score_c = composite >= 70 ? '#27ae60' : composite >= 50 ? '#e67e22' : '#c8490c';
    function aggspan(field, text, fmt) { return '<span data-agg="' + field + '" data-fmt="' + (fmt || 'int') + '">' + text + '</span>'; }
    var _health = composite >= 70 ? 'Healthy' : composite >= 50 ? 'Needs Attention' : 'At Risk';
    var summary_html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:18px">'
      + tile(Y1 + ' Total', aggspan('total_2025', fm(total_2025), 'money'))
      + tile(Y0 + ' YTD', aggspan('total_2026_ytd', fm(total_2026_ytd), 'money'), 'Ann: ' + aggspan('total_2026_ann', fm(total_2026_ann), 'money'))
      + tile('Revenue At Risk', aggspan('at_risk', fm(at_risk), 'money'), "Overdue+gone accounts' " + Y1, true)
      + tile('Declining Gap', aggspan('declining_gap', fm(declining_gap), 'money'), 'Pace vs ' + Y1, true)
      + tile('Total Exposure', aggspan('total_exposure', fm(total_exposure), 'money'), '', true)
      + tile('Retention Score', aggspan('composite', pyFloat(composite), 'num') + '/100', aggspan('__health__', _health, 'text'))
      + tile('Overdue', aggspan('overdue_n', String(sc(status_counts, 'overdue') + sc(status_counts, 'significantly_overdue')), 'int'), aggspan('sig_n', String(sc(status_counts, 'significantly_overdue')), 'int') + ' significant')
      + tile('Not Yet Due', aggspan('nyd_n', String(sc(status_counts, 'not_yet_due')), 'int'), 'Expected soon')
      + '</div>'
      + '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-bottom:14px">'
      + '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Activity Cadence</div>'
      + '<div style="display:flex;gap:28px;flex-wrap:wrap">'
      + '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#27ae60">' + aggspan('cin', String(sc(cadence_counts, 'in_cadence')), 'int') + '</div><div style="font-size:11px;color:#6b6460">In Cadence</div></div>'
      + '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#e67e22">' + aggspan('cout', String(sc(cadence_counts, 'out_of_cadence')), 'int') + '</div><div style="font-size:11px;color:#6b6460">Out of Cadence</div></div>'
      + '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#7f8c8d">' + aggspan('cno', String(sc(cadence_counts, 'no_activity')), 'int') + '</div><div style="font-size:11px;color:#6b6460">No Activity</div></div>'
      + '</div></div>';
    var status_chips = '<div id="statusChips" style="display:flex;flex-wrap:wrap;gap:7px">';
    _ALL_STATS.forEach(function (st) {
      var cnt = sc(status_counts, st);
      if (cnt) status_chips += '<div style="background:' + lk(STATUS_COLORS, st, '#7f8c8d') + ';color:#fff;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600">' + lk(STATUS_LABELS, st, st) + ': ' + cnt + '</div>';
    });
    status_chips += '</div>';
    summary_html += '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px"><div style="font-size:15px;font-weight:700;margin-bottom:10px;font-family:Georgia,serif">Status Breakdown</div>' + status_chips + '</div>';
    if (POD_MODE) {
      var _ot = new Map();
      vals(customers).forEach(function (c) {
        var o = c.owner === undefined ? '—' : c.owner, d = mapGet(_ot, o, function () { return { r25: 0.0, r26: 0.0, n: 0 }; });
        d.r25 += c.rev_2025; d.r26 += c.rev_2026_ytd; d.n += 1;
      });
      var _members = POD_MEMBERS.slice();
      _ot.forEach(function (d, o) { if (o === '—') return; if (!_members.some(function (m) { return lower(o) === lower(m); })) _members.push(o); });
      var _agg_for = function (nm) { var r = null; _ot.forEach(function (d, o) { if (r === null && lower(o) === lower(nm)) r = d; }); return r || { r25: 0.0, r26: 0.0, n: 0 }; };
      var _op = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-top:14px"><div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Pod Split by Rep</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">';
      _members.forEach(function (o) {
        var d = _agg_for(o), isNew = d.n === 0;
        var tag = isNew ? ' <span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:700;color:#1a5276;background:#eaf3fb;border:1px solid #b8d8ef">NEW</span>' : '';
        var body = isNew ? '<span style="color:#9e9086;font-style:italic">New — no activity yet in NetSuite. Fills in automatically once orders are logged.</span>'
          : Y1 + ': ' + fm(d.r25) + '<br>' + Y0 + ' YTD: ' + fm(d.r26) + '<br>' + d.n + ' accounts';
        _op += '<div style="border:1px solid #e2ddd6;border-radius:8px;padding:14px"><div style="font-weight:700;margin-bottom:6px">' + o + ' ' + obadge(o) + tag + '</div><div style="font-size:12px;color:#6b6460;line-height:1.7">' + body + '</div></div>';
      });
      _op += '</div></div>';
      summary_html += _op;
    }

    // ─── RETENTION PANEL ────────────────────────────────────────────────────
    var health_bg = composite >= 70 ? '#d5f5e3' : composite >= 50 ? '#fef3cd' : '#fde8e8';
    var health_fc = composite >= 70 ? '#1a6639' : composite >= 50 ? '#8a5700' : '#8b1a1a';
    var acctStr = materially_active.length ? pyFloat(pyRound(acct_pct, 1)) : '0';
    var revStr = rev_2025_total > 0 ? pyFloat(pyRound(rev_pct, 1)) : '0';
    var ret_html = '<div id="thinNote" style="display:none;background:#f7f6f3;border:1px solid #e2ddd6;'
      + 'border-left:4px solid #9e9086;border-radius:8px;padding:11px 15px;margin-bottom:14px;'
      + 'font-size:13px;color:#4a4440;line-height:1.6"></div>'
      + '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:22px;margin-bottom:14px">'
      + '<div style="font-size:15px;font-weight:700;margin-bottom:14px;font-family:Georgia,serif">Retention Score <span id="retScope" style="font-size:12px;font-weight:600;color:#9e9086">— ' + (TEAM_MODE ? 'whole team' : 'whole pod') + '</span></div>'
      + '<div id="retHealth" style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;background:' + health_bg + ';color:' + health_fc + ';margin-bottom:12px">' + _health + '</div>'
      + '<div style="font-size:48px;font-weight:800;color:' + score_c + ';line-height:1;margin-bottom:8px"><span id="retScoreNum">' + pyFloat(composite) + '</span><span style="font-size:18px;color:#9e9086">/100</span></div>'
      + '<div style="max-width:380px;margin-bottom:12px">'
      + '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#6b6460;margin-bottom:3px"><span>Account Retention</span><span id="retAcctPct">' + acctStr + '%</span></div><div style="background:#f0ece7;border-radius:4px;height:8px"><div id="retAcctBar" style="background:#2980b9;border-radius:4px;height:8px;width:' + (materially_active.length ? pct100(acct_pct) : '0') + '%"></div></div></div>'
      + '<div><div style="display:flex;justify-content:space-between;font-size:12px;color:#6b6460;margin-bottom:3px"><span>Revenue Retention</span><span id="retRevPct">' + revStr + '%</span></div><div style="background:#f0ece7;border-radius:4px;height:8px"><div id="retRevBar" style="background:#27ae60;border-radius:4px;height:8px;width:' + (rev_2025_total > 0 ? pct100(rev_pct) : '0') + '%"></div></div></div>'
      + '</div>'
      + '<div style="font-size:12px;color:#9e9086"><span id="retMA">' + materially_active.length + '</span> materially active customers &nbsp;|&nbsp; <span id="retRET">' + retained.length + '</span> retained</div>'
      + '</div>';
    if (POD_MODE) {
      var _pr = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px"><div style="font-size:15px;font-weight:700;margin-bottom:4px;font-family:Georgia,serif">Retention Score by Rep</div><div style="font-size:12px;color:#9e9086;margin-bottom:14px">Same 0–100 measure (40% accounts retained + 60% revenue retained), computed on each rep&#39;s own book.</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">';
      _view_members.forEach(function (m) {
        var a = VIEW_AGG[m] || {}, cmp = a.composite || 0, man = a.ma || 0, col = cmp >= 70 ? '#27ae60' : cmp >= 50 ? '#e67e22' : '#c8490c', inner;
        if (man === 0) inner = '<div style="font-size:12px;color:#9e9086;font-style:italic;margin-top:6px">New — no activity yet</div>';
        else inner = '<div style="font-size:34px;font-weight:800;color:' + col + ';line-height:1;margin:4px 0 6px">' + pyFloat(cmp) + '<span style="font-size:14px;color:#9e9086">/100</span></div>'
          + '<div style="font-size:12px;color:#6b6460">Acct ' + pyFloat(a.acct_pct) + '% &nbsp;·&nbsp; Rev ' + pyNum(a.rev_pct, a._rpInt) + '%</div>'
          + '<div style="font-size:11px;color:#9e9086;margin-top:3px">' + man + ' materially active · ' + (a.ret || 0) + ' retained</div>';
        _pr += '<div style="border:1px solid #e2ddd6;border-radius:8px;border-top:3px solid ' + _owner_color(m) + ';padding:14px">'
          + '<div style="font-weight:700">' + m + ' ' + obadge(m) + '</div>' + inner + '</div>';
      });
      _pr += '</div></div>';
      ret_html += _pr;
    }

    // ─── MONTHLY CHART TABLE ────────────────────────────────────────────────
    var months_list = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var rev_yrs = {}; YEARS.forEach(function (y) { rev_yrs[y] = {}; });
    Object.keys(monthly_totals).forEach(function (k) {
      var yr = +k.slice(0, 4), mn = +k.slice(5, 7);
      if (rev_yrs[yr]) rev_yrs[yr][mn] = (rev_yrs[yr][mn] || 0) + monthly_totals[k];
    });
    var chart_table = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2ddd6;color:#9e9086;font-weight:600">Month</th>';
    YEARS.forEach(function (y) { chart_table += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2ddd6;color:#9e9086;font-weight:600">' + y + '</th>'; });
    chart_table += '</tr></thead><tbody>';
    months_list.forEach(function (mn, i0) {
      var i = i0 + 1;
      chart_table += '<tr style="border-bottom:1px solid #f0ece7"><td style="padding:6px 8px;font-weight:500">' + mn + '</td>';
      YEARS.forEach(function (y) {
        var v = rev_yrs[y][i] || 0, st = v > 0 ? 'color:#c8490c;font-weight:600' : 'color:#ccc';
        chart_table += '<td style="padding:6px 8px;text-align:right;' + st + '">' + (v > 0 ? fm(v) : '—') + '</td>';
      });
      chart_table += '</tr>';
    });
    chart_table += '</tbody></table></div>';
    var chart_html = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:22px;margin-bottom:14px">'
      + '<div style="font-size:15px;font-weight:700;margin-bottom:14px;font-family:Georgia,serif">Monthly Revenue ' + Y3 + '–' + Y0 + '</div>'
      + '<canvas id="revChart" height="90" style="margin-bottom:14px"></canvas>'
      + '<details><summary style="cursor:pointer;font-size:12px;color:#9e9086">View as table</summary>'
      + chart_table + '</details></div>';

    // ─── SCOPES ─────────────────────────────────────────────────────────────
    var CHG_SCOPES = ['__ALL__'].concat(TEAM_MODE ? Array.from(POD_GROUPS.keys()) : []).concat(POD_MODE ? POD_MEMBERS : []);
    function _scope_cust(cu, scope) { if (scope === '__ALL__') return cu; return filterMap(cu, function (v) { return _in_scope(v, scope); }); }
    function _scope_slug(scope) { return scope === '__ALL__' ? 'all' : lower(scope).replace(/[^a-z0-9]+/g, '_').slice(0, 40); }

    // ─── RISK CARDS (per scope) ─────────────────────────────────────────────
    var RISK_STATUSES = { significantly_overdue: 1, gone: 1, overdue: 1, declining: 1 }, RISK_CARD_CAP = 24;
    var _rev2025s = vals(customers).filter(function (c) { return c.rev_2025 > 0; }).map(function (c) { return c.rev_2025; }).sort(function (a, b) { return a - b; });
    var RISK_REV_FLOOR = _rev2025s.length ? _rev2025s[Math.floor(_rev2025s.length / 2)] : 0;
    function _risk_card(c) {
      var border_c = lk(STATUS_COLORS, c.status, '#e74c3c'), desc;
      if (c.status === 'significantly_overdue')
        desc = 'Expected reorder ' + fd(c.expected_next) + ' (avg gap ' + (c.avg_gap ? pyNum(c.avg_gap, c._agInt) : '?') + ' mo). ' + pyRound(c.months_overdue || 0) + ' months past due.';
      else if (c.status === 'gone') desc = 'Last order ' + fd(c.last_order) + '. No activity >12 months.';
      else if (c.status === 'overdue') desc = 'Expected ' + fd(c.expected_next) + '. About ' + pyRound(c.months_overdue || 0) + ' month(s) overdue.';
      else if (c.status === 'declining') {
        var gap = Math.max(0, (c.rev_2025 || 0) - (c.rev_2026_ann || 0));
        desc = 'Pacing ' + fm(c.rev_2026_ann) + ' ann. vs ' + fm(c.rev_2025) + ' in ' + Y1 + '. Gap: ' + fm(gap) + '.';
      } else desc = '';
      return '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:14px;border-left:4px solid ' + border_c + '">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">'
        + '<div style="font-weight:700;font-size:13px">' + c.name + notetag(c) + ' ' + obadge(c.owner) + '</div>' + sbadge(c.status) + '</div>'
        + '<div style="font-size:12px;color:#6b6460;margin-bottom:6px">' + Y1 + ': ' + fm(c.rev_2025) + ' &nbsp; ' + Y0 + ' YTD: ' + fm(c.rev_2026_ytd) + '</div>'
        + '<div style="font-size:12px;color:#4a4540;margin-bottom:8px;line-height:1.5">' + desc + '</div>'
        + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">' + cbadge(c.cadence) + '</div>'
        + '<div style="font-size:11px;color:#6b6460;border-top:1px solid #f0ece7;padding-top:6px">' + activity_cell(c, true) + '</div>'
        + (c.task_due ? '<div style="font-size:11px;color:#6b6460;margin-top:4px">Reorder task: ' + task_cell(c) + '</div>' : '')
        + '</div>';
    }
    function _risk_panel(scope) {
      var _sc = _scope_slug(scope), _cur = _scope_cust(customers, scope);
      var _risky = vals(_cur).filter(function (c) { return RISK_STATUSES[c.status]; });
      var _eligible = stableSort(_risky.filter(function (c) { return c.rev_2025 >= RISK_REV_FLOOR; }), function (x) { return [-x.rev_2025, x.name]; });
      var _shown = _eligible.slice(0, RISK_CARD_CAP), _hidden = _eligible.slice(RISK_CARD_CAP), _below = _risky.length - _eligible.length, body;
      if (!_risky.length) body = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;font-size:13px;color:#6b6460">No accounts in a risk status on this book right now.</div>';
      else {
        body = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">' + _shown.map(_risk_card).join('') + '</div>';
        if (!_shown.length) body = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;font-size:13px;color:#6b6460">'
          + _risky.length + ' account' + (_risky.length === 1 ? '' : 's') + ' in a risk status, all below the ' + fm(RISK_REV_FLOOR) + ' revenue floor. They are on All Customers, filtered by status.</div>';
      }
      var note = [];
      if (_hidden.length) note.push('Showing the <b>' + _shown.length + ' largest</b> of ' + _eligible.length + ' at-risk accounts above the ' + fm(RISK_REV_FLOOR) + ' revenue floor &mdash; <b>' + _hidden.length + ' more</b>, ' + fm(sum(_hidden.map(function (c) { return c.rev_2025; }))) + ' of ' + Y1 + ' revenue not shown here.');
      else if (_shown.length) note.push('Showing all ' + _shown.length + ' at-risk accounts above the ' + fm(RISK_REV_FLOOR) + ' revenue floor.');
      if (_below) note.push('A further <b>' + _below + '</b> at-risk account' + (_below === 1 ? '' : 's') + ' fall below the floor.');
      if (note.length) {
        note.push('The complete list is on <b>All Customers</b>, filtered by status.');
        body += '<div style="margin-top:12px;padding:11px 14px;background:#faf8f5;border:1px solid #e2ddd6;border-radius:8px;font-size:12px;color:#6b6460;line-height:1.6">' + note.join(' ') + '</div>';
      }
      return '<div class="riskscope" id="riskscope-' + _sc + '" style="display:' + (scope === '__ALL__' ? 'block' : 'none') + '">' + body + '</div>';
    }
    var risk_html = CHG_SCOPES.map(_risk_panel).join('');

    // ─── CUSTOMER TABLE ─────────────────────────────────────────────────────
    var custs_sorted = stableSort(vals(customers), function (x) { return -(x.rev_2025 || 0); });
    var tbl_rows = [];
    custs_sorted.forEach(function (c) {
      tbl_rows.push('<tr class="ownrow" data-owner="' + lower(pyStr(c.owner === undefined ? '' : c.owner)) + '" data-status="' + c.status + '" data-cadence="' + c.cadence + '" data-name="' + pySlice(lower(c.name).replace(/"/g, ''), 60) + '">'
        + (POD_MODE ? '<td>' + obadge(c.owner) + '</td>' : '')
        + '<td><b>' + c.name + '</b>' + notetag(c) + '</td>'
        + '<td>' + sbadge(c.status) + '</td>'
        + '<td>' + tbadge(c.tier || 'B') + '</td>'
        + '<td style="text-align:right">' + fm(c.rev_2025) + '</td>'
        + '<td style="text-align:right">' + fm(c.rev_2026_ytd) + '</td>'
        + '<td style="text-align:right">' + fm(c.rev_2026_ann) + '</td>'
        + '<td>' + fd(c.last_order) + '</td>'
        + '<td>' + (c.expected_next ? fd(c.expected_next) : '—') + '</td>'
        + '<td>' + cbadge(c.cadence) + '</td>'
        + '<td>' + activity_cell(c) + '</td>'
        + '<td style="font-size:11px;color:#6b6460">' + task_cell(c) + '</td>'
        + '</tr>');
    });
    var table_html = '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
      + '<input type="text" id="tblSearch" placeholder="Search..." oninput="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px;min-width:190px">'
      + '<select id="tblSt" onchange="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px"><option value="">All Statuses</option>';
    _ALL_STATS.forEach(function (st) { table_html += '<option value="' + st + '">' + lk(STATUS_LABELS, st, st) + '</option>'; });
    table_html += '</select><select id="tblCad" onchange="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px">'
      + '<option value="">All Cadences</option>'
      + ['in_cadence', 'out_of_cadence', 'not_scheduled', 'no_activity'].map(function (k) { return '<option value="' + k + '">' + CADENCE_LABELS[k] + '</option>'; }).join('')
      + '</select><span id="tblCnt" style="font-size:12px;color:#9e9086;align-self:center"></span>'
      + '<span style="font-size:11px;color:#c8aa90;align-self:center">click a column heading to sort</span></div>'
      + '<div style="overflow:auto;border:1px solid #e2ddd6;border-radius:10px;height:calc(100vh - 250px);min-height:360px">'
      + '<table id="custT" class="sortable" style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr>';
    var TH = 'style="background:#f0ece7;padding:8px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;position:sticky;top:0;z-index:2;white-space:nowrap;cursor:pointer"';
    var _HY1 = Y1 + ' Rev', _HY0 = Y0 + ' YTD', _HY0A = Y0 + ' Ann.';
    (POD_MODE ? ['Owner'] : []).concat(['Customer', 'Status', 'Tier', _HY1, _HY0, _HY0A, 'Last Order', 'Exp. Next', 'Cadence', 'Last Activity', 'Reorder Task']).forEach(function (h) {
      var tr = (h === _HY1 || h === _HY0 || h === _HY0A) ? TH.replace('text-align:left', 'text-align:right') : TH;
      table_html += '<th ' + tr + '>' + h + '<span class="sarw" style="opacity:.35;font-size:9px"> ⇅</span></th>';
    });
    table_html += '</tr></thead><tbody id="custTbody">' + tbl_rows.join('') + '</tbody></table></div>';

    // ─── EXPECTED REORDERS ──────────────────────────────────────────────────
    var due_rows = stableSort(vals(customers).filter(function (c) { return c.status !== 'snoozed' && c.expected_next && c.expected_next >= CMS && c.expected_next < NMS; }), function (x) { return -x.expected_value; });
    var next_month_due = stableSort(vals(customers).filter(function (c) { return c.status !== 'snoozed' && c.expected_next && c.expected_next >= NMS && c.expected_next < NNMS; }), function (x) { return -x.expected_value; });
    var awaiting_date = stableSort(vals(customers).filter(function (c) { return c.needs_reorder_date && c.status !== 'snoozed' && c.status !== 'transferred'; }), function (x) { return -(x.total_rev || 0); });
    function _months_since(ds) { var d = parseDate(ds); return d === null ? null : tdDays(TODAY, d) / 30.44; }
    var _task_groups = { early: [], live: [], cold: [], lapsed: [] };
    awaiting_date.forEach(function (c0) {
      var age = _months_since(c0.last_order); if (age === null) return;
      var c = Object.assign({}, c0); c.months_since = pyRound(age, 1);
      if (age < TASK_TOO_EARLY_MONTHS) _task_groups.early.push(c);
      else if (age < TASK_LIVE_MONTHS) _task_groups.live.push(c);
      else if (age < TASK_COLD_MONTHS) _task_groups.cold.push(c);
      else _task_groups.lapsed.push(c);
    });
    Object.keys(_task_groups).forEach(function (k) { _task_groups[k] = stableSort(_task_groups[k], function (x) { return -(x.total_rev || 0); }); });
    var expected_rev_this_month = sum(due_rows.map(function (c) { return c.expected_value; }));
    var expected_rev_next_month = sum(next_month_due.map(function (c) { return c.expected_value; }));
    function _slug(s) { return lower(String(s)).replace(/[^a-z0-9]+/g, '_').slice(0, 40); }
    function due_section(title, subtitle, rows, period, tier, accent) {
      var sec_id = 'out_' + period + '_' + tier, body;
      if (!rows.length) body = '<p style="color:#9e9086;font-size:13px;margin:6px 0 0">None due this period.</p>';
      else {
        var h = '<div style="overflow:auto;max-height:62vh;border:1px solid #f0ece7;border-radius:8px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
        var cols = ['✓', 'Customer'].concat(POD_MODE ? ['Owner'] : []).concat(['Status', 'Last Order', 'Exp. Date', 'Last Activity', 'Reorder Task', 'Expected $', Y1 + ' Rev', Y0 + ' YTD', 'Avg Gap', 'Cadence']);
        cols.forEach(function (col) {
          var al = (col === 'Expected $' || col === Y1 + ' Rev' || col === Y0 + ' YTD') ? 'text-align:right;' : 'text-align:left;';
          var cur = col !== '✓' ? 'cursor:pointer;' : '', car = col !== '✓' ? '<span class="sarw" style="opacity:.35;font-size:9px"> ⇅</span>' : '';
          h += '<th style="background:#f0ece7;padding:7px 9px;' + al + cur + 'font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;white-space:nowrap;position:sticky;top:0;z-index:2">' + col + car + '</th>';
        });
        h += '</tr></thead><tbody>';
        var parts_ = [];
        rows.forEach(function (c) {
          var rid = 'er_' + period + '_' + _slug(c.name);
          parts_.push('<tr class="er ownrow" data-owner="' + lower(pyStr(c.owner === undefined ? '' : c.owner)) + '" data-id="' + rid + '" data-exp="' + pyFloat(c.expected_value) + '" data-r25="' + pyNum(c.rev_2025, c._i25) + '" data-r26="' + pyNum(c.rev_2026_ytd, c._i26) + '" data-period="' + period + '" data-tier="' + tier + '" style="border-bottom:1px solid #f0ece7">'
            + '<td style="padding:7px 9px;text-align:center"><input type="checkbox" class="erck" onclick="erToggle(this)"></td>'
            + '<td style="padding:7px 9px"><b>' + c.name + '</b>' + notetag(c) + '</td>'
            + (POD_MODE ? '<td style="padding:7px 9px">' + obadge(c.owner) + '</td>' : '')
            + '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>'
            + '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.last_order) + '</td>'
            + '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.expected_next) + '</td>'
            + '<td style="padding:7px 9px">' + activity_cell(c) + '</td>'
            + '<td style="padding:7px 9px">' + task_cell(c) + '</td>'
            + '<td style="padding:7px 9px;text-align:right;font-weight:700;color:#c8490c">' + fm(c.expected_value) + '</td>'
            + '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_2025) + '</td>'
            + '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_2026_ytd) + '</td>'
            + '<td style="padding:7px 9px">' + (c.avg_gap ? pyRound(c.avg_gap) + ' mo' : '—') + '</td>'
            + '<td style="padding:7px 9px">' + cbadge(c.cadence) + '</td>'
            + '</tr>');
        });
        h += parts_.join('');
        var clab = String(2 + (POD_MODE ? 1 : 0));
        h += '<tr class="totalrow" style="background:#fff8f0;border-top:2px solid #c8490c">'
          + '<td colspan="' + clab + '" style="padding:8px 9px;font-weight:700">TOTAL (<span data-roll="n">' + rows.length + '</span> accounts)</td>'
          + '<td></td><td></td><td></td><td></td><td></td>'
          + '<td data-roll="exp" style="padding:8px 9px;text-align:right;font-weight:800;color:#c8490c;font-size:14px">' + fm(sum(rows.map(function (c) { return c.expected_value; }))) + '</td>'
          + '<td data-roll="r25" style="padding:8px 9px;text-align:right;font-weight:600">' + fm(sum(rows.map(function (c) { return c.rev_2025; }))) + '</td>'
          + '<td data-roll="r26" style="padding:8px 9px;text-align:right;font-weight:600">' + fm(sum(rows.map(function (c) { return c.rev_2026_ytd; }))) + '</td>'
          + '<td colspan="2"></td></tr>';
        body = h + '</tbody></table></div>';
      }
      return '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-bottom:14px;border-left:5px solid ' + accent + '">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px">'
        + '<div style="font-size:15px;font-weight:700;font-family:Georgia,serif">' + title + '</div>'
        + '<div id="' + sec_id + '" style="font-size:12px;font-weight:700;color:' + accent + '"></div></div>'
        + '<div style="font-size:12px;color:#9e9086;margin-bottom:8px">' + subtitle + '</div>'
        + body + '</div>';
    }
    var cur_month_name = fmtDate(TODAY, '%B %Y'), next_month_name = fmtDate(nextMonthStart(TODAY), '%B %Y');
    function split_tier(rows) { return [rows.filter(function (c) { return c.tier === 'A'; }), rows.filter(function (c) { return c.tier !== 'A'; })]; }
    var curAB = split_tier(due_rows), nxtAB = split_tier(next_month_due);
    var pareto_banner = '<div style="background:#fff;border:1px solid #e2ddd6;border-left:5px solid #c8490c;border-radius:10px;padding:16px 18px;margin-bottom:14px">'
      + '<div style="font-size:15px;font-weight:700;font-family:Georgia,serif;margin-bottom:6px">The 80/20 of the book</div>'
      + '<div style="font-size:13px;color:#4a4540;line-height:1.7">'
      + '<b style="color:#c8490c">Key Accounts (Tier A):</b> ' + pareto.a_n + ' accounts (~' + pyFloat(pareto.a_pct_n) + '% of the book) drive ' + fm(pareto.a_rev) + ' &mdash; ' + pyFloat(pareto.a_pct_rev) + '% of revenue. Protect these first.<br>'
      + '<b>Long Tail (Tier B):</b> ' + pareto.b_n + ' accounts (~' + pyFloat(pareto.b_pct_n) + '%) make up ' + fm(pareto.b_rev) + ' &mdash; ' + pyFloat(pareto.b_pct_rev) + '%. Keep warm, batch the outreach.'
      + '</div></div>';
    var _await_html = '';
    if (awaiting_date.length) {
      _await_html = '<div style="margin-top:22px"><div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin-bottom:6px">'
        + 'Reorder date needed &mdash; ' + awaiting_date.length + ' new account' + (awaiting_date.length === 1 ? '' : 's') + '</div>'
        + '<div style="font-size:12px;color:#6b6460;margin-bottom:9px;max-width:780px">'
        + 'These have ordered once, so there is no cadence to read yet. Ask the customer when '
        + 'they expect to reorder and set a reorder task &mdash; the date will then drive their '
        + 'expected order here. No guess is being made in the meantime.</div>'
        + '<div style="overflow-x:auto;border:1px solid #e2ddd6;border-radius:8px">'
        + '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'
        + ['Customer', 'Their one order', 'Order value', 'Status'].map(function (h) { return '<th style="background:#f0ece7;padding:7px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;white-space:nowrap">' + h + '</th>'; }).join('')
        + '</tr></thead><tbody>'
        + awaiting_date.slice(0, 60).map(function (c) {
          return '<tr style="border-bottom:1px solid #f0ece7"><td style="padding:7px 10px;font-weight:600">' + c.name + '</td>'
            + '<td style="padding:7px 10px;white-space:nowrap">' + fd(c.last_order) + '</td>'
            + '<td style="padding:7px 10px;text-align:right">' + fm(c.total_rev) + '</td>'
            + '<td style="padding:7px 10px">' + sbadge(c.status) + '</td></tr>';
        }).join('')
        + '</tbody></table></div></div>';
    }
    var due_html = pareto_banner
      + '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:10px 14px;font-size:12px;color:#1a5276;margin-bottom:14px">Expected $ = average order size over the trailing 12 months. Check off each account as the order is placed &mdash; the outstanding total updates live and is saved in your browser, so you and the pod can see what is still open.</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px">'
      + tile('Expected Revenue &mdash; ' + cur_month_name, aggspan('exp_this', fm(expected_rev_this_month), 'money'), aggspan('due_n', String(due_rows.length), 'int') + ' accounts due', true)
      + tile('Expected Revenue &mdash; ' + next_month_name, aggspan('exp_next', fm(expected_rev_next_month), 'money'), aggspan('next_n', String(next_month_due.length), 'int') + ' accounts due')
      + '</div>'
      + '<h3 style="font-family:Georgia,serif;font-size:16px;margin:6px 0 10px">Due in ' + cur_month_name + '</h3>'
      + due_section('★ Key Accounts &mdash; Tier A', 'Top ~20% of accounts / ~80% of revenue. Call these first.', curAB[0], 'cur', 'A', '#c8490c')
      + due_section('Long Tail &mdash; Tier B', 'Bottom ~80% of accounts / ~20% of revenue. Batch these.', curAB[1], 'cur', 'B', '#9e9086')
      + '<h3 style="font-family:Georgia,serif;font-size:16px;margin:18px 0 10px">Due in ' + next_month_name + '</h3>'
      + due_section('★ Key Accounts &mdash; Tier A', 'Top ~20% of accounts / ~80% of revenue.', nxtAB[0], 'next', 'A', '#c8490c')
      + due_section('Long Tail &mdash; Tier B', 'Bottom ~80% of accounts / ~20% of revenue.', nxtAB[1], 'next', 'B', '#9e9086');

    // ─── MONTH CALL PLAN ────────────────────────────────────────────────────
    var current_week_idx = Math.min(pyTrunc(tdDays(TODAY, cur_month_start) / 7), week_starts.length - 1);
    function call_objective(row) {
      var reason = row.reason, cdata = cust(row.name), mo = cdata.months_overdue, exp = row.expected_next;
      if (reason.indexOf('Significantly Overdue') >= 0) {
        var suffix = (mo && mo > 0) ? ' — ' + pyFloat(pyRound(mo, 1)) + ' months past expected' : '';
        return 'Urgent check-in: well past expected reorder window' + suffix;
      } else if (reason.indexOf('Overdue') >= 0) return 'Follow up: order is past due, confirm reorder plans';
      return 'Touch base: order expected around ' + fd(exp);
    }
    function actLine(row) {
      var ago = days_ago(row.last_activity_date);
      if (row.last_activity_title && ago) return ['"' + pySlice(row.last_activity_title, 60) + '" &mdash; ' + ago, false];
      if (ago) return ['Last contact ' + ago, false];
      return ['No contact on record', true];
    }
    function taskLine(row) {
      if (!row.task_due) return '';
      var tt = _rep_task_title(row.name);
      return '<div class="ac-act" style="color:#6b6460">Reorder task already set: ' + fd(row.task_due)
        + ((row.expected_next && row.task_due > row.expected_next) ? ' &mdash; <b style="color:#c8490c">after the ' + fd(row.expected_next) + ' reorder date</b>' : '')
        + (tt ? ' &middot; ' + esc(pySlice(tt, 46)) : '')
        + '</div>';
    }
    var total_calls = 0, high_total = 0;
    july_schedule.forEach(function (rows) { total_calls += rows.length; rows.forEach(function (r) { if (r.priority === 'high') high_total++; }); });
    var sched_html = '<style>'
      + '.sc-banner{background:linear-gradient(135deg,#1a1714 0%,#2d2520 100%);color:#fff;border-radius:10px;padding:16px 22px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center}'
      + '.sc-banner h2{font-size:17px;font-weight:700;font-family:"DM Serif Display",Georgia,serif;margin-bottom:4px}'
      + '.sc-banner p{font-size:12px;color:#c4b9b0}'
      + '.sc-stat .big{font-size:26px;font-weight:700;color:#ff8c6b;text-align:right}'
      + '.sc-stat .lbl{font-size:11px;color:#c4b9b0;text-align:right}'
      + '.wk-card{background:#fff;border:1px solid #e2ddd6;border-radius:10px;margin-bottom:14px;overflow:hidden}'
      + '.wk-hdr{padding:13px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #f0ece7}'
      + '.wk-hdr.cur{background:#fff8f0;border-bottom-color:#c8490c}'
      + '.wk-title{font-size:16px;font-weight:700;font-family:"DM Serif Display",Georgia,serif}'
      + '.wk-dates{font-size:13px;color:#9e9086;margin-left:8px}'
      + '.cur-badge{display:inline-block;background:#c8490c;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:10px;vertical-align:middle;letter-spacing:.5px}'
      + '.wk-counts{display:flex;gap:8px}'
      + '.wk-ct{font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;white-space:nowrap}'
      + '.wk-ct.hi{background:#fde8e0;color:#c8490c}'
      + '.wk-ct.md{background:#fef3e2;color:#b07818}'
      + '.pri-section{padding:0 18px}'
      + '.pri-hdr{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:10px 0 6px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f0ece7;margin-bottom:2px}'
      + '.pri-hdr.hi{color:#c8490c}'
      + '.pri-hdr.md{color:#b07818}'
      + '.ac{display:grid;grid-template-columns:1fr auto;gap:12px;padding:11px 0;border-bottom:1px solid #f0ece7;align-items:start}'
      + '.ac:last-child{border-bottom:none}'
      + '.ac.done{opacity:.4}'
      + '.ac.done .ac-name{text-decoration:line-through}'
      + '.ac-name{font-weight:700;font-size:14px;margin-bottom:3px}'
      + '.ac-obj{font-size:12px;color:#4a4440;margin-bottom:5px;font-style:italic}'
      + '.ac-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:4px}'
      + '.ac-act{font-size:11px;color:#6b6460}'
      + '.ac-act.warn{color:#e67e22;font-weight:500}'
      + '.ac-right{text-align:right;flex-shrink:0;min-width:90px}'
      + '.ac-rev{font-size:16px;font-weight:700}'
      + '.ac-rev-lbl{font-size:10px;color:#9e9086;margin-bottom:8px}'
      + '.call-lbl{display:flex;align-items:center;gap:5px;justify-content:flex-end;cursor:pointer;font-size:12px;font-weight:600;color:#2980b9;user-select:none;margin-top:4px}'
      + '.call-lbl input{cursor:pointer}'
      + '.call-lbl.ck{color:#27ae60}'
      + '.sec-pad{padding-bottom:14px}'
      + '</style>'
      + '<div class="sc-banner">'
      + '<div><h2>' + cur_month_name + ' Call Plan</h2><p>Work HIGH priority first each week. Check off accounts as you call.</p></div>'
      + '<div class="sc-stat"><div class="big">' + total_calls + '</div>'
      + '<div class="lbl">' + high_total + ' HIGH &middot; ' + (total_calls - high_total) + ' expected orders</div></div>'
      + '</div>';
    strSort(Array.from(july_schedule.keys())).forEach(function (wk, wk_idx) {
      var rows = july_schedule.get(wk); if (!rows.length) return;
      var is_cur = wk_idx === current_week_idx, pi = wk.indexOf('(');
      var wk_num_str = pi >= 0 ? strip(wk.slice(0, pi)) : strip(wk), wk_date_str = pi >= 0 ? wk.slice(pi) : '';
      var hi_rows = rows.filter(function (r) { return r.priority === 'high'; }), md_rows = rows.filter(function (r) { return r.priority !== 'high'; });
      var out = ['<div class="wk-card"><div class="wk-hdr' + (is_cur ? ' cur' : '') + '">'
        + '<div><span class="wk-title">' + wk_num_str + '</span><span class="wk-dates">' + wk_date_str + '</span>'
        + (is_cur ? '<span class="cur-badge">THIS WEEK</span>' : '') + '</div>'
        + '<div class="wk-counts">'
        + (hi_rows.length ? '<span class="wk-ct hi">' + hi_rows.length + ' HIGH</span>' : '')
        + (md_rows.length ? '<span class="wk-ct md">' + md_rows.length + (md_rows.length === 1 ? ' EXPECTED ORDER' : ' EXPECTED ORDERS') + '</span>' : '')
        + '</div></div><div class="pri-section">'];
      function card(row, cid) {
        var al = actLine(row), c0 = cust(row.name);
        var ag = row.avg_gap ? ' <span style="font-size:11px;color:#9e9086">Avg gap: ' + pyNum(pyRound(row.avg_gap, 1), row._agInt) + ' mo</span>' : '';
        return '<div class="ac ownrow" data-owner="' + lower(pyStr(c0.owner === undefined ? '' : c0.owner)) + '" id="' + cid + '">'
          + '<div><div class="ac-name">' + row.name + notetag(c0) + '</div>'
          + '<div class="ac-obj">' + call_objective(row) + '</div>'
          + '<div class="ac-meta">' + sbadge(row.status) + ' ' + cbadge(row.cadence) + ag + '</div>'
          + taskLine(row)
          + '<div class="ac-act' + (al[1] ? ' warn' : '') + '">' + al[0] + '</div></div>'
          + '<div class="ac-right"><div class="ac-rev">' + fm(row.rev_2025) + '</div><div class="ac-rev-lbl">' + Y1 + ' rev</div>'
          + '<label class="call-lbl" id="l' + cid + '" onclick="tc(\'' + cid + '\');return false;"><input type="checkbox" onclick="event.stopPropagation()"> Called</label>'
          + '</div></div>';
      }
      if (hi_rows.length) { out.push('<div class="pri-hdr hi">&#9888; HIGH PRIORITY &mdash; Call These First</div>'); hi_rows.forEach(function (r, i) { out.push(card(r, 'c' + wk_idx + 'h' + i)); }); }
      if (md_rows.length) { out.push('<div class="pri-hdr md">&#x25cf; EXPECTED ORDERS &mdash; Touch Base</div>'); md_rows.forEach(function (r, i) { out.push(card(r, 'c' + wk_idx + 'm' + i)); }); }
      out.push('<div class="sec-pad"></div></div></div>');
      sched_html += out.join('');
    });
    // NOTE: rows in july_schedule do not carry task_due (as in the Python), so the
    // "Reorder task already set" line never renders on this tab — kept for parity.

    // ─── THIS WEEK: DAY-BY-DAY ──────────────────────────────────────────────
    var week_monday = addDays(TODAY, -TP.wd);
    var week_days = [0, 1, 2, 3, 4].map(function (i) { return addDays(week_monday, i); });
    var week_list = [], week_seen = {};
    stableSort(vals(customers).filter(function (x) { return x.status === 'significantly_overdue'; }), function (x) { return -x.rev_2025; }).slice(0, 10).forEach(function (v) {
      week_list.push({ c: v, priority: 'high', reason: 'Significantly Overdue - Urgent' }); week_seen[v.name] = 1; });
    stableSort(vals(customers).filter(function (x) { return x.status === 'overdue'; }), function (x) { return -x.rev_2025; }).slice(0, 8).forEach(function (v) {
      if (!week_seen[v.name]) { week_list.push({ c: v, priority: 'high', reason: 'Overdue - Follow Up' }); week_seen[v.name] = 1; } });
    stableSort(due_rows, function (x) { return [x.expected_next || '9999', -x.expected_value]; }).slice(0, 15).forEach(function (v) {
      if (!week_seen[v.name]) { week_list.push({ c: v, priority: 'medium', reason: 'Expected Order Due' }); week_seen[v.name] = 1; } });
    var n_week = week_list.length, per_day = n_week ? Math.max(1, Math.ceil(n_week / 5)) : 0;
    var day_bins = [0, 1, 2, 3, 4].map(function (i) { return week_list.slice(i * per_day, (i + 1) * per_day); });
    var week_total = n_week, week_high = week_list.filter(function (e) { return e.priority === 'high'; }).length;
    var week_exp_rev = sum(week_list.map(function (e) { return e.c.expected_value; }));
    var week_html = '<div class="sc-banner"><div><h2>Call Plan &mdash; Week of ' + fmtDate(week_monday, '%B %d') + '</h2>'
      + '<p>Priority-first: HIGH accounts land Monday&ndash;Tuesday. Check off as you call.</p></div>'
      + '<div class="sc-stat"><div class="big">' + week_total + '</div>'
      + '<div class="lbl">' + week_high + ' HIGH &middot; ' + fm(week_exp_rev) + ' expected reorder value</div></div></div>';
    if (!week_list.length) week_html += '<p style="color:#9e9086;font-size:13px">No calls needed this week — nothing overdue or due this month.</p>';
    week_days.forEach(function (day, di) {
      var entries = day_bins[di] || [], is_today = floorDay(day) === floorDay(TODAY);
      var day_exp = sum(entries.map(function (e) { return e.c.expected_value; }));
      var nh = entries.filter(function (e) { return e.priority === 'high'; }).length, nm = entries.length - nh;
      var out = ['<div class="wk-card"><div class="wk-hdr' + (is_today ? ' cur' : '') + '">'
        + '<div><span class="wk-title">' + fmtDate(day, '%A') + '</span><span class="wk-dates">' + fmtDate(day, '%b %d') + '</span>'
        + (is_today ? '<span class="cur-badge">TODAY</span>' : '') + '</div><div class="wk-counts">'
        + (nh ? '<span class="wk-ct hi">' + nh + ' HIGH</span>' : '')
        + (nm ? '<span class="wk-ct md">' + nm + ' EXPECTED</span>' : '')
        + '<span class="wk-ct" style="background:#eef4ee;color:#1a6639">' + fm(day_exp) + '</span>'
        + '</div></div><div class="pri-section">'];
      if (!entries.length) out.push('<p style="color:#9e9086;font-size:13px;padding:12px 0">No calls scheduled.</p>');
      entries.forEach(function (e, i) {
        var row = e.c, al = actLine(row), cid = 'wd' + di + 'i' + i, c0 = cust(row.name);
        var ag = row.avg_gap ? ' <span style="font-size:11px;color:#9e9086">Avg gap: ' + pyNum(pyRound(row.avg_gap, 1), row._agInt) + ' mo</span>' : '';
        out.push('<div class="ac ownrow" data-owner="' + lower(pyStr(c0.owner === undefined ? '' : c0.owner)) + '" id="' + cid + '">'
          + '<div><div class="ac-name">' + row.name + ' ' + pbadge(e.priority) + (POD_MODE ? ' ' + obadge(row.owner) : '') + notetag(c0) + '</div>'
          + '<div class="ac-obj">' + call_objective({ reason: e.reason, name: row.name, expected_next: row.expected_next }) + '</div>'
          + '<div class="ac-meta">' + sbadge(row.status) + ' ' + cbadge(row.cadence) + ag + '</div>'
          + taskLine(row)
          + '<div class="ac-act' + (al[1] ? ' warn' : '') + '">' + al[0] + '</div></div>'
          + '<div class="ac-right"><div class="ac-rev">' + fm(row.expected_value) + '</div><div class="ac-rev-lbl">expected reorder</div>'
          + '<div style="font-size:11px;color:#9e9086;margin-bottom:6px">' + Y1 + ': ' + fm(row.rev_2025) + '</div>'
          + '<label class="call-lbl" id="l' + cid + '" onclick="tc(\'' + cid + '\');return false;"><input type="checkbox" onclick="event.stopPropagation()"> Called</label>'
          + '</div></div>');
      });
      out.push('<div class="sec-pad"></div></div></div>');
      week_html += out.join('');
    });

    // ─── ACTIVITY CADENCE TAB ───────────────────────────────────────────────
    var out_cad = stableSort(vals(customers).filter(function (c) { return c.cadence === 'out_of_cadence' && c.rev_2025 > 0; }), function (x) { return -x.rev_2025; });
    var cad_tbl = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px;margin-bottom:14px"><div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Cadence by Status</div><canvas id="cadChart" height="80"></canvas></div>'
      + '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px"><div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Top Out-of-Cadence Accounts</div>'
      + '<div style="overflow:auto;max-height:62vh;border:1px solid #f0ece7;border-radius:8px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
    (POD_MODE ? ['Owner'] : []).concat(['Customer', 'Status', Y1 + ' Rev', 'Last Activity', 'Notes', 'Exp. Next']).forEach(function (h) {
      cad_tbl += '<th style="background:#f0ece7;padding:7px 9px;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;text-align:left;white-space:nowrap;position:sticky;top:0;z-index:2;cursor:pointer">' + h + '<span class="sarw" style="opacity:.35;font-size:9px"> ⇅</span></th>';
    });
    cad_tbl += '</tr></thead><tbody>';
    out_cad.slice(0, 80).forEach(function (c) {
      cad_tbl += '<tr class="ownrow" data-owner="' + lower(pyStr(c.owner === undefined ? '' : c.owner)) + '" style="border-bottom:1px solid #f0ece7">'
        + (POD_MODE ? '<td style="padding:7px 9px">' + obadge(c.owner) + '</td>' : '')
        + '<td style="padding:7px 9px"><b>' + c.name + '</b></td>'
        + '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>'
        + '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_2025) + '</td>'
        + '<td style="padding:7px 9px">' + activity_cell(c, true) + '</td>'
        + '<td style="padding:7px 9px;font-size:11px;color:#6b6460">'
        + (c.last_activity_type ? '<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600;color:#fff;background:' + (String(c.last_activity_type).indexOf('Email') === 0 ? '#2980b9' : '#6b6460') + ';margin-right:5px">' + c.last_activity_type + '</span>' : '')
        + pySlice(c.last_activity_title || '', 50)
        + (c.watch || []).map(function (w) { return '<div style="margin-top:2px;color:#8e44ad;font-size:10px;font-weight:600">&#9888; ' + w + '</div>'; }).join('')
        + '</td>'
        + '<td style="padding:7px 9px;white-space:nowrap">' + (c.expected_next ? fd(c.expected_next) : '—') + '</td>'
        + '</tr>';
    });
    var _touch = { 'Task': 0, 'Email in': 0, 'Email out': 0, '': 0 };
    vals(customers).forEach(function (c) { var t = c.last_activity_type || ''; _touch[(t in _touch) ? t : ''] += 1; });
    var _email_touch = _touch['Email in'] + _touch['Email out'];
    var _CTH = 'background:#f0ece7;padding:7px 9px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;white-space:nowrap';
    var _ci_on = vals(customers).filter(function (c) { return c.on_rotation; }).length;
    var _ci_in = vals(customers).filter(function (c) { return c.cadence === 'in_cadence'; }).length;
    var _ci_out = _ci_on - _ci_in;
    var _ci_silent = vals(customers).filter(function (c) { return c.on_rotation && c.cadence === 'no_activity'; }).length;
    var _ci_never = vals(customers).filter(function (c) { return c.cadence === 'no_activity'; }).length;
    var _ci_pct = _ci_on ? pyRound(100 * _ci_in / _ci_on) : 0;
    var _cov = {}; vals(customers).forEach(function (c) { var k = c.reorder_cover; _cov[k] = (_cov[k] || 0) + 1; });
    var _cov_due = sc(_cov, 'covered_task') + sc(_cov, 'covered_touch') + sc(_cov, 'uncovered');
    var _cov_ok = sc(_cov, 'covered_task') + sc(_cov, 'covered_touch');
    var _cov_pct = _cov_due ? pyRound(100 * _cov_ok / _cov_due) : 0;
    var _uncovered = stableSort(vals(customers).filter(function (c) { return c.reorder_cover === 'uncovered'; }), function (c) { return -(c.rev_2025 || 0); });
    function _cover_rows(rows, limit) {
      limit = limit || 200;
      if (!rows.length) return '<p style="color:#27ae60;font-size:13px;margin:8px 0 0;font-weight:600">Nothing past due without someone on it.</p>';
      var cols = ['Account'].concat(POD_MODE ? ['Owner'] : []).concat(['Status', 'Was due', 'Months late', 'Last touch', 'Last-year revenue']);
      var h = '<div style="overflow:auto;max-height:58vh;border:1px solid #e2ddd6;border-radius:9px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'
        + cols.map(function (c) { return '<th style="' + _CTH + ';position:sticky;top:0;z-index:2;cursor:pointer">' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.slice(0, limit).forEach(function (c) {
        var ml = c.months_overdue;
        h += '<tr class="ownrow" data-owner="' + lower(pyStr(c.owner === undefined ? '' : c.owner)) + '" style="border-bottom:1px solid #f0ece7">'
          + '<td style="padding:7px 9px;font-weight:600">' + c.name + '</td>'
          + (POD_MODE ? '<td style="padding:7px 9px">' + obadge(c.owner) + '</td>' : '')
          + '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>'
          + '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.expected_next) + '</td>'
          + '<td style="padding:7px 9px;text-align:right;font-weight:700;color:#c0392b">' + ((ml !== null && ml !== undefined && ml > 0) ? pyFmt(ml, 1) : '&mdash;') + '</td>'
          + '<td style="padding:7px 9px;font-size:12px;color:#6b6460;white-space:nowrap">'
          + (c.last_activity_date ? fd(c.last_activity_date) : '<span style="color:#c0392b">never</span>')
          + (c.last_activity_type ? '<div style="font-size:10px;color:#9e9086">' + c.last_activity_type + '</div>' : '') + '</td>'
          + '<td style="padding:7px 9px;text-align:right;white-space:nowrap">' + fm(c.rev_2025 || 0) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (rows.length > limit) h += '<div style="font-size:12px;color:#9e9086;margin-top:6px">Showing the top ' + limit + ' of ' + rows.length + ' by last-year revenue.</div>';
      return h;
    }
    var cad_html = '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:11px 15px;font-size:12px;color:#1a5276;margin-bottom:14px;line-height:1.6">'
      + '<b>Two different questions, kept apart on purpose.</b> Support processes orders, so '
      + 'transactional email tracks how often a customer buys whether or not anyone is managing the '
      + 'relationship. <b>Check-in cadence</b> asks whether the proactive rotation is being run, and only '
      + 'covers accounts that have one. <b>Reorder coverage</b> asks whether anyone is actually on the '
      + 'reorder, and covers every account that is due &mdash; including the ones with no scheduled '
      + 'check-in, because &ldquo;operational, as needed&rdquo; still means somebody has to chase it.</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:18px">'
      + tile('Check-in cadence', _ci_pct + '%', _ci_in + ' of ' + _ci_on + ' on the rotation', true)
      + tile('Check-in overdue', String(_ci_out), 'past their interval' + (_ci_silent ? ', incl. ' + _ci_silent + ' never contacted' : ''), true)
      + tile('No contact on record', String(_ci_never), 'nothing logged either way, ever', true)
      + tile('Reorder coverage', _cov_pct + '%', _cov_ok + ' of ' + _cov_due + ' due or past due', true)
      + tile('Nobody on the reorder', String(_uncovered.length), fm(sum(_uncovered.map(function (c) { return c.rev_2025 || 0; }))) + ' of last-year revenue', true)
      + '</div>'
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:20px 0 8px">Past due for a reorder and nobody is on it</h3>'
      + '<div style="font-size:12px;color:#6b6460;margin-bottom:9px;max-width:900px;line-height:1.6">'
      + 'No forward-dated reorder task, and no real contact from two weeks before the date onward. Biggest first.</div>'
      + _cover_rows(_uncovered)
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:26px 0 8px">How contact is reaching them</h3>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:16px">'
      + tile('Last touch was email', String(_email_touch), _touch['Email out'] + ' we wrote &middot; ' + _touch['Email in'] + ' they wrote')
      + tile('Last touch was a logged task', String(_touch['Task']), 'calls and logged activity')
      + tile('No contact on record', String(_touch['']), 'nothing logged either way')
      + '</div>'
      + '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:10px 14px;font-size:12px;color:#1a5276;margin-bottom:14px">Cadence counts real conversation &mdash; '
      + 'a logged task, an email the rep wrote, or an email the customer sent in. Order confirmations, '
      + 'quote documents and other automated mail are excluded, so a customer who simply placed an order '
      + 'does not read as &ldquo;in touch&rdquo;.</div>'
      + cad_tbl + '</tbody></table></div></div>';

    // ─── REORDER TASKS NEEDED ───────────────────────────────────────────────
    function _task_table(rows, accent) {
      if (!rows.length) return '<p style="color:#9e9086;font-size:13px;margin:4px 0 2px">None.</p>';
      var th = 'background:#f0ece7;padding:7px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;white-space:nowrap';
      var h = '<div style="overflow-x:auto;border:1px solid #e2ddd6;border-radius:8px;border-left:3px solid ' + accent + '"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'
        + ['Customer', 'Their one order', 'Order value', 'Months since', 'Status'].map(function (c) { return '<th style="' + th + '">' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (c) {
        h += '<tr style="border-bottom:1px solid #f0ece7"><td style="padding:7px 10px;font-weight:600">' + c.name + '</td>'
          + '<td style="padding:7px 10px;white-space:nowrap">' + fd(c.last_order) + '</td>'
          + '<td style="padding:7px 10px;text-align:right;white-space:nowrap">' + fm(c.total_rev) + '</td>'
          + '<td style="padding:7px 10px;text-align:right">' + pyFloat(c.months_since) + '</td>'
          + '<td style="padding:7px 10px">' + sbadge(c.status) + '</td></tr>';
      });
      return h + '</tbody></table></div>';
    }
    function _grp_rev(k) { return sum(_task_groups[k].map(function (c) { return c.total_rev || 0; })); }
    var task_html = '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:10px 14px;font-size:12px;color:#1a5276;margin-bottom:14px">'
      + 'These customers have ordered once. There is no cadence to read from a single order, so the '
      + 'dashboard does not guess a reorder date &mdash; ask the customer when they expect to reorder '
      + 'and set a reorder task. That date then drives their expected order on the Expected Reorders tab.</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:18px">'
      + tile('Worth a task now', String(_task_groups.live.length), fm(_grp_rev('live')) + ' in first orders', true)
      + tile('Going cold', String(_task_groups.cold.length), fm(_grp_rev('cold')) + ' &middot; 9&ndash;18 months')
      + tile('Too early to ask', String(_task_groups.early.length), 'ordered within 2 months')
      + tile('Lapsed', String(_task_groups.lapsed.length), 'over 18 months &mdash; win-back, not a task')
      + '</div>'
      + '<div style="font-size:13px;font-weight:700;margin:4px 0 5px">Worth a reorder task now <span style="font-weight:400;color:#6b6460">&mdash; ordered 2&ndash;9 months ago, still warm, biggest first</span></div>'
      + _task_table(_task_groups.live, '#c8490c')
      + '<div style="font-size:13px;font-weight:700;margin:22px 0 5px">Going cold <span style="font-weight:400;color:#6b6460">&mdash; 9&ndash;18 months, worth one attempt</span></div>'
      + _task_table(_task_groups.cold, '#e67e22')
      + '<div style="font-size:13px;font-weight:700;margin:22px 0 5px">Too early to ask <span style="font-weight:400;color:#6b6460">&mdash; give them time</span></div>'
      + _task_table(_task_groups.early, '#16a085')
      + '<div style="font-size:13px;font-weight:700;margin:22px 0 5px">Lapsed <span style="font-weight:400;color:#6b6460">&mdash; over 18 months since their only order. This is a win-back list, not a reorder task list.</span></div>'
      + _task_table(_task_groups.lapsed.slice(0, 40), '#7f8c8d')
      + (_task_groups.lapsed.length > 40 ? '<p style="color:#9e9086;font-size:12px;margin-top:7px">Showing the 40 largest of ' + _task_groups.lapsed.length + '.</p>' : '');

    var stat_order_j = ['growing', 'on_track', 'new', 'not_yet_due', 'declining', 'overdue', 'significantly_overdue', 'gone'];
    var cad_labels = stat_order_j.map(function (s) { return lk(STATUS_LABELS, s, s); });
    var month_year_str = fmtDate(TODAY, '%B %Y');
    var rep_select = '';
    if (POD_MODE && !OPT.hideRepFilter) {
      rep_select = '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="color:#9e9086;font-size:11px;letter-spacing:.6px;text-transform:uppercase">' + (TEAM_MODE ? 'View by pod or rep' : 'View by rep') + '</span>'
        + '<select id="repFilter" onchange="applyRep(this.value)" style="padding:7px 11px;border-radius:7px;border:1px solid #4a4038;background:#2a2420;color:#fff;font-size:13px;font-weight:600">' + _rep_options() + '</select></div>';
    }

    // ─── WHAT CHANGED (period-over-period, rebuilt as-of) ───────────────────
    function score_of(cu) {
      var ma = new Map(), ret = new Map();
      cu.forEach(function (v, k) { if (isScored(v)) { ma.set(k, v); if (retained_statuses[v.status]) ret.set(k, v); } });
      var n = ma.size, rt = sum(mvals(ma).map(function (v) { return v.rev_2025; }));
      var a = n ? (ret.size / n * 100) : 0.0, rr = sum(mvals(ret).map(function (v) { return v.rev_2025; }));
      var r = rt > 0 ? (rr / rt * 100) : 0.0;
      return { composite: pyRound(0.4 * a + 0.6 * r, 1), acct_pct: a, rev_pct: r, n_active: n, n_retained: ret.size, rev_active: rt, ma: ma, ret: ret };
    }
    var _selfcheck = score_of(customers).composite;
    var WARN = [];
    if (Math.abs(_selfcheck - composite) > 0.05) WARN.push('WARNING: score_of() = ' + _selfcheck + ' but composite = ' + composite);
    var _STATE_CACHE = {};
    function state_at(dt) { var k = ymd(dt); if (!_STATE_CACHE[k]) _STATE_CACHE[k] = build_state(dt); return _STATE_CACHE[k]; }
    var CAUSE_LABELS = { ordered: 'Order landed', time: 'Reorder date passed', drift: 'Calendar drift', eligible: 'Entered scored set', ineligible: 'Left scored set', other: 'Status change' };
    var CAUSE_COLORS = { ordered: '#27ae60', time: '#e67e22', drift: '#8e44ad', eligible: '#2980b9', ineligible: '#7f8c8d', other: '#6b6460' };
    var REAL_CAUSES = { ordered: 1, time: 1, other: 1 };
    function _cause(nm, cur, prev) {
      var c2 = cur.get(nm), c1 = prev.get(nm);
      if (!c2) return ['ineligible', 'Dropped out of the scored set'];
      if (!c1) return ['eligible', 'Reached 2+ orders with qualifying revenue'];
      if (c2.last_order !== c1.last_order) return ['ordered', 'Ordered ' + fd(c2.last_order) + ' — reorder clock reset'];
      var s1 = c1.status, s2 = c2.status, late = { overdue: 1, significantly_overdue: 1, gone: 1 };
      if (late[s2] && !late[s1]) return ['time', 'Expected ' + fd(c2.expected_next) + ', nothing since ' + fd(c2.last_order)];
      if (s2 === 'declining' && (s1 === 'on_track' || s1 === 'growing')) return ['drift', 'No new order — annualized run-rate slipped under 70% of ' + Y1 + ' as months elapsed'];
      if (s1 === 'declining' && (s2 === 'on_track' || s2 === 'growing')) return ['drift', 'No new order — annualized run-rate rose back over 70% of ' + Y1];
      return ['other', lk(STATUS_LABELS, s1, s1) + ' → ' + lk(STATUS_LABELS, s2, s2)];
    }
    function compare(prev_cust, cur_cust) {
      var S1 = score_of(prev_cust), S2 = score_of(cur_cust), N2 = S2.n_active || 1, R2 = S2.rev_active || 1.0, flips = [];
      S2.ma.forEach(function (v2, nm) {
        if (!S1.ma.has(nm)) return;
        var r1 = S1.ret.has(nm) ? 1 : 0, r2 = S2.ret.has(nm) ? 1 : 0;
        if (r1 === r2) return;
        var rev = v2.rev_2025, pts = 0.4 * ((r2 - r1) / N2 * 100) + 0.6 * ((r2 - r1) * rev / R2 * 100);
        var cw = _cause(nm, cur_cust, prev_cust);
        flips.push({ name: nm, rev: rev, from: S1.ma.get(nm).status, to: v2.status, pts: pts, cause: cw[0], why: cw[1], owner: v2.owner });
      });
      var mix = [];
      strSort(Array.from(S2.ma.keys()).filter(function (k) { return !S1.ma.has(k); })).forEach(function (nm) {
        var c1 = prev_cust.get(nm), why = 'Reached 2+ orders with qualifying revenue';
        if (c1 && c1.last_order !== cur_cust.get(nm).last_order) why = 'Qualifying second order landed ' + fd(cur_cust.get(nm).last_order) + ' — now inside the scored set';
        mix.push({ name: nm, rev: S2.ma.get(nm).rev_2025, from: '—', to: S2.ma.get(nm).status, cause: 'eligible', why: why });
      });
      strSort(Array.from(S1.ma.keys()).filter(function (k) { return !S2.ma.has(k); })).forEach(function (nm) {
        mix.push({ name: nm, rev: S1.ma.get(nm).rev_2025, from: S1.ma.get(nm).status, to: '—', cause: 'ineligible', why: 'Dropped out of the scored set' });
      });
      flips = stableSort(flips, function (x) { return [x.pts, x.name]; }); // ties broken on the name (rev 10.4)
      var explained = sum(flips.map(function (f) { return f.pts; })), delta = pyRound(S2.composite - S1.composite, 1);
      return { S1: S1, S2: S2, delta: delta, flips: flips, mix: mix, explained: explained, residual: delta - explained };
    }
    var BASELINES = [['week', 'Last week', addDays(TODAY, -7)], ['month', 'Last month-end', prevMonthEnd(TODAY)]];
    var _TREND = [], _td = TODAY;
    for (var _k = 0; _k < 7; _k++) { var _me = prevMonthEnd(_td); if (parts(_me).y < TP.y) break; _TREND.push(_me); _td = _me; }
    _TREND.reverse();
    function _trend_svg(pts) {
      if (pts.length < 2) return '<div style="color:#6b6460;font-size:13px;padding:10px 0">Not enough completed month-ends this year to draw a trend yet.</div>';
      var W = 700, H = 158, PADL = 44, PADR = 16, PADT = 28, PADB = 26;
      var vs = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
      if (hi - lo < 2) { lo = lo - 1; hi = hi + 1; }
      var span = hi - lo;
      function X(i) { return PADL + i * (W - PADL - PADR) / (pts.length - 1); }
      function Yv(v) { return PADT + (hi - v) * (H - PADT - PADB) / span; }
      var o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:720px;height:auto">'];
      [0, 0.5, 1].forEach(function (g) {
        var yv = lo + span * g;
        o.push('<line x1="' + PADL + '" y1="' + pyFmt(Yv(yv), 1) + '" x2="' + (W - PADR) + '" y2="' + pyFmt(Yv(yv), 1) + '" stroke="#e2ddd6"/>');
        o.push('<text x="' + (PADL - 6) + '" y="' + pyFmt(Yv(yv) + 3, 1) + '" font-size="10" fill="#9e9086" text-anchor="end">' + pyFmt(yv, 0) + '</text>');
      });
      o.push('<polyline points="' + vs.map(function (v, i) { return pyFmt(X(i), 1) + ',' + pyFmt(Yv(v), 1); }).join(' ') + '" fill="none" stroke="#c8490c" stroke-width="2.5"/>');
      pts.forEach(function (p, i) {
        var v = p[1];
        o.push('<circle cx="' + pyFmt(X(i), 1) + '" cy="' + pyFmt(Yv(v), 1) + '" r="4" fill="#fff" stroke="#c8490c" stroke-width="2.5"/>');
        o.push('<text x="' + pyFmt(X(i), 1) + '" y="' + pyFmt(H - 8, 1) + '" font-size="10" fill="#6b6460" text-anchor="middle">' + p[0] + '</text>');
        var prv = i ? vs[i - 1] : null;
        if (i === 0 || i === pts.length - 1 || Math.abs(v - prv) >= 0.05)
          o.push('<text x="' + pyFmt(X(i), 1) + '" y="' + pyFmt(Math.max(Yv(v) - 9, 11), 1) + '" font-size="10" font-weight="700" fill="#1a1714" text-anchor="middle">' + pyFmt(v, 1) + '</text>');
      });
      o.push('</svg>');
      return o.join('');
    }
    function _cbadge(c) { return '<span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:10px;font-weight:700;color:#fff;background:' + lk(CAUSE_COLORS, c, '#6b6460') + '">' + lk(CAUSE_LABELS, c, c) + '</span>'; }
    function _delta_str(x, dp) { if (dp === undefined) dp = 1; return (x > 0 ? '+' : x < 0 ? '−' : '') + pyFmt(Math.abs(x), dp); }

    // ─── WINDOWED ACTIVITY LOG ("What we actually did") ─────────────────────
    var ACT_LOG = new Map();
    (raw.touchlog || []).forEach(function (r) {
      var cu = strip(pyStr(r.customer === undefined ? '' : r.customer)), dd = parseDate(r.date);
      if (!(cu && dd !== null)) return;
      mapGet(ACT_LOG, cu, function () { return []; }).push({
        date: dd, dir: lower(pyStr(r.dir === undefined ? '' : r.dir)).indexOf('in') === 0 ? 'in' : 'out',
        who: strip(String(r.who || '')) || '—', kind: String(r.kind || 'email'),
        done: r.done || null, subject: String(r.subject || '') });
    });
    ACT_LOG.forEach(function (v, k) { ACT_LOG.set(k, stableSort(v, function (x) { return x.date; })); });
    var HAS_ACTLOG = ACT_LOG.size > 0;
    var _PLAN_CACHE = {};
    function plan_at(dt) { var k = ymd(dt); if (!_PLAN_CACHE[k]) _PLAN_CACHE[k] = compute_checkins(state_at(dt), dt, false); return _PLAN_CACHE[k]; }
    var ACT_GROUPS = [
      ['worked', 'Reached out — and the order landed', '#27ae60', 'We made contact and they bought inside the period. This is the motion working.'],
      ['waiting', 'Reached out — still waiting', '#2980b9', 'Contact was made, no order yet. Normal for most of the list; worth a second touch once it ages.'],
      ['selfserve', 'Ordered without us reaching out', '#8e44ad', 'They came back on their own. The revenue is fine, but we learned nothing and built no relationship.'],
      ['missed', 'Nobody reached them — and no order', '#c8490c', 'These were on the list at the start of the period and nothing happened at either end.'],
      ['extra', 'Activity on accounts that were not due', '#6b6460', 'Real work that the plan did not ask for — inbound questions, follow-ups, opportunistic calls.']
    ];
    var _ROSTER_LC = {}; POD_MEMBERS.forEach(function (m) { _ROSTER_LC[lower(strip(String(m)))] = 1; });
    function _is_rep(w) { return !!_ROSTER_LC[lower(strip(String(w)))]; }
    var _ACT_CACHE = {};
    function activity_since(as_of, scope) {
      var ck = ymd(as_of) + '|' + scope; if (_ACT_CACHE[ck]) return _ACT_CACHE[ck];
      var cur = _scope_cust(customers, scope), prev = _scope_cust(state_at(as_of), scope);
      var _today_s = ymd(TODAY), _as_of_s = ymd(as_of);
      var checkin_due = {};
      plan_at(as_of).forEach(function (x) { if (x.overdue >= 0 && prev.has(x.name)) checkin_due[x.name] = x.due; });
      var reorder_due = {}, due_new = {}, due_carried = {};
      prev.forEach(function (v, nm) {
        if (v.status === 'snoozed' || v.status === 'transferred') return;
        var en = v.expected_next;
        if (en && en <= _today_s) { reorder_due[nm] = en; (en > _as_of_s ? due_new : due_carried)[nm] = 1; }
      });
      var due = {}; Object.keys(checkin_due).forEach(function (k) { due[k] = 1; }); Object.keys(reorder_due).forEach(function (k) { due[k] = 1; });
      var groups = {}; ACT_GROUPS.forEach(function (g) { groups[g[0]] = []; });
      var who = new Map(), n_touch = 0, n_in = 0, n_sup = 0, touched = {};
      var allN = {}; cur.forEach(function (v, k) { allN[k] = 1; }); prev.forEach(function (v, k) { allN[k] = 1; }); Object.keys(due).forEach(function (k) { allN[k] = 1; });
      strSort(Object.keys(allN)).forEach(function (nm) {
        var ts = (ACT_LOG.get(nm) || []).filter(function (t) { return as_of < t.date && t.date <= TODAY; });
        if (!ts.length && !due[nm]) return;
        var sent = ts.filter(function (t) { return t.dir === 'out'; });
        var outs = sent.filter(function (t) { return _is_rep(t.who); }), sup = sent.filter(function (t) { return !_is_rep(t.who); });
        n_touch += ts.length; n_in += ts.length - sent.length; n_sup += sup.length;
        if (ts.length) touched[nm] = 1;
        outs.forEach(function (t) { who.set(t.who, (who.get(t.who) || 0) + 1); });
        var c2 = cur.get(nm) || prev.get(nm) || null, c1 = prev.get(nm) || null;
        var lo = (c2 || {}).last_order, ordered = !!(lo && lo > _as_of_s), rev_in = 0.0;
        if (ordered && c1 && c2) rev_in = Math.max(0.0, (c2.rev_2026_ytd || 0) - (c1.rev_2026_ytd || 0));
        var why = [];
        if (reorder_due[nm]) why.push('Reorder due ' + fd(reorder_due[nm]));
        if (checkin_due[nm]) why.push('Check-in due ' + fd(checkin_due[nm]));
        var row = { name: nm, owner: (c2 || {}).owner, rev: ((c2 || c1 || {}).rev_2025) || 0, why: why, touches: ts, outs: outs, support: sup,
          ordered: ordered, order_date: ordered ? lo : null, rev_in: rev_in, checkin: !!checkin_due[nm] && outs.length > 0 };
        var g;
        if (due[nm]) g = (outs.length && ordered) ? 'worked' : outs.length ? 'waiting' : ordered ? 'selfserve' : 'missed';
        else g = 'extra';
        groups[g].push(row);
      });
      Object.keys(groups).forEach(function (k) { groups[k] = stableSort(groups[k], function (r) { return [-r.rev, r.name]; }); });
      var reached_set = {}; groups.worked.concat(groups.waiting).forEach(function (r) { reached_set[r.name] = 1; });
      var cnt = function (o) { return Object.keys(o).length; };
      var inter = function (o) { return Object.keys(o).filter(function (k) { return reached_set[k]; }).length; };
      var wk = groups.worked.concat(groups.selfserve);
      var A = { due: cnt(due), reached: cnt(reached_set), due_new: cnt(due_new), due_carried: cnt(due_carried),
        reached_new: inter(due_new), reached_carried: inter(due_carried),
        n_touch: n_touch, n_in: n_in, n_sup: n_sup, n_out: n_touch - n_in - n_sup, n_accounts: cnt(touched), who: who, groups: groups,
        orders: wk.filter(function (r) { return r.ordered; }).length, order_rev: sum(wk.map(function (r) { return r.rev_in; })),
        checkins: groups.worked.concat(groups.waiting).filter(function (r) { return r.checkin; }).length,
        checkin_due: cnt(checkin_due), reorder_due: cnt(reorder_due) };
      _ACT_CACHE[ck] = A; return A;
    }
    function most_common(m, n) {
      var arr = []; m.forEach(function (v, k) { arr.push([k, v]); });
      arr = stableSort(arr, function (x) { return -x[1]; });
      return n ? arr.slice(0, n) : arr;
    }
    function _act_touch_cell(r, limit) {
      limit = limit || 3;
      if (!r.touches.length) return '<span style="color:#b9b0a6">&mdash; nothing logged</span>';
      var o = [];
      r.touches.slice().reverse().slice(0, limit).forEach(function (t) {
        var rep = _is_rep(t.who);
        var arrow = t.dir !== 'out' ? '<span style="color:#2980b9;font-weight:800">&#8600;</span>'
          : rep ? '<span style="color:#27ae60;font-weight:800">&#8599;</span>' : '<span style="color:#b9b0a6;font-weight:800">&#8599;</span>';
        var kind = t.kind === 'task' ? ('task' + (t.done ? '' : ' · still open')) : 'email';
        o.push('<div style="margin-bottom:2px">' + arrow + ' <b style="font-size:11px">' + fmtDate(t.date, '%b %d') + '</b> '
          + '<span style="font-size:11px;color:#9e9086">' + kind + '</span> '
          + '<span style="font-size:11px;color:' + ((rep || t.dir !== 'out') ? '#6b6460' : '#b9b0a6') + '">' + esc(t.who)
          + ((rep || t.dir !== 'out') ? '' : ' &middot; support') + '</span>'
          + (t.subject ? '<div style="font-size:11px;color:#9e9086;margin-left:14px">' + esc(pySlice(t.subject, 68)) + '</div>' : '')
          + '</div>');
      });
      if (r.touches.length > limit) o.push('<div style="font-size:11px;color:#b9b0a6">+ ' + (r.touches.length - limit) + ' more</div>');
      return o.join('');
    }
    function _act_outcome_cell(r) {
      if (r.ordered) return '<span style="color:#27ae60;font-weight:700">Ordered ' + fd(r.order_date) + '</span>'
        + (r.rev_in > 0 ? '<div style="font-size:11px;color:#6b6460">' + fm(r.rev_in) + ' this period</div>' : '');
      if (r.checkin) return '<span style="color:#2980b9;font-weight:700">Check-in made</span>';
      if (r.outs.length) return '<span style="color:#6b6460">Contacted, no order yet</span>';
      if (r.support && r.support.length) return '<span style="color:#9e9086">Support handled it</span><div style="font-size:11px;color:#b9b0a6">no rep contact</div>';
      if (r.touches.length) return '<span style="color:#6b6460">They wrote in; we did not reach out</span>';
      return '<span style="color:#c8490c;font-weight:700">Nothing</span>';
    }
    function _act_table(rows, scope, limit) {
      limit = limit || 120;
      var own = POD_MODE && scope === '__ALL__';
      var cols = ['Account'].concat(own ? ['Owner'] : []).concat([Y1 + ' Revenue', 'Why it was on the list', 'What was logged', 'Outcome']);
      var o = ['<div style="overflow-x:auto"><table class="sortable" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2ddd6;border-radius:8px;font-size:13px"><thead><tr style="background:#faf8f5;text-align:left">'
        + cols.map(function (c) { return '<th style="padding:8px 11px;border-bottom:2px solid #e2ddd6;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b6460;cursor:pointer;white-space:nowrap">' + c + '<span class="sarw" style="opacity:.35"> &#8645;</span></th>'; }).join('') + '</tr></thead><tbody>'];
      rows.slice(0, limit).forEach(function (r) {
        o.push('<tr style="border-bottom:1px solid #f0ece6;vertical-align:top"><td style="padding:8px 11px;font-weight:600">' + esc(r.name) + '</td>'
          + (own ? '<td style="padding:8px 11px">' + obadge(r.owner) + '</td>' : '')
          + '<td style="padding:8px 11px;white-space:nowrap">' + fm(r.rev) + '</td>'
          + '<td style="padding:8px 11px;font-size:12px;color:#6b6460;white-space:nowrap">' + (r.why.length ? r.why.join('<br>') : '<span style="color:#b9b0a6">not on the list</span>') + '</td>'
          + '<td style="padding:8px 11px">' + _act_touch_cell(r) + '</td>'
          + '<td style="padding:8px 11px;white-space:nowrap">' + _act_outcome_cell(r) + '</td></tr>');
      });
      o.push('</tbody></table></div>');
      if (rows.length > limit) o.push('<div style="font-size:12px;color:#9e9086;margin-top:6px">Showing the ' + limit + ' largest by ' + Y1 + ' revenue of ' + rows.length + '.</div>');
      return o.join('');
    }
    function _activity_html(key, label, as_of, scope) {
      if (!HAS_ACTLOG) return '';
      var A = activity_since(as_of, scope), _sc = _scope_slug(scope), dl = fmtDate(as_of, '%b %d');
      var o = ['<div style="margin-top:26px;padding-top:20px;border-top:2px solid #e2ddd6">'];
      o.push('<div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin-bottom:4px">What we actually did &mdash; since ' + dl + '</div>'
        + '<div style="font-size:13px;color:#6b6460;margin-bottom:14px;line-height:1.55">'
        + 'Every logged task and genuine email on these accounts in the period, graded against the '
        + 'list as it stood on ' + dl + ' &mdash; not against today\'s list, '
        + 'which would move the goalposts. Attributed to whoever logged it, support included.</div>');
      o.push('<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:16px">');
      o.push(tile('Logged activity', String(A.n_touch), A.n_out + ' by reps &middot; ' + A.n_sup + ' by support &middot; ' + A.n_in + ' inbound, across ' + A.n_accounts + ' accounts'));
      var _pn = A.due_new ? (A.reached_new / A.due_new * 100) : 0.0, _pc = A.due_carried ? (A.reached_carried / A.due_carried * 100) : 0.0;
      o.push(tile('Came due this period', String(A.due_new), A.reached_new + ' reached &middot; ' + pyFmt(_pn, 0) + '%', A.due_new > 0 && _pn < 50));
      o.push(tile('Carried-over backlog', String(A.due_carried), A.reached_carried + ' reached &middot; ' + pyFmt(_pc, 0) + '%'));
      o.push(tile('Orders landed', String(A.orders), fm(A.order_rev) + ' in the period'));
      o.push(tile('Nobody reached', String(A.groups.missed.length), 'on the list, no contact, no order', A.groups.missed.length > 0));
      o.push('</div>');
      if (A.who.size) {
        var tot = 0; A.who.forEach(function (n) { tot += n; }); tot = tot || 1;
        o.push('<div style="background:#fff;border:1px solid #e2ddd6;border-radius:9px;padding:14px 16px;margin-bottom:16px"><div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin-bottom:9px">Who logged the outreach</div>');
        most_common(A.who, 12).forEach(function (wn) {
          o.push('<div style="display:flex;align-items:center;gap:9px;margin-bottom:5px"><div style="width:150px;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(wn[0]) + '</div>'
            + '<div style="flex:1;background:#f0ece7;border-radius:4px;height:11px;overflow:hidden"><div style="width:' + pyFmt(wn[1] / tot * 100, 1) + '%;height:100%;background:#6c5ce7"></div></div>'
            + '<div style="width:40px;text-align:right;font-size:12px;font-weight:700">' + wn[1] + '</div></div>');
        });
        o.push('<div style="font-size:11px;color:#9e9086;margin-top:7px">Outbound touches by the reps on this roster only &mdash; tasks logged and emails sent. Inbound replies are not effort, and sales support is counted separately: a support-logged touch shows on the account row in grey but never counts as the rep having reached out.</div></div>');
      }
      ACT_GROUPS.forEach(function (g) {
        var rows = A.groups[g[0]], gid = 'act-' + _sc + '-' + key + '-' + g[0];
        o.push('<div style="margin-bottom:10px;background:#fff;border:1px solid #e2ddd6;border-left:4px solid ' + g[2] + ';border-radius:9px;overflow:hidden">'
          + '<div onclick="actTog(\'' + gid + '\')" style="padding:11px 15px;cursor:pointer;display:flex;align-items:center;gap:10px">'
          + '<span style="font-size:13px;font-weight:700;color:#1a1714">' + g[1] + '</span>'
          + '<span style="background:' + g[2] + ';color:#fff;border-radius:11px;padding:1px 9px;font-size:11px;font-weight:800">' + rows.length + '</span>'
          + '<span style="margin-left:auto;font-size:11px;color:#9e9086">' + (rows.length ? 'click to open' : 'nothing here') + '</span></div>'
          + '<div id="' + gid + '" style="display:none;padding:0 15px 15px"><div style="font-size:12px;color:#6b6460;margin-bottom:9px;line-height:1.5">' + g[3] + '</div>'
          + (rows.length ? _act_table(rows, scope) : '<div style="font-size:13px;color:#9e9086">Nothing in this group for the period.</div>')
          + '</div></div>');
      });
      o.push('<div style="margin-top:12px;padding:11px 14px;background:#faf8f5;border:1px solid #e2ddd6;border-radius:8px;font-size:12px;color:#6b6460;line-height:1.6">'
        + '<b style="color:#1a1714">How to read this.</b> &ldquo;Meant to reach&rdquo; is the '
        + 'reorder list plus the proactive rotation as both stood on ' + dl
        + ', so an account that only came due yesterday is not counted against anyone. '
        + 'An order counts when its date falls inside the period. &ldquo;Reached&rdquo; means a rep '
        + 'on this roster logged something outbound &mdash; sales support doing the correspondence '
        + 'is shown in grey on the row but does not count, because this is a measure of whether the '
        + 'reps worked their list. A check-in counts when something outbound was logged on an '
        + 'account the rotation had flagged; the rotation cannot tell which touchpoint was used '
        + 'until reps name them in the task subject.</div>');
      o.push('</div>');
      return o.join('');
    }
    function _chg_block(key, label, as_of, cmp_, active, scope) {
      var _sc = _scope_slug(scope); key = _sc + '-' + key;
      var S1 = cmp_.S1, S2 = cmp_.S2, delta = cmp_.delta, dcol = delta > 0 ? '#27ae60' : delta < 0 ? '#c8490c' : '#6b6460';
      var real = sum(cmp_.flips.filter(function (f) { return REAL_CAUSES[f.cause]; }).map(function (f) { return f.pts; }));
      var ghost = sum(cmp_.flips.filter(function (f) { return f.cause === 'drift'; }).map(function (f) { return f.pts; }));
      var own = POD_MODE && scope === '__ALL__';
      var o = ['<div id="chg-' + key + '" class="chgb" style="display:' + (active ? 'block' : 'none') + '">'];
      o.push('<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:16px">');
      o.push(tile(label + ' (' + fmtDate(as_of, '%b %d') + ')', pyFmt(S1.composite, 1), S1.n_retained + ' of ' + S1.n_active + ' accounts retained'));
      o.push(tile('Now (' + fmtDate(TODAY, '%b %d') + ')', pyFmt(S2.composite, 1), S2.n_retained + ' of ' + S2.n_active + ' accounts retained'));
      o.push('<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:16px 18px"><div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#9e9086;margin-bottom:5px">Change</div>'
        + '<div style="font-size:22px;font-weight:700;color:' + dcol + '">' + _delta_str(delta) + ' pts</div><div style="font-size:12px;color:#9e9086;margin-top:3px">'
        + cmp_.flips.length + ' account' + (cmp_.flips.length === 1 ? '' : 's') + ' flipped</div></div>');
      o.push(tile('Real events', _delta_str(real, 2) + ' pts', 'orders, missed reorder dates'));
      o.push(tile('Calendar drift', _delta_str(ghost, 2) + ' pts', 'no customer behaviour changed', ghost < 0));
      o.push('</div>');
      if (Math.abs(ghost) >= 0.05)
        o.push('<div style="background:#f4ecff;border:1px solid #d9c2f5;border-left:4px solid #8e44ad;border-radius:8px;padding:12px 15px;margin-bottom:16px;font-size:13px;line-height:1.55">'
          + '<b>' + _delta_str(ghost, 2) + ' pts of this move is calendar drift, not customer behaviour.</b> '
          + 'Status for accounts with orders this year compares their annualized run-rate to last year, '
          + 'and the annualizing divisor rises on the 1st of every month — so an account can slip out of '
          + '&ldquo;retained&rdquo; having done nothing differently. Treat these as pace warnings, not as calls to make.</div>');
      if (cmp_.flips.length) {
        o.push('<div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:4px 0 8px">Every account that moved &mdash; worst first</div>');
        o.push('<div style="overflow-x:auto"><table class="sortable" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2ddd6;border-radius:8px;font-size:13px">');
        o.push('<thead><tr style="background:#faf8f5;text-align:left">'
          + ['Account'].concat(own ? ['Owner'] : []).concat([Y1 + ' Revenue', 'Was', 'Now', 'Score Impact', 'Why']).map(function (h) {
            return '<th style="padding:9px 12px;border-bottom:2px solid #e2ddd6;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b6460;cursor:pointer;white-space:nowrap">' + h + '<span class="sarw" style="opacity:.35"> &#8645;</span></th>'; }).join('')
          + '</tr></thead><tbody>');
        cmp_.flips.forEach(function (f) {
          var pc = f.pts > 0 ? '#27ae60' : '#c8490c';
          o.push('<tr style="border-bottom:1px solid #f0ece6"><td style="padding:8px 12px;font-weight:600">' + f.name + '</td>'
            + (own ? '<td style="padding:8px 12px">' + obadge(f.owner) + '</td>' : '')
            + '<td style="padding:8px 12px">' + fm(f.rev) + '</td><td style="padding:8px 12px">' + sbadge(f.from) + '</td>'
            + '<td style="padding:8px 12px">' + sbadge(f.to) + '</td><td style="padding:8px 12px;font-weight:700;color:' + pc + '">' + _delta_str(f.pts, 2) + '</td>'
            + '<td style="padding:8px 12px;color:#4a4440">' + _cbadge(f.cause) + ' <span style="font-size:12px">' + f.why + '</span></td></tr>');
        });
        o.push('</tbody></table></div>');
      } else
        o.push('<div style="background:#fff;border:1px solid #e2ddd6;border-radius:8px;padding:16px;color:#6b6460;font-size:13px">No account changed retained status since ' + lower(label) + '. Any score movement below is from accounts entering or leaving the scored set.</div>');
      if (cmp_.mix.length) {
        o.push('<div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:20px 0 8px">Entered or left the scored set <span style="font-weight:500;text-transform:none;letter-spacing:0">(needs 2+ orders and revenue in ' + Y2 + ' or ' + Y1 + ')</span></div>');
        o.push('<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2ddd6;border-radius:8px;font-size:13px">');
        o.push('<thead><tr style="background:#faf8f5;text-align:left">' + ['Account', Y1 + ' Revenue', 'Was', 'Now', 'Why'].map(function (h) {
          return '<th style="padding:9px 12px;border-bottom:2px solid #e2ddd6;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b6460">' + h + '</th>'; }).join('') + '</tr></thead><tbody>');
        cmp_.mix.forEach(function (m) {
          o.push('<tr style="border-bottom:1px solid #f0ece6"><td style="padding:8px 12px;font-weight:600">' + m.name + '</td><td style="padding:8px 12px">' + fm(m.rev) + '</td>'
            + '<td style="padding:8px 12px">' + (m.from !== '—' ? sbadge(m.from) : '—') + '</td><td style="padding:8px 12px">' + (m.to !== '—' ? sbadge(m.to) : '—') + '</td>'
            + '<td style="padding:8px 12px;color:#4a4440">' + _cbadge(m.cause) + ' <span style="font-size:12px">' + m.why + '</span></td></tr>');
        });
        o.push('</tbody></table></div>');
      }
      o.push(_activity_html(key.split('-').pop(), label, as_of, scope));
      o.push('<div style="margin-top:16px;padding:12px 15px;background:#fff;border:1px solid #e2ddd6;border-radius:8px;font-size:12px;color:#6b6460;line-height:1.6">'
        + '<b style="color:#1a1714">Reconciliation.</b> Score moved ' + _delta_str(delta) + ' pts. Accounts flipping retained status account for ' + _delta_str(cmp_.explained, 2)
        + ' pts; the remaining ' + _delta_str(cmp_.residual, 2) + ' pts comes from the scored set itself changing size ('
        + S1.n_active + ' &rarr; ' + S2.n_active + ' accounts, ' + fm(S1.rev_active) + ' &rarr; ' + fm(S2.rev_active) + ' of ' + Y1 + ' revenue). '
        + 'Account retention ' + pyFmt(S1.acct_pct, 1) + '% &rarr; ' + pyFmt(S2.acct_pct, 1) + '% &middot; revenue retention ' + pyFmt(S1.rev_pct, 1) + '% &rarr; ' + pyFmt(S2.rev_pct, 1) + '%.</div>');
      o.push('</div>');
      return o.join('');
    }
    var _CMPS = BASELINES.map(function (b) { return [b[0], b[1], b[2], compare(state_at(b[2]), customers)]; });
    function _changed_panel(scope) {
      var _sc = _scope_slug(scope), _cur = _scope_cust(customers, scope);
      var cmps = scope === '__ALL__' ? _CMPS : BASELINES.map(function (b) { return [b[0], b[1], b[2], compare(_scope_cust(state_at(b[2]), scope), _cur)]; });
      var trend = _TREND.map(function (m) { return [fmtDate(m, '%b'), score_of(_scope_cust(state_at(m), scope)).composite]; });
      trend.push(['Now', score_of(_cur).composite]);
      return '<div class="chgscope" id="chgscope-' + _sc + '" style="display:' + (scope === '__ALL__' ? 'block' : 'none') + '">' + _changed_body(_sc, cmps, trend, scope) + '</div>';
    }
    function _changed_body(_sc, cmps, tp, scope) {
      return '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin-bottom:7px">Compare against</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
        + cmps.map(function (c, i) {
          return '<button id="cbt-' + _sc + '-' + c[0] + '" onclick="chgSel(\'' + _sc + '-' + c[0] + '\')" style="background:' + (i === 0 ? '#1a1714' : '#fff') + ';color:' + (i === 0 ? '#fff' : '#4a4440') + ';border:1px solid ' + (i === 0 ? '#1a1714' : '#e2ddd6') + ';border-radius:7px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">' + c[1] + ' &middot; ' + fmtDate(c[2], '%b %d') + '</button>';
        }).join('')
        + '</div></div>'
        + cmps.map(function (c, i) { return _chg_block(c[0], c[1], c[2], c[3], i === 0, scope); }).join('')
        + '<div style="margin-top:22px;background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:16px 18px"><div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin-bottom:10px">Retention score by month-end &mdash; ' + TP.y + '</div>'
        + _trend_svg(tp)
        + '<div style="font-size:12px;color:#9e9086;margin-top:8px">Each point is the score recomputed from order history as it stood on that date, using identical logic &mdash; not a stored snapshot, so the trend is exact and available retroactively.</div></div>';
    }
    var changed_html = CHG_SCOPES.map(_changed_panel).join('');

    // ─── CHECK-IN PLAN TAB (Section 7, Revision 4) ──────────────────────────
    var MONTHS_ABBR = { 1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec' };
    function _gbadge(gr) {
      return '<span title="Group ' + gr + ' — ' + lk(GROUP_NAMES, gr, '') + '" style="display:inline-block;width:19px;height:19px;line-height:19px;text-align:center;border-radius:5px;font-size:11px;font-weight:800;color:#fff;background:' + lk(GROUP_COLORS, gr, '#6b6460') + ';margin-right:6px">' + gr + '</span>';
    }
    function _tierbadge(t) { return '<span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:10px;font-weight:700;color:#fff;background:' + (t === 'A' ? '#c8490c' : '#9e9086') + '">Tier ' + t + '</span>'; }
    var _c_now = CHECKINS.filter(function (x) { return x.overdue >= 0; });
    var _c_soon = CHECKINS.filter(function (x) { return -1.2 <= x.overdue && x.overdue < 0; });
    var _c_a_due = CHECKINS.filter(function (x) { return x.tier === 'A' && x.overdue >= -1.2; });
    function _checkin_rows(rows, limit) {
      limit = limit || 400;
      if (!rows.length) return '<p style="color:#9e9086;font-size:13px;margin:8px 0 0">Nothing in this bucket right now.</p>';
      var cols = ['Account'].concat(POD_MODE ? ['Owner'] : []).concat(['Tier', 'Their rhythm', 'Due', 'What to send', 'Format', 'Last named touch', 'Reorder task', 'TTM']);
      var h = ['<div style="overflow:auto;max-height:64vh;border:1px solid #e2ddd6;border-radius:9px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'
        + cols.map(function (c) { return '<th style="' + _CTH + ';position:sticky;top:0;z-index:2;cursor:pointer">' + c + '</th>'; }).join('') + '</tr></thead><tbody>'];
      rows.slice(0, limit).forEach(function (x) {
        var od = x.overdue, dcol = od > 0.5 ? '#c8490c' : '#6b6460';
        h.push('<tr class="ownrow" data-owner="' + lower(pyStr(x.owner === undefined ? '' : x.owner)) + '" style="border-bottom:1px solid #f0ece7">'
          + '<td style="padding:7px 9px;font-weight:600">' + x.name + '</td>'
          + (POD_MODE ? '<td style="padding:7px 9px">' + obadge(x.owner) + '</td>' : '')
          + '<td style="padding:7px 9px">' + _tierbadge(x.tier) + '</td>'
          + '<td style="padding:7px 9px;font-size:12px;color:#6b6460;white-space:nowrap">' + lk(RHYTHM_LABELS, x.rhythm, x.rhythm)
          + '<div style="font-size:10px;color:#9e9086">every ' + x.interval + ' mo &middot; ' + x.slots + '/yr</div></td>'
          + '<td style="padding:7px 9px;white-space:nowrap;color:' + dcol + '">' + fd(x.due)
          + (od > 0.5 ? '<div style="font-size:10px;font-weight:700;color:#c8490c">' + pyFmt(od, 1) + ' mo late</div>' : '') + '</td>'
          + '<td style="padding:7px 9px;white-space:nowrap">' + _gbadge(x.next_group)
          + '<a href="#tp-' + x.next_key + '" style="color:#1a1714;font-weight:700;text-decoration:none;border-bottom:1px dotted #9e9086">' + x.next_label + '</a>'
          + (x.skipped && x.skipped.length ? '<div style="font-size:10px;color:#9e9086">skipped ' + x.skipped.join(', ') + ' &mdash; does not apply</div>' : '')
          + ((x.season && x.next_key === 'pre_season') ? '<div style="font-size:10px;color:#16a085">season opens ' + MONTHS_ABBR[x.season[0]] + '</div>' : '')
          + '</td>'
          + '<td style="padding:7px 9px;font-size:12px;color:#6b6460">' + x.next_format + '</td>'
          + '<td style="padding:7px 9px;font-size:12px;color:#6b6460;white-space:nowrap">'
          + (x.last_label ? _gbadge(x.last_group) + x.last_label + '<div style="font-size:10px;color:#9e9086">' + fd(x.last_date) + '</div>' : '<span style="color:#b9b0a6">&mdash; none on file</span>')
          + '</td>'
          + '<td style="padding:7px 9px">' + task_cell(cust(x.name)) + '</td>'
          + '<td style="padding:7px 9px;text-align:right;white-space:nowrap">' + fm(x.ttm) + '</td></tr>');
      });
      h.push('</tbody></table></div>');
      if (rows.length > limit) h.push('<div style="font-size:12px;color:#9e9086;margin-top:6px">Showing the top ' + limit + ' of ' + rows.length + ' by priority.</div>');
      return h.join('');
    }
    var _EVCOL = { late: '#c8490c', dropped: '#8e44ad', big: '#2980b9' };
    function _event_rows(rows, limit) {
      limit = limit || 250;
      if (!rows.length) return '<p style="color:#9e9086;font-size:13px;margin:8px 0 0">Nothing firing right now.</p>';
      var cols = ['Trigger', 'Account'].concat(POD_MODE ? ['Owner'] : []).concat(['What happened', 'When to call', 'TTM']);
      var h = ['<div style="overflow:auto;max-height:52vh;border:1px solid #e2ddd6;border-radius:9px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'
        + cols.map(function (c) { return '<th style="' + _CTH + ';position:sticky;top:0;z-index:2;cursor:pointer">' + c + '</th>'; }).join('') + '</tr></thead><tbody>'];
      rows.slice(0, limit).forEach(function (x) {
        h.push('<tr class="ownrow" data-owner="' + lower(pyStr(x.owner === undefined ? '' : x.owner)) + '" style="border-bottom:1px solid #f0ece7">'
          + '<td style="padding:7px 9px;white-space:nowrap"><span style="display:inline-block;width:3px;height:13px;border-radius:2px;vertical-align:-2px;margin-right:7px;background:' + lk(_EVCOL, x.kind, '#6b6460') + '"></span><b>' + x.trigger + '</b></td>'
          + '<td style="padding:7px 9px;font-weight:600">' + x.name + '</td>'
          + (POD_MODE ? '<td style="padding:7px 9px">' + obadge(x.owner) + '</td>' : '')
          + '<td style="padding:7px 9px;font-size:12px;color:#4a4440">' + x.detail + '</td>'
          + '<td style="padding:7px 9px;font-size:12px;color:#9e9086;white-space:nowrap">' + x.window + '</td>'
          + '<td style="padding:7px 9px;text-align:right;white-space:nowrap">' + fm(x.ttm || 0) + '</td></tr>');
      });
      return h.join('') + '</tbody></table></div>';
    }
    var _grid = '<div style="overflow-x:auto;border:1px solid #e2ddd6;border-radius:9px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'
      + ['Tier', 'Their rhythm', 'How often', 'Touches a year', 'The rotation'].map(function (c) { return '<th style="' + _CTH + '">' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
    strSort(Object.keys(CADENCE)).forEach(function (k) {
      var t = k.split('|')[0], rb = k.split('|')[1], iv = CADENCE[k][0], sq = CADENCE[k][1];
      _grid += '<tr style="border-bottom:1px solid #f0ece7"><td style="padding:7px 9px">' + _tierbadge(t) + '</td>'
        + '<td style="padding:7px 9px">' + lk(RHYTHM_LABELS, rb, rb) + '</td>'
        + '<td style="padding:7px 9px;white-space:nowrap">Every ' + iv + ' months</td>'
        + '<td style="padding:7px 9px">' + sq.length + '</td>'
        + '<td style="padding:7px 9px">' + sq.map(function (s) { return _gbadge(TOUCHPOINTS[s][0]) + TOUCHPOINTS[s][1]; }).join(' &rarr; ') + '</td></tr>';
    });
    _grid += '</tbody></table></div>';
    var TOUCH_GUIDE = {"order_thankyou": ["Within a day or two of the order landing. Plain thanks, it is moving, tracking follows. No question attached.", "Subject: Thanks for the order, [First]\u2029[First], your order came through and I wanted to say thanks for it. It is moving on our end and I will send tracking as soon as it ships.\u2029Anything else coming up that you want me to keep an eye out for?", "Hi [First], nothing to solve, I just saw your order come through and wanted to say thanks for it. Everything running okay on your end?"], "post_delivery": ["About a week after the goods arrived. We have been working well together a while, your delivery just landed, how is everything going, and here is an open door. Not a quality inspection.", "Subject: Checking in, [First]\u2029[First], we have been working together well for a while now and I wanted to check in properly. I know your delivery just landed.\u2029How is everything going with us? If there is anything we could be doing better, or anything I could help with that you have not thought to ask about, I would rather hear it from you.\u2029Thanks as always for the business.", "Hi [First], I know your delivery just landed and I wanted to check in. We have been running well together for a while now. How is everything going on your end with us? And anything you need that you have not asked me for?"], "fit_check": ["They buy A and B from us and have never been quoted on C, which most people buying A and B end up needing. The upsell that is actually useful to them.", "Subject: One thing we have never quoted you on\u2029[First], I was going through what you buy from us and noticed we have never quoted you on [item C], which almost everybody buying [item A] ends up needing.\u2029Not trying to take business off anyone. I just want you to know we carry it and what it would run you here. Want me to put a number together?", "Hi [First], I was in your account and something stood out. You buy [A] and [B] from us but we have never talked about [C]. Can I send you a price so you have it on hand?"], "spec_review": ["A cheaper or better way to buy what they already buy. Rare, and mostly belongs at discovery. Senior reps only, and only when it is genuinely right for the customer.", "Subject: A cheaper way to buy the same [item]\u2029[First], you have been running the [current spec] for a while and I went back through it. [The lighter gauge / the next size down] would do the same job and comes in around [X]% under what you are paying now.\u2029I am not trying to change something that is working. If you want to test it I will send a sample before you commit to anything.", "Hi [First], I was looking at the [item] you buy and I think you may be overspending on it. There is a [spec] that does the same job for less. Want me to send a sample so you can judge it yourself?"], "price_review": ["Their volume has grown far past where their pricing was set, so we re-tier them before they think to ask or a competitor quotes them cold.", "Subject: Your pricing is behind your volume\u2029[First], your volume with us is up substantially from where it was when your pricing was set, and I would rather fix that before you have to ask me about it.\u2029I re-tiered [item] and [item]. New pricing is attached and it takes effect on your next order, nothing for you to do.\u2029If your volume is heading somewhere I have not accounted for, tell me and I will look again.", "Hi [First], you have grown with us a lot this year and your pricing was set back when you were much smaller. I already re-tiered you. I wanted you to hear it from me instead of waiting for you to notice."], "heads_up": ["Something in the market is about to affect them: resin pricing, a lead time stretching, a vendor change, an item being discontinued. Nothing for them to do.", "Subject: Heads up on [item]\u2029[First], nothing you need to do here, I just wanted you to hear it from me first. [Resin pricing / lead times on the item / the vendor] is moving and [item] is likely to go up around [month].\u2029If you want to get ahead of it I can hold today\u2019s pricing on anything placed before then. Either way, you will know before it hits you.", "Hi [First], quick one, and I am not selling you anything. Lead times on [item] just went out to [X] weeks. Figured you would rather hear it now than find out on a rush order."], "their_news": ["Something visibly happening at their company: a second location, a new line, a lab opening, a hiring push. Congratulations, and if they are growing, what they need from us is probably changing too.", "Subject: Saw the [news], congratulations\u2029[First], I saw [the second location / the new line / the piece about you] and wanted to say congratulations. Nicely done.\u2029Does it change anything about what you need from us? If volume or timing is shifting I would rather plan for it with you now than react to it in three months.", "Hi [First], I saw [news] and wanted to say congratulations. Does that change what you are going to need from us?"], "pre_season": ["Ahead of their known heavy months. Same items as last year, or is something changing.", "Subject: Before your busy season\u2029[First], your heavy months usually start around [month] and I would rather get ahead of it than scramble alongside you.\u2029Same items as last year, or is something changing? If I know now I can have stock lined up before it matters.", "Hi [First], [month] is usually when you start picking up. Wanted to ask now whether you are running the same items as last year so I can get ahead of it."], "milestone": ["The anniversary of working together. A physical card, not an email. Different card and different envelope every year, with some personality in it.", "Handwritten, in a card that is not a boring white envelope:\u2029\"[First], [X] years working together this month. I appreciate the business and I appreciate you. Here is to another one. [Rep]\"\u2029No ask, nothing enclosed, no sales line.", "No phone version. A call turns a thank you into an obligation to talk, which defeats the purpose of the card."], "personal": ["A birthday, a personal milestone, anything they told us themselves. We never go looking for it and we never buy a list.", "\"[First], you mentioned [the thing] last time we spoke. Just wanted to say [happy birthday / congratulations / good luck with it]. Hope it is a good one.\"", "Same line, said rather than written. If it came up on a call, it belongs on a call."], "annual_review": ["Twenty minutes on the year: volumes, where pricing landed, what is changing on their side, what to stock ahead for.", "Subject: Twenty minutes to look at the year?\u2029[First], we have been running steady all year and I would like to go through it properly with you. What you are using, where pricing landed, and what is changing on your end for [next year] so we can stock ahead instead of reacting.\u2029Would [day] or [day] be easier for you?", "Hi [First], I want to put twenty minutes on the calendar to go through the year with you. Not because anything is wrong, I would just rather plan [next year] with you than guess at it. What does your week look like?"]};
    function _para(t) { return t.split(' ').map(function (p) { return '<div style="margin-bottom:5px">' + p + '</div>'; }).join(''); }
    var _guide_html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px">';
    ['order_thankyou', 'post_delivery', 'fit_check', 'spec_review', 'price_review', 'heads_up', 'their_news', 'pre_season', 'milestone', 'personal', 'annual_review'].forEach(function (gk) {
      var tp = TOUCHPOINTS[gk], g = TOUCH_GUIDE[gk];
      _guide_html += '<div id="tp-' + gk + '" style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:15px 17px">'
        + '<div style="margin-bottom:7px">' + _gbadge(tp[0]) + '<b style="font-size:15px">' + tp[1] + '</b><span style="font-size:11px;color:#9e9086;margin-left:8px">' + tp[2] + '</span></div>'
        + '<div style="font-size:12.5px;color:#4a4440;line-height:1.6;margin-bottom:10px">' + g[0] + '</div>'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9e9086;margin-bottom:4px">Email</div>'
        + '<div style="font-size:12px;color:#4a4440;line-height:1.55;background:#faf8f5;border-radius:7px;padding:9px 11px;margin-bottom:9px">' + _para(g[1]) + '</div>'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9e9086;margin-bottom:4px">On the phone</div>'
        + '<div style="font-size:12px;color:#4a4440;line-height:1.55;background:#faf8f5;border-radius:7px;padding:9px 11px">' + _para(g[2]) + '</div></div>';
    });
    _guide_html += '</div>';
    var _named = CHECKINS.filter(function (x) { return !x.never; }).length;
    var _evAcc = {}; EVENTS.forEach(function (e) { _evAcc[e.name] = 1; });
    var checkin_html = '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:11px 15px;font-size:12px;color:#1a5276;margin-bottom:14px;line-height:1.6">'
      + '<b>This is the proactive rotation, not the reorder list.</b> Reorder outreach lives on '
      + 'Expected Reorders and Call This Week. These are the touches that happen because it is time, '
      + 'not because something went wrong. Rule 1 holds throughout: never two touches in a row from '
      + 'the same group, because three product conversations in a row land on the customer as one '
      + 'repeated call whatever we call them internally.</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:11px;margin-bottom:16px">'
      + tile('Due now', String(_c_now.length), 'past their slot', true)
      + tile('Due within a month', String(_c_soon.length), 'get ahead of these')
      + tile('Tier A in that window', String(_c_a_due.length), '$8K+ trailing twelve months', true)
      + tile('On the rotation', String(CHECKINS.length), 'of ' + customers.size + ' accounts')
      + tile('Triggers live', String(EVENTS.length), Object.keys(_evAcc).length + ' accounts, outside the cadence', true)
      + '</div>'
      + (_named ? '' : '<div style="background:#fff8ec;border:1px solid #f0d9ae;border-left:4px solid #c8490c;border-radius:8px;padding:12px 15px;margin-bottom:16px;font-size:13px;line-height:1.6">'
        + '<b>No named touches on file yet.</b> The rotation reads which of the ten a touch was from '
        + 'the task subject &mdash; a task called &ldquo;FIT CHECK &mdash; Acme&rdquo; registers as a '
        + 'Group B touch and moves that account on to the next group. Until reps start naming them, '
        + 'every account is scheduled off its own first-order date instead, which is why the due dates '
        + 'below are spread across the coming months rather than all landing today.</div>')
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:18px 0 8px">Due now &mdash; worst first</h3>'
      + _checkin_rows(_c_now)
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:22px 0 8px">Coming up in the next month</h3>'
      + _checkin_rows(_c_soon)
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:26px 0 8px">Event-driven &mdash; these fire off the account, not the calendar</h3>'
      + '<div style="font-size:12px;color:#6b6460;margin-bottom:9px;max-width:900px;line-height:1.6">'
      + 'These do not count against the rotation above. A late reorder on a rhythmic account is the '
      + 'clearest churn signal there is, and a line that stopped while the rest of the order held '
      + 'steady means either they stopped needing it or somebody beat us on it &mdash; both answers '
      + 'are worth having.</div>'
      + _event_rows(EVENTS)
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:26px 0 8px">The ten touchpoints &mdash; what each is, and what it sounds like</h3>'
      + '<div style="font-size:12px;color:#6b6460;margin-bottom:11px;max-width:900px;line-height:1.6">'
      + 'Drafts, not scripts. Fill the brackets from the account. None of these say &ldquo;checking in on '
      + 'you&rdquo; &mdash; the warmth comes from having a reason to make contact, not from asking how '
      + 'things are going.</div>'
      + _guide_html
      + '<h3 style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9e9086;margin:26px 0 8px">The grid these dates come from</h3>'
      + _grid
      + '<div style="font-size:12px;color:#9e9086;margin-top:8px;line-height:1.6">'
      + 'Tier A is trailing-twelve-month revenue of $8,000 or more. Weekly and monthly buyers are '
      + 'treated the same on purpose &mdash; the difference in order frequency changes the Sales '
      + 'Support workload, not the relationship. Bottom-tier episodic accounts are operational only '
      + 'and carry no scheduled slot.</div>';

    // ─── FINAL HTML ─────────────────────────────────────────────────────────
    var CLIENT = "var VIEW_AGG=__VIEW_AGG__;var CADLBL=__CADLBL__;var SCOPE_MEM=__SCOPE_MEM__;function curRep(){return window._REP||\"__ALL__\";}function curAgg(){return VIEW_AGG[curRep()]||VIEW_AGG[\"__ALL__\"];}function money(x){return \"$\"+Math.round(x||0).toLocaleString();}function show(id,btn){document.querySelectorAll(\".pnl\").forEach(function(p){p.classList.remove(\"on\");});document.querySelectorAll(\".nav button\").forEach(function(b){b.classList.remove(\"on\");});document.getElementById(\"p-\"+id).classList.add(\"on\");btn.classList.add(\"on\");if(id===\"chart\")buildRevChart(curAgg());if(id===\"cadence\")buildCadChart(curAgg());}function actTog(id){var e=document.getElementById(id);if(e)e.style.display=(e.style.display===\"none\")?\"block\":\"none\";}function chgSel(k){var t=document.getElementById(\"chg-\"+k);if(!t)return;var sc=t.closest(\".chgscope\")||document;sc.querySelectorAll(\".chgb\").forEach(function(b){b.style.display=\"none\";});t.style.display=\"block\";sc.querySelectorAll(\"[id^=cbt-]\").forEach(function(b){b.style.background=\"#fff\";b.style.color=\"#4a4440\";b.style.borderColor=\"#e2ddd6\";});var a=document.getElementById(\"cbt-\"+k);if(a){a.style.background=\"#1a1714\";a.style.color=\"#fff\";a.style.borderColor=\"#1a1714\";}}function filterT(){var q=(document.getElementById(\"tblSearch\").value||\"\").toLowerCase();var st=document.getElementById(\"tblSt\").value;var cd=document.getElementById(\"tblCad\").value;var rep=curRep();var mem=SCOPE_MEM[rep]||[];var rows=document.querySelectorAll(\"#custTbody tr\");var n=0;rows.forEach(function(r){var ow=r.getAttribute(\"data-owner\")||\"\";var show=(rep===\"__ALL__\"||mem.indexOf(ow)>=0)&&(!q||r.getAttribute(\"data-name\").indexOf(q)>=0)&&(!st||r.getAttribute(\"data-status\")===st)&&(!cd||r.getAttribute(\"data-cadence\")===cd);r.style.display=show?\"\":\"none\";if(show)n++;});var el=document.getElementById(\"tblCnt\");if(el)el.textContent=n+\" customers\";}function fmtVal(v,f){if(v===undefined||v===null)return\"\";if(f===\"money\")return money(v);return v;}function setTxt(id,t){var e=document.getElementById(id);if(e)e.textContent=t;}function setW(id,p){var e=document.getElementById(id);if(e)e.style.width=Math.min(100,Math.max(0,p))+\"%\";}function scoreCol(c){return c>=70?\"#27ae60\":c>=50?\"#e67e22\":\"#c8490c\";}var THIN=__THIN__;function healthTxt(c){return c>=70?\"Healthy\":c>=50?\"Needs Attention\":\"At Risk\";}function bookState(a){var n=(a&&a.ma)||0;return n===0?\"empty\":(n<THIN?\"thin\":\"ok\");}function scoreTxt(a){return bookState(a)===\"empty\"?\"\u2014\":a.composite;}function healthOf(a){var s=bookState(a);return s===\"empty\"?\"No accounts yet\":s===\"thin\"?\"Too few accounts to score\":healthTxt(a.composite);}function rebuildChips(sc){var box=document.getElementById(\"statusChips\");if(!box)return;var order=[\"growing\",\"on_track\",\"new\",\"not_yet_due\",\"snoozed\",\"declining\",\"overdue\",\"significantly_overdue\",\"gone\",\"erratic\",\"one_time\",\"one_time_old\"];var COL=__COL__,LB=__LB__;box.innerHTML=\"\";order.forEach(function(s){var n=(sc||{})[s]||0;if(!n)return;var d=document.createElement(\"div\");d.style.cssText=\"background:\"+(COL[s]||\"#7f8c8d\")+\";color:#fff;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600\";d.textContent=(LB[s]||s)+\": \"+n;box.appendChild(d);});}function applyRep(v){window._REP=v;var hs=document.getElementById(\"repFilter\");if(hs)hs.value=v;document.querySelectorAll(\".repsel\").forEach(function(s){s.value=v;});var a=VIEW_AGG[v]||VIEW_AGG[\"__ALL__\"];document.querySelectorAll(\"[data-agg]\").forEach(function(el){var f=el.getAttribute(\"data-agg\"),fmt=el.getAttribute(\"data-fmt\");if(f===\"__health__\"){el.textContent=healthTxt(a.composite);return;}if(a[f]!==undefined)el.textContent=fmtVal(a[f],fmt);});setTxt(\"retScoreNum\",scoreTxt(a));setTxt(\"retAcctPct\",a.acct_pct+\"%\");setTxt(\"retRevPct\",a.rev_pct+\"%\");setW(\"retAcctBar\",a.acct_pct);setW(\"retRevBar\",a.rev_pct);setTxt(\"retMA\",a.ma);setTxt(\"retRET\",a.ret);var bs=bookState(a);var rh=document.getElementById(\"retHealth\");if(rh){rh.textContent=healthOf(a);if(bs!==\"ok\"){rh.style.background=\"#f0ece7\";rh.style.color=\"#6b6460\";}else{rh.style.background=a.composite>=70?\"#d5f5e3\":a.composite>=50?\"#fef3cd\":\"#fde8e8\";rh.style.color=a.composite>=70?\"#1a6639\":a.composite>=50?\"#8a5700\":\"#8b1a1a\";}}var tn=document.getElementById(\"thinNote\");if(tn){tn.style.display=(bs===\"ok\")?\"none\":\"block\";tn.textContent=(bs===\"empty\")?\"No accounts with order history are assigned to this rep yet. They will appear here automatically once activity lands in NetSuite \u2014 this is not a score of zero.\":\"Only \"+a.ma+\" accounts carry a score for this rep. One account moving swings the number several points, so do not compare it against a full book.\";}var sn=document.getElementById(\"retScoreNum\");if(sn&&sn.parentElement)sn.parentElement.style.color=(bs===\"ok\")?scoreCol(a.composite):\"#9e9086\";var rsc=document.getElementById(\"retScope\");if(rsc)rsc.textContent=v===\"__ALL__\"?\"\u2014 __WHOLE__\":\"\u2014 \"+v;rebuildChips(a.status_counts);var mem=SCOPE_MEM[v]||[];document.querySelectorAll(\".ownrow\").forEach(function(el){if(el.closest&&el.closest(\"#custTbody\"))return;var ow=el.getAttribute(\"data-owner\")||\"\";el.style.display=(v===\"__ALL__\"||mem.indexOf(ow)>=0)?\"\":\"none\";});var csl=(v===\"__ALL__\")?\"all\":v.toLowerCase().replace(/[^a-z0-9]+/g,\"_\").slice(0,40);document.querySelectorAll(\".chgscope\").forEach(function(el){el.style.display=(el.id===\"chgscope-\"+csl)?\"block\":\"none\";});document.querySelectorAll(\".riskscope\").forEach(function(el){el.style.display=(el.id===\"riskscope-\"+csl)?\"block\":\"none\";});filterT();rollupDue();rollupCalls();if(document.getElementById(\"p-chart\").classList.contains(\"on\"))buildRevChart(a);if(document.getElementById(\"p-cadence\").classList.contains(\"on\"))buildCadChart(a);}function rollupDue(){document.querySelectorAll(\"table\").forEach(function(t){var tot=t.querySelector(\"tr.totalrow\");if(!tot)return;var exp=0,r25=0,r26=0,n=0;t.querySelectorAll(\"tr.er\").forEach(function(tr){if(tr.style.display===\"none\")return;n++;exp+=parseFloat(tr.getAttribute(\"data-exp\"))||0;r25+=parseFloat(tr.getAttribute(\"data-r25\"))||0;r26+=parseFloat(tr.getAttribute(\"data-r26\"))||0;});var s=function(k,val){var c=tot.querySelector(\"[data-roll=\\\"\"+k+\"\\\"]\");if(c)c.textContent=val;};s(\"n\",n);s(\"exp\",money(exp));s(\"r25\",money(r25));s(\"r26\",money(r26));});}function rollupCalls(){[\"p-week\",\"p-schedule\"].forEach(function(pid){var p=document.getElementById(pid);if(!p)return;var vis=0;p.querySelectorAll(\".ac\").forEach(function(c){if(c.style.display!==\"none\")vis++;});var big=p.querySelector(\".sc-stat .big\");if(big)big.textContent=vis;});}function parseCell(t){t=(t||\"\").trim();if(t===\"\"||t===\"\u2014\")return{n:-Infinity,s:\"\"};var m=t.replace(/[$,]/g,\"\");if(/^-?\\d+(\\.\\d+)?$/.test(m))return{n:parseFloat(m),s:t.toLowerCase()};var d=t.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);if(d)return{n:new Date(+d[3],+d[1]-1,+d[2]).getTime(),s:t};return{n:NaN,s:t.toLowerCase()};}function sortTable(t,idx,th){var tb=t.tBodies[0];if(!tb)return;var rows=[].slice.call(tb.rows).filter(function(r){return !r.classList.contains(\"totalrow\");});var totals=[].slice.call(tb.rows).filter(function(r){return r.classList.contains(\"totalrow\");});var pk=rows.map(function(r){return parseCell((r.cells[idx]||{}).textContent);});var allNum=pk.some(function(x){return !isNaN(x.n)&&x.n!==-Infinity;})&&pk.every(function(x){return !isNaN(x.n);});var same=t._sc===idx;var dir=same?-t._sd:(allNum?-1:1);rows.sort(function(a,b){var av=parseCell((a.cells[idx]||{}).textContent),bv=parseCell((b.cells[idx]||{}).textContent);if(allNum)return (av.n-bv.n)*dir;return (av.s<bv.s?-1:av.s>bv.s?1:0)*dir;});rows.forEach(function(r){tb.appendChild(r);});totals.forEach(function(r){tb.appendChild(r);});t._sc=idx;t._sd=dir;var hs=th.parentElement.children;for(var i=0;i<hs.length;i++){var ar=hs[i].querySelector(\".sarw\");if(ar){ar.textContent=\" \\u21c5\";ar.style.opacity=\".35\";}}var a2=th.querySelector(\".sarw\");if(a2){a2.textContent=dir<0?\" \\u2193\":\" \\u2191\";a2.style.opacity=\"1\";}}function initSort(){document.querySelectorAll(\"table.sortable\").forEach(function(t){var hr=t.tHead&&t.tHead.rows[0];if(!hr)return;[].slice.call(hr.cells).forEach(function(th,idx){if((th.textContent||\"\").trim().charAt(0)===\"\\u2713\")return;th.addEventListener(\"click\",function(){sortTable(t,idx,th);});});});}var RB_MONTHS=__MONTHS__,RB_YEARS=__YEARS__;\nfunction rbNice(mx){if(!(mx>0))return{step:1,top:1};var raw=mx/5,p=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10)),f=raw/p,s=f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10,st=s*p;return{step:st,top:Math.ceil(mx/st-1e-9)*st};}\nfunction rbTip(html,x,y){var t=document.getElementById(\"rbTip\");if(!t)return;if(!html){t.style.display=\"none\";return;}t.innerHTML=html;t.style.display=\"block\";var w=t.offsetWidth,h=t.offsetHeight;var L=x+14;if(L+w>window.innerWidth-8)L=x-w-14;var T=y-h-10;if(T<8)T=y+14;t.style.left=L+\"px\";t.style.top=T+\"px\";}\nfunction rbRR(g,x,y,w,h,r){r=Math.min(r,w/2,Math.abs(h));if(h<=0||w<=0)return;g.beginPath();g.moveTo(x,y+h);g.lineTo(x,y+r);g.quadraticCurveTo(x,y,x+r,y);g.lineTo(x+w-r,y);g.quadraticCurveTo(x+w,y,x+w,y+r);g.lineTo(x+w,y+h);g.closePath();g.fill();}\nfunction rbChart(id,cfg){var c=document.getElementById(id);if(!c)return;var st=c._rb||(c._rb={hidden:{}});st.cfg=cfg;rbDraw(c);if(!st.bound){st.bound=1;c.addEventListener(\"mousemove\",function(e){rbHover(c,e);});c.addEventListener(\"mouseleave\",function(){rbTip(null);rbDraw(c);});c.addEventListener(\"click\",function(e){var r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;(c._rb.legend||[]).forEach(function(L){if(x>=L.x&&x<=L.x+L.w&&y>=L.y&&y<=L.y+L.h){c._rb.hidden[L.i]=!c._rb.hidden[L.i];rbDraw(c);}});});window.addEventListener(\"resize\",function(){if(c.offsetParent)rbDraw(c);});}}\nfunction rbDraw(c,hov){var st=c._rb,cfg=st.cfg,dpr=window.devicePixelRatio||1;var P=c.parentElement,cs=P?getComputedStyle(P):null,W=P?P.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0):700;if(!(W>0))W=700;if(W<200)W=200;var H=Math.max(cfg.minH||240,Math.round(W/cfg.aspect));c.style.width=W+\"px\";c.style.height=H+\"px\";c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);var g=c.getContext(\"2d\");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);var F='\"DM Sans\",Arial,sans-serif';g.font=\"12px \"+F;g.textBaseline=\"middle\";\nvar ds=cfg.datasets,items=[],tot=0;ds.forEach(function(d,i){var w=g.measureText(d.label).width+40;items.push({i:i,w:w});tot+=w;});var x=Math.max(4,(W-tot)/2),LY=14;st.legend=[];items.forEach(function(it){var d=ds[it.i],off=st.hidden[it.i];g.globalAlpha=off?0.35:1;g.fillStyle=d.color;g.fillRect(x,LY-6,28,12);g.fillStyle=\"#666\";g.fillText(d.label,x+33,LY);if(off){g.strokeStyle=\"#666\";g.lineWidth=1;g.beginPath();g.moveTo(x+33,LY);g.lineTo(x+33+g.measureText(d.label).width,LY);g.stroke();}g.globalAlpha=1;st.legend.push({x:x,y:LY-9,w:it.w-8,h:18,i:it.i});x+=it.w;});\nvar n=cfg.labels.length,mx=0;for(var k=0;k<n;k++){if(cfg.stacked){var s=0;ds.forEach(function(d,i){if(!st.hidden[i])s+=(+d.data[k]||0);});mx=Math.max(mx,s);}else ds.forEach(function(d,i){if(!st.hidden[i])mx=Math.max(mx,+d.data[k]||0);});}\nvar nice=rbNice(mx);if(cfg.integer){nice.step=Math.max(1,Math.round(nice.step));nice.top=Math.max(nice.step,Math.ceil(mx/nice.step)*nice.step);}\nvar ticks=[];for(var v=0;v<=nice.top+1e-9;v+=nice.step)ticks.push(v);var PL=8;ticks.forEach(function(t){PL=Math.max(PL,g.measureText(cfg.yfmt(t)).width+14);});var PT=34,PB=26,PR=8,cw=W-PL-PR,ch=H-PT-PB;\ng.textAlign=\"right\";ticks.forEach(function(t){var y=PT+ch-(t/nice.top)*ch;g.strokeStyle=t===0?\"#cfc8c0\":\"#eee9e3\";g.lineWidth=1;g.beginPath();g.moveTo(PL,Math.round(y)+0.5);g.lineTo(W-PR,Math.round(y)+0.5);g.stroke();g.fillStyle=\"#888\";g.fillText(cfg.yfmt(t),PL-8,y);});\nvar gw=cw/n,vis=[];ds.forEach(function(d,i){if(!st.hidden[i])vis.push(i);});st.geo={PL:PL,PT:PT,ch:ch,gw:gw,n:n};g.textAlign=\"center\";\nfor(var k2=0;k2<n;k2++){var gx=PL+k2*gw;if(hov===k2){g.fillStyle=\"rgba(200,73,12,.06)\";g.fillRect(gx,PT,gw,ch);}g.fillStyle=\"#888\";g.fillText(cfg.labels[k2],gx+gw/2,PT+ch+14);\nif(cfg.stacked){var bw=Math.max(2,gw*0.62),bx=gx+(gw-bw)/2,acc=0;vis.forEach(function(i){var val=+ds[i].data[k2]||0;if(val<=0)return;var y0=PT+ch-(acc/nice.top)*ch,y1=PT+ch-((acc+val)/nice.top)*ch;g.fillStyle=ds[i].color;g.fillRect(bx,y1,bw,y0-y1);acc+=val;});}\nelse{var inner=gw*0.8,bw2=vis.length?inner/vis.length:0,bx2=gx+(gw-inner)/2;vis.forEach(function(i,j){var val=+ds[i].data[k2]||0;if(val<=0)return;var h=(val/nice.top)*ch;g.fillStyle=ds[i].color;rbRR(g,bx2+j*bw2+1,PT+ch-h,Math.max(1,bw2-2),h,3);});}}}\nfunction rbHover(c,e){var st=c._rb,G=st.geo;if(!G)return;var r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;if(x<G.PL||y<G.PT||y>G.PT+G.ch){rbTip(null);rbDraw(c);return;}var k=Math.floor((x-G.PL)/G.gw);if(k<0||k>=G.n){rbTip(null);return;}rbDraw(c,k);var cfg=st.cfg,h=\"<b>\"+cfg.labels[k]+\"</b>\",tot=0;cfg.datasets.forEach(function(d,i){if(st.hidden[i])return;var v=+d.data[k]||0;tot+=v;h+='<div><span style=\"display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:'+d.color+'\"></span>'+d.label+\": \"+cfg.vfmt(v)+\"</div>\";});if(cfg.stacked)h+='<div style=\"margin-top:3px;opacity:.8\">Total: '+cfg.vfmt(tot)+\"</div>\";rbTip(h,e.clientX,e.clientY);}\nfunction buildRevChart(a){try{rbChart(\"revChart\",{labels:RB_MONTHS,aspect:300/90,minH:260,datasets:[{label:RB_YEARS[0],data:a.rev_2023,color:\"#b8c8e8\"},{label:RB_YEARS[1],data:a.rev_2024,color:\"#b8a9d4\"},{label:RB_YEARS[2],data:a.rev_2025,color:\"#2d6a4f\"},{label:RB_YEARS[3],data:a.rev_2026,color:\"#e55d1e\"}],yfmt:function(v){return \"$\"+Math.round(v/1000)+\"k\";},vfmt:function(v){return money(v);}});}catch(e){}}\nfunction buildCadChart(a){try{rbChart(\"cadChart\",{labels:CADLBL,aspect:300/80,minH:240,stacked:true,integer:true,datasets:[{label:\"In Cadence\",data:a.cad_in,color:\"#27ae60\"},{label:\"Out of Cadence\",data:a.cad_out,color:\"#e67e22\"},{label:\"No scheduled check-in\",data:a.cad_ns,color:\"#b9b0a6\"},{label:\"No contact on record\",data:a.cad_no,color:\"#7f8c8d\"}],yfmt:function(v){return String(Math.round(v));},vfmt:function(v){return String(v);}});}catch(e){}}initSort();(function(){var rows=document.querySelectorAll(\"#custTbody tr\");var el=document.getElementById(\"tblCnt\");if(el)el.textContent=rows.length+\" customers\";})();var SK=\"retdash___DASHID__\";function loadState(){try{return JSON.parse(localStorage.getItem(SK)||\"{}\");}catch(e){return {};}}function saveState(s){try{localStorage.setItem(SK,JSON.stringify(s));}catch(e){}}function tc(id){var card=document.getElementById(id);var lbl=document.getElementById(\"l\"+id);var cb=lbl.querySelector(\"input\");var now=!card.classList.contains(\"done\");card.classList.toggle(\"done\",now);lbl.classList.toggle(\"ck\",now);if(cb)cb.checked=now;var s=loadState();if(now){s[id]=1;}else{delete s[id];}saveState(s);}function erToggle(cb){var tr=cb.closest(\"tr\");var id=tr.getAttribute(\"data-id\");var now=cb.checked;tr.classList.toggle(\"done\",now);var s=loadState();if(now){s[id]=1;}else{delete s[id];}saveState(s);updateOutstanding();}function updateOutstanding(){var g={};document.querySelectorAll(\"tr.er\").forEach(function(tr){var k=tr.getAttribute(\"data-period\")+\"_\"+tr.getAttribute(\"data-tier\");if(!g[k])g[k]={rem:0,n:0,dn:0};var e=parseFloat(tr.getAttribute(\"data-exp\"))||0;var d=tr.classList.contains(\"done\");g[k].n++;if(d){g[k].dn++;}else{g[k].rem+=e;}});Object.keys(g).forEach(function(k){var el=document.getElementById(\"out_\"+k);if(el){var x=g[k];el.textContent=\"$\"+Math.round(x.rem).toLocaleString()+\" outstanding \u00b7 \"+x.dn+\"/\"+x.n+\" done\";}});}function applyState(){var s=loadState();document.querySelectorAll(\".ac\").forEach(function(c){if(s[c.id]){c.classList.add(\"done\");var l=document.getElementById(\"l\"+c.id);if(l){l.classList.add(\"ck\");var cb=l.querySelector(\"input\");if(cb)cb.checked=true;}}});document.querySelectorAll(\"tr.er\").forEach(function(tr){var cb=tr.querySelector(\"input.erck\");if(s[tr.getAttribute(\"data-id\")]){tr.classList.add(\"done\");if(cb)cb.checked=true;}});updateOutstanding();}applyState();(function(){var v=__INITREP__;if(v&&v!==\"__ALL__\"&&VIEW_AGG[v])applyRep(v);})();";
    function rep(s, a, b) { return s.split(a).join(b); }
    var client = CLIENT;
    client = rep(client, '__VIEW_AGG__', JSON.stringify(VIEW_AGG, function (k, v) { return k === '_rpInt' ? undefined : v; }));
    client = rep(client, '__CADLBL__', JSON.stringify(cad_labels));
    client = rep(client, '__SCOPE_MEM__', JSON.stringify(SCOPE_MEMBERS));
    client = rep(client, '__THIN__', String(THIN_BOOK_MIN));
    client = rep(client, '__COL__', JSON.stringify(STATUS_COLORS));
    client = rep(client, '__LB__', JSON.stringify(STATUS_LABELS));
    client = rep(client, '__DASHID__', DASH_ID);
    client = rep(client, '__WHOLE__', TEAM_MODE ? 'whole team' : 'whole pod');
    client = rep(client, '__MONTHS__', JSON.stringify(months_list));
    client = rep(client, '__YEARS__', JSON.stringify(YEARS.map(String)));
    client = rep(client, '__INITREP__', JSON.stringify(OPT.initialScope || '__ALL__'));
    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
      + '<title>' + REP_NAME + ' Retention Dashboard &mdash; ' + month_year_str + '</title>'
      + (OPT.webFonts === false ? '' : '<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">')
      + '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"DM Sans",Arial,sans-serif;background:#f7f6f3;color:#1a1714;font-size:14px}'
      + '.hdr{background:#1a1714;border-top:3px solid #c8490c;padding:16px 26px;display:flex;align-items:center;justify-content:space-between}'
      + '.hdr h1{color:#fff;font-size:21px;font-family:"DM Serif Display",Georgia,serif}'
      + '.hdr .sub{color:#9e9086;font-size:11px;margin-bottom:2px}'
      + '.nav{background:#fff;border-bottom:2px solid #e2ddd6;padding:0 20px;display:flex;gap:2px;overflow-x:auto}'
      + '.nav button{background:none;border:none;padding:12px 15px;cursor:pointer;font-size:13px;font-weight:500;color:#6b6460;border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap}'
      + '.nav button.on,.nav button:hover{color:#1a1714;border-bottom-color:#c8490c}'
      + '.pnl{display:none;padding:20px 24px}.pnl.on{display:block}'
      + '#custT td{padding:7px 12px}#custT tbody tr:hover{background:#faf8f5}table.sortable td{white-space:nowrap}'
      + 'tr.er.done{opacity:.5}tr.er.done td b{text-decoration:line-through}input.erck{width:16px;height:16px;cursor:pointer}'
      + '#rbTip{position:fixed;pointer-events:none;background:rgba(26,23,20,.92);color:#fff;font-size:12px;padding:7px 10px;border-radius:6px;z-index:99;display:none;line-height:1.5;white-space:nowrap}</style></head><body>'
      + '<div class="hdr"><div><div class="sub">RETENTION DASHBOARD &mdash; LIVE FROM NETSUITE</div><h1>' + REP_NAME + ' &mdash; ' + month_year_str + '</h1></div>'
      + '<div style="display:flex;align-items:center;gap:18px">' + rep_select + '<div style="color:#9e9086;font-size:12px">' + (OPT.generatedLabel || ('Generated ' + fmtDate(TODAY, '%B %d, %Y'))) + '</div></div></div>'
      + (OPT.banner || '')
      + '<div class="nav">'
      + '<button class="on" onclick="show(\'summary\',this)">Summary</button>'
      + '<button onclick="show(\'retention\',this)">Retention Score</button>'
      + '<button onclick="show(\'changed\',this)">What Changed</button>'
      + '<button onclick="show(\'chart\',this)">Revenue Chart</button>'
      + '<button onclick="show(\'risk\',this)">Risk Cards</button>'
      + '<button onclick="show(\'table\',this)">All Customers</button>'
      + '<button onclick="show(\'due\',this)">Expected Reorders</button>'
      + '<button onclick="show(\'week\',this)">Call This Week</button>'
      + '<button onclick="show(\'schedule\',this)">Month Call Plan</button>'
      + '<button onclick="show(\'cadence\',this)">Activity Cadence</button>'
      + '<button onclick="show(\'tasks\',this)">Reorder Tasks Needed</button>'
      + '<button onclick="show(\'checkin\',this)">Check-In Plan</button>'
      + '</div>'
      + '<div id="p-summary" class="pnl on">' + summary_html + '</div>'
      + '<div id="p-retention" class="pnl">' + ret_html + '</div>'
      + '<div id="p-changed" class="pnl">' + repbar + changed_html + '</div>'
      + '<div id="p-chart" class="pnl">' + repbar + chart_html + '</div>'
      + '<div id="p-risk" class="pnl">' + repbar + risk_html + '</div>'
      + '<div id="p-table" class="pnl">' + repbar + table_html + '</div>'
      + '<div id="p-due" class="pnl">' + repbar + due_html + _await_html + '</div>'
      + '<div id="p-week" class="pnl">' + repbar + week_html + '</div>'
      + '<div id="p-schedule" class="pnl">' + repbar + sched_html + '</div>'
      + '<div id="p-cadence" class="pnl">' + repbar + cad_html + '</div>'
      + '<div id="p-tasks" class="pnl">' + repbar + task_html + '</div>'
      + '<div id="p-checkin" class="pnl">' + repbar + checkin_html + '</div>'
      + '<div id="rbTip"></div>'
      + '<script>' + client + '</script></body></html>';

    // ─── RUN SUMMARY (same lines the Python engine prints) ──────────────────
    var L = WARN.slice();
    function money0(x) { return '$' + comma(pyTrunc(x)); }
    if (HAS_ACTLOG) BASELINES.forEach(function (b) {
      var A = activity_since(b[2], '__ALL__');
      L.push('Activity since ' + lower(b[1]) + ' (' + ymd(b[2]) + '): ' + A.n_touch + ' logged (' + A.n_out + ' out / ' + A.n_in + ' in) across ' + A.n_accounts + ' accounts');
      L.push('   came due ' + A.due_new + ', reached ' + A.reached_new + ' | carried-over backlog ' + A.due_carried + ', reached ' + A.reached_carried);
      L.push('   orders landed ' + A.orders + ' (' + money0(A.order_rev) + ') | nobody reached ' + A.groups.missed.length + ' | worked but not due ' + A.groups.extra.length);
      L.push('   outreach logged by: ' + most_common(A.who, 8).map(function (w) { return w[0] + ' ' + w[1]; }).join(', '));
    });
    L.push('Customers processed: ' + customers.size);
    L.push('Retention composite score: ' + pyFloat(composite));
    L.push('Revenue at risk: ' + pyFloat(pyRound(at_risk, 2)));
    L.push('Total exposure: ' + pyFloat(pyRound(total_exposure, 2)));
    L.push(Y1 + ' total: ' + pyFloat(pyRound(total_2025, 2)));
    L.push(Y0 + ' YTD: ' + pyFloat(pyRound(total_2026_ytd, 2)));
    L.push('Expected reorder revenue this month: ' + pyFloat(pyRound(expected_rev_this_month, 2)));
    L.push('Accounts due this month: ' + due_rows.length);
    var _w = new Map();
    vals(customers).forEach(function (c) { (c.watch || []).forEach(function (f) { var k = f.split(' (')[0].split(' —')[0]; _w.set(k, (_w.get(k) || 0) + 1); }); });
    stableSort(Array.from(_w.entries()), function (x) { return -x[1]; }).forEach(function (x) { L.push('   watch flag — ' + x[0] + ': ' + x[1]); });
    var _open_acc = vals(customers).filter(function (c) { return (c.open_tasks || 0) > 0; });
    L.push('Accounts with an open past-due task: ' + _open_acc.length + ' | open tasks in total: ' + sum(_open_acc.map(function (c) { return c.open_tasks; })));
    L.push('   last activity is an unticked task on: ' + vals(customers).filter(function (c) { return c.last_activity_date && lower(String(c.last_activity_type || '')).indexOf('task') === 0 && !c.last_activity_done; }).length + ' accounts');
    var _rtd = vals(customers).filter(function (c) { return c.reorder_date_source === 'rep task'; }).length;
    L.push('Dates set by a rep task: ' + _rtd);
    L.push('Calls scheduled this week: ' + week_total);
    L.push('Snoozed (excluded) accounts: ' + sc(status_counts, 'snoozed'));
    if (INVALID_SNOOZES.length) {
      L.push('Snoozes rejected (no reactivate date and/or no reason) — ' + INVALID_SNOOZES.length);
      INVALID_SNOOZES.forEach(function (i) { L.push('    ' + i.name + ' — missing ' + i.missing); });
    }
    L.push('Cadence source — email: ' + _email_touch + ' | task: ' + _touch['Task'] + ' | none: ' + _touch['']);
    L.push('In cadence: ' + sc(cadence_counts, 'in_cadence') + ' | out of cadence: ' + sc(cadence_counts, 'out_of_cadence') + ' | no activity: ' + sc(cadence_counts, 'no_activity'));
    L.push('One-order accounts dated by a rep task: ' + _rtd);
    L.push('One-order accounts still needing a reorder date: ' + awaiting_date.length);
    L.push('   worth a task now: ' + _task_groups.live.length + ' | going cold: ' + _task_groups.cold.length + ' | too early: ' + _task_groups.early.length + ' | lapsed: ' + _task_groups.lapsed.length);
    function sgn(x, d) { return (x < 0 || (x === 0 && 1 / x < 0) ? '-' : '+') + pyFmt(Math.abs(x), d); }
    _CMPS.forEach(function (c) {
      var C = c[3];
      var r = sum(C.flips.filter(function (f) { return REAL_CAUSES[f.cause]; }).map(function (f) { return f.pts; }));
      var g = sum(C.flips.filter(function (f) { return f.cause === 'drift'; }).map(function (f) { return f.pts; }));
      L.push('Score vs ' + lower(c[1]) + ' (' + ymd(c[2]) + '): ' + pyFmt(C.S1.composite, 1) + ' -> ' + pyFmt(C.S2.composite, 1) + ' (' + sgn(C.delta, 1) + ' pts; real events ' + sgn(r, 2) + ', calendar drift ' + sgn(g, 2) + ', ' + C.flips.length + ' accounts moved)');
      C.flips.slice(0, 5).forEach(function (f) { L.push('   ' + sgn(f.pts, 2) + ' pts  ' + f.name + '  (' + f.from + ' -> ' + f.to + ')  ' + f.cause); });
    });

    return { html: html, summary: L, stats: { composite: composite, customers: customers.size, at_risk: at_risk,
      uncovered: _uncovered.length, uncovered_rev: sum(_uncovered.map(function (c) { return c.rev_2025 || 0; })) } };
  }



  // ═══ NETSUITE PLUMBING ═══════════════════════════════════════════════════
  function runAll(sql) {
    var out = [];
    var pd = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
    pd.pageRanges.forEach(function (r) {
      var page = pd.fetch({ index: r.index });
      var rows = page.data.asMappedResults();
      for (var i = 0; i < rows.length; i++) out.push(rows[i]);
    });
    return out;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymdOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDaysYMD(s, n) {
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  // The logged-in user's calendar date, in their own timezone preference.
  function userNow() {
    var now = new Date(), label = '', today = ymdOf(now);
    try {
      var tz = runtime.getCurrentUser().getPreference({ name: 'TIMEZONE' });
      var s = tz ? format.format({ value: now, type: format.Type.DATETIMETZ, timezone: tz })
                 : format.format({ value: now, type: format.Type.DATETIMETZ });
      label = s;
      var datePart = String(s).replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?\s*$/i, '');
      var d = format.parse({ value: datePart, type: format.Type.DATE });
      if (d instanceof Date && !isNaN(d.getTime())) today = ymdOf(d);
    } catch (e) {
      log.audit({ title: 'Timezone fallback', details: String(e && e.message || e) });
    }
    return { today: today, label: label };
  }
  function scriptUrl(params) {
    var sc = runtime.getCurrentScript();
    return url.resolveScript({ scriptId: sc.id, deploymentId: sc.deploymentId, params: params || {} });
  }
  function htmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function writeBig(response, html) {   // write in slices; harmless for small pages
    var CH = 1000000;
    for (var i = 0; i < html.length; i += CH) response.write({ output: html.slice(i, i + CH) });
  }
  function errorPage(title, msg) {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Retention Dashboard</title></head>'
      + '<body style="font-family:Arial,sans-serif;background:#f7f6f3;color:#1a1714;padding:40px">'
      + '<div style="max-width:720px;background:#fff;border:1px solid #e2ddd6;border-left:5px solid #c8490c;border-radius:10px;padding:22px 26px">'
      + '<h2 style="font-family:Georgia,serif;margin:0 0 10px">' + htmlEsc(title) + '</h2>'
      + '<div style="font-size:14px;line-height:1.6;color:#4a4540">' + msg + '</div></div></body></html>';
  }

  // ═══ WHO IS LOOKING, AND WHAT THEY MAY OPEN ═════════════════════════════
  function podById(id) { for (var i = 0; i < RB_CONFIG.PODS.length; i++) if (RB_CONFIG.PODS[i].id === id) return RB_CONFIG.PODS[i]; return null; }
  function accessFor(userId) {
    var uid = Number(userId), allPods = RB_CONFIG.PODS.map(function (p) { return p.id; });
    var full = { views: ['team'].concat(allPods), reps: Object.keys(RB_CONFIG.REPS), dflt: 'team', initial: '__ALL__' };
    if (ACCESS.FULL.map(Number).indexOf(uid) >= 0) return full;
    var lead = ACCESS.POD_LEADS[String(uid)] || ACCESS.POD_LEADS[uid];
    if (lead && podById(lead)) return { views: [lead], reps: podById(lead).members.slice(), dflt: lead, initial: '__ALL__' };
    var me = null;
    Object.keys(RB_CONFIG.REPS).forEach(function (n) { if (Number(RB_CONFIG.REPS[n]) === uid) me = n; });
    if (me) {
      var myPod = null; RB_CONFIG.PODS.forEach(function (p) { if (p.members.indexOf(me) >= 0) myPod = p; });
      if (ACCESS.OTHER_REPS === 'pod' && myPod) return { views: [myPod.id], reps: myPod.members.slice(), dflt: myPod.id, initial: me };
      if (ACCESS.OTHER_REPS === 'self' || (ACCESS.OTHER_REPS === 'pod' && !myPod)) return { views: [], reps: [me], dflt: 'rep:' + me, initial: '__ALL__' };
      return null;
    }
    return ACCESS.EVERYONE_ELSE === 'full' ? full : null;
  }
  function resolveView(params, user) {
    var acc = accessFor(user.id);
    if (!acc) return null;
    var want = String(params.view || '').toLowerCase(), wantRep = params.rep ? String(params.rep) : null;
    var key;
    if (want === 'rep' && wantRep && acc.reps.indexOf(wantRep) >= 0) key = 'rep:' + wantRep;
    else if (want && acc.views.indexOf(want) >= 0) key = want;
    else key = acc.dflt;                       // anything not permitted falls back to their own default
    var v;
    if (key.indexOf('rep:') === 0) {
      var r = key.slice(4);
      v = { key: 'rep', label: r, rep_name: 'Retention — ' + r, dashboard_id: 'rep_' + r.split(/\s+/)[0].toLowerCase(),
            pod_members: [r], pod_groups: null, initialScope: '__ALL__' };
    } else if (key === 'team') {
      var groups = {}, all = [];
      RB_CONFIG.PODS.forEach(function (p) { groups[p.group] = p.members.slice(); all = all.concat(p.members); });
      v = { key: 'team', label: 'Whole team', rep_name: RB_CONFIG.TEAM_NAME, dashboard_id: 'team',
            pod_members: all, pod_groups: groups, initialScope: '__ALL__' };
    } else {
      var p = podById(key);
      v = { key: p.id, label: p.group, rep_name: p.name, dashboard_id: p.id, pod_members: p.members.slice(), pod_groups: null,
            initialScope: (key === acc.dflt && p.members.indexOf(acc.initial) >= 0) ? acc.initial : '__ALL__' };
    }
    v.acc = acc;
    return v;
  }
  function viewBar(v) {
    var acc = v.acc;
    if (acc.views.length + acc.reps.length <= 1) return '';
    function pill(on, href, txt) {
      return '<a href="' + htmlEsc(href) + '" style="text-decoration:none;padding:4px 11px;border-radius:12px;font-weight:600;'
        + (on ? 'background:#c8490c;color:#fff' : 'background:#3a322c;color:#e2ddd6') + '">' + htmlEsc(txt) + '</a>';
    }
    var o = '<div style="background:#2a2420;padding:7px 26px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px">'
      + '<span style="color:#9e9086;letter-spacing:.6px;text-transform:uppercase;font-size:10px;margin-right:6px">Open dashboard for</span>';
    acc.views.forEach(function (k) {
      var lbl = k === 'team' ? 'Whole team' : podById(k).group + ' — all';
      o += pill(v.key === k, scriptUrl({ view: k }), lbl);
    });
    if (acc.views.length && acc.reps.length) o += '<span style="color:#6b6460;margin:0 4px">|</span>';
    acc.reps.forEach(function (r) { o += pill(v.key === 'rep' && v.label === r, scriptUrl({ view: 'rep', rep: r }), r); });
    return o + '</div>';
  }

  // ═══ ENTRY POINT ═════════════════════════════════════════════════════════
  function onRequest(context) {
    if (context.request.method !== 'GET') { context.response.write({ output: 'GET only' }); return; }
    var t0 = Date.now(), timings = [];
    try {
      var user = runtime.getCurrentUser();
      var v = resolveView(context.request.parameters || {}, user);
      if (!v) {
        log.audit({ title: 'Retention dashboard — access denied', details: 'user=' + user.id });
        writeBig(context.response, errorPage('No access to this dashboard',
          'Your login is not set up to view the retention dashboard. Ask the administrator to add you.'));
        return;
      }
      var clock = userNow();
      var ids = v.pod_members.map(function (n) { return RB_CONFIG.REPS[n]; }).filter(function (x) { return x !== undefined; });
      if (!ids.length) {
        writeBig(context.response, errorPage('No reps to show', 'This view has no reps on its roster. Check RB_CONFIG.REPS and RB_CONFIG.PODS in the script.'));
        return;
      }
      var Q = rbQueries(ids, clock.today, addDaysYMD(clock.today, -TOUCH_WINDOW_DAYS));
      var R = {};
      ['employees', 'orders', 'invoices', 'items', 'contacts', 'activity', 'reptasks', 'touchtasks', 'touchmsgs'].forEach(function (k) {
        var t = Date.now(); R[k] = runAll(Q[k]); timings.push(k + ' ' + R[k].length + ' rows ' + (Date.now() - t) + 'ms');
      });
      // A pull that returns no transactions at all is a connector/permission problem, not
      // an empty book — never render a normal-looking empty dashboard (skill guardrail).
      if (!R.orders.length && !R.invoices.length) {
        writeBig(context.response, errorPage('NetSuite returned no transactions',
          'The sales order and invoice queries came back empty for this roster. That almost always means a '
          + 'permission or record-type problem rather than an empty book, so the dashboard has not been drawn. '
          + 'Check that this role can see Transactions, Customers, Tasks and Messages.'));
        return;
      }
      var raw = rbAssemble(R, { rep_name: v.rep_name, dashboard_id: v.dashboard_id, pod_members: v.pod_members,
        pod_groups: v.pod_groups, ids: RB_CONFIG.REPS, exclusions: RB_CONFIG.EXCLUSIONS });
      var t1 = Date.now();
      var out = rbEngine(raw, clock.today, {
        initialScope: v.initialScope, webFonts: WEB_FONTS, hideRepFilter: v.key === 'rep', banner: viewBar(v),
        generatedLabel: 'Live &middot; ' + htmlEsc(clock.label || clock.today) });
      timings.push('engine ' + (Date.now() - t1) + 'ms');
      writeBig(context.response, out.html);
      log.audit({ title: 'Retention dashboard served', details: 'view=' + v.key + (v.key === 'rep' ? ':' + v.label : '')
        + ' user=' + user.id + ' today=' + clock.today + ' score=' + out.stats.composite + ' customers=' + out.stats.customers
        + ' html=' + out.html.length + ' total=' + (Date.now() - t0) + 'ms units_left=' + runtime.getCurrentScript().getRemainingUsage()
        + ' | ' + timings.join('; ') });
      log.debug({ title: 'Run summary', details: out.summary.join('\n').slice(0, 3900) });
    } catch (e) {
      log.error({ title: 'Retention dashboard failed', details: (e && (e.name + ': ' + e.message + '\n' + e.stack)) || String(e) });
      writeBig(context.response, errorPage('The retention dashboard could not be built',
        'NetSuite returned an error while building the page. Nothing is wrong with your data; please try again, '
        + 'and if it persists send this to the administrator:<pre style="white-space:pre-wrap;background:#faf8f5;padding:10px;border-radius:6px;font-size:12px">'
        + htmlEsc((e && (e.name + ': ' + e.message)) || String(e)) + '</pre>'));
    }
  }
  return { onRequest: onRequest };
});