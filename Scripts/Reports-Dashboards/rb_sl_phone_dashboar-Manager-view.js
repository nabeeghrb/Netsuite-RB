/**
 * Royal Bag — Phone Call Dashboard (live)
 *
 * Suitelet that queries NetSuite live on every page load and renders the
 * phone-call dashboard (Pulse, By call type, Reps x call type, Sentiment &
 * recovery, Deep dive, Combined workload). Every filter recomputes client-side
 * from one consistent snapshot pulled in a single request.
 *
 * Single self-contained file: the page (styles, layout, chart/filter logic) is
 * embedded at the bottom of this script as PAGE_HEAD / PAGE_BODY / PAGE_APP.
 * No other File Cabinet files are needed.
 *
 * Script parameters (all optional — defaults in DEFAULTS below):
 *   custscript_rbpd_roster        Employee internal ids, comma separated, in display order
 *   custscript_rbpd_start         Window start, YYYY-MM-DD
 *   custscript_rbpd_scored_from   "Scored era" preset start, YYYY-MM-DD
 *   custscript_rbpd_tickets       Checkbox — include support tickets (support roster = on, sales roster = off)
 *
 * URL overrides (handy for one deployment serving several rosters):
 *   &reps=653584,496615   &start=2026-03-01   &tickets=F   &format=json
 *
 * Field decoding (verified against live records, Nov 2026):
 *   - Owner is phonecall.assigned (NOT owner).
 *   - Use the *_num* sentiment lists: list id 1 = Positive, 2 = Neutral, 3 = Negative.
 *     The text lists (custevent_rb_rep_sentiment / custevent_customer_sentiment) order
 *     2 = Negative, 3 = Neutral — reading those by id silently inverts the dashboard.
 *   - custevent_rb_customer_sentiment_end_num is a real integer -1/0/1, normalised to 3/2/1.
 *   - Voicemail / no-answer = title contains "no conversation"; banded separately, never toned.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/runtime', 'N/log'], (query, runtime, log) => {

    const DEFAULTS = {
        roster: '653584,496615,317501,1006783',   // Moshe Naiman, Taylor Kennedy, Sruly Marsow, Gianna Saviano
        start: '2026-01-01',
        scoredFrom: '2026-02-26',                  // AI scoring went live late Feb 2026
        tickets: true
    };

    // Fallback labels; live labels from BUILTIN.DF override these.
    const CT = { 1: 'New Order', 2: 'Reorder', 3: 'Product Complaint', 4: 'Shipping Issue', 5: 'Pricing Inquiry',
        6: 'Lead Time', 7: 'Product Question', 8: 'Order Status Inquiry', 9: 'Vendor / Supplier Call',
        10: 'General Inquiry', 11: 'Lead / Discovery Call', 12: 'Lead / Negotiation', 13: 'Others',
        15: 'Lead Time / Availability Inquiry' };
    const IC = { 1: 'Seal failure', 2: 'Thickness issue', 3: 'Printing issue', 4: 'Wrong shipment',
        5: 'Short shipment', 6: 'Damaged goods', 7: 'Late delivery', 8: 'Pricing dispute',
        9: 'Size issue', 10: 'Feature issue', 11: 'Other', 12: 'None' };
    const ACT = { 1: 'Sales Follow-up', 2: 'Credit Needed', 3: 'Replacement Needed', 4: 'Operations Review',
        5: 'Support Follow-up', 6: 'None' };

    const SPAM_TICKET_CATEGORY = 8;

    // ------------------------------------------------------------------ config
    const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const truthy = v => v === true || v === 'T' || v === 't' || v === 'true' || v === '1';

    function getConfig(params) {
        const script = runtime.getCurrentScript();
        const p = id => { try { return script.getParameter({ name: id }); } catch (e) { return null; } };

        const rosterRaw = params.reps || p('custscript_rbpd_roster') || DEFAULTS.roster;
        const roster = String(rosterRaw).split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => n > 0);
        if (!roster.length) throw new Error('Roster is empty — set custscript_rbpd_roster or &reps=');

        const start = isDate(params.start) ? params.start : (isDate(p('custscript_rbpd_start')) ? p('custscript_rbpd_start') : DEFAULTS.start);
        const scoredFrom = isDate(p('custscript_rbpd_scored_from')) ? p('custscript_rbpd_scored_from') : DEFAULTS.scoredFrom;

        let tickets = DEFAULTS.tickets;
        const tp = p('custscript_rbpd_tickets');
        if (tp !== null && tp !== '' && tp !== undefined) tickets = truthy(tp);
        if (params.tickets !== undefined) tickets = truthy(params.tickets);

        return { roster, start, scoredFrom: scoredFrom < start ? start : scoredFrom, tickets };
    }

    // ------------------------------------------------------------------ query helpers
    /** Runs SuiteQL and returns every row (pages through the 1000-row page cap). */
    function runAll(sql, params) {
        const paged = query.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000 });
        const out = [];
        paged.pageRanges.forEach(range => {
            paged.fetch({ index: range.index }).data.asMappedResults().forEach(r => out.push(r));
        });
        return out;
    }

    const placeholders = n => new Array(n).fill('?').join(',');
    const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v);

    // ------------------------------------------------------------------ data
    function loadRoster(cfg) {
        const rows = runAll(
            `SELECT id, firstname, lastname, entityid FROM employee WHERE id IN (${placeholders(cfg.roster.length)})`,
            cfg.roster);
        const byId = {};
        rows.forEach(r => {
            const name = [r.firstname, r.lastname].filter(Boolean).join(' ') || r.entityid || ('Employee ' + r.id);
            byId[String(r.id)] = name;
        });
        // Keep configured order; keep an id that resolved to nothing so it shows as an empty state, never hidden.
        return cfg.roster.map(id => [String(id), byId[String(id)] || ('Employee ' + id)]);
    }

    /**
     * ONE query for every call — the row set and the work queues are both derived
     * from this single snapshot, so a call logged mid-request can never misalign them.
     */
    function loadCalls(cfg) {
        const sql = `
            SELECT p.id,
                   TO_CHAR(p.startdate, 'YYYY-MM-DD')                 AS d,
                   p.assigned                                          AS r,
                   p.custevent_rb_call_type_ai                         AS ct,
                   BUILTIN.DF(p.custevent_rb_call_type_ai)             AS ctl,
                   p.custevent_rb_customer_sentiment_num               AS dom,
                   p.custevent_rb_customer_sentiment_end_num           AS fin,
                   p.custevent_rb_rep_sentiment_num                    AS rs,
                   p.custevent_rb_customer_risk                        AS risk,
                   p.custevent_urgency_level                           AS urg,
                   p.custevent_rb_action_required                      AS act,
                   BUILTIN.DF(p.custevent_rb_action_required)          AS actl,
                   p.custevent_rb_confidence_score                     AS conf,
                   p.custevent_rb_aiprocessed                          AS ai,
                   CASE WHEN LOWER(p.title) LIKE '%no conversation%' THEN 1 ELSE 0 END AS vm,
                   p.custevent_rb_issue_category                       AS ic,
                   BUILTIN.DF(p.custevent_rb_issue_category)           AS icl,
                   p.custevent_rb_direction                            AS dir,
                   c.id                                                AS cid,
                   c.entityid                                          AS acct,
                   c.companyname                                       AS cname,
                   c.isperson                                          AS isperson
            FROM phonecall p
            LEFT JOIN customer c ON c.id = p.company
            WHERE p.startdate >= TO_DATE(?, 'YYYY-MM-DD')
              AND p.assigned IN (${placeholders(cfg.roster.length)})
            ORDER BY p.id`;
        return runAll(sql, [cfg.start].concat(cfg.roster));
    }

    function loadTickets(cfg) {
        const sql = `
            SELECT TO_CHAR(datecreated, 'YYYY-MM-DD') AS d, assigned AS r, COUNT(*) AS n
            FROM supportcase
            WHERE datecreated >= TO_DATE(?, 'YYYY-MM-DD')
              AND assigned IN (${placeholders(cfg.roster.length)})
              AND NVL(category, 0) <> ${SPAM_TICKET_CATEGORY}
            GROUP BY TO_CHAR(datecreated, 'YYYY-MM-DD'), assigned
            ORDER BY 1, 2`;
        return runAll(sql, [cfg.start].concat(cfg.roster));
    }

    // Strip the account-code prefix NetSuite prepends to some company names ("C4402 Acme" -> "Acme").
    function cleanName(name, code) {
        if (!name) return '';
        let n = String(name).trim();
        if (code && n.indexOf(code) === 0) n = n.slice(String(code).length).replace(/^[\s-]+/, '');
        return n;
    }

    /** Pure transform: raw query rows -> the DATA payload the page reads. */
    function buildPayload(cfg, roster, callRows, ticketRows) {
        const keys = {};
        roster.forEach(([k]) => { keys[k] = true; });
        const ct = Object.assign({}, CT), ic = Object.assign({}, IC), act = Object.assign({}, ACT);

        const rows = [], queue = [];
        let maxDate = '';

        callRows.forEach(x => {
            const rep = String(x.r);
            if (!keys[rep]) return;

            const ctv = num(x.ct), icv = num(x.ic), actv = num(x.act);
            if (ctv && x.ctl) ct[ctv] = x.ctl;
            if (icv && x.icl) ic[icv] = x.icl;
            if (actv && x.actl) act[actv] = x.actl;

            const dom = num(x.dom), rs = num(x.rs), risk = num(x.risk), urg = num(x.urg);
            // ending sentiment is a real integer -1/0/1 -> 3/2/1 (0 = not scored)
            const f = (x.fin === null || x.fin === undefined || x.fin === '') ? null : Number(x.fin);
            const fin = f === 1 ? 1 : f === 0 ? 2 : f === -1 ? 3 : 0;
            const conf = (x.conf === null || x.conf === undefined || x.conf === '') ? -1 : Number(x.conf);
            const ai = truthy(x.ai) ? 1 : 0;
            const vm = num(x.vm) ? 1 : 0;
            const dir = num(x.dir);

            if (x.d > maxDate) maxDate = x.d;

            // row: [0 date,1 rep,2 ct,3 dom,4 end,5 rs,6 risk,7 urg,8 act,9 conf,10 ai,11 vm,12 ic,13 dir]
            rows.push([x.d, rep, ctv, dom, fin, rs, risk, urg, actv, conf, ai, vm, icv, dir]);

            // Work-queue membership — identical to the original extraction criteria.
            const inQueue = ai && (
                (actv >= 1 && actv <= 5) ||
                risk === 2 || risk === 3 ||
                (conf >= 0 && conf <= 80) ||
                dom === 3 || rs === 3 ||
                ((dom === 1 || dom === 2) && fin === 3));
            if (inQueue) {
                // Privacy: business account names only. Individual customers are shown as such, never by name.
                const person = truthy(x.isperson);
                const cid = num(x.cid);
                const acctCode = person ? '' : (x.acct || '');
                const cname = person ? 'Individual customer' : cleanName(x.cname, x.acct);
                // queue: [0 id,1 d,2 rep,3 ct,4 ic,5 act,6 risk,7 urg,8 dom,9 fin,10 rs,11 conf,12 dir,13 vm,14 cid,15 acct,16 cname]
                queue.push([num(x.id), x.d, rep, ctv, icv, actv, risk, urg, dom, fin, rs, conf, dir, vm,
                    cid, acctCode, cid ? cname : '']);
            }
        });

        const tickets = [];
        (ticketRows || []).forEach(t => {
            const rep = String(t.r);
            if (keys[rep] && t.d) tickets.push([t.d, rep, num(t.n)]);
        });

        return {
            rows, queue, tickets, ct, ic, act,
            maxDate: maxDate || cfg.start,
            minDate: cfg.start,
            scoredFrom: cfg.scoredFrom,
            builtAtIso: new Date().toISOString(),
            builtAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
            roster,
            hasTickets: !!cfg.tickets,
            nsBase: ''   // same-domain relative links to call / customer records
        };
    }

    // ------------------------------------------------------------------ http
    const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function errorPage(msg) {
        return '<!doctype html><html><head><meta charset="utf-8"><title>Phone call dashboard</title></head>' +
            '<body style="font:14px system-ui,sans-serif;padding:40px;color:#101418">' +
            '<h2>Phone call dashboard could not load</h2><p>' + escHtml(msg) + '</p>' +
            '<p style="color:#6E7A87">Check the script parameters and the script execution log.</p>' +
            '</body></html>';
    }

    function onRequest(ctx) {
        const res = ctx.response;
        const params = ctx.request.parameters || {};
        try {
            const cfg = getConfig(params);
            const roster = loadRoster(cfg);
            const calls = loadCalls(cfg);
            const tickets = cfg.tickets ? loadTickets(cfg) : [];
            const data = buildPayload(cfg, roster, calls, tickets);

            log.audit('Phone dashboard', `calls=${data.rows.length} queue=${data.queue.length} ` +
                `ticketDays=${data.tickets.length} usageLeft=${runtime.getCurrentScript().getRemainingUsage()}`);

            if (params.format === 'json') {
                res.setHeader({ name: 'Content-Type', value: 'application/json' });
                res.write(JSON.stringify(data));
                return;
            }

            // "<" escaped so no customer name can ever close the <script> block.
            const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
            res.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
            res.write(renderPage(json));
        } catch (e) {
            log.error('Phone dashboard failed', e);
            res.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
            res.write(errorPage(e.message || String(e)));
        }
    }

    // ------------------------------------------------------------------ page
    /** Assembles the full HTML document around the live data payload. */
    function renderPage(json) {
        return PAGE_HEAD + PAGE_BODY +
            '\n<script>var DATA = ' + json + ';</script>\n' +
            '<script>\n' + PAGE_APP + '\n</script>\n</body>\n</html>\n';
    }

    // ================================================================== EMBEDDED PAGE
    // Everything below is the dashboard itself. Kept as String.raw so CSS/JS backslashes
    // stay literal. Do not add backticks or "${" inside these blocks.

    // ---- <head>: document shell + complete stylesheet
    const PAGE_HEAD = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Royal Bag &middot; Phone calls &amp; combined workload</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#EDF0F3; --card:#FFFFFF; --ink:#101418; --muted:#6E7A87; --faint:#98A3AE;
    --rule:#E1E7EC; --accent:#0F5F63; --accent-soft:#E4EEEE; --radius:14px;
    --display:"Space Grotesk",ui-sans-serif,system-ui,sans-serif;
    --body:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
    --pos:#1baf7a; --neu:#98A3AE; --neg:#d03b3b; --vm:#8C93C8; --none:#C9D2DA;
    --good:#0ca30c; --warn:#fab219; --crit:#d03b3b;
    --calls:#0F5F63; --callsout:#4FA3A8; --nodir:#C9D2DA; --tickets:#eb6834;
  }
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{background:var(--paper);color:var(--ink);font-family:var(--body);font-size:15px;
    line-height:1.5;-webkit-font-smoothing:antialiased;padding:32px 22px 70px}
  .wrap{max-width:1140px;margin:0 auto}
  .banner{background:#FFF8E6;border:1px solid #F0DFA8;border-radius:10px;padding:11px 16px;
    margin-bottom:22px;font-size:13px;color:#6B5518} .banner b{color:#4A3A10}
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;gap:22px;flex-wrap:wrap;
    padding-bottom:16px;margin-bottom:18px;border-bottom:1px solid var(--rule)}
  h1{font-family:var(--display);font-size:26px;font-weight:500;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13.5px;margin:0}
  .stamp{font-family:var(--display);font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;
    color:var(--faint);text-align:right;line-height:1.65}
  .tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
  .tabs button{font-family:var(--display);font-size:12px;font-weight:500;letter-spacing:.08em;
    text-transform:uppercase;color:var(--muted);background:transparent;border:1px solid var(--rule);
    border-radius:999px;padding:8px 17px;cursor:pointer;transition:all .15s}
  .tabs button:hover{color:var(--ink);border-color:var(--faint)}
  .tabs button[aria-selected=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
  .tabs button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .controls{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);
    padding:13px 17px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:center;
    gap:14px;flex-wrap:wrap;position:sticky;top:0;z-index:20;box-shadow:0 1px 0 rgba(16,20,24,.04)}
  .fg{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .fg label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  select,input[type=date]{font-family:var(--body);font-size:13px;color:var(--ink);
    border:1px solid var(--rule);border-radius:8px;padding:6px 9px;background:#fff}
  #presets{gap:5px}
  #presets button{font-family:var(--body);font-size:12px;font-weight:500;color:var(--muted);
    background:transparent;border:1px solid var(--rule);border-radius:999px;padding:5px 11px;
    cursor:pointer;transition:all .14s}
  #presets button:hover{color:var(--ink);border-color:var(--faint)}
  #presets button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
  th.sortable{cursor:pointer;user-select:none;white-space:nowrap}
  th.sortable:hover{color:var(--ink)}
  th.sortable::after{content:"\2195";opacity:.3;margin-left:5px;font-weight:400}
  th.sortable[data-dir=asc]::after{content:"\2191";opacity:1;color:var(--accent)}
  th.sortable[data-dir=desc]::after{content:"\2193";opacity:1;color:var(--accent)}
  .chart svg{display:block;width:100%;height:auto}
  .scope{font-size:12px;color:var(--accent);font-weight:600;font-variant-numeric:tabular-nums}
  .panel{display:none} .panel.on{display:block}
  h2{font-family:var(--display);font-size:12.5px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
    color:var(--accent);margin:0 0 4px;display:flex;align-items:center;gap:9px}
  h2::before{content:"";width:16px;height:2px;background:var(--accent);border-radius:2px}
  .lede{color:var(--muted);font-size:13px;margin:0 0 16px;max-width:78ch}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));gap:12px;margin-bottom:26px}
  .tile{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);padding:16px 18px}
  .tile .lab{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);
  .tile .lab>span:first-child{min-width:0;overflow-wrap:anywhere}
  .tile .pill{max-width:58%;overflow:hidden;text-overflow:ellipsis}
  .stamp a{color:inherit}
    margin-bottom:9px;min-height:28px;display:flex;align-items:flex-start;justify-content:space-between;gap:7px}
  .tile .val{font-family:var(--display);font-size:33px;font-weight:500;letter-spacing:-.03em;line-height:1;
    font-variant-numeric:tabular-nums}
  .tile .foot{font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.45}
  .pill{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:3px 7px;
    border-radius:999px;white-space:nowrap;flex:none}
  .pill.ok{background:#E6F4E6;color:#0A6B0A} .pill.wa{background:#FDF2D9;color:#7A5600}
  .pill.cr{background:#FBE7E7;color:#9B2020} .pill.nu{background:#EEF1F4;color:#55606B}
  .card{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);padding:19px 21px 17px;margin-bottom:15px}
  .card h3{font-family:var(--display);font-size:15px;font-weight:500;margin:0 0 3px;letter-spacing:-.01em}
  .card .note{font-size:12.5px;color:var(--muted);margin:0 0 16px}
  .gap{background:#F4F7F9;border:1px dashed #C6D2DB;border-radius:9px;padding:10px 14px;
    font-size:12.5px;color:#4E5C68;margin:0 0 15px;line-height:1.55}
  .gap b{color:var(--ink)}
  .legend{display:flex;gap:15px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:14px}
  .legend span{display:flex;align-items:center;gap:6px} .legend i{width:10px;height:10px;border-radius:3px}
  .hbar{display:grid;grid-template-columns:210px 1fr;gap:12px;align-items:center;margin-bottom:9px}
  .hbar.narrow{grid-template-columns:96px 1fr}
  .hbar .name{font-size:12.5px;text-align:right;font-weight:500}
  .track{position:relative;height:26px;background:#F4F6F8;border-radius:5px;display:flex;gap:2px;overflow:hidden}
  .fill{height:100%;position:relative;cursor:default;transition:filter .12s}
  .fill:hover,.fill:focus{filter:brightness(1.08);outline:none}
  .dlabel{position:absolute;top:50%;transform:translateY(-50%);font-size:12px;font-weight:600;
    font-variant-numeric:tabular-nums;white-space:nowrap}
  .dlabel.in{right:8px;color:#fff} .dlabel.out{left:calc(100% + 8px);color:var(--ink)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:var(--muted);padding:0 9px 8px;border-bottom:1px solid var(--rule)}
  th.n,td.n{text-align:right;font-variant-numeric:tabular-nums}
  td{padding:9px;border-bottom:1px solid #F1F4F6;font-variant-numeric:tabular-nums}
  tbody tr:hover{background:#FAFCFD} tbody tr:last-child td{border-bottom:none}
  td.lbl{font-variant-numeric:normal}
  .dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  .flag{font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:2px 6px;
    border-radius:4px;background:#FBE7E7;color:#9B2020;white-space:nowrap}
  .flag.wa{background:#FDF2D9;color:#7A5600} .flag.nu{background:#EEF1F4;color:#55606B}
  .flag.ok{background:#E6F4E6;color:#0A6B0A}
  .muted{color:var(--muted)} a{color:#2A6F97;text-decoration:none;font-weight:500} a:hover{text-decoration:underline}
  .cell{padding:5px 7px;border-radius:5px;font-variant-numeric:tabular-nums;font-size:12.5px;display:inline-block;min-width:58px;text-align:right}
  .empty{padding:30px;text-align:center;color:var(--faint);font-size:13px}
  .newbie{background:#F7FAFB;border:1px dashed #C6D2DB;border-radius:9px;padding:14px 16px;font-size:12.5px;color:#4E5C68}
  #tip{position:fixed;z-index:99;pointer-events:none;opacity:0;transition:opacity .1s;background:#101418;
    color:#fff;border-radius:9px;padding:9px 12px;font-size:12.5px;line-height:1.5;max-width:280px;
    box-shadow:0 6px 22px rgba(16,20,24,.26)} #tip.on{opacity:1}
  #tip .tv{font-family:var(--display);font-size:17px;font-weight:500;display:block;margin-bottom:1px}
  #tip .tl{color:#B9C4CE;font-size:11.5px}
  #tip .tr{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15);color:#D6DEE5;font-size:11.5px}
  .foot-note{margin-top:28px;padding-top:18px;border-top:1px solid var(--rule);font-size:12.5px;
    color:var(--muted);line-height:1.65}
  .split{display:grid;grid-template-columns:1fr 1fr;gap:15px}
  @media(max-width:820px){.split{grid-template-columns:1fr}}
  @media(max-width:700px){body{padding:20px 13px 44px}.hbar,.hbar.narrow{grid-template-columns:1fr;gap:4px}
    .hbar .name{text-align:left}.controls{position:static}.masthead{align-items:flex-start}.stamp{text-align:left}}
  /* deep-dive sub-navigation */
  #deepnav button{font-family:var(--display);font-size:11.5px;font-weight:500;letter-spacing:.06em;
    text-transform:uppercase;color:var(--muted);background:var(--card);border:1px solid var(--rule);
    border-radius:999px;padding:7px 15px;cursor:pointer;transition:all .15s}
  #deepnav button:hover{color:var(--ink);border-color:var(--faint)}
  #deepnav button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
  #type-body tr{cursor:pointer}
  td a{white-space:nowrap}
</style>
</head>`;

    // ---- <body>: banner, masthead, tabs, filters, empty panel containers
    const PAGE_BODY = String.raw`<body>
<div class="wrap">

  <div class="banner">
    <b>Live NetSuite data &middot; <span id="banner-scope">every call the roster took</span>.</b>
    Scope is <b>all</b> their calls, not just Department = Support. Sentiments are shown separately &mdash;
    there is deliberately <b>no blended quality score</b>. <b>Call duration is not available</b>
    (calls log on answer, not on finish, so the duration field is always 0) &mdash; it is marked as a gap
    throughout and never estimated. Missed calls are not logged and are out of scope.
  </div>

  <header class="masthead">
    <div>
      <h1>Phone calls &middot; sales support</h1>
      <p class="sub">How the team sounds on the phone, by call type and by rep.
        Every filter rescopes every number on every tab.</p>
    </div>
    <div class="stamp">Speed &middot; Accuracy<br>Empathy &middot; Ownership<br><span id="asof">Loading&hellip;</span></div>
  </header>

  <nav class="tabs" role="tablist">
    <button role="tab" aria-selected="true"  data-p="pulse">Pulse</button>
    <button role="tab" aria-selected="false" data-p="type">By call type</button>
    <button role="tab" aria-selected="false" data-p="reps">Reps &times; call type</button>
    <button role="tab" aria-selected="false" data-p="recov">Sentiment &amp; recovery</button>
    <button role="tab" aria-selected="false" data-p="deep">Deep dive</button>
    <button role="tab" aria-selected="false" data-p="comb">Combined workload</button>
  </nav>

  <section class="controls">
    <div class="fg">
      <label for="d1">From</label><input type="date" id="d1" />
      <label for="d2">to</label><input type="date" id="d2" />
    </div>
    <div class="fg" id="presets">
      <button data-days="30">30d</button><button data-days="90">90d</button>
      <button data-days="180">180d</button><button data-days="0" aria-pressed="true" id="preset-all">All</button>
      <button data-scored="1">Scored era</button>
    </div>
    <div class="fg">
      <label for="fr">Rep</label>
      <select id="fr"><option value="">All reps</option></select>
      <label for="ft">Call type</label>
      <select id="ft"><option value="">All types</option></select>
      <label for="fd">Direction</label>
      <select id="fd"><option value="">Any</option><option value="1">Inbound</option>
        <option value="2">Outbound</option></select>
      <label for="fu">Urgency</label>
      <select id="fu"><option value="">Any</option><option value="3">High</option>
        <option value="2">Medium</option><option value="1">Low</option></select>
      <span class="scope" id="scope"></span>
    </div>
  </section>

  <!-- ============ PULSE ============ -->
  <div class="panel on" id="p-pulse">
    <h2>How is the team doing on the phone?</h2>
    <p class="lede">One screen. Outliers are flagged automatically &mdash; the tiles below tell you
      <i>whether</i> to dig, the next tabs tell you <i>where</i>, and the Deep dive tab is what you act on.</p>
    <div class="tiles" id="pulse-tiles"></div>

    <div class="card">
      <h3>Weekly volume and tone</h3>
      <p class="note">Bars are call volume, split by tone. The line is the share of scored conversations
        the AI called negative. Voicemails and no-answers are banded separately and carry no tone.</p>
      <div class="legend">
        <span><i style="background:var(--pos)"></i>Positive</span>
        <span><i style="background:var(--neu)"></i>Neutral</span>
        <span><i style="background:var(--neg)"></i>Negative</span>
        <span><i style="background:var(--vm)"></i>Voicemail / no conversation</span>
        <span><i style="background:var(--none)"></i>Not scored by AI</span>
        <span><i style="background:#101418;height:2px;border-radius:0"></i>% negative</span>
      </div>
      <div class="chart" id="trend"></div>
    </div>

    <div class="card">
      <h3>Where to dig</h3>
      <p class="note" id="pulse-story"></p>
    </div>
  </div>

  <!-- ============ BY CALL TYPE ============ -->
  <div class="panel" id="p-type">
    <h2>Each call type is a different job</h2>
    <p class="lede">Call type is the primary segmentation, mirroring the ticket-type treatment.
      Sort by % negative to find the job going wrong, then use the rep tab to see whether it is one
      person or all of them.</p>

    <div class="card">
      <h3>Tone by call type</h3>
      <p class="note">Scored conversations only &mdash; voicemails excluded, they carry no tone.
        Bars are shares within the type; the count is on the right.</p>
      <div class="legend">
        <span><i style="background:var(--pos)"></i>Positive</span>
        <span><i style="background:var(--neu)"></i>Neutral</span>
        <span><i style="background:var(--neg)"></i>Negative</span>
      </div>
      <div id="type-bars"></div>
    </div>

    <div class="card">
      <h3>The table behind the bars</h3>
      <p class="note">Every column sorts. Click a row to filter the whole dashboard to that call type.
        &ldquo;At risk&rdquo; is customer risk Medium or High; &ldquo;action open&rdquo; is any
        Action Required other than None.</p>
      <table id="type-table"><thead><tr>
        <th class="sortable" data-k="name" data-t="s">Call type</th>
        <th class="n sortable" data-k="n" data-t="n" data-dir="desc">Calls</th>
        <th class="n sortable" data-k="inb" data-t="n">Inbound</th>
        <th class="n sortable" data-k="outb" data-t="n">Outbound</th>
        <th class="n sortable" data-k="pneg" data-t="n">% negative</th>
        <th class="n sortable" data-k="ppos" data-t="n">% positive</th>
        <th class="n sortable" data-k="risk" data-t="n">At risk</th>
        <th class="n sortable" data-k="act" data-t="n">Action open</th>
        <th class="n sortable" data-k="lowconf" data-t="n">Conf &le;80</th>
      </tr></thead><tbody id="type-body"></tbody></table>
    </div>

    <div class="card">
      <h3>Second-level drill &mdash; what the complaint was actually about</h3>
      <p class="note" id="issue-note"></p>
      <div class="split">
        <div>
          <div class="note" style="margin-bottom:10px"><b>Issue category, across the selection</b></div>
          <div id="issue-bars"></div>
        </div>
        <div>
          <div class="note" style="margin-bottom:10px"><b>Which call type it came in on</b></div>
          <table id="issue-table"><thead><tr>
            <th class="sortable" data-k="icn" data-t="s">Issue</th>
            <th class="sortable" data-k="ctn" data-t="s">Call type</th>
            <th class="n sortable" data-k="n" data-t="n" data-dir="desc">Calls</th>
            <th class="n sortable" data-k="neg" data-t="n">Neg</th>
          </tr></thead><tbody id="issue-body"></tbody></table>
        </div>
      </div>
      <p class="note" style="margin:16px 0 0" id="issue-foot"></p>
    </div>
  </div>

  <!-- ============ REPS ============ -->
  <div class="panel" id="p-reps">
    <h2>Rep comparison, split by call type</h2>
    <p class="lede">Never one blended score per rep. Read the two tables together: a rep can look calm
      because their mix is easy, not because they are handling hard calls well.</p>
    <div class="gap" id="cov-gap"></div>
    <div class="card">
      <h3>% of scored conversations the AI called negative</h3>
      <p class="note">Cells with fewer than 5 calls are greyed &mdash; too thin to read. Darker = more negative.</p>
      <div id="mx-neg"></div>
    </div>
    <div class="card">
      <h3>Call volume by type</h3>
      <p class="note">The denominator for the table above, and the honest picture of who takes which call.</p>
      <div id="mx-vol"></div>
    </div>
    <div class="card">
      <h3>Workload mix &mdash; read this beside the tables above</h3>
      <p class="note">Each rep&rsquo;s calls split by type. Hover any segment for the share.</p>
      <div id="mixrows"></div>
    </div>
  </div>

  <!-- ============ RECOVERY ============ -->
  <div class="panel" id="p-recov">
    <h2>Did the call end better than it ran?</h2>
    <p class="lede">Your question was &ldquo;if it went bad and then got good&rdquo;. This is the closest
      the current fields can get &mdash; and the gap is worth reading before the numbers.</p>
    <div class="gap">
      <b>This is a proxy, not the metric you asked for.</b> There is no opening-sentiment field.
      <b>Customer Sentiment</b> is the <i>dominant</i> tone across the whole call, explicitly not the
      opening mood. So &ldquo;Recovered&rdquo; below means <i>dominant tone negative, ending positive</i>
      &mdash; not <i>started negative, ended positive</i>.
      <b>Ask Nabeegh for an opening-sentiment field.</b> It is a small change and it is the difference
      between this proxy and the real thing.
    </div>
    <div class="tiles" id="recov-tiles"></div>
    <div class="card">
      <h3>Where negative calls ended up</h3>
      <p class="note">Of the scored conversations the AI called negative overall, this is the tone
        it recorded at the moment the call concluded.</p>
      <div id="recov-bars"></div>
    </div>
    <div class="card">
      <h3>The ending-sentiment field barely moves</h3>
      <p class="note" id="recov-story"></p>
    </div>
    <div class="card">
      <h3>Customer tone vs rep tone</h3>
      <p class="note">Shown separately and never combined. Rep sentiment is scored on voicemails too,
        so it is the one measure that covers the whole call log.</p>
      <div class="split">
        <div><div class="note" style="margin-bottom:10px"><b>Customer &mdash; dominant tone</b></div><div id="sent-cust"></div></div>
        <div><div class="note" style="margin-bottom:10px"><b>Rep tone</b></div><div id="sent-rep"></div></div>
      </div>
    </div>
  </div>

  <!-- ============ DEEP DIVE ============ -->
  <div class="panel" id="p-deep">
    <h2>Deep dive &mdash; what to actually work</h2>
    <p class="lede">Three worklists, all rescoped by the filters above. Every row links to the call
      record, and to the customer where a link exists.</p>

    <div class="fg" id="deepnav" style="margin-bottom:18px;gap:5px">
      <button data-s="risk" aria-pressed="true">Customers at risk</button>
      <button data-s="follow">Follow-up commitments</button>
      <button data-s="review">Flagged for review</button>
    </div>

    <!-- ---- risk ---- -->
    <div class="dsec" id="s-risk">
      <div class="tiles" id="risk-tiles"></div>
      <div class="card">
        <h3>High-risk calls &mdash; the sharpest signal the AI produces</h3>
        <p class="note" id="risk-note"></p>
        <table id="hr-table"><thead><tr>
          <th class="sortable" data-k="d" data-t="s" data-dir="desc">Date</th>
          <th class="sortable" data-k="cname" data-t="s">Customer</th>
          <th class="sortable" data-k="rep" data-t="s">Rep</th>
          <th class="sortable" data-k="ctn" data-t="s">Call type</th>
          <th class="sortable" data-k="icn" data-t="s">Issue</th>
          <th class="sortable" data-k="actn" data-t="s">Action</th>
          <th>Tone</th><th class="n sortable" data-k="conf" data-t="n">Conf</th>
          <th>Open</th>
        </tr></thead><tbody id="hr-body"></tbody></table>
      </div>
      <div class="card">
        <h3>Accounts carrying risk, ranked</h3>
        <p class="note" id="acct-note"></p>
        <div class="gap" id="colink-gap"></div>
        <table id="acct-table"><thead><tr>
          <th class="sortable" data-k="name" data-t="s">Account</th>
          <th class="n sortable" data-k="hi" data-t="n" data-dir="desc">High</th>
          <th class="n sortable" data-k="med" data-t="n">Medium</th>
          <th class="n sortable" data-k="neg" data-t="n">Negative</th>
          <th class="n sortable" data-k="act" data-t="n">Action open</th>
          <th class="sortable" data-k="last" data-t="s">Last call</th>
          <th>Open</th>
        </tr></thead><tbody id="acct-body"></tbody></table>
      </div>
    </div>

    <!-- ---- follow-up ---- -->
    <div class="dsec" id="s-follow" style="display:none">
      <div class="tiles" id="fu-tiles"></div>
      <div class="gap">
        <b>Nothing in NetSuite records whether these were done.</b> Action Required captures that the AI
        heard a commitment on the call. There is no completion field, no owner and no due date, so
        &ldquo;days open&rdquo; below is <b>time since the promise</b>, not time overdue. For now the
        working assumption is that support handled it &mdash; this list is the prompt to confirm, not
        evidence of a miss. <b>Making these trackable is the single biggest upgrade available</b>;
        see the note at the bottom of this section.
      </div>
      <div class="split">
        <div class="card">
          <h3>By action type</h3>
          <p class="note">What the rep committed to. Sales and Support follow-ups dominate; the small
            categories are the expensive ones.</p>
          <div class="legend"><span><i style="background:var(--neg)"></i>On a Medium/High-risk customer</span><span><i style="background:var(--calls)"></i>Standard</span></div>
          <div id="fu-bytype"></div>
        </div>
        <div class="card">
          <h3>By age</h3>
          <p class="note">How long ago the commitment was made, in calendar days.</p>
          <div class="legend"><span><i style="background:var(--neg)"></i>On a Medium/High-risk customer</span><span><i style="background:var(--calls)"></i>Standard</span></div>
          <div id="fu-byage"></div>
        </div>
      </div>
      <div class="card">
        <h3>Action type &times; call type</h3>
        <p class="note">Where the commitments come from. A concentration here tells you which
          conversation reliably ends in a promise. Columns are the six busiest call types; everything
          else is folded into <i>All other types</i>, so each row adds across to its own total.</p>
        <div id="fu-matrix"></div>
      </div>
      <div class="card">
        <h3>The queue</h3>
        <p class="note" id="fu-note"></p>
        <table id="fu-table"><thead><tr>
          <th class="sortable" data-k="d" data-t="s">Date</th>
          <th class="n sortable" data-k="age" data-t="n" data-dir="desc">Days open</th>
          <th class="sortable" data-k="cname" data-t="s">Customer</th>
          <th class="sortable" data-k="rep" data-t="s">Rep</th>
          <th class="sortable" data-k="ctn" data-t="s">Call type</th>
          <th class="sortable" data-k="actn" data-t="s">Action</th>
          <th class="n sortable" data-k="risk" data-t="n">Risk</th>
          <th>Open</th>
        </tr></thead><tbody id="fu-body"></tbody></table>
      </div>
      <div class="card">
        <h3>Making follow-ups trackable</h3>
        <p class="note" id="fu-proposal"></p>
      </div>
    </div>

    <!-- ---- review ---- -->
    <div class="dsec" id="s-review" style="display:none">
      <div class="tiles" id="rev-tiles"></div>
      <div class="gap" id="conf-gap"></div>
      <div class="card">
        <h3>Review queue &mdash; real conversations only</h3>
        <p class="note" id="rev-note"></p>
        <table id="rev-table"><thead><tr>
          <th class="n sortable" data-k="conf" data-t="n" data-dir="asc">Conf</th>
          <th class="sortable" data-k="d" data-t="s">Date</th>
          <th class="sortable" data-k="cname" data-t="s">Customer</th>
          <th class="sortable" data-k="rep" data-t="s">Rep</th>
          <th class="sortable" data-k="ctn" data-t="s">Call type</th>
          <th>Customer</th><th>Ending</th><th>Rep</th>
          <th class="n sortable" data-k="risk" data-t="n">Risk</th>
          <th>Why flagged</th><th>Open</th>
        </tr></thead><tbody id="rev-body"></tbody></table>
      </div>
      <div class="card">
        <h3>Neutral is the biggest single call the AI makes</h3>
        <p class="note" id="neutral-note"></p>
        <div id="neutral-bars"></div>
      </div>
    </div>
  </div>

  <!-- ============ COMBINED ============ -->
  <div class="panel" id="p-comb">
    <h2>Where each rep&rsquo;s effort actually goes</h2>
    <p class="lede">Calls and tickets side by side, as separate bars. There is deliberately no blended
      score and no call-to-ticket exchange rate &mdash; a call and a ticket are not interchangeable units.
      Calls are split inbound / outbound, so you can see what a rep answered versus what they initiated.</p>
    <div class="gap">
      <b>Without call duration this comparison has a hard ceiling.</b> Ten two-minute calls and three
      twenty-minute calls look identical here. Calls log on answer rather than on finish, so the duration
      field is always 0 &mdash; a deliberate trade that makes the customer screen pop work. Until duration
      is recovered from the AWS recordings, read the bars as <i>volume of interactions</i>, never as effort.
    </div>
    <div class="tiles" id="comb-tiles"></div>
    <div class="card">
      <h3>Calls vs tickets, per rep</h3>
      <p class="note">Same scale, never combined. Both bars honour the date filter.</p>
      <div class="legend">
        <span><i style="background:var(--calls)"></i>Inbound calls</span>
        <span><i style="background:var(--callsout)"></i>Outbound calls</span>
        <span><i style="background:var(--nodir)"></i>Direction not recorded</span>
        <span><i style="background:var(--tickets)"></i>Tickets</span>
      </div>
      <div id="comb-bars"></div>
    </div>
    <div class="card">
      <h3>Inbound vs outbound &mdash; who is reaching out</h3>
      <p class="note" id="dir-note"></p>
      <div id="dir-bars"></div>
    </div>
    <div class="card">
      <h3>The split, week by week</h3>
      <p class="note">Calls and tickets each as their own line, both rescoped by every filter.</p>
      <div class="chart" id="comb-trend"></div>
    </div>
    <div class="card">
      <h3>Read this before drawing a conclusion</h3>
      <p class="note" id="comb-story"></p>
    </div>
  </div>

  <p class="foot-note" id="foot"></p>
</div>
<div id="tip"></div>
`;

    // ---- client logic: filters, tiles, charts, tables, deep dive. Reads window DATA.
    const PAGE_APP = String.raw`(function(){
"use strict";
// Roster and the tickets toggle both come from the payload, so this file is
// identical across builds. Change the roster in build.py, never here.
if(DATA.builtAtIso){DATA.builtAt=new Date(DATA.builtAtIso).toLocaleString(undefined,
  {day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"})}
var R={},RO=[];
DATA.roster.forEach(function(p){R[p[0]]=p[1];RO.push(p[0])});
var HAS_TICKETS=!!DATA.hasTickets;
var SENTC=["var(--none)","var(--pos)","var(--neu)","var(--neg)"];
var SENTN=["not scored","Positive","Neutral","Negative"];
var CT=DATA.ct, ICN=DATA.ic, ACTN=DATA.act;
// Live build: "today" is the viewer's local date (never earlier than the newest call),
// the window start and scored-era start come from the Suitelet's config.
var TODAY=(function(){var d=new Date(),l=new Date(d.getTime()-d.getTimezoneOffset()*60000)
  .toISOString().slice(0,10);return DATA.maxDate&&DATA.maxDate>l?DATA.maxDate:l})();
var START=DATA.minDate, SCORED_FROM=DATA.scoredFrom||DATA.minDate;
var NSBASE=(DATA.nsBase!=null)?DATA.nsBase:"https://system.netsuite.com";
var NSCALL=NSBASE+"/app/crm/calendar/call.nl?id=";
var NSCUST=NSBASE+"/app/common/entity/custjob.nl?id=";
var d1=document.getElementById("d1"),d2=document.getElementById("d2"),
    fr=document.getElementById("fr"),ft=document.getElementById("ft"),
    fd=document.getElementById("fd"),fu=document.getElementById("fu");
var SORT={};
d1.value=START; d2.value=TODAY;
d1.min=START; d1.max=TODAY; d2.min=START; d2.max=TODAY;
(function(){
  var y=START.slice(0,4), sameYear=START.slice(5)==="01-01"&&TODAY.slice(0,4)===y;
  document.getElementById("preset-all").textContent=sameYear?("All "+y):"All";
  var names=RO.map(function(k){return R[k]});
  document.getElementById("banner-scope").textContent="every call "+
    (names.length===1?names[0]:("the "+names.length+" reps on this roster"))+
    " took since "+new Date(START+"T00:00:00Z").toLocaleDateString(undefined,{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});
  document.getElementById("asof").innerHTML="Live &middot; "+esc(DATA.builtAt)+
    ' &middot; <a href="javascript:location.reload()">Refresh</a>';
  if(!HAS_TICKETS){var tb=document.querySelector('.tabs button[data-p="comb"]');if(tb)tb.style.display="none"}
})();

// row  : [0 date,1 rep,2 ct,3 dom,4 end,5 rs,6 risk,7 urg,8 act,9 conf,10 ai,11 vm,12 ic,13 dir]
// queue: [0 id,1 d,2 rep,3 ct,4 ic,5 act,6 risk,7 urg,8 dom,9 fin,10 rs,11 conf,12 dir,13 vm,14 cid,15 acct,16 cname]

RO.forEach(function(k){var o=document.createElement("option");o.value=k;o.textContent=R[k];
  document.getElementById("fr").appendChild(o)});
(function(){var c={};DATA.rows.forEach(function(r){if(r[2])c[r[2]]=(c[r[2]]||0)+1});
  Object.keys(c).sort(function(a,b){return c[b]-c[a]}).forEach(function(k){
    var o=document.createElement("option");o.value=k;o.textContent=CT[k];ft.appendChild(o)})})();

function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML}
function pct(a,b){return b?100*a/b:0}
function f1(x){return (Math.round(x*10)/10).toFixed(1)}
function nfmt(n){return (n||0).toLocaleString()}
function days(a,b){return Math.round((new Date(b)-new Date(a))/86400000)}

var tip=document.getElementById("tip");
function bind(el,v,l,meta){
  function on(e){var p=e.touches?e.touches[0]:e;
    tip.innerHTML="";
    var a=document.createElement("span");a.className="tv";a.textContent=v;tip.appendChild(a);
    var b=document.createElement("span");b.className="tl";b.textContent=l;tip.appendChild(b);
    if(meta){var c=document.createElement("div");c.className="tr";c.textContent=meta;tip.appendChild(c)}
    tip.classList.add("on");
    var r=tip.getBoundingClientRect(),x=(p?p.clientX:0)+14,y=(p?p.clientY:0)+14;
    if(x+r.width>innerWidth-10)x=(p?p.clientX:0)-r.width-14;
    if(y+r.height>innerHeight-10)y=(p?p.clientY:0)-r.height-14;
    tip.style.left=Math.max(8,x)+"px";tip.style.top=Math.max(8,y)+"px"}
  el.addEventListener("pointermove",on);el.addEventListener("pointerenter",on);
  el.addEventListener("focus",function(){var r=el.getBoundingClientRect();
    on({clientX:r.left+r.width/2,clientY:r.top})});
  el.addEventListener("pointerleave",function(){tip.classList.remove("on")});
  el.addEventListener("blur",function(){tip.classList.remove("on")});
}

/* ---- one filter definition, applied to every dataset ------------------- */
function F(){return {a:d1.value,b:d2.value,r:fr.value,t:ft.value,dir:fd.value,u:fu.value}}
function slice(){var f=F();
  return DATA.rows.filter(function(x){
    if(f.a&&x[0]<f.a)return false; if(f.b&&x[0]>f.b)return false;
    if(f.r&&x[1]!==f.r)return false; if(f.t&&String(x[2])!==f.t)return false;
    if(f.dir&&String(x[13])!==f.dir)return false;
    if(f.u&&String(x[7])!==f.u)return false; return true})}
function qslice(){var f=F();
  return DATA.queue.filter(function(x){
    if(f.a&&x[1]<f.a)return false; if(f.b&&x[1]>f.b)return false;
    if(f.r&&x[2]!==f.r)return false; if(f.t&&String(x[3])!==f.t)return false;
    if(f.dir&&String(x[12])!==f.dir)return false;
    if(f.u&&String(x[7])!==f.u)return false; return true})}
// tickets carry no call type / direction / urgency, so only date + rep can apply.
// When a call-level filter is on, tickets are not comparable and are reported as such.
function tslice(){var f=F();
  return DATA.tickets.filter(function(x){
    if(f.a&&x[0]<f.a)return false; if(f.b&&x[0]>f.b)return false;
    if(f.r&&x[1]!==f.r)return false; return true})}
function ticketsComparable(){var f=F();return HAS_TICKETS&&!(f.t||f.dir||f.u)}
function conv(rows){return rows.filter(function(x){return x[10]&&!x[11]})}

/* ---- shared components ------------------------------------------------ */
function stack(mount,items,total,fmtLab){
  var el=typeof mount==="string"?document.getElementById(mount):mount;
  el.innerHTML="";
  if(!total){el.innerHTML='<div class="empty">Nothing in this selection.</div>';return}
  items.forEach(function(it){
    var row=document.createElement("div");row.className="hbar";
    var nm=document.createElement("div");nm.className="name";nm.textContent=it.name;
    var tr=document.createElement("div");tr.className="track";
    var segs=it.segs.filter(function(s){return s.v>0});
    if(!segs.length){var em=document.createElement("span");em.className="dlabel out";
      em.style.left="6px";em.style.color="var(--faint)";em.textContent="none";tr.appendChild(em)}
    segs.forEach(function(s){
      var f=document.createElement("div");f.className="fill";
      f.style.flex=s.v; f.style.background=s.c;
      if(s.pad){f.style.background="transparent";tr.appendChild(f);return}
      f.setAttribute("tabindex","0");f.setAttribute("role","img");
      f.setAttribute("aria-label",s.l+" "+s.v+" for "+it.name);
      bind(f,nfmt(s.v)+(it.den?" · "+f1(pct(s.v,it.den))+"%":""),s.l+" — "+it.name,s.meta||"");
      tr.appendChild(f)});
    var lb=document.createElement("span");lb.className="dlabel out";
    lb.textContent=fmtLab?fmtLab(it):nfmt(it.den||0);
    tr.appendChild(lb);
    row.appendChild(nm);row.appendChild(tr);el.appendChild(row);
  });
}
function tiles(mount,list){
  var th=document.getElementById(mount);th.innerHTML="";
  list.forEach(function(t){
    var d=document.createElement("div");d.className="tile";
    var l=document.createElement("div");l.className="lab";
    var ls=document.createElement("span");ls.innerHTML=t.l;l.appendChild(ls);
    if(t.p){var pp=document.createElement("span");pp.className="pill "+t.p[0];pp.innerHTML=t.p[1];l.appendChild(pp)}
    var v=document.createElement("div");v.className="val";v.innerHTML=t.v;
    var f=document.createElement("div");f.className="foot";f.innerHTML=t.f;
    d.appendChild(l);d.appendChild(v);d.appendChild(f);
    if(t.tip){v.setAttribute("tabindex","0");bind(v,t.tip[0],t.tip[1],t.tip[2])}
    th.appendChild(d)})
}
function sortTable(tid,data,defK,defT,defDir){
  var st=SORT[tid];
  if(!st){var th0=document.querySelector("#"+tid+" th[data-dir]");
    st=SORT[tid]={k:th0?th0.dataset.k:defK,dir:th0?th0.dataset.dir:(defDir||"desc"),
                  t:th0?th0.dataset.t:(defT||"n")}}
  var d=data.slice().sort(function(a,b){
    var x=a[st.k],y=b[st.k],r;
    if(st.t==="n"){r=(x||0)-(y||0)}else{r=String(x==null?"":x).localeCompare(String(y==null?"":y))}
    return st.dir==="desc"?-r:r});
  var tbl=document.getElementById(tid);
  Array.prototype.forEach.call(tbl.querySelectorAll("th.sortable"),function(th){
    if(th.dataset.k===st.k)th.setAttribute("data-dir",st.dir);else th.removeAttribute("data-dir");
    if(!th._w){th._w=1;th.setAttribute("tabindex","0");
      var go=function(){SORT[tid]={k:th.dataset.k,t:th.dataset.t||"s",
        dir:(SORT[tid].k===th.dataset.k&&SORT[tid].dir==="asc")?"desc":"asc"};render()};
      th.addEventListener("click",go);
      th.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}})}});
  return d;
}
function riskFlag(v){
  if(v===3)return '<span class="flag">High</span>';
  if(v===2)return '<span class="flag wa">Medium</span>';
  if(v===1)return '<span class="muted">Low</span>';
  return '<span class="muted">&mdash;</span>'}
function sentDot(v){return '<span class="dot" style="background:'+SENTC[v]+'"></span>'+
  '<span style="font-variant-numeric:normal">'+SENTN[v]+'</span>'}
function callLink(id){return '<a href="'+NSCALL+id+'" target="_blank" rel="noopener">call &#8599;</a>'}
function custCell(q){
  if(q[14]&&q[16])return '<a href="'+NSCUST+q[14]+'" target="_blank" rel="noopener">'+esc(q[16])+'</a>'+
    ' <span class="muted" style="font-size:11px">'+esc(q[15])+'</span>';
  if(q[14])return '<a href="'+NSCUST+q[14]+'" target="_blank" rel="noopener">'+esc(q[15]||("id "+q[14]))+'</a>';
  return '<span class="muted">no customer linked</span>'}

/* ---- charts ----------------------------------------------------------- */
function weeksOf(rows){
  var by={};
  rows.forEach(function(x){
    var d=new Date(x[0]+"T00:00:00Z"),day=(d.getUTCDay()+6)%7;
    d.setUTCDate(d.getUTCDate()-day);
    var k=d.toISOString().slice(0,10);
    if(!by[k])by[k]={k:k,n:0,pos:0,neu:0,neg:0,vm:0,un:0};
    var b=by[k];b.n++;
    if(!x[10])b.un++; else if(x[11])b.vm++;
    else if(x[3]===1)b.pos++; else if(x[3]===2)b.neu++; else if(x[3]===3)b.neg++});
  return Object.keys(by).sort().map(function(k){return by[k]})}
function mondayOf(ds){var d=new Date(ds+"T00:00:00Z"),day=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10)}

function drawTrend(mount,ws){
  var el=document.getElementById(mount);el.innerHTML="";
  if(!ws.length){el.innerHTML='<div class="empty">Nothing in this selection.</div>';return}
  var W=1080,H=250,PL=44,PR=44,PT=14,PB=34,iw=W-PL-PR,ih=H-PT-PB;
  var max=0;ws.forEach(function(w){max=Math.max(max,w.n)});max=max*1.12||1;
  var bw=iw/ws.length, gap=Math.min(4,bw*0.18);
  var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Weekly call volume by tone">';
  [0,.25,.5,.75,1].forEach(function(t){var y=PT+ih-ih*t;
    svg+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+y+'" y2="'+y+'" stroke="#E1E7EC"/>'+
      '<text x="'+(PL-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="10" fill="#98A3AE">'+
      Math.round(max*t)+'</text>'});
  ws.forEach(function(w,i){
    var x=PL+i*bw+gap/2, ww=bw-gap, y=PT+ih;
    [["un",w.un,"var(--none)"],["vm",w.vm,"var(--vm)"],["neg",w.neg,"var(--neg)"],
     ["neu",w.neu,"var(--neu)"],["pos",w.pos,"var(--pos)"]].forEach(function(s){
      if(!s[1])return; var h=s[1]/max*ih; y-=h;
      svg+='<rect x="'+x+'" y="'+y+'" width="'+ww+'" height="'+h+'" fill="'+s[2]+'"/>'})});
  var pts=[];
  ws.forEach(function(w,i){var den=w.pos+w.neu+w.neg,p=den?w.neg/den:0;
    pts.push([PL+i*bw+bw/2, PT+ih-p*ih/0.30])});
  svg+='<path d="'+pts.map(function(p,i){return (i?"L":"M")+p[0].toFixed(1)+" "+
    Math.max(PT,p[1]).toFixed(1)}).join(" ")+'" fill="none" stroke="#101418" stroke-width="1.8"/>';
  [0,.1,.2,.3].forEach(function(t){var y=PT+ih-(t/0.30)*ih;
    svg+='<text x="'+(W-PR+8)+'" y="'+(y+4)+'" font-size="10" fill="#98A3AE">'+Math.round(t*100)+'%</text>'});
  ws.forEach(function(w,i){if(i%4)return;
    svg+='<text x="'+(PL+i*bw+bw/2)+'" y="'+(H-12)+'" text-anchor="middle" font-size="10" fill="#98A3AE">'+
      w.k.slice(5)+'</text>'});
  el.innerHTML=svg+'</svg>';
  var g=el.querySelector("svg");
  ws.forEach(function(w,i){
    var den=w.pos+w.neu+w.neg;
    var r=document.createElementNS("http://www.w3.org/2000/svg","rect");
    r.setAttribute("x",PL+i*bw);r.setAttribute("y",PT);r.setAttribute("width",bw);
    r.setAttribute("height",ih);r.setAttribute("fill","transparent");r.setAttribute("tabindex","0");
    bind(r,nfmt(w.n)+" calls","Week of "+w.k,
      den?(w.neg+" negative of "+den+" scored ("+f1(pct(w.neg,den))+"%) · "+w.vm+" voicemail · "+w.un+" not scored")
         :(w.vm+" voicemail · "+w.un+" not scored by AI"));
    g.appendChild(r)})}

function drawComboTrend(rows,ticks){
  var el=document.getElementById("comb-trend");el.innerHTML="";
  var cw={},tw={};
  rows.forEach(function(x){var k=mondayOf(x[0]);cw[k]=(cw[k]||0)+1});
  ticks.forEach(function(x){var k=mondayOf(x[0]);tw[k]=(tw[k]||0)+x[2]});
  var keys={};Object.keys(cw).forEach(function(k){keys[k]=1});Object.keys(tw).forEach(function(k){keys[k]=1});
  var ks=Object.keys(keys).sort();
  if(!ks.length){el.innerHTML='<div class="empty">Nothing in this selection.</div>';return}
  var W=1080,H=240,PL=44,PR=16,PT=14,PB=34,iw=W-PL-PR,ih=H-PT-PB;
  var max=0;ks.forEach(function(k){max=Math.max(max,cw[k]||0,tw[k]||0)});max=max*1.12||1;
  var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Weekly calls and tickets">';
  [0,.25,.5,.75,1].forEach(function(t){var y=PT+ih-ih*t;
    svg+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+y+'" y2="'+y+'" stroke="#E1E7EC"/>'+
      '<text x="'+(PL-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="10" fill="#98A3AE">'+
      Math.round(max*t)+'</text>'});
  function line(src,color){svg+='<path d="'+ks.map(function(k,i){
      var x=PL+(ks.length>1?i/(ks.length-1):0.5)*iw,y=PT+ih-(src[k]||0)/max*ih;
      return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1)}).join(" ")+
      '" fill="none" stroke="'+color+'" stroke-width="2"/>'}
  line(cw,"#0F5F63"); if(ticketsComparable())line(tw,"#eb6834");
  ks.forEach(function(k,i){if(i%4)return;
    var x=PL+(ks.length>1?i/(ks.length-1):0.5)*iw;
    svg+='<text x="'+x+'" y="'+(H-12)+'" text-anchor="middle" font-size="10" fill="#98A3AE">'+
      k.slice(5)+'</text>'});
  el.innerHTML=svg+'</svg>';
  var g=el.querySelector("svg");
  ks.forEach(function(k,i){
    var x=PL+(ks.length>1?i/(ks.length-1):0.5)*iw;
    var r=document.createElementNS("http://www.w3.org/2000/svg","rect");
    r.setAttribute("x",x-iw/ks.length/2);r.setAttribute("y",PT);
    r.setAttribute("width",iw/ks.length);r.setAttribute("height",ih);
    r.setAttribute("fill","transparent");r.setAttribute("tabindex","0");
    bind(r,(cw[k]||0)+" calls","Week of "+k,
      ticketsComparable()?((tw[k]||0)+" tickets opened"):"tickets hidden — a call-level filter is on");
    g.appendChild(r)})}

/* ====================== RENDER ======================================== */
function render(){
  var rows=slice(), q=qslice(), ticks=tslice();
  var cv=conv(rows), scored=rows.filter(function(x){return x[10]});
  var neg=cv.filter(function(x){return x[3]===3}).length;
  var pos=cv.filter(function(x){return x[3]===1}).length;
  var neu=cv.filter(function(x){return x[3]===2}).length;
  var vm=rows.filter(function(x){return x[11]}).length;
  var un=rows.length-scored.length;
  var lowconf=scored.filter(function(x){return x[9]>=0&&x[9]<=80});
  var lowconfConv=lowconf.filter(function(x){return !x[11]});
  var risk2=scored.filter(function(x){return x[6]>=2}).length;
  var risk3=scored.filter(function(x){return x[6]===3}).length;
  var actOpen=scored.filter(function(x){return x[8]>=1&&x[8]<=5}).length;
  var negAll=scored.filter(function(x){return x[3]===3}).length;
  var repNeg=scored.filter(function(x){return x[5]===3}).length;
  var det=scored.filter(function(x){return (x[3]===1||x[3]===2)&&x[4]===3}).length;
  var rec=scored.filter(function(x){return x[3]===3&&x[4]===1}).length;
  var par=scored.filter(function(x){return x[3]===3&&x[4]===2}).length;
  var flagged=scored.filter(function(x){return !x[11]&&
    ((x[9]>=0&&x[9]<=80)||x[3]===3||x[5]===3||((x[3]===1||x[3]===2)&&x[4]===3))});

  document.getElementById("scope").textContent=nfmt(rows.length)+" calls in view";

  /* -------- PULSE -------- */
  tiles("pulse-tiles",[
    {l:"Calls logged",v:nfmt(rows.length),
     f:nfmt(cv.length)+" scored conversations, "+nfmt(vm)+" voicemail / no-answer, "+nfmt(un)+" not scored.",
     tip:[nfmt(rows.length)+" calls","Every call these reps took","Not filtered to Department = Support"]},
    {l:"AI coverage",v:f1(pct(scored.length,rows.length))+"%",
     f:nfmt(un)+" calls carry no AI scoring at all. A rep with no coverage looks flawless.",
     p:pct(scored.length,rows.length)>=90?["ok","Good"]:["wa","Watch"],
     tip:[nfmt(scored.length)+" of "+nfmt(rows.length),"Calls scored by the AI","Scoring only started late February 2026"]},
    {l:"Negative",v:f1(pct(neg,cv.length))+"%",
     f:nfmt(neg)+" of "+nfmt(cv.length)+" scored conversations. The aim is none. Voicemails excluded &mdash; they carry no tone.",
     p:neg?["wa","Target zero"]:["ok","Zero"],
     tip:[nfmt(neg)+" calls","Dominant tone negative","Concentrated in Product Complaint and Shipping Issue"]},
    {l:"Customers at risk",v:nfmt(risk2),
     f:"<b>"+nfmt(risk3)+" High</b> and "+nfmt(risk2-risk3)+" Medium. Worked on the Deep dive tab.",
     p:risk3?["cr",nfmt(risk3)+" High"]:["ok","None high"],
     tip:[nfmt(risk2)+" calls","Customer risk Medium or High","Queued by account on the Deep dive tab"]},
    {l:"Follow-ups open",v:nfmt(actOpen),
     f:"Commitments the AI heard on a call. <b>No completion tracking exists</b> &mdash; prompts, not overdue items.",
     p:["nu","No tracking"],
     tip:[nfmt(actOpen)+" items","Action Required other than None","Nothing records whether it was done"]},
    {l:"Flagged for review",v:nfmt(flagged.length),
     f:"Confidence &le;80 or any negative, <b>voicemails excluded</b> &mdash; "+
       nfmt(lowconf.length-lowconfConv.length)+" silent calls were filtered out.",
     p:["wa","Threshold 80"],
     tip:[nfmt(flagged.length)+" conversations","Flagged for human review","Silent calls can never score and are excluded"]}
  ]);
  drawTrend("trend",weeksOf(rows));

  /* -------- type aggregates -------- */
  var types={};
  cv.forEach(function(x){
    var k=x[2];if(!types[k])types[k]={k:k,name:CT[k]||"(unscored)",n:0,neg:0,pos:0,neu:0,
      risk:0,act:0,lowconf:0,inb:0,outb:0};
    var t=types[k];t.n++;
    if(x[3]===1)t.pos++;else if(x[3]===2)t.neu++;else if(x[3]===3)t.neg++;
    if(x[6]>=2)t.risk++; if(x[8]>=1&&x[8]<=5)t.act++; if(x[9]>=0&&x[9]<=80)t.lowconf++;
    if(x[13]===1)t.inb++; else if(x[13]===2)t.outb++});
  var tl=Object.keys(types).map(function(k){var t=types[k];
    t.pneg=pct(t.neg,t.n);t.ppos=pct(t.pos,t.n);return t});
  var worst=tl.filter(function(t){return t.n>=20}).sort(function(a,b){return b.pneg-a.pneg})[0];
  var biggest=tl.slice().sort(function(a,b){return b.neg-a.neg})[0];

  var spread="";
  if(worst){
    var per=RO.map(function(r){
      var v=cv.filter(function(x){return x[1]===r&&x[2]===worst.k});
      return v.length>=5?{r:r,p:pct(v.filter(function(x){return x[3]===3}).length,v.length)}:null})
      .filter(Boolean);
    if(per.length>=2){
      var lo=Math.min.apply(null,per.map(function(x){return x.p})),
          hi=Math.max.apply(null,per.map(function(x){return x.p}));
      spread=(hi-lo<=10)
        ? " And it is <b>not one person</b> &mdash; every rep with enough volume lands between <b>"+f1(lo)+
          "%</b> and <b>"+f1(hi)+"%</b> on that type. When three people independently hit the same number, "+
          "you are looking at the product or the process, not at coaching."
        : " And it is <b>uneven between reps</b> &mdash; from "+f1(lo)+"% to "+f1(hi)+"% on that same type, "+
          "which is a coaching conversation rather than a process one. The Reps &times; call type tab shows who."}}
  document.getElementById("pulse-story").innerHTML = !cv.length ?
    "No scored conversations in this selection." :
    "Tone is not evenly spread, and that is the whole point. <b>"+esc(worst?worst.name:"—")+"</b> runs at <b>"+
    (worst?f1(worst.pneg):"0")+"% negative</b> against <b>"+f1(pct(neg,cv.length))+
    "%</b> across every call type &mdash; that is the job going wrong, not the team."+spread+
    " In raw numbers the largest single source of negative calls is <b>"+esc(biggest?biggest.name:"—")+
    "</b> at <b>"+(biggest?nfmt(biggest.neg):"0")+"</b> calls, because the volume is so much higher. "+
    "Fixing the first is a process problem; fixing the second is a volume problem.<br><br>"+
    "Two things to keep in mind before acting. <b>"+nfmt(un)+" calls carry no AI scoring</b>, almost all "+
    "from before scoring switched on in late February &mdash; so trends reaching into January measure "+
    "coverage, not behaviour. And <b>call duration does not exist</b>, so nothing here can tell you "+
    "whether a rep took three long calls or ten short ones.";

  /* -------- BY CALL TYPE -------- */
  stack("type-bars", tl.slice().sort(function(a,b){return b.n-a.n}).map(function(t){
    return {name:t.name,den:t.n,segs:[{v:t.pos,c:"var(--pos)",l:"Positive"},
      {v:t.neu,c:"var(--neu)",l:"Neutral"},{v:t.neg,c:"var(--neg)",l:"Negative"}]}}),
    tl.length,function(it){return nfmt(it.den)});

  var tb=document.getElementById("type-body");tb.innerHTML="";
  if(!tl.length)tb.innerHTML='<tr><td colspan="9" class="empty">Nothing in this selection.</td></tr>';
  sortTable("type-table",tl,"n").forEach(function(t){
    var tr=document.createElement("tr");
    tr.style.cursor="pointer";
    tr.innerHTML='<td class="lbl">'+esc(t.name)+'</td><td class="n">'+nfmt(t.n)+'</td>'+
      '<td class="n">'+nfmt(t.inb)+'</td><td class="n">'+nfmt(t.outb)+'</td>'+
      '<td class="n">'+(t.pneg>=10?'<b style="color:var(--crit)">':'')+f1(t.pneg)+'%'+(t.pneg>=10?'</b>':'')+'</td>'+
      '<td class="n">'+f1(t.ppos)+'%</td><td class="n">'+nfmt(t.risk)+'</td>'+
      '<td class="n">'+nfmt(t.act)+'</td><td class="n">'+nfmt(t.lowconf)+'</td>';
    tr.addEventListener("click",function(){ft.value=String(t.k);render()});
    tb.appendChild(tr)});

  /* -------- issue-category drill: computed live from the filtered rows -------- */
  var withIssue=cv.filter(function(x){return x[12]&&x[12]!==12});
  var icAgg={},pairAgg={};
  withIssue.forEach(function(x){
    if(!icAgg[x[12]])icAgg[x[12]]={k:x[12],name:ICN[x[12]]||"?",n:0,neg:0};
    icAgg[x[12]].n++; if(x[3]===3)icAgg[x[12]].neg++;
    var pk=x[12]+"|"+x[2];
    if(!pairAgg[pk])pairAgg[pk]={icn:ICN[x[12]]||"?",ctn:CT[x[2]]||"(unscored)",n:0,neg:0};
    pairAgg[pk].n++; if(x[3]===3)pairAgg[pk].neg++});
  var icList=Object.keys(icAgg).map(function(k){return icAgg[k]}).sort(function(a,b){return b.n-a.n});
  var pairList=Object.keys(pairAgg).map(function(k){return pairAgg[k]});
  document.getElementById("issue-note").innerHTML =
    "Issue category only fires when the AI hears a concrete problem, so it is blank on most calls by design. "+
    "In this selection <b>"+nfmt(withIssue.length)+"</b> of "+nfmt(cv.length)+
    " scored conversations carry one. Both panels below rescope with every filter.";
  stack("issue-bars",icList.map(function(i){
    return {name:i.name,den:i.n,segs:[{v:i.neg,c:"var(--neg)",l:"Negative tone"},
      {v:i.n-i.neg,c:"var(--neu)",l:"Neutral or positive"}]}}),
    icList.length,function(it){return nfmt(it.den)});
  var ib=document.getElementById("issue-body");ib.innerHTML="";
  if(!pairList.length)ib.innerHTML='<tr><td colspan="4" class="empty">No issue categories in this selection.</td></tr>';
  sortTable("issue-table",pairList,"n").forEach(function(p){
    var tr=document.createElement("tr");
    tr.innerHTML='<td class="lbl"><b>'+esc(p.icn)+'</b></td><td class="lbl">'+esc(p.ctn)+'</td>'+
      '<td class="n">'+nfmt(p.n)+'</td>'+
      '<td class="n">'+(p.neg?'<b style="color:var(--crit)">'+p.neg+'</b>':'<span class="muted">0</span>')+'</td>';
    ib.appendChild(tr)});
  var topIC=icList[0];
  document.getElementById("issue-foot").innerHTML = !icList.length ? "" :
    "The most common concrete problem in this selection is <b>"+esc(topIC.name)+"</b> at <b>"+nfmt(topIC.n)+
    "</b> calls"+(topIC.neg?", of which <b>"+nfmt(topIC.neg)+"</b> the AI scored negative":"")+
    ". This is the layer worth taking to production &mdash; it names the defect, not just the mood.";

  /* -------- REPS -------- */
  var reps=fr.value?[fr.value]:RO;
  var byVol=tl.slice().sort(function(a,b){return b.n-a.n});
  var byNeg=tl.slice().filter(function(t){return t.neg>0}).sort(function(a,b){return b.neg-a.neg});
  var pick={};byVol.slice(0,5).forEach(function(t){pick[t.k]=1});
  byNeg.slice(0,5).forEach(function(t){pick[t.k]=1});
  var tset=ft.value?[Number(ft.value)]:byVol.filter(function(t){return pick[t.k]}).slice(0,8)
    .map(function(t){return t.k});
  function matrix(mount,valFn,fmt,heat){
    var el=document.getElementById(mount);
    var h='<table><thead><tr><th>Rep</th>';
    tset.forEach(function(k){h+='<th class="n">'+esc(CT[k]||"?")+'</th>'});
    h+='<th class="n">All types</th></tr></thead><tbody>';
    var colMax={};tset.forEach(function(k){var m=0;reps.forEach(function(r){
      var v=cv.filter(function(x){return x[1]===r&&x[2]===k});
      if(v.length>=5)m=Math.max(m,valFn(v))});colMax[k]=m});
    reps.forEach(function(r){
      h+='<tr><td class="lbl">'+esc(R[r])+'</td>';
      tset.forEach(function(k){
        var v=cv.filter(function(x){return x[1]===r&&x[2]===k});
        if(!v.length){h+='<td class="n muted">&mdash;</td>';return}
        var val=valFn(v),weak=v.length<5,bg="transparent";
        if(heat&&!weak&&colMax[k])bg="rgba(208,59,59,"+(0.03+Math.min(1,val/colMax[k])*0.19).toFixed(3)+")";
        h+='<td class="n"><span class="cell" style="background:'+bg+(weak?';color:var(--faint)':'')+'">'+
           fmt(val,v)+'</span></td>'});
      var all=cv.filter(function(x){return x[1]===r});
      h+='<td class="n"><b>'+(all.length?fmt(valFn(all),all):"&mdash;")+'</b></td></tr>'});
    el.innerHTML=h+'</tbody></table>'}
  matrix("mx-neg",function(v){return pct(v.filter(function(x){return x[3]===3}).length,v.length)},
    function(val){return f1(val)+"%"},true);
  matrix("mx-vol",function(v){return v.length},function(val){return nfmt(val)},false);
  document.getElementById("cov-gap").innerHTML =
    "<b>Check AI coverage before you compare anyone.</b> A rep whose calls were never scored shows no "+
    "negatives at all, which reads as flawless. Coverage in this selection: "+
    reps.map(function(r){var all=rows.filter(function(x){return x[1]===r});
      var sc=all.filter(function(x){return x[10]}).length;
      return R[r]+" <b>"+f1(pct(sc,all.length))+"%</b> ("+nfmt(sc)+"/"+nfmt(all.length)+")"}).join(" &middot; ")+
    "."+(function(){var nw=RO.filter(function(r){return !DATA.rows.some(function(x){return x[1]===r})});
      return nw.length?(" "+nw.map(function(r){return esc(R[r])}).join(", ")+(nw.length>1?" have":" has")+
        " no calls logged yet &mdash; kept on the roster with an honest empty state rather than hidden, "+
        "and fills in on its own as activity is logged."):""})();
  var mr=document.getElementById("mixrows");mr.innerHTML="";
  var PALETTE=["#0F5F63","#2a78d6","#eb6834","#1baf7a","#eda100","#8C93C8","#d03b3b","#6E7A87","#5B8C5A","#A8577E"];
  reps.forEach(function(r){
    var sub=cv.filter(function(x){return x[1]===r});
    var row=document.createElement("div");row.className="hbar narrow";
    var nm=document.createElement("div");nm.className="name";nm.textContent=R[r];
    var tr=document.createElement("div");tr.className="track";tr.style.background="transparent";
    if(!sub.length)tr.innerHTML='<span class="muted" style="font-size:12px">no scored calls yet</span>';
    byVol.forEach(function(t,i){
      var n=sub.filter(function(x){return x[2]===t.k}).length;if(!n)return;
      var seg=document.createElement("div");
      seg.style.cssText="height:100%;border-radius:4px;background:"+PALETTE[i%PALETTE.length]+";flex:"+n;
      seg.setAttribute("tabindex","0");seg.setAttribute("aria-label",t.name+" "+n+" calls for "+R[r]);
      bind(seg,n+" calls",t.name+" — "+R[r],f1(pct(n,sub.length))+"% of their scored calls");
      tr.appendChild(seg)});
    row.appendChild(nm);row.appendChild(tr);mr.appendChild(row)});

  /* -------- RECOVERY -------- */
  tiles("recov-tiles",[
    {l:"Negative calls",v:nfmt(negAll),f:"Dominant tone negative, across "+nfmt(scored.length)+" scored calls.",
     tip:[nfmt(negAll),"Dominant tone negative","The pool the bands below split"]},
    {l:"Recovered",v:nfmt(rec),f:"Negative overall, <b>ended positive</b>. The band you asked for &mdash; via a proxy.",
     p:rec?["ok","Proxy"]:["nu","Proxy"],tip:[nfmt(rec)+" calls","Dominant negative, ending positive",""]},
    {l:"Partial",v:nfmt(par),f:"Negative overall, <b>ended neutral</b>. Most resolved calls simply end neutral.",
     p:["nu","Softer signal"],tip:[nfmt(par)+" calls","Dominant negative, ending neutral",""]},
    {l:"Deteriorated",v:nfmt(det),f:"Positive or neutral overall, <b>ended negative</b>. The one to surface loudest.",
     p:det?["cr","Surface these"]:["ok","None"],tip:[nfmt(det)+" calls","Ended worse than it ran",""]}
  ]);
  stack("recov-bars",[{name:"Negative calls",den:negAll,segs:[
    {v:rec,c:"var(--pos)",l:"Ended positive (Recovered)"},
    {v:par,c:"var(--neu)",l:"Ended neutral (Partial)"},
    {v:negAll-rec-par,c:"var(--neg)",l:"Still negative at the end"}]}],
    negAll,function(it){return nfmt(it.den)});
  var endNeg=scored.filter(function(x){return x[4]===3}).length;
  document.getElementById("recov-story").innerHTML =
    "Across <b>"+nfmt(scored.length)+"</b> scored calls in this selection, the AI recorded a "+
    "<b>negative ending on "+nfmt(endNeg)+"</b> of them. That is the whole reason &ldquo;Deteriorated&rdquo; "+
    "reads "+nfmt(det)+" &mdash; not because calls never go wrong, but because the ending-sentiment field "+
    "almost never fires negative. Of the "+nfmt(negAll)+" calls the AI called negative overall, <b>"+
    nfmt(par)+" end neutral</b> and only "+nfmt(rec)+" end positive.<br><br>"+
    "Read that as a measurement finding, not a performance one. <b>Recovery cannot be measured properly "+
    "from these two fields.</b> An opening-sentiment field would fix it outright, and Nabeegh has said it "+
    "is a small change &mdash; it is the single highest-value ask on this dashboard.";
  function sentSplit(mount,idx,pool){
    stack(mount,[1,2,3].map(function(v){
      var n=pool.filter(function(x){return x[idx]===v}).length;
      return {name:SENTN[v],den:pool.length,n:n,
        segs:[{v:n,c:SENTC[v],l:SENTN[v]},{v:pool.length-n,pad:true}]}}),
      pool.length,function(it){return nfmt(it.n)+"  ("+f1(pct(it.n,it.den))+"%)"})}
  sentSplit("sent-cust",3,cv); sentSplit("sent-rep",5,scored);

  /* ================= DEEP DIVE ================= */
  /* ---- customers at risk ---- */
  var hr=q.filter(function(x){return x[6]===3}).map(function(x){
    return {q:x,d:x[1],rep:R[x[2]],ctn:CT[x[3]]||"(unscored)",icn:(x[4]&&x[4]!==12)?(ICN[x[4]]||"?"):"—",
            actn:ACTN[x[5]]||"None",conf:x[11],cname:x[16]||x[15]||"zzz",dom:x[8],fin:x[9],rs:x[10]}});
  var accs={};
  q.filter(function(x){return x[6]>=2}).forEach(function(x){
    var key=x[15]||"(none)";
    if(!accs[key])accs[key]={key:key,name:x[16]||x[15]||"No customer linked",code:x[15]||"",
      cid:x[14]||0,hi:0,med:0,neg:0,act:0,last:""};
    var a=accs[key];
    if(x[6]===3)a.hi++; else a.med++;
    if(x[8]===3)a.neg++;
    if(x[5]>=1&&x[5]<=5)a.act++;
    if(x[1]>a.last)a.last=x[1]});
  var accList=Object.keys(accs).map(function(k){return accs[k]});
  var linked=q.filter(function(x){return x[6]>=2&&x[14]}).length,
      unlinked=q.filter(function(x){return x[6]>=2&&!x[14]}).length;
  tiles("risk-tiles",[
    {l:"High-risk calls",v:nfmt(risk3),f:"The sharpest relationship signal the AI produces. Every one is listed below.",
     p:risk3?["cr","Work these"]:["ok","Clear"],tip:[nfmt(risk3),"Customer risk High",""]},
    {l:"Medium-risk calls",v:nfmt(risk2-risk3),f:"Slower-moving. Watch for an account appearing repeatedly.",
     p:["wa","Watch"],tip:[nfmt(risk2-risk3),"Customer risk Medium",""]},
    {l:"Accounts involved",v:nfmt(accList.filter(function(a){return a.code}).length),
     f:"Distinct customers with at least one Medium or High risk call in this selection.",
     tip:[nfmt(accList.length),"Accounts carrying risk",""]},
    {l:"Risk calls with no customer",v:nfmt(unlinked),
     f:"Of "+nfmt(linked+unlinked)+" risk calls. These can never reach an account queue.",
     p:unlinked?["wa","Blind spot"]:["ok","All linked"],
     tip:[nfmt(unlinked),"Risk calls with no customer record","A structural gap, not missing work"]}
  ]);
  document.getElementById("risk-note").innerHTML =
    "All <b>"+nfmt(hr.length)+"</b> High-risk calls in this selection, newest first. "+
    "Customer opens the NetSuite account; Call opens the record with the subject, summary and recording.";
  var hb=document.getElementById("hr-body");hb.innerHTML="";
  if(!hr.length)hb.innerHTML='<tr><td colspan="9" class="empty">No High-risk calls in this selection.</td></tr>';
  sortTable("hr-table",hr,"d","s","desc").forEach(function(r){
    var tr=document.createElement("tr");
    tr.innerHTML='<td class="lbl muted">'+r.d+'</td><td class="lbl">'+custCell(r.q)+'</td>'+
      '<td class="lbl">'+esc(r.rep)+'</td><td class="lbl">'+esc(r.ctn)+'</td>'+
      '<td class="lbl">'+esc(r.icn)+'</td><td class="lbl">'+esc(r.actn)+'</td>'+
      '<td class="lbl" style="white-space:nowrap">'+sentDot(r.dom)+' <span class="muted">&rarr;</span> '+sentDot(r.fin)+'</td>'+
      '<td class="n">'+(r.conf<0?"&mdash;":r.conf)+'</td><td>'+callLink(r.q[0])+'</td>';
    hb.appendChild(tr)});
  document.getElementById("acct-note").innerHTML =
    "Every account with a Medium or High risk call in this selection &mdash; <b>"+nfmt(accList.length)+
    "</b> in total, ranked High first. An account appearing here repeatedly matters more than any single call.";
  document.getElementById("colink-gap").innerHTML =
    "<b>Only calls with a customer record can be rolled up by account.</b> "+nfmt(unlinked)+" of "+
    nfmt(linked+unlinked)+" risk calls in this selection have no customer attached, and are grouped as "+
    "&ldquo;No customer linked&rdquo; below. Worth raising with Nabeegh alongside the opening-sentiment field.";
  var ab=document.getElementById("acct-body");ab.innerHTML="";
  if(!accList.length)ab.innerHTML='<tr><td colspan="7" class="empty">Nothing in this selection.</td></tr>';
  var accShown=sortTable("acct-table",accList,"hi").slice(0,50);
  accShown.forEach(function(a){
    var tr=document.createElement("tr");
    tr.innerHTML='<td class="lbl">'+(a.cid?'<a href="'+NSCUST+a.cid+'" target="_blank" rel="noopener">'+
        esc(a.name)+'</a> <span class="muted" style="font-size:11px">'+esc(a.code)+'</span>'
        :'<span class="muted">'+esc(a.name)+'</span>')+'</td>'+
      '<td class="n">'+(a.hi?'<span class="flag">'+a.hi+'</span>':'<span class="muted">0</span>')+'</td>'+
      '<td class="n">'+(a.med||'<span class="muted">0</span>')+'</td>'+
      '<td class="n">'+(a.neg?'<b style="color:var(--crit)">'+a.neg+'</b>':'<span class="muted">0</span>')+'</td>'+
      '<td class="n">'+a.act+'</td><td class="lbl muted">'+a.last+'</td>'+
      '<td>'+(a.cid?'<a href="'+NSCUST+a.cid+'" target="_blank" rel="noopener">account &#8599;</a>':'<span class="muted">&mdash;</span>')+'</td>';
    ab.appendChild(tr)});
  if(accList.length>accShown.length){var atr=document.createElement("tr");
    atr.innerHTML='<td colspan="7" class="muted" style="text-align:center;padding:14px">Showing the top '+
      accShown.length+' of '+nfmt(accList.length)+' accounts by the current sort. '+
      'Narrow with the filters above, or click a column to re-rank.</td>';
    ab.appendChild(atr)}

  /* ---- follow-up commitments ---- */
  var fuRows=q.filter(function(x){return x[5]>=1&&x[5]<=5}).map(function(x){
    return {q:x,d:x[1],age:days(x[1],TODAY),rep:R[x[2]],ctn:CT[x[3]]||"(unscored)",
            actn:ACTN[x[5]]||"?",actk:x[5],risk:x[6],cname:x[16]||x[15]||"zzz"}});
  var AGES=[[0,7,"0–7 days"],[7,30,"8–30 days"],[30,90,"31–90 days"],[90,1e9,"Over 90 days"]];
  var fuOld=fuRows.filter(function(r){return r.age>90}).length;
  tiles("fu-tiles",[
    {l:"Commitments open",v:nfmt(fuRows.length),f:"Every Action Required other than None, in this selection.",
     p:["nu","No tracking"],tip:[nfmt(fuRows.length),"Follow-ups the AI heard",""]},
    {l:"Over 90 days",v:nfmt(fuOld),f:"Promised more than a quarter ago. Almost certainly handled &mdash; but nothing proves it.",
     p:fuOld?["wa","Confirm"]:["ok","None"],tip:[nfmt(fuOld),"Commitments over 90 days old",""]},
    {l:"On at-risk customers",v:nfmt(fuRows.filter(function(r){return r.risk>=2}).length),
     f:"Follow-ups owed to a customer the AI already flagged Medium or High risk. Do these first.",
     p:["cr","Priority"],tip:[nfmt(fuRows.filter(function(r){return r.risk>=2}).length),
       "Open follow-ups on at-risk accounts",""]},
    {l:"Completion rate",v:"unknown",f:"There is no completion field in NetSuite. This is the gap, not a number.",
     p:["wa","Known gap"],tip:["Not measurable","No completion field exists","See the proposal below"]}
  ]);
  var fuByType=Object.keys(ACTN).filter(function(k){return k!=="6"}).map(function(k){
    var v=fuRows.filter(function(r){return String(r.actk)===k});
    return {name:ACTN[k],den:v.length,n:v.length,
      segs:[{v:v.filter(function(r){return r.risk>=2}).length,c:"var(--neg)",l:"On an at-risk customer"},
            {v:v.filter(function(r){return r.risk<2}).length,c:"var(--calls)",l:"Standard"}]}})
    .sort(function(a,b){return b.den-a.den});
  stack("fu-bytype",fuByType,fuRows.length,function(it){return nfmt(it.den)});
  stack("fu-byage",AGES.map(function(a){
    var v=fuRows.filter(function(r){return r.age>=a[0]&&r.age<a[1]});
    return {name:a[2],den:v.length,n:v.length,
      segs:[{v:v.filter(function(r){return r.risk>=2}).length,c:"var(--neg)",l:"On an at-risk customer"},
            {v:v.filter(function(r){return r.risk<2}).length,c:"var(--calls)",l:"Standard"}]}}),
    fuRows.length,function(it){return nfmt(it.den)});
  (function(){
    var acts=Object.keys(ACTN).filter(function(k){return k!=="6"});
    var cts=byVol.slice(0,6).map(function(t){return t.k});
    var inSet={};cts.forEach(function(k){inSet[k]=1});
    var h='<table><thead><tr><th>Action</th>';
    cts.forEach(function(k){h+='<th class="n">'+esc(CT[k]||"?")+'</th>'});
    h+='<th class="n">All other types</th><th class="n">All</th></tr></thead><tbody>';
    var mx=0;
    acts.forEach(function(a){
      cts.forEach(function(k){
        mx=Math.max(mx,fuRows.filter(function(r){return String(r.actk)===a&&r.q[3]===k}).length)});
      mx=Math.max(mx,fuRows.filter(function(r){return String(r.actk)===a&&!inSet[r.q[3]]}).length)});
    acts.forEach(function(a){
      var rowSet=fuRows.filter(function(r){return String(r.actk)===a});
      if(!rowSet.length)return;
      h+='<tr><td class="lbl">'+esc(ACTN[a])+'</td>';
      function cell(n){var bg=n&&mx?"rgba(15,95,99,"+(0.04+n/mx*0.20).toFixed(3)+")":"transparent";
        return '<td class="n">'+(n?'<span class="cell" style="background:'+bg+'">'+n+'</span>'
          :'<span class="muted">&mdash;</span>')+'</td>'}
      cts.forEach(function(k){cell;h+=cell(rowSet.filter(function(r){return r.q[3]===k}).length)});
      h+=cell(rowSet.filter(function(r){return !inSet[r.q[3]]}).length);
      h+='<td class="n"><b>'+nfmt(rowSet.length)+'</b></td></tr>'});
    h+='</tbody></table>';
    document.getElementById("fu-matrix").innerHTML=h})();
  document.getElementById("fu-note").innerHTML =
    "All <b>"+nfmt(fuRows.length)+"</b> open commitments in this selection, oldest first. "+
    "Every column sorts.";
  var fb=document.getElementById("fu-body");fb.innerHTML="";
  if(!fuRows.length)fb.innerHTML='<tr><td colspan="8" class="empty">Nothing in this selection.</td></tr>';
  sortTable("fu-table",fuRows,"age").slice(0,60).forEach(function(r){
    var tr=document.createElement("tr");
    tr.innerHTML='<td class="lbl muted">'+r.d+'</td><td class="n"><b>'+r.age+'</b></td>'+
      '<td class="lbl">'+custCell(r.q)+'</td><td class="lbl">'+esc(r.rep)+'</td>'+
      '<td class="lbl">'+esc(r.ctn)+'</td><td class="lbl">'+esc(r.actn)+'</td>'+
      '<td class="n">'+riskFlag(r.risk)+'</td><td>'+callLink(r.q[0])+'</td>';
    fb.appendChild(tr)});
  if(fuRows.length>60){
    var tr=document.createElement("tr");
    tr.innerHTML='<td colspan="8" class="muted" style="text-align:center;padding:14px">'+
      'Showing 60 of '+nfmt(fuRows.length)+' by the current sort. '+
      'Narrow with the filters above, or click a column to re-rank.</td>';
    fb.appendChild(tr)}
  document.getElementById("fu-proposal").innerHTML =
    "Today Action Required is a <b>read-only observation</b>: the AI heard a promise, wrote it to the call "+
    "record, and nothing else happens. There is no owner, no due date and no way to close it, which is why "+
    "the tile above says <i>unknown</i> rather than a percentage.<br><br>"+
    "The smallest change that fixes this is a <b>NetSuite Task created from the call</b> whenever "+
    "Action Required is not None &mdash; assigned to the rep who took the call, titled from the call subject, "+
    "linked back to the call and the customer, and dated by action type (Credit Needed and Replacement "+
    "Needed are tighter than a Sales Follow-up). Tasks already carry status, owner and due date, so "+
    "completion becomes measurable the day it is switched on, and this tab turns into a real open/closed "+
    "queue with an aging curve.<br><br>"+
    "Two smaller variants if a Task feels heavy: set a <b>follow-up flag plus a due date directly on the "+
    "call record</b> and let reps clear it, or open a <b>case</b> for the Credit and Replacement actions "+
    "only, which are the ones with money attached. All three are Nabeegh-side changes &mdash; "+
    "worth raising in the same conversation as the opening-sentiment field.";

  /* ---- review queue ---- */
  var rq=q.filter(function(x){return !x[13]&&
    ((x[11]>=0&&x[11]<=80)||x[8]===3||x[10]===3||((x[8]===1||x[8]===2)&&x[9]===3))})
    .map(function(x){return {q:x,d:x[1],rep:R[x[2]],ctn:CT[x[3]]||"(unscored)",conf:x[11],
      risk:x[6],dom:x[8],fin:x[9],rs:x[10],cname:x[16]||x[15]||"zzz"}});
  document.getElementById("conf-gap").innerHTML =
    "<b>The confidence flag is mostly catching silent calls.</b> Of the <b>"+nfmt(lowconf.length)+
    "</b> calls at confidence 80 or below in this selection, <b>"+nfmt(lowconf.length-lowconfConv.length)+
    "</b> are voicemails or no-answers &mdash; there was no conversation to score, so they will never score "+
    "well and reviewing them teaches you nothing. Every list on this tab excludes them.";
  tiles("rev-tiles",[
    {l:"Flagged conversations",v:nfmt(rq.length),f:"Confidence &le;80 or any negative. Voicemails excluded throughout.",
     p:["wa","Review"],tip:[nfmt(rq.length),"Flagged for human review","Least confident first"]},
    {l:"Confidence &le;80",v:nfmt(lowconfConv.length),
     f:"Excluding the "+nfmt(lowconf.length-lowconfConv.length)+" silent calls that can never score.",
     tip:[nfmt(lowconfConv.length),"Low-confidence conversations","Threshold set at 80, not 85"]},
    {l:"Negative &mdash; customer",v:nfmt(negAll),f:"Every one is flagged, per your instruction.",
     p:negAll?["cr","All flagged"]:["ok","None"],tip:[nfmt(negAll),"Dominant tone negative",""]},
    {l:"Negative &mdash; rep",v:nfmt(repNeg),f:"Rep tone is scored on voicemails too, so this covers the whole log.",
     p:repNeg?["cr","All flagged"]:["ok","None"],tip:[nfmt(repNeg),"Rep tone negative",""]}
  ]);
  document.getElementById("rev-note").innerHTML =
    "<b>"+nfmt(rq.length)+"</b> conversations in this selection, sorted by confidence ascending then risk "+
    "descending. Every column sorts.";
  var rb=document.getElementById("rev-body");rb.innerHTML="";
  if(!rq.length)rb.innerHTML='<tr><td colspan="11" class="empty">Nothing in this selection.</td></tr>';
  sortTable("rev-table",rq,"conf","n","asc").slice(0,60).forEach(function(r){
    var why=[];
    if(r.conf>=0&&r.conf<=80)why.push('<span class="flag wa">conf '+r.conf+'</span>');
    if(r.dom===3)why.push('<span class="flag">cust neg</span>');
    if(r.rs===3)why.push('<span class="flag">rep neg</span>');
    if((r.dom===1||r.dom===2)&&r.fin===3)why.push('<span class="flag">deteriorated</span>');
    var tr=document.createElement("tr");
    tr.innerHTML='<td class="n"><b>'+(r.conf<0?"&mdash;":r.conf)+'</b></td><td class="lbl muted">'+r.d+'</td>'+
      '<td class="lbl">'+custCell(r.q)+'</td><td class="lbl">'+esc(r.rep)+'</td>'+
      '<td class="lbl">'+esc(r.ctn)+'</td><td class="lbl">'+sentDot(r.dom)+'</td>'+
      '<td class="lbl">'+sentDot(r.fin)+'</td><td class="lbl">'+sentDot(r.rs)+'</td>'+
      '<td class="n">'+riskFlag(r.risk)+'</td><td class="lbl">'+why.join(" ")+'</td>'+
      '<td>'+callLink(r.q[0])+'</td>';
    rb.appendChild(tr)});
  if(rq.length>60){var tr2=document.createElement("tr");
    tr2.innerHTML='<td colspan="11" class="muted" style="text-align:center;padding:14px">Showing the 60 '+
      'least-confident of '+nfmt(rq.length)+'. Narrow with the filters above, or click a column to re-rank.</td>';
    rb.appendChild(tr2)}
  document.getElementById("neutral-note").innerHTML =
    "You asked to flag neutrals too, to see what the AI is calling neutral before trusting it. In this "+
    "selection it calls <b>"+nfmt(neu)+" of "+nfmt(cv.length)+"</b> scored conversations neutral &mdash; <b>"+
    f1(pct(neu,cv.length))+"%</b>. That is too many to queue as a worklist, so it is shown as a distribution "+
    "instead: if neutral is genuinely the default outcome of a support call, this is the shape you would "+
    "expect. If it is the AI hedging, you will see neutral crowding out positive on call types where you "+
    "know customers leave happy.";
  stack("neutral-bars",byVol.slice(0,10).map(function(t){
    return {name:t.name,den:t.n,segs:[{v:t.pos,c:"var(--pos)",l:"Positive"},
      {v:t.neu,c:"var(--neu)",l:"Neutral"},{v:t.neg,c:"var(--neg)",l:"Negative"}]}}),
    tl.length,function(it){return f1(pct(it.segs[1].v,it.den))+"% neutral"});

  /* ================= COMBINED ================= */
  var combReps=fr.value?[fr.value]:RO;
  var callN={},inN={},outN={},nodirN={},tickN={};
  combReps.forEach(function(r){
    var sub=rows.filter(function(x){return x[1]===r});
    callN[r]=sub.length;
    inN[r]=sub.filter(function(x){return x[13]===1}).length;
    outN[r]=sub.filter(function(x){return x[13]===2}).length;
    nodirN[r]=sub.filter(function(x){return x[13]===0}).length;
    tickN[r]=ticks.filter(function(x){return x[1]===r}).reduce(function(a,b){return a+b[2]},0)});
  var totC=0,totT=0,totIn=0,totOut=0;
  combReps.forEach(function(r){totC+=callN[r];totT+=tickN[r];totIn+=inN[r];totOut+=outN[r]});
  var cmp=ticketsComparable();
  tiles("comb-tiles",[
    {l:"Phone calls",v:nfmt(totC),f:"In the selected range. "+nfmt(totIn)+" inbound, "+nfmt(totOut)+" outbound.",
     tip:[nfmt(totC),"Calls in view","All filters apply"]},
    {l:"Tickets",v:cmp?nfmt(totT):"n/a",
     f:cmp?"Non-spam tickets opened in the same range. Date and rep filters both apply."
          :"Hidden: a call-type, direction or urgency filter is on, and tickets carry none of those fields.",
     p:cmp?null:["wa","Not comparable"],
     tip:cmp?[nfmt(totT),"Non-spam tickets in range",""]:["Not comparable","Tickets have no call-level fields",""]},
    {l:"Outbound share",v:totIn+totOut?f1(pct(totOut,totIn+totOut))+"%":"&mdash;",
     f:"Of calls where direction was recorded. Outbound is the team reaching out rather than answering.",
     tip:[nfmt(totOut),"Outbound calls","of "+nfmt(totIn+totOut)+" with a direction recorded"]},
    {l:"Duration",v:"&mdash;",f:"Not available on any call. Never estimated here.",p:["wa","Known gap"],
     tip:["Unavailable","Calls log on answer, not finish","Nabeegh to investigate the AWS recordings"]}
  ]);
  var maxCT=1;combReps.forEach(function(r){maxCT=Math.max(maxCT,callN[r],cmp?tickN[r]:0)});
  var cbEl=document.getElementById("comb-bars");cbEl.innerHTML="";
  combReps.forEach(function(r){
    var row1=document.createElement("div");row1.className="hbar";row1.style.marginBottom="3px";
    var nm1=document.createElement("div");nm1.className="name";
    nm1.innerHTML="<b>"+esc(R[r])+"</b><br><span class='muted' style='font-weight:400'>calls</span>";
    var t1=document.createElement("div");t1.className="track";
    var segs=[[inN[r],"var(--calls)","Inbound"],[outN[r],"var(--callsout)","Outbound"],
              [nodirN[r],"var(--nodir)","Direction not recorded"]];
    var wsum=0;segs.forEach(function(s){wsum+=s[0]});
    segs.forEach(function(s){if(!s[0])return;
      var f=document.createElement("div");f.className="fill";
      f.style.width=(s[0]/maxCT*100)+"%";f.style.background=s[1];
      f.setAttribute("tabindex","0");f.setAttribute("aria-label",R[r]+" "+s[0]+" "+s[2]+" calls");
      bind(f,nfmt(s[0]),s[2]+" — "+R[r],f1(pct(s[0],wsum))+"% of their calls in range");
      t1.appendChild(f)});
    var l1=document.createElement("span");l1.className="dlabel out";l1.textContent=nfmt(callN[r]);
    t1.appendChild(l1);
    row1.appendChild(nm1);row1.appendChild(t1);cbEl.appendChild(row1);

    var row2=document.createElement("div");row2.className="hbar";row2.style.marginBottom="15px";
    var nm2=document.createElement("div");nm2.className="name";
    nm2.innerHTML="<span class='muted'>tickets</span>";
    var t2=document.createElement("div");t2.className="track";
    if(cmp){
      var f2=document.createElement("div");f2.className="fill";
      f2.style.width=(tickN[r]/maxCT*100)+"%";f2.style.background="var(--tickets)";
      f2.style.borderRadius="4px";f2.setAttribute("tabindex","0");
      f2.setAttribute("aria-label",R[r]+" "+tickN[r]+" tickets");
      bind(f2,nfmt(tickN[r]),"Tickets — "+R[r],"Non-spam, opened in the selected range");
      t2.appendChild(f2);
      var l2=document.createElement("span");l2.className="dlabel out";l2.textContent=nfmt(tickN[r]);
      t2.appendChild(l2)}
    else{var em=document.createElement("span");em.className="dlabel out";em.style.left="6px";
      em.style.color="var(--faint)";em.textContent="not comparable under a call-level filter";
      t2.appendChild(em)}
    row2.appendChild(nm2);row2.appendChild(t2);cbEl.appendChild(row2)});

  document.getElementById("dir-note").innerHTML =
    "Direction is recorded on <b>"+nfmt(totIn+totOut)+"</b> of "+nfmt(totC)+" calls in this selection. "+
    "Outbound is the closest thing in this data to proactive effort &mdash; it is the rep picking up the "+
    "phone rather than answering it.";
  stack("dir-bars",combReps.map(function(r){
    return {name:R[r],den:callN[r],segs:[
      {v:inN[r],c:"var(--calls)",l:"Inbound"},{v:outN[r],c:"var(--callsout)",l:"Outbound"},
      {v:nodirN[r],c:"var(--nodir)",l:"Direction not recorded"}]}}),
    totC,function(it){var d=it.segs[0].v+it.segs[1].v;
      return d?f1(pct(it.segs[1].v,d))+"% outbound":"—"});
  drawComboTrend(rows,ticks);

  var lean=combReps.map(function(r){return {r:r,c:callN[r],t:tickN[r],d:callN[r]-tickN[r]}})
    .sort(function(a,b){return b.d-a.d});
  var ph=lean[0],th2=lean[lean.length-1];
  document.getElementById("comb-story").innerHTML = !cmp ?
    ("Tickets are hidden because a call-type, direction or urgency filter is on. Tickets carry none of "+
     "those fields, so any ticket number shown beside a filtered call count would be a different "+
     "population wearing the same label. Clear those filters to compare the two.") :
    ("In this selection <b>"+esc(R[ph.r])+"</b> is the most phone-weighted &mdash; "+nfmt(ph.c)+
     " calls against "+nfmt(ph.t)+" tickets &mdash; and <b>"+esc(R[th2.r])+"</b> the most ticket-weighted, at "+
     nfmt(th2.c)+" calls against "+nfmt(th2.t)+" tickets. That is a real difference in how two people spend "+
     "a day, and it is the thing worth asking them about.<br><br>"+
     "What it is <b>not</b> is a productivity comparison. Without duration, the phone bar counts a "+
     "thirty-second &ldquo;he&rsquo;s not in&rdquo; the same as a twenty-minute complaint. And because no "+
     "call links to a ticket, the same customer problem can appear once in each bar with nothing tying the "+
     "two together. Use this to ask better questions, not to rank anyone.");

  document.getElementById("foot").innerHTML =
    "Live from NetSuite <code>phonecall</code>"+(HAS_TICKETS?" and <code>supportcase</code>":"")+", loaded "+esc(DATA.builtAt)+". "+
    "Roster: "+RO.map(function(k){return esc(R[k])}).join(", ")+" &mdash; every call they took, not "+
    "only Department = Support. The 15 AI fields were decoded from live records rather than assumed. "+
    "Customer and call links open the matching NetSuite record. This dashboard carries business account "+
    "names only &mdash; no contact names, phone numbers, email addresses or call transcripts; open the call "+
    "record for the subject, summary and recording. "+
    "Known gaps, all labelled and none estimated around: call duration, opening sentiment, follow-up "+
    "completion, call-to-ticket linkage, and the customer link on part of the call log.";
}

/* ---- chrome ----------------------------------------------------------- */
Array.prototype.forEach.call(document.querySelectorAll(".tabs button"),function(b){
  b.addEventListener("click",function(){
    Array.prototype.forEach.call(document.querySelectorAll(".tabs button"),function(x){
      x.setAttribute("aria-selected",x===b?"true":"false")});
    Array.prototype.forEach.call(document.querySelectorAll(".panel"),function(p){
      p.classList.toggle("on",p.id==="p-"+b.dataset.p)})})});
Array.prototype.forEach.call(document.querySelectorAll("#deepnav button"),function(b){
  b.addEventListener("click",function(){
    Array.prototype.forEach.call(document.querySelectorAll("#deepnav button"),function(x){
      x.setAttribute("aria-pressed",x===b?"true":"false")});
    Array.prototype.forEach.call(document.querySelectorAll(".dsec"),function(s){
      s.style.display=(s.id==="s-"+b.dataset.s)?"":"none"})})});
Array.prototype.forEach.call(document.querySelectorAll("#presets button"),function(b){
  b.addEventListener("click",function(){
    Array.prototype.forEach.call(document.querySelectorAll("#presets button"),function(x){
      x.setAttribute("aria-pressed",x===b?"true":"false")});
    if(b.dataset.scored){d1.value=SCORED_FROM;d2.value=TODAY}
    else{var n=Number(b.dataset.days);
      if(!n){d1.value=START;d2.value=TODAY}
      else{var e=new Date(TODAY+"T00:00:00Z"),s=new Date(e);s.setUTCDate(s.getUTCDate()-n);
        var sv=s.toISOString().slice(0,10);d1.value=sv<START?START:sv;d2.value=TODAY}}
    render()})});
[d1,d2,fr,ft,fd,fu].forEach(function(el){el.addEventListener("change",function(){
  Array.prototype.forEach.call(document.querySelectorAll("#presets button"),function(x){
    x.setAttribute("aria-pressed","false")});
  render()})});
render();
})();
`;

    return { onRequest, buildPayload, renderPage, _cleanName: cleanName };
});