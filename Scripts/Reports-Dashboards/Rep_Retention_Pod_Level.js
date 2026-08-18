/**
 * Retention Pod Dashboard - LIVE
 * Royal Bag | NetSuite Suitelet | SuiteScript 2.1
 *
 * Queries NetSuite on every page load and renders the pod retention dashboard:
 * retention score, revenue at risk, 80/20 tiering, expected reorders, and the
 * day-by-day call plan. No snapshot, no File Cabinet dependency, no scheduled
 * rebuild - open the URL and you are looking at current data.
 *
 * MAINTENANCE - everything you would normally change lives in CONFIG below:
 *   - Adding a rep to the pod is one line in CONFIG.POD_MEMBERS. A brand-new
 *     hire with no NetSuite data still renders, marked "NEW", and fills in
 *     automatically once orders are assigned to them.
 *   - Account exceptions (snoozes and notes) are CONFIG.EXCLUSIONS. A dated
 *     snooze simply goes quiet and resurfaces after the date passes.
 *
 * NOTES
 *   - Fonts come from fonts.googleapis.com and Chart.js from cdnjs. If outbound
 *     CDN access is blocked the two charts stay blank and everything else works;
 *     host chart.umd.min.js in the File Cabinet and repoint the src to fix.
 *   - "Called" checkmarks persist per browser via localStorage. Nothing is
 *     written back to NetSuite - this Suitelet is read-only.
 *   - The analytics were ported from the validated Python engine and diffed
 *     byte-for-byte against it, including Python's banker's rounding and the
 *     exact-summation behaviour of statistics.mean.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/log', 'N/runtime'], function (query, log, runtime) {
    'use strict';

    // ═══ CONFIG ══════════════════════════════════════════════════════════════
    var CONFIG = {
        POD_NAME: 'Retention Pod \u2014 Fay + Taylor + Gianna',
        DASHBOARD_ID: 'pod_fay_taylor_gianna',

        // Roster order sets each rep's colour. Keep new hires listed here.
        POD_MEMBERS: ["Fay Singer", "Taylor Kennedy", "Gianna Saviano"],

        // Employee internal IDs are resolved live by name, so this is only a
        // fallback if the name lookup misses.
        FALLBACK_REP_IDS: {
            "Fay Singer": "749",
            "Taylor Kennedy": "496615",
            "Gianna Saviano": "1006783"
},

        // Order history start, and the invoice window used for 2023-24 history.
        ORDERS_FROM: '2025-01-01',
        INVOICES_FROM: '2023-01-01',
        INVOICES_TO: '2024-12-31',

        EXCLUSIONS: [
            {
                        "name": "Mario Badescu",
                        "owner": "Mendy Eagle",
                        "type": "snooze",
                        "until": "2026-12-31",
                        "reason": "Large order last year; expected to reorder around year-end. Not at risk."
            },
            {
                        "name": "SMM Holdings LLC",
                        "owner": "Mendy Eagle",
                        "type": "snooze",
                        "until": null,
                        "reason": "$77K blanket PO draws down over time; won't show as new sales orders (false decline)."
            },
            {
                        "name": "Oh Nuts",
                        "owner": "Mendy Eagle",
                        "type": "snooze",
                        "until": null,
                        "reason": "$20K blanket PO, same false-decline mechanism as SMM."
            },
            {
                        "name": "AMR Management",
                        "owner": "Mendy Eagle",
                        "type": "snooze",
                        "until": null,
                        "reason": "Company closed down."
            },
            {
                        "name": "FAROUK Systems",
                        "owner": "Mendy Eagle",
                        "type": "snooze",
                        "until": "2026-08-31",
                        "reason": "Blanket PO on file so orders don't show as new sales; new blanket PO to be arranged by end of August, then it resurfaces as flagged."
            },
            {
                        "name": "Spice Kingdom",
                        "owner": "Mendy Eagle",
                        "type": "snooze",
                        "until": "2026-09-30",
                        "reason": "Still has stock from last order."
            },
            {
                        "name": "Richard Bauer & Co.",
                        "owner": "Mendy Eagle",
                        "type": "note",
                        "until": null,
                        "reason": "Genuinely declining for a real reason \u2014 reseller's end customer reduced usage. New lower baseline; do not chase a win-back to old revenue."
            },
            {
                        "name": "Robin Industries",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": "2026-10-15",
                        "reason": "Overstocked; snoozed ~1.5x the ~1.9-month order cadence from the last order, resurfaces mid-October."
            },
            {
                        "name": "Bag Factory",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": null,
                        "reason": "OK to be lost \u2014 cheaper backup supplier, not worth the time."
            },
            {
                        "name": "Crown Staple",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": null,
                        "reason": "OK to be lost \u2014 lost on price."
            },
            {
                        "name": "Wilmington Fibre",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": null,
                        "reason": "Deprioritized \u2014 early big-volume promise never materialized; ceiling ~$300-600."
            },
            {
                        "name": "Ken Craft",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": null,
                        "reason": "Long-dormant; Renee's call, no urgency."
            },
            {
                        "name": "Tara & Sons",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": null,
                        "reason": "Low-priority ('swirly') pile."
            },
            {
                        "name": "Matachi",
                        "owner": "Renee Goldenberg",
                        "type": "snooze",
                        "until": null,
                        "reason": "Explicitly told not to reach out."
            },
            {
                        "name": "Smith & Warren",
                        "owner": "Renee Goldenberg",
                        "type": "note",
                        "until": null,
                        "reason": "Real cadence ~5-7 months (not 3); reached out recently, all good. Don't chase as overdue."
            },
            {
                        "name": "Precision Resource",
                        "owner": "Renee Goldenberg",
                        "type": "note",
                        "until": null,
                        "reason": "Real cadence ~6 months (not 4); already shipped, next real touch ~November."
            },
            {
                        "name": "Lions Services",
                        "owner": "Fay Singer",
                        "type": "note",
                        "until": null,
                        "reason": "Orders every ~2.5 months; the extra spot order (one-time custom-bag backup) was a one-off \u2014 don't read it as a new trend."
            },
            {
                        "name": "Tedder Industries",
                        "owner": "Fay Singer",
                        "type": "snooze",
                        "until": "2026-10-01",
                        "reason": "Switched to a cheaper custom bag and ordered extra to last longer; expected to reorder Fall 2026 (Tedder / Alien Gear Holsters)."
            },
            {
                        "name": "The Smart Group",
                        "owner": "Fay Singer",
                        "type": "snooze",
                        "until": null,
                        "reason": "Now orders through Bizink; won't reorder under this name."
            },
            {
                        "name": "Schoolhouse Supplies",
                        "owner": "Fay Singer",
                        "type": "snooze",
                        "until": "2027-06-01",
                        "reason": "Has enough stock until summer 2027."
            },
            {
                        "name": "Selkirk Sport",
                        "owner": "Fay Singer",
                        "type": "snooze",
                        "until": "2026-10-01",
                        "reason": "Will need to reorder in Fall 2026."
            }
        ]
    };

    // ═══ DATA LAYER ══════════════════════════════════════════════════════════
    function runSQL(sql, label) {
        var rows = [], pageSize = 5000, more = true, offset = 0;
        while (more) {
            var res = query.runSuiteQL({ query: sql });
            var mapped = res.asMappedResults();
            rows = rows.concat(mapped);
            // runSuiteQL caps at 5000 rows; our aggregated pulls sit well under
            // that, but bail loudly rather than silently truncate.
            more = false;
            if (mapped.length >= pageSize) {
                log.error({ title: 'Retention pod: result set hit the 5000-row cap',
                            details: label + ' returned ' + mapped.length + ' rows. Aggregation may be truncated.' });
            }
            offset += mapped.length;
        }
        return rows;
    }

    function resolveReps() {
        var rows = runSQL(
            "SELECT e.id, e.firstname || ' ' || e.lastname AS full_name " +
            "FROM employee e WHERE e.issalesrep = 'T' AND e.isinactive = 'F'", 'employees');
        var byLower = {};
        rows.forEach(function (r) {
            if (r.full_name) byLower[String(r.full_name).trim().toLowerCase()] = String(r.id);
        });
        var ids = [], nameById = {};
        CONFIG.POD_MEMBERS.forEach(function (m) {
            var id = byLower[m.trim().toLowerCase()] || CONFIG.FALLBACK_REP_IDS[m] || null;
            if (id) { ids.push(String(id)); nameById[String(id)] = m; }
        });
        return { ids: ids, nameById: nameById };
    }

    // Aggregate by customer-month in SuiteQL, then reconstruct individual
    // transactions. Lossless for this model: order counts, monthly revenue,
    // yearly revenue, gaps and average order size all come out exact; only
    // within-month dates collapse to that month's last order date, which the
    // monthly cadence math does not depend on.
    function pullTxns(recordType, ids, dateClause) {
        var sql =
            "SELECT NVL(c.companyname, c.entityid) AS customer, c.salesrep AS ownerid, " +
            "TO_CHAR(t.trandate,'YYYY-MM') AS ym, ROUND(SUM(t.foreigntotal),2) AS amt, " +
            "COUNT(*) AS cnt, MAX(TO_CHAR(t.trandate,'DD')) AS dd " +
            "FROM transaction t JOIN customer c ON c.id = t.entity " +
            "WHERE t.recordtype = '" + recordType + "' AND c.salesrep IN (" + ids.join(',') + ") " +
            dateClause + " " +
            "GROUP BY NVL(c.companyname, c.entityid), c.salesrep, TO_CHAR(t.trandate,'YYYY-MM')";
        return runSQL(sql, recordType);
    }

    function expand(rows, nameById) {
        var out = [];
        rows.forEach(function (r) {
            var cnt = parseInt(r.cnt, 10) || 0;
            if (!cnt) return;
            var amt = parseFloat(r.amt) || 0;
            var per = pyRound(amt / cnt, 2);   // same banker's rounding as the engine
            var ym = String(r.ym);
            var date = ym.slice(5, 7) + '/' + String(r.dd) + '/' + ym.slice(0, 4);
            var owner = nameById[String(r.ownerid)] || '\u2014';
            var cust = String(r.customer || '').trim();
            if (!cust) return;
            for (var i = 0; i < cnt; i++) {
                out.push({ date: date, customer: cust, amount: per, owner: owner });
            }
        });
        return out;
    }

    function pullActivity(ids) {
        var sql =
            "SELECT NVL(c.companyname, c.entityid) AS cu, TO_CHAR(a.startdate,'MM/DD/YYYY') AS d, " +
            "SUBSTR(NVL(a.title,'activity'),1,26) AS t " +
            "FROM activity a JOIN customer c ON c.id = a.company " +
            "WHERE c.salesrep IN (" + ids.join(',') + ") " +
            "AND a.startdate = (SELECT MAX(a2.startdate) FROM activity a2 WHERE a2.company = a.company) " +
            "AND EXISTS (SELECT 1 FROM transaction t WHERE t.entity = c.id " +
            "AND t.recordtype IN ('salesorder','invoice') " +
            "AND t.trandate >= TO_DATE('" + CONFIG.INVOICES_FROM + "','YYYY-MM-DD'))";
        return runSQL(sql, 'activity').map(function (r) {
            return { customer: String(r.cu || '').trim(), title: String(r.t || ''),
                     last_activity_date: r.d || null };
        });
    }

    function loadRaw() {
        var reps = resolveReps();
        if (!reps.ids.length) throw new Error('No pod members resolved to NetSuite sales reps.');
        var orderRows = pullTxns('salesorder', reps.ids,
            "AND t.trandate >= TO_DATE('" + CONFIG.ORDERS_FROM + "','YYYY-MM-DD')");
        var invoiceRows = pullTxns('invoice', reps.ids,
            "AND t.trandate BETWEEN TO_DATE('" + CONFIG.INVOICES_FROM + "','YYYY-MM-DD') " +
            "AND TO_DATE('" + CONFIG.INVOICES_TO + "','YYYY-MM-DD')");
        return {
            rep_name: CONFIG.POD_NAME,
            pod_mode: true,
            dashboard_id: CONFIG.DASHBOARD_ID,
            pod_members: CONFIG.POD_MEMBERS,
            orders: expand(orderRows, reps.nameById),
            invoices: expand(invoiceRows, reps.nameById),
            activity: pullActivity(reps.ids),
            exclusions: CONFIG.EXCLUSIONS
        };
    }

    // ═══ ENGINE (ported from process_pod.py, byte-verified) ══════════════════
// ── Python-compatible numeric helpers ────────────────────────────────────────
// Python round() is banker's rounding (half to even); JS Math.round is not.
// Rounds on the double's exact decimal expansion so ties break to even the way
// Python's round() does. Multiplying by a power of 10 first (the obvious
// approach) introduces its own error and misclassifies ties by a cent.
function pyRound(v, nd) {
    if (v === null || v === undefined || typeof v !== 'number' || isNaN(v) || !isFinite(v)) return v;
    nd = nd || 0;
    var neg = v < 0, a = Math.abs(v);
    var s = a.toFixed(Math.min(30, nd + 22));   // effectively exact for our magnitudes
    var dot = s.indexOf('.');
    var digits = s.slice(0, dot) + s.slice(dot + 1);
    var intLen = dot;
    var keep = intLen + nd;                      // number of digits to retain
    if (keep >= digits.length) return v;
    var head = digits.slice(0, keep), tail = digits.slice(keep);
    var roundUp;
    var firstTail = tail.charCodeAt(0) - 48;
    if (firstTail > 5) roundUp = true;
    else if (firstTail < 5) roundUp = false;
    else {
        var restNonZero = /[1-9]/.test(tail.slice(1));
        if (restNonZero) roundUp = true;
        else {                                   // exact tie -> half to even
            var lastKept = keep > 0 ? head.charCodeAt(keep - 1) - 48 : 0;
            roundUp = (lastKept % 2) === 1;
        }
    }
    var n = head === '' ? 0n : BigInt(head);
    if (roundUp) n += 1n;
    var out = Number(n) / Math.pow(10, nd);
    return neg ? -out : out;
}
// str() of a Python float: 56.1 -> "56.1", 56.0 -> "56.0"
function pyFloatStr(v) {
    if (v === null || v === undefined) return 'None';
    if (Number.isInteger(v)) return v.toFixed(1);
    return String(v);
}
// statistics.mean sums exactly (Fractions) before dividing, so naive float
// accumulation can land a cent off after rounding. Kahan-Babuska compensation
// recovers that precision.
function ksum(a) {
    var s = 0, c = 0, i, t;
    for (i = 0; i < a.length; i++) {
        t = s + a[i];
        c += Math.abs(s) >= Math.abs(a[i]) ? (s - t) + a[i] : (a[i] - t) + s;
        s = t;
    }
    return s + c;
}
function mean(a) { return ksum(a) / a.length; }
function stdev(a) { // sample stdev (ddof=1), matches statistics.stdev
    if (a.length < 2) return 0;
    var m = mean(a), s = 0, i;
    for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
}
function sum(a, f) { return ksum(f ? a.map(f) : a); }

// ── Date helpers (UTC everywhere; Python datetimes are naive/DST-free) ───────
var MS = 86400000;
function ymd(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function monthKey(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }
function parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m) return new Date(Date.UTC(2000 + +m[3], +m[1] - 1, +m[2]));
    return null;
}
// Python timedelta.days floors toward negative infinity.
function tdDays(aMs, bMs) { return Math.floor((aMs - bMs) / MS); }
function monthsDiff(a, b) { // 'YYYY-MM' strings
    var ay = +a.slice(0, 4), am = +a.slice(5, 7), by = +b.slice(0, 4), bm = +b.slice(5, 7);
    return (by - ay) * 12 + (bm - am);
}
function firstOfMonth(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonth(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
var MONTH_NAMES = ['January','February','March','April','May','June','July',
                   'August','September','October','November','December'];
var MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── Static lookups ───────────────────────────────────────────────────────────
var STATUS_COLORS = {
    gone:'#c0392b', significantly_overdue:'#e74c3c', overdue:'#e67e22',
    growing:'#27ae60', on_track:'#2980b9', declining_2026:'#8e44ad',
    not_yet_due:'#16a085', new_2026:'#3498db', erratic:'#d35400',
    one_time_2025:'#7f8c8d', one_time_old:'#7f8c8d', snoozed:'#95a5a6'
};
var STATUS_LABELS = {
    gone:'Gone', significantly_overdue:'Sig. Overdue', overdue:'Overdue',
    growing:'Growing', on_track:'On Track', declining_2026:'Declining',
    not_yet_due:'Not Yet Due', new_2026:'New 2026', erratic:'Erratic',
    one_time_2025:'One-Time 2025', one_time_old:'One-Time (Old)', snoozed:'Snoozed'
};
var CADENCE_COLORS = { in_cadence:'#27ae60', out_of_cadence:'#e67e22', no_activity:'#7f8c8d' };
var CADENCE_LABELS = { in_cadence:'In Cadence', out_of_cadence:'Out of Cadence', no_activity:'No Activity' };
var ALL_STATS = ['growing','on_track','new_2026','not_yet_due','snoozed','declining_2026',
                 'overdue','significantly_overdue','gone','erratic','one_time_2025','one_time_old'];
var STAT_ORDER = ['growing','on_track','new_2026','not_yet_due','declining_2026',
                  'overdue','significantly_overdue','gone'];
var POD_PALETTE = ['#6c5ce7','#00897b','#c8490c','#2980b9','#8e44ad','#16a085',
                   '#d35400','#2c3e50','#c0392b','#27ae60'];

function buildDashboard(raw, TODAY) {
    var REP_NAME = raw.rep_name || 'Rep';
    var POD_MODE = !!raw.pod_mode;
    var DASH_ID = raw.dashboard_id || REP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    var MONTHS_2026 = Math.max(1, TODAY.getUTCFullYear() === 2026 ? TODAY.getUTCMonth() : 6);
    var T = TODAY.getTime();

    // ── Roster + colors ──────────────────────────────────────────────────────
    var POD_MEMBERS = [], POD_COLORS = {}, pi = 0;
    (raw.pod_members || []).forEach(function (m) {
        var nm = typeof m === 'string' ? m : (m.name || '');
        var col = typeof m === 'string' ? null : m.color;
        nm = String(nm).trim();
        if (!nm) return;
        POD_MEMBERS.push(nm);
        if (!col) { col = POD_PALETTE[pi % POD_PALETTE.length]; pi++; }
        POD_COLORS[nm.toLowerCase()] = col;
        var first = nm.toLowerCase().split(/\s+/)[0];
        if (!(first in POD_COLORS)) POD_COLORS[first] = col;
    });
    function ownerColor(o) {
        if (!o) return '#7f8c8d';
        var k = String(o).trim().toLowerCase();
        if (k in POD_COLORS) return POD_COLORS[k];
        var p = k.split(/\s+/);
        if (p[0] && p[0] in POD_COLORS) return POD_COLORS[p[0]];
        return '#7f8c8d';
    }

    // ── Exclusions ───────────────────────────────────────────────────────────
    var EXCLUSIONS = [];
    (raw.exclusions || []).forEach(function (ex) {
        var nm = String(ex.name || '').trim().toLowerCase();
        var until = parseDate(ex.until);
        var etype = String(ex.type || 'snooze').trim().toLowerCase() || 'snooze';
        var owner = String(ex.owner || '').trim().toLowerCase();
        if (nm && (etype === 'note' || until === null || until.getTime() > T)) {
            EXCLUSIONS.push({ name: nm, until: until, reason: String(ex.reason || ''),
                              type: etype, owner: owner });
        }
    });
    function exMatch(ex, cname, cowner) {
        var cl = String(cname).trim().toLowerCase();
        if (!(cl.indexOf(ex.name) >= 0 || ex.name.indexOf(cl) >= 0)) return false;
        if (ex.owner) {
            var co = String(cowner || '').trim().toLowerCase();
            if (co.indexOf(ex.owner) < 0 && ex.owner.indexOf(co) < 0) return false;
        }
        return true;
    }
    function excludedInfo(cname, cowner) {
        var snooze = null, note = null;
        EXCLUSIONS.forEach(function (ex) {
            if (!exMatch(ex, cname, cowner)) return;
            if (ex.type === 'note') { if (!note) note = ex; }
            else if (!snooze) snooze = ex;
        });
        return snooze || note;
    }
    function noteInfo(cname, cowner) {
        for (var i = 0; i < EXCLUSIONS.length; i++) {
            if (EXCLUSIONS[i].type === 'note' && exMatch(EXCLUSIONS[i], cname, cowner))
                return EXCLUSIONS[i];
        }
        return null;
    }

    // ── Load transactions (Map preserves Python dict insertion order) ────────
    var txns = new Map(), custOwnerRev = new Map(), custOwnerCnt = new Map();
    function addTx(cust, d, amt, owner) {
        if (!txns.has(cust)) txns.set(cust, []);
        txns.get(cust).push({ date: d, amount: amt });
        if (!custOwnerRev.has(cust)) { custOwnerRev.set(cust, new Map()); custOwnerCnt.set(cust, new Map()); }
        var r = custOwnerRev.get(cust), c = custOwnerCnt.get(cust);
        r.set(owner, (r.get(owner) || 0) + amt);
        c.set(owner, (c.get(owner) || 0) + 1);
    }
    function num(v) {
        var x = parseFloat(String(v === undefined || v === null ? 0 : v).replace(/,/g, '').replace(/\$/g, ''));
        return isNaN(x) ? 0 : x;
    }
    (raw.invoices || []).forEach(function (row) {
        var d = parseDate(row.date);
        if (!d || d.getUTCFullYear() > 2024) return;
        var cust = String(row.customer || '').trim().replace(/^C\d+\s+/, '');
        if (!cust) return;
        addTx(cust, d, num(row.amount), String(row.owner || '').trim() || '\u2014');
    });
    (raw.orders || []).forEach(function (row) {
        var d = parseDate(row.date);
        if (!d || d.getUTCFullYear() < 2025) return;
        var cust = String(row.customer || '').trim();
        if (!cust) return;
        addTx(cust, d, num(row.amount), String(row.owner || '').trim() || '\u2014');
    });

    // ── Activity ─────────────────────────────────────────────────────────────
    var activity = {};
    (raw.activity || []).forEach(function (row) {
        var cust = String(row.customer || '').trim();
        if (!cust) return;
        var d = parseDate(row.last_activity_date || row.duedate);
        if (d && d.getTime() > T) d = null;
        var ex = activity[cust];
        if (ex === undefined) {
            activity[cust] = { date: d, title: String(row.title || ''), type: 'Task' };
        } else if (d !== null && (ex.date === null || d.getTime() > ex.date.getTime())) {
            activity[cust] = { date: d, title: String(row.title || ''), type: 'Task' };
        }
    });

    // ── Customer profiles ────────────────────────────────────────────────────
    var customers = new Map();
    txns.forEach(function (txlist, cname) {
        txlist.sort(function (a, b) { return a.date - b.date; });
        var revByYear = {}, monthlyRev = {}, mkeys = [];
        txlist.forEach(function (t) {
            var y = t.date.getUTCFullYear(), mk = monthKey(t.date);
            revByYear[y] = (revByYear[y] || 0) + t.amount;
            if (!(mk in monthlyRev)) { monthlyRev[mk] = 0; mkeys.push(mk); }
            monthlyRev[mk] += t.amount;
        });
        var amounts = txlist.map(function (t) { return t.amount; });
        var totalRev = sum(amounts);
        var firstOrder = txlist[0].date, lastOrder = txlist[txlist.length - 1].date;
        var nOrders = txlist.length;
        var activeMonths = mkeys.slice().sort();
        var nActiveMonths = activeMonths.length;
        var gaps = [];
        for (var i = 0; i < activeMonths.length - 1; i++)
            gaps.push(monthsDiff(activeMonths[i], activeMonths[i + 1]));
        var avgGap = gaps.length ? mean(gaps) : null;
        var stdGap = gaps.length >= 2 ? stdev(gaps) : 0;
        var cvGap = (avgGap && avgGap > 0 && gaps.length >= 2) ? stdGap / avgGap : 0;

        var monthAmounts = mkeys.map(function (k) { return monthlyRev[k]; });
        var cvAmount = 0;
        if (monthAmounts.length >= 2) {
            var mm = mean(monthAmounts);
            cvAmount = mm > 0 ? stdev(monthAmounts) / mm : 0;
        }

        var expectedNext = avgGap ? new Date(lastOrder.getTime() + avgGap * 30.44 * MS) : null;
        var monthsOverdue = expectedNext ? pyRound(tdDays(T, expectedNext.getTime()) / 30.44, 2) : null;

        var cutoff12 = T - 365 * MS;
        var recent = txlist.filter(function (t) { return t.date.getTime() >= cutoff12; })
                           .map(function (t) { return t.amount; });
        var expectedValue = recent.length ? pyRound(mean(recent), 2)
                          : (amounts.length ? pyRound(mean(amounts), 2) : 0);

        var rev2023 = pyRound(revByYear[2023] || 0, 2), rev2024 = pyRound(revByYear[2024] || 0, 2);
        var rev2025 = pyRound(revByYear[2025] || 0, 2), rev2026 = pyRound(revByYear[2026] || 0, 2);
        var rev2026Ann = rev2026 > 0 ? pyRound((rev2026 / MONTHS_2026) * 12, 2) : 0;
        var has2026 = rev2026 > 0;
        var firstYear = firstOrder.getUTCFullYear();

        var status;
        if (firstYear >= TODAY.getUTCFullYear() && !(rev2025 > 0 || rev2024 > 0 || rev2023 > 0)) status = 'new_2026';
        else if (nOrders === 1 && firstYear === 2025) status = 'one_time_2025';
        else if (nOrders === 1) status = 'one_time_old';
        else if (has2026) {
            if (rev2025 > 0) {
                var ratio = rev2026Ann / rev2025;
                status = ratio >= 1.15 ? 'growing' : (ratio >= 0.70 ? 'on_track' : 'declining_2026');
            } else status = 'on_track';
        } else {
            var monthsSince = tdDays(T, lastOrder.getTime()) / 30.44;
            if (monthsSince > 12) status = 'gone';
            else if (expectedNext && expectedNext.getTime() > T) status = 'not_yet_due';
            else if (expectedNext) {
                var overage = tdDays(T, expectedNext.getTime()) / 30.44;
                var threshold = avgGap ? avgGap * 1.5 : 4.5;
                status = overage >= threshold ? 'significantly_overdue' : 'overdue';
            } else status = monthsSince > 6 ? 'significantly_overdue' : 'overdue';
        }
        if (nActiveMonths >= 3 && cvGap > 1.0 && cvAmount > 1.0 &&
            ['new_2026','one_time_2025','one_time_old'].indexOf(status) < 0) status = 'erratic';

        var owner = '\u2014';
        var orev = custOwnerRev.get(cname);
        if (orev && orev.size) {
            var best = null, bestRev = -Infinity, bestCnt = -Infinity;
            orev.forEach(function (rv, ow) {
                var ct = custOwnerCnt.get(cname).get(ow) || 0;
                if (rv > bestRev || (rv === bestRev && ct > bestCnt)) { best = ow; bestRev = rv; bestCnt = ct; }
            });
            owner = best;
        }

        var excl = excludedInfo(cname, owner);
        if (excl && excl.type !== 'note') status = 'snoozed';
        var note = noteInfo(cname, owner);

        var act = activity[cname] || {};
        var actD = act.date || null;
        var gapForCadence = avgGap ? avgGap : 3.0;
        var cadence = actD === null ? 'no_activity'
            : (tdDays(T, actD.getTime()) / 30.44 <= gapForCadence ? 'in_cadence' : 'out_of_cadence');

        var mr = {};
        mkeys.forEach(function (k) { mr[k] = pyRound(monthlyRev[k], 2); });

        customers.set(cname, {
            name: cname, owner: owner, total_rev: pyRound(totalRev, 2),
            rev_2023: rev2023, rev_2024: rev2024, rev_2025: rev2025,
            rev_2026_ytd: rev2026, rev_2026_ann: rev2026Ann, monthly_rev: mr,
            first_order: ymd(firstOrder), last_order: ymd(lastOrder),
            n_orders: nOrders, n_active_months: nActiveMonths,
            avg_gap: avgGap ? pyRound(avgGap, 2) : null,
            cv_gap: pyRound(cvGap, 3), cv_amount: pyRound(cvAmount, 3),
            expected_next: expectedNext ? ymd(expectedNext) : null,
            months_overdue: monthsOverdue, has_2026: has2026, expected_value: expectedValue,
            snooze_until: (excl && excl.type !== 'note' && excl.until) ? ymd(excl.until) : null,
            snooze_reason: (excl && excl.type !== 'note') ? excl.reason : null,
            note_reason: note ? note.reason : null,
            status: status, cadence: cadence,
            last_activity_date: actD ? ymd(actD) : null,
            last_activity_title: act.title || ''
        });
    });

    var CVALS = Array.from(customers.values());

    // ── Pareto tiers ─────────────────────────────────────────────────────────
    CVALS.forEach(function (c) { c.book = pyRound(Math.max(c.rev_2025, c.rev_2026_ann), 2); });
    var ranked = CVALS.slice().sort(function (a, b) { return b.book - a.book; });
    var totalBook = sum(CVALS.filter(function (c) { return c.book > 0; }), function (c) { return c.book; }) || 1.0;
    var cum = 0;
    ranked.forEach(function (c) {
        if (c.book <= 0) { c.tier = 'B'; return; }
        var prev = cum / totalBook;
        cum += c.book;
        c.tier = prev < 0.80 ? 'A' : 'B';
    });
    var aList = CVALS.filter(function (c) { return c.tier === 'A'; });
    var bList = CVALS.filter(function (c) { return c.tier === 'B'; });
    var aRev = sum(aList, function (c) { return c.book; }), bRev = sum(bList, function (c) { return c.book; });
    var nRev = CVALS.filter(function (c) { return c.book > 0; }).length || 1;
    var pareto = {
        a_n: aList.length, b_n: bList.length, a_rev: aRev, b_rev: bRev,
        a_pct_n: pyRound(aList.length / nRev * 100, 1), a_pct_rev: pyRound(aRev / totalBook * 100, 1),
        b_pct_n: pyRound(bList.length / nRev * 100, 1), b_pct_rev: pyRound(bRev / totalBook * 100, 1)
    };

    var RETAINED = ['growing','on_track','not_yet_due','new_2026','snoozed'];
    var AT_RISK = ['significantly_overdue','gone','overdue'];
    function isMA(v) { return v.n_orders >= 2 && (v.rev_2024 > 0 || v.rev_2025 > 0); }

    var materiallyActive = CVALS.filter(isMA);
    var retained = materiallyActive.filter(function (v) { return RETAINED.indexOf(v.status) >= 0; });
    var acctPct = materiallyActive.length ? retained.length / materiallyActive.length * 100 : 0;
    var rev2025Total = sum(materiallyActive, function (v) { return v.rev_2025; });
    var revPct = rev2025Total > 0 ? sum(retained, function (v) { return v.rev_2025; }) / rev2025Total * 100 : 0;
    var composite = pyRound(0.4 * acctPct + 0.6 * revPct, 1);

    var atRisk = sum(CVALS.filter(function (v) { return AT_RISK.indexOf(v.status) >= 0; }), function (v) { return v.rev_2025; });
    var decliningGap = sum(CVALS.filter(function (v) { return v.status === 'declining_2026'; }),
                           function (v) { return Math.max(0, v.rev_2025 - v.rev_2026_ann); });
    var totalExposure = atRisk + decliningGap;
    var total2025 = sum(CVALS, function (v) { return v.rev_2025; });
    var total2026Ytd = sum(CVALS, function (v) { return v.rev_2026_ytd; });
    var total2026Ann = (total2026Ytd / MONTHS_2026) * 12;
    var statusCounts = {}, cadenceCounts = {}, monthlyTotals = {};
    CVALS.forEach(function (v) {
        statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
        cadenceCounts[v.cadence] = (cadenceCounts[v.cadence] || 0) + 1;
        for (var k in v.monthly_rev) monthlyTotals[k] = (monthlyTotals[k] || 0) + v.monthly_rev[k];
    });

    // ── Month boundaries ─────────────────────────────────────────────────────
    var curMonthStart = firstOfMonth(TODAY);
    var nextMonthStart = addMonth(curMonthStart);
    var nextNextStart = addMonth(nextMonthStart);
    var cms = ymd(curMonthStart).slice(0, 8) + '01';
    var nms = ymd(nextMonthStart).slice(0, 8) + '01';
    var nnms = ymd(nextNextStart).slice(0, 8) + '01';

    // ── Per-rep aggregates ───────────────────────────────────────────────────
    function computeView(subset) {
        var ma = subset.filter(isMA);
        var ret = ma.filter(function (v) { return RETAINED.indexOf(v.status) >= 0; });
        var ap = ma.length ? ret.length / ma.length * 100 : 0;
        var r25t = sum(ma, function (v) { return v.rev_2025; });
        var rp = r25t > 0 ? sum(ret, function (v) { return v.rev_2025; }) / r25t * 100 : 0;
        var comp = pyRound(0.4 * ap + 0.6 * rp, 1);
        var ar = sum(subset.filter(function (v) { return AT_RISK.indexOf(v.status) >= 0; }), function (v) { return v.rev_2025; });
        var dg = sum(subset.filter(function (v) { return v.status === 'declining_2026'; }),
                     function (v) { return Math.max(0, v.rev_2025 - v.rev_2026_ann); });
        var t25 = sum(subset, function (v) { return v.rev_2025; });
        var t26 = sum(subset, function (v) { return v.rev_2026_ytd; });
        var sc = {}, cc = {}, mt = {};
        subset.forEach(function (v) {
            sc[v.status] = (sc[v.status] || 0) + 1;
            cc[v.cadence] = (cc[v.cadence] || 0) + 1;
            for (var k in v.monthly_rev) mt[k] = (mt[k] || 0) + v.monthly_rev[k];
        });
        var ry = { 2023:{}, 2024:{}, 2025:{}, 2026:{} };
        for (var k2 in mt) {
            var yr = +k2.slice(0, 4), mn = +k2.slice(5, 7);
            if (ry[yr]) ry[yr][mn] = (ry[yr][mn] || 0) + mt[k2];
        }
        function series(y) { var o = [], i; for (i = 1; i <= 12; i++) o.push(pyRound(ry[y][i] || 0, 2)); return o; }
        var due = subset.filter(function (v) { return v.status !== 'snoozed' && v.expected_next && cms <= v.expected_next && v.expected_next < nms; });
        var nxt = subset.filter(function (v) { return v.status !== 'snoozed' && v.expected_next && nms <= v.expected_next && v.expected_next < nnms; });
        function cadBy(kind) {
            return STAT_ORDER.map(function (s) {
                return subset.filter(function (v) { return v.status === s && v.cadence === kind; }).length;
            });
        }
        var scAll = {}; ALL_STATS.forEach(function (s) { scAll[s] = sc[s] || 0; });
        return {
            composite: comp, acct_pct: pyRound(ap, 1), rev_pct: pyRound(rp, 1),
            ma: ma.length, ret: ret.length,
            total_2025: pyRound(t25), total_2026_ytd: pyRound(t26),
            total_2026_ann: pyRound((t26 / MONTHS_2026) * 12),
            at_risk: pyRound(ar), declining_gap: pyRound(dg), total_exposure: pyRound(ar + dg),
            status_counts: scAll,
            cadence_counts: { in_cadence: cc.in_cadence || 0, out_of_cadence: cc.out_of_cadence || 0, no_activity: cc.no_activity || 0 },
            rev_2023: series(2023), rev_2024: series(2024), rev_2025: series(2025), rev_2026: series(2026),
            cad_in: cadBy('in_cadence'), cad_out: cadBy('out_of_cadence'), cad_no: cadBy('no_activity'),
            exp_this: pyRound(sum(due, function (v) { return v.expected_value; })), due_n: due.length,
            exp_next: pyRound(sum(nxt, function (v) { return v.expected_value; })), next_n: nxt.length,
            overdue_n: (sc.overdue || 0) + (sc.significantly_overdue || 0),
            sig_n: sc.significantly_overdue || 0, nyd_n: sc.not_yet_due || 0,
            cin: cc.in_cadence || 0, cout: cc.out_of_cadence || 0, cno: cc.no_activity || 0
        };
    }
    var viewMembers = POD_MEMBERS.slice();
    CVALS.forEach(function (v) {
        var o = v.owner || '\u2014';
        if (o && o !== '\u2014' && !viewMembers.some(function (m) { return o.toLowerCase() === m.toLowerCase(); }))
            viewMembers.push(o);
    });
    var VIEW_AGG = { __ALL__: computeView(CVALS) };
    viewMembers.forEach(function (m) {
        VIEW_AGG[m] = computeView(CVALS.filter(function (v) {
            return String(v.owner || '').toLowerCase() === m.toLowerCase();
        }));
    });

    // ── Render helpers ───────────────────────────────────────────────────────
    function fm(v) {
        if (!v) return '$0';
        return '$' + pyRound(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    function fd(s) {
        if (!s) return '\u2014';
        var p = String(s).split('-');
        return p.length === 3 ? (p[1] + '/' + p[2] + '/' + p[0]) : s;
    }
    function sbadge(s) {
        return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:'
            + (STATUS_COLORS[s] || '#7f8c8d') + '">' + (STATUS_LABELS[s] || s) + '</span>';
    }
    function cbadge(c) {
        return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:'
            + (CADENCE_COLORS[c] || '#7f8c8d') + '">' + (CADENCE_LABELS[c] || c) + '</span>';
    }
    function pbadge(p) {
        var c = { high:'#c8490c', medium:'#e67e22', low:'#27ae60' }[p] || '#7f8c8d';
        return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:'
            + c + '">' + String(p).toUpperCase() + '</span>';
    }
    function obadge(o) {
        if (!POD_MODE || !o || o === '\u2014') return '';
        return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:'
            + ownerColor(o) + '">' + String(o).split(/\s+/)[0] + '</span>';
    }
    function notetag(c) {
        var reason = c && c.note_reason;
        if (!reason) return '';
        var safe = String(reason).split('"').join('&quot;');
        return ' <span title="' + safe + '" style="display:inline-block;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;color:#8a5700;background:#fef3cd;border:1px solid #f0d98a;cursor:help">NOTE</span>';
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
    function aggspan(field, text, fmt) {
        return '<span data-agg="' + field + '" data-fmt="' + (fmt || 'int') + '">' + text + '</span>';
    }
    function slug(s) {
        return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    }
    function ownLower(c) { return String((c && c.owner) || '').toLowerCase(); }
    function gapStr1(g) {
        return Number.isInteger(g) ? String(g) : pyFloatStr(pyRound(g, 1));
    }

    var scoreC = composite >= 70 ? '#27ae60' : composite >= 50 ? '#e67e22' : '#c8490c';
    var health = composite >= 70 ? 'Healthy' : composite >= 50 ? 'Needs Attention' : 'At Risk';

    // ── Summary ──────────────────────────────────────────────────────────────
    var summary = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:18px">'
        + tile('2025 Total', aggspan('total_2025', fm(total2025), 'money'))
        + tile('2026 YTD', aggspan('total_2026_ytd', fm(total2026Ytd), 'money'), 'Ann: ' + aggspan('total_2026_ann', fm(total2026Ann), 'money'))
        + tile('Revenue At Risk', aggspan('at_risk', fm(atRisk), 'money'), "Overdue+gone accounts' 2025", true)
        + tile('Declining Gap', aggspan('declining_gap', fm(decliningGap), 'money'), 'Pace vs 2025', true)
        + tile('Total Exposure', aggspan('total_exposure', fm(totalExposure), 'money'), '', true)
        + tile('Retention Score', aggspan('composite', pyFloatStr(composite), 'num') + '/100', aggspan('__health__', health, 'text'))
        + tile('Overdue', aggspan('overdue_n', String((statusCounts.overdue || 0) + (statusCounts.significantly_overdue || 0)), 'int'), aggspan('sig_n', String(statusCounts.significantly_overdue || 0), 'int') + ' significant')
        + tile('Not Yet Due', aggspan('nyd_n', String(statusCounts.not_yet_due || 0), 'int'), 'Expected soon')
        + '</div>'
        + '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-bottom:14px">'
        + '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Activity Cadence</div>'
        + '<div style="display:flex;gap:28px;flex-wrap:wrap">'
        + '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#27ae60">' + aggspan('cin', String(cadenceCounts.in_cadence || 0), 'int') + '</div><div style="font-size:11px;color:#6b6460">In Cadence</div></div>'
        + '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#e67e22">' + aggspan('cout', String(cadenceCounts.out_of_cadence || 0), 'int') + '</div><div style="font-size:11px;color:#6b6460">Out of Cadence</div></div>'
        + '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#7f8c8d">' + aggspan('cno', String(cadenceCounts.no_activity || 0), 'int') + '</div><div style="font-size:11px;color:#6b6460">No Activity</div></div>'
        + '</div></div>';

    var chips = '<div id="statusChips" style="display:flex;flex-wrap:wrap;gap:7px">';
    ALL_STATS.forEach(function (st) {
        var cnt = statusCounts[st] || 0;
        if (cnt) chips += '<div style="background:' + (STATUS_COLORS[st] || '#7f8c8d') + ';color:#fff;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600">' + (STATUS_LABELS[st] || st) + ': ' + cnt + '</div>';
    });
    chips += '</div>';
    summary += '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px"><div style="font-size:15px;font-weight:700;margin-bottom:10px;font-family:Georgia,serif">Status Breakdown</div>' + chips + '</div>';

    if (POD_MODE) {
        var ot = new Map();
        CVALS.forEach(function (c) {
            var o = c.owner || '\u2014';
            if (!ot.has(o)) ot.set(o, { r25: 0, r26: 0, n: 0 });
            var d = ot.get(o); d.r25 += c.rev_2025; d.r26 += c.rev_2026_ytd; d.n += 1;
        });
        var members = POD_MEMBERS.slice();
        ot.forEach(function (_d, o) {
            if (o === '\u2014') return;
            if (!members.some(function (m) { return o.toLowerCase() === m.toLowerCase(); })) members.push(o);
        });
        function aggFor(nm) {
            var found = { r25: 0, r26: 0, n: 0 };
            ot.forEach(function (d, o) { if (o.toLowerCase() === nm.toLowerCase()) found = d; });
            return found;
        }
        var op = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-top:14px"><div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Pod Split by Rep</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">';
        members.forEach(function (o) {
            var d = aggFor(o), isNew = (d.n === 0);
            var newTag = isNew ? ' <span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:700;color:#1a5276;background:#eaf3fb;border:1px solid #b8d8ef">NEW</span>' : '';
            var body = isNew
                ? '<span style="color:#9e9086;font-style:italic">New \u2014 no activity yet in NetSuite. Fills in automatically once orders are logged.</span>'
                : '2025: ' + fm(d.r25) + '<br>2026 YTD: ' + fm(d.r26) + '<br>' + d.n + ' accounts';
            op += '<div style="border:1px solid #e2ddd6;border-radius:8px;padding:14px"><div style="font-weight:700;margin-bottom:6px">' + o + ' ' + obadge(o) + newTag + '</div><div style="font-size:12px;color:#6b6460;line-height:1.7">' + body + '</div></div>';
        });
        summary += op + '</div></div>';
    }

    // ── Retention panel ──────────────────────────────────────────────────────
    var healthBg = composite >= 70 ? '#d5f5e3' : composite >= 50 ? '#fef3cd' : '#fde8e8';
    var healthFc = composite >= 70 ? '#1a6639' : composite >= 50 ? '#8a5700' : '#8b1a1a';
    var retHtml = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:22px;margin-bottom:14px">'
        + '<div style="font-size:15px;font-weight:700;margin-bottom:14px;font-family:Georgia,serif">Retention Score <span id="retScope" style="font-size:12px;font-weight:600;color:#9e9086">\u2014 whole pod</span></div>'
        + '<div id="retHealth" style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;background:' + healthBg + ';color:' + healthFc + ';margin-bottom:12px">' + health + '</div>'
        + '<div style="font-size:48px;font-weight:800;color:' + scoreC + ';line-height:1;margin-bottom:8px"><span id="retScoreNum">' + pyFloatStr(composite) + '</span><span style="font-size:18px;color:#9e9086">/100</span></div>'
        + '<div style="max-width:380px;margin-bottom:12px">'
        + '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#6b6460;margin-bottom:3px"><span>Account Retention</span><span id="retAcctPct">' + pyFloatStr(pyRound(acctPct, 1)) + '%</span></div><div style="background:#f0ece7;border-radius:4px;height:8px"><div id="retAcctBar" style="background:#2980b9;border-radius:4px;height:8px;width:' + Math.min(100, Math.max(0, acctPct)) + '%"></div></div></div>'
        + '<div><div style="display:flex;justify-content:space-between;font-size:12px;color:#6b6460;margin-bottom:3px"><span>Revenue Retention</span><span id="retRevPct">' + pyFloatStr(pyRound(revPct, 1)) + '%</span></div><div style="background:#f0ece7;border-radius:4px;height:8px"><div id="retRevBar" style="background:#27ae60;border-radius:4px;height:8px;width:' + Math.min(100, Math.max(0, revPct)) + '%"></div></div></div>'
        + '</div>'
        + '<div style="font-size:12px;color:#9e9086"><span id="retMA">' + materiallyActive.length + '</span> materially active customers &nbsp;|&nbsp; <span id="retRET">' + retained.length + '</span> retained</div>'
        + '</div>';
    if (POD_MODE) {
        var pr = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px"><div style="font-size:15px;font-weight:700;margin-bottom:4px;font-family:Georgia,serif">Retention Score by Rep</div><div style="font-size:12px;color:#9e9086;margin-bottom:14px">Same 0\u2013100 measure (40% accounts retained + 60% revenue retained), computed on each rep&#39;s own book.</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">';
        viewMembers.forEach(function (m) {
            var a = VIEW_AGG[m] || {};
            var cmp = a.composite || 0, man = a.ma || 0;
            var col = cmp >= 70 ? '#27ae60' : cmp >= 50 ? '#e67e22' : '#c8490c';
            var inner = man === 0
                ? '<div style="font-size:12px;color:#9e9086;font-style:italic;margin-top:6px">New \u2014 no activity yet</div>'
                : '<div style="font-size:34px;font-weight:800;color:' + col + ';line-height:1;margin:4px 0 6px">' + pyFloatStr(cmp) + '<span style="font-size:14px;color:#9e9086">/100</span></div>'
                  + '<div style="font-size:12px;color:#6b6460">Acct ' + pyFloatStr(a.acct_pct || 0) + '% &nbsp;\u00b7&nbsp; Rev ' + pyFloatStr(a.rev_pct || 0) + '%</div>'
                  + '<div style="font-size:11px;color:#9e9086;margin-top:3px">' + man + ' materially active \u00b7 ' + (a.ret || 0) + ' retained</div>';
            pr += '<div style="border:1px solid #e2ddd6;border-radius:8px;border-top:3px solid ' + ownerColor(m) + ';padding:14px">'
                + '<div style="font-weight:700">' + m + ' ' + obadge(m) + '</div>' + inner + '</div>';
        });
        retHtml += pr + '</div></div>';
    }

    // ── Revenue chart tab ────────────────────────────────────────────────────
    var revYrs = { 2023:{}, 2024:{}, 2025:{}, 2026:{} };
    for (var mk in monthlyTotals) {
        var y = +mk.slice(0, 4), mn = +mk.slice(5, 7);
        if (revYrs[y]) revYrs[y][mn] = (revYrs[y][mn] || 0) + monthlyTotals[mk];
    }
    var chartTable = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2ddd6;color:#9e9086;font-weight:600">Month</th>';
    [2023, 2024, 2025, 2026].forEach(function (yr) {
        chartTable += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2ddd6;color:#9e9086;font-weight:600">' + yr + '</th>';
    });
    chartTable += '</tr></thead><tbody>';
    MON_ABBR.forEach(function (mnName, idx) {
        chartTable += '<tr style="border-bottom:1px solid #f0ece7"><td style="padding:6px 8px;font-weight:500">' + mnName + '</td>';
        [2023, 2024, 2025, 2026].forEach(function (yr) {
            var v = revYrs[yr][idx + 1] || 0;
            var st = v > 0 ? 'color:#c8490c;font-weight:600' : 'color:#ccc';
            chartTable += '<td style="padding:6px 8px;text-align:right;' + st + '">' + (v > 0 ? fm(v) : '\u2014') + '</td>';
        });
        chartTable += '</tr>';
    });
    chartTable += '</tbody></table></div>';
    var chartHtml = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:22px;margin-bottom:14px">'
        + '<div style="font-size:15px;font-weight:700;margin-bottom:14px;font-family:Georgia,serif">Monthly Revenue 2023\u20132026</div>'
        + '<canvas id="revChart" height="90" style="margin-bottom:14px"></canvas>'
        + '<details><summary style="cursor:pointer;font-size:12px;color:#9e9086">View as table</summary>'
        + chartTable + '</details></div>';

    // ── Risk cards ───────────────────────────────────────────────────────────
    var RISK = ['significantly_overdue','gone','overdue','declining_2026'];
    var rev2025s = CVALS.filter(function (c) { return c.rev_2025 > 0; })
                        .map(function (c) { return c.rev_2025; }).sort(function (a, b) { return a - b; });
    var median = rev2025s.length ? rev2025s[Math.floor(rev2025s.length / 2)] : 0;
    var riskCusts = CVALS.filter(function (c) { return RISK.indexOf(c.status) >= 0 && c.rev_2025 >= median; })
                         .sort(function (a, b) { return b.rev_2025 - a.rev_2025; });
    var riskHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">';
    riskCusts.slice(0, 24).forEach(function (c) {
        var borderC = STATUS_COLORS[c.status] || '#e74c3c', desc = '';
        if (c.status === 'significantly_overdue')
            desc = 'Expected reorder ' + fd(c.expected_next) + ' (avg gap ' + (c.avg_gap === null ? '?' : String(c.avg_gap)) + ' mo). ' + pyRound(c.months_overdue || 0) + ' months past due.';
        else if (c.status === 'gone')
            desc = 'Last order ' + fd(c.last_order) + '. No activity >12 months.';
        else if (c.status === 'overdue')
            desc = 'Expected ' + fd(c.expected_next) + '. About ' + pyRound(c.months_overdue || 0) + ' month(s) overdue.';
        else if (c.status === 'declining_2026')
            desc = 'Pacing ' + fm(c.rev_2026_ann) + ' ann. vs ' + fm(c.rev_2025) + ' in 2025. Gap: ' + fm(Math.max(0, (c.rev_2025 || 0) - (c.rev_2026_ann || 0))) + '.';
        var actInfo = c.last_activity_date ? fd(c.last_activity_date) : 'No activity logged';
        riskHtml += '<div class="ownrow" data-owner="' + ownLower(c) + '" style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:14px;border-left:4px solid ' + borderC + '">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">'
            + '<div style="font-weight:700;font-size:13px">' + c.name + notetag(c) + ' ' + obadge(c.owner) + '</div>' + sbadge(c.status) + '</div>'
            + '<div style="font-size:12px;color:#6b6460;margin-bottom:6px">2025: ' + fm(c.rev_2025) + ' &nbsp; 2026 YTD: ' + fm(c.rev_2026_ytd) + '</div>'
            + '<div style="font-size:12px;color:#4a4540;margin-bottom:8px;line-height:1.5">' + desc + '</div>'
            + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + cbadge(c.cadence)
            + '<span style="font-size:11px;color:#9e9086">' + actInfo + '</span></div></div>';
    });
    riskHtml += '</div>';

    // ── Customer table ───────────────────────────────────────────────────────
    var custsSorted = CVALS.slice().sort(function (a, b) { return (b.rev_2025 || 0) - (a.rev_2025 || 0); });
    var tblRows = '';
    custsSorted.forEach(function (c) {
        var actInfo = c.last_activity_date ? fd(c.last_activity_date) : '\u2014';
        var note = String(c.last_activity_title || '').slice(0, 40);
        var ownTd = POD_MODE ? '<td>' + obadge(c.owner) + '</td>' : '';
        tblRows += '<tr class="ownrow" data-owner="' + ownLower(c) + '" data-status="' + c.status + '" data-cadence="' + c.cadence + '" data-name="' + c.name.toLowerCase().split('"').join('').slice(0, 60) + '">'
            + ownTd
            + '<td><b>' + c.name + '</b>' + notetag(c) + '</td>'
            + '<td>' + sbadge(c.status) + '</td>'
            + '<td>' + tbadge(c.tier || 'B') + '</td>'
            + '<td style="text-align:right">' + fm(c.rev_2025) + '</td>'
            + '<td style="text-align:right">' + fm(c.rev_2026_ytd) + '</td>'
            + '<td style="text-align:right">' + fm(c.rev_2026_ann) + '</td>'
            + '<td>' + fd(c.last_order) + '</td>'
            + '<td>' + (c.expected_next ? fd(c.expected_next) : '\u2014') + '</td>'
            + '<td>' + cbadge(c.cadence) + '</td>'
            + '<td>' + actInfo + '</td>'
            + '<td style="font-size:11px;color:#6b6460">' + note + '</td>'
            + '</tr>';
    });
    var tableHtml = '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
        + '<input type="text" id="tblSearch" placeholder="Search..." oninput="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px;min-width:190px">'
        + '<select id="tblSt" onchange="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px"><option value="">All Statuses</option>';
    ALL_STATS.forEach(function (st) { tableHtml += '<option value="' + st + '">' + (STATUS_LABELS[st] || st) + '</option>'; });
    tableHtml += '</select><select id="tblCad" onchange="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px">'
        + '<option value="">All Cadences</option><option value="in_cadence">In Cadence</option>'
        + '<option value="out_of_cadence">Out of Cadence</option><option value="no_activity">No Activity</option>'
        + '</select><span id="tblCnt" style="font-size:12px;color:#9e9086;align-self:center"></span>'
        + '<span style="font-size:11px;color:#c8aa90;align-self:center">click a column heading to sort</span></div>'
        + '<div style="overflow:auto;border:1px solid #e2ddd6;border-radius:10px;height:calc(100vh - 250px);min-height:360px">'
        + '<table id="custT" class="sortable" style="width:100%;border-collapse:collapse;font-size:13px">'
        + '<thead><tr>';
    var TH = 'style="background:#f0ece7;padding:8px 10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;position:sticky;top:0;z-index:2;white-space:nowrap;cursor:pointer"';
    var cols = (POD_MODE ? ['Owner'] : []).concat(['Customer','Status','Tier','2025 Rev','2026 YTD','2026 Ann.','Last Order','Exp. Next','Cadence','Last Activity','Notes']);
    cols.forEach(function (h) {
        var tr = (h === '2025 Rev' || h === '2026 YTD' || h === '2026 Ann.')
            ? TH.replace('text-align:left', 'text-align:right') : TH;
        tableHtml += '<th ' + tr + '>' + h + '<span class="sarw" style="opacity:.35;font-size:9px"> \u21c5</span></th>';
    });
    tableHtml += '</tr></thead><tbody id="custTbody">' + tblRows + '</tbody></table></div>';

    // ── Expected reorders ────────────────────────────────────────────────────
    var dueRows = CVALS.filter(function (c) { return c.status !== 'snoozed' && c.expected_next && c.expected_next >= cms && c.expected_next < nms; })
                       .sort(function (a, b) { return b.expected_value - a.expected_value; });
    var nextMonthDue = CVALS.filter(function (c) { return c.status !== 'snoozed' && c.expected_next && c.expected_next >= nms && c.expected_next < nnms; })
                            .sort(function (a, b) { return b.expected_value - a.expected_value; });
    var expThis = sum(dueRows, function (c) { return c.expected_value; });
    var expNext = sum(nextMonthDue, function (c) { return c.expected_value; });

    function dueSection(title, subtitle, rows, period, tier, accent) {
        var secId = 'out_' + period + '_' + tier, body;
        if (!rows.length) {
            body = '<p style="color:#9e9086;font-size:13px;margin:6px 0 0">None due this period.</p>';
        } else {
            var h = '<div style="overflow:auto;max-height:62vh;border:1px solid #f0ece7;border-radius:8px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
            var dcols = ['\u2713','Customer'].concat(POD_MODE ? ['Owner'] : [])
                .concat(['Status','Last Order','Exp. Date','Expected $','2025 Rev','2026 YTD','Avg Gap','Cadence']);
            dcols.forEach(function (col) {
                var al = (col === 'Expected $' || col === '2025 Rev' || col === '2026 YTD') ? 'text-align:right;' : 'text-align:left;';
                var cur = col !== '\u2713' ? 'cursor:pointer;' : '';
                var car = col !== '\u2713' ? '<span class="sarw" style="opacity:.35;font-size:9px"> \u21c5</span>' : '';
                h += '<th style="background:#f0ece7;padding:7px 9px;' + al + cur + 'font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;white-space:nowrap;position:sticky;top:0;z-index:2">' + col + car + '</th>';
            });
            h += '</tr></thead><tbody>';
            rows.forEach(function (c) {
                var rid = 'er_' + period + '_' + slug(c.name);
                var ownerTd = POD_MODE ? '<td style="padding:7px 9px">' + obadge(c.owner) + '</td>' : '';
                h += '<tr class="er ownrow" data-owner="' + ownLower(c) + '" data-id="' + rid + '" data-exp="' + c.expected_value + '" data-r25="' + c.rev_2025 + '" data-r26="' + c.rev_2026_ytd + '" data-period="' + period + '" data-tier="' + tier + '" style="border-bottom:1px solid #f0ece7">'
                    + '<td style="padding:7px 9px;text-align:center"><input type="checkbox" class="erck" onclick="erToggle(this)"></td>'
                    + '<td style="padding:7px 9px"><b>' + c.name + '</b>' + notetag(c) + '</td>'
                    + ownerTd
                    + '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>'
                    + '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.last_order) + '</td>'
                    + '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.expected_next) + '</td>'
                    + '<td style="padding:7px 9px;text-align:right;font-weight:700;color:#c8490c">' + fm(c.expected_value) + '</td>'
                    + '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_2025) + '</td>'
                    + '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_2026_ytd) + '</td>'
                    + '<td style="padding:7px 9px">' + (c.avg_gap ? pyRound(c.avg_gap) + ' mo' : '\u2014') + '</td>'
                    + '<td style="padding:7px 9px">' + cbadge(c.cadence) + '</td>'
                    + '</tr>';
            });
            var clab = String(2 + (POD_MODE ? 1 : 0));
            h += '<tr class="totalrow" style="background:#fff8f0;border-top:2px solid #c8490c">'
                + '<td colspan="' + clab + '" style="padding:8px 9px;font-weight:700">TOTAL (<span data-roll="n">' + rows.length + '</span> accounts)</td>'
                + '<td></td><td></td><td></td>'
                + '<td data-roll="exp" style="padding:8px 9px;text-align:right;font-weight:800;color:#c8490c;font-size:14px">' + fm(sum(rows, function (c) { return c.expected_value; })) + '</td>'
                + '<td data-roll="r25" style="padding:8px 9px;text-align:right;font-weight:600">' + fm(sum(rows, function (c) { return c.rev_2025; })) + '</td>'
                + '<td data-roll="r26" style="padding:8px 9px;text-align:right;font-weight:600">' + fm(sum(rows, function (c) { return c.rev_2026_ytd; })) + '</td>'
                + '<td colspan="2"></td></tr>';
            body = h + '</tbody></table></div>';
        }
        return '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-bottom:14px;border-left:5px solid ' + accent + '">'
            + '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px">'
            + '<div style="font-size:15px;font-weight:700;font-family:Georgia,serif">' + title + '</div>'
            + '<div id="' + secId + '" style="font-size:12px;font-weight:700;color:' + accent + '"></div></div>'
            + '<div style="font-size:12px;color:#9e9086;margin-bottom:8px">' + subtitle + '</div>'
            + body + '</div>';
    }

    var curMonthName = MONTH_NAMES[TODAY.getUTCMonth()] + ' ' + TODAY.getUTCFullYear();
    var nextMonthName = MONTH_NAMES[nextMonthStart.getUTCMonth()] + ' ' + nextMonthStart.getUTCFullYear();
    function splitTier(rows) {
        return [rows.filter(function (c) { return c.tier === 'A'; }),
                rows.filter(function (c) { return c.tier !== 'A'; })];
    }
    var curT = splitTier(dueRows), nxtT = splitTier(nextMonthDue);
    var paretoBanner = '<div style="background:#fff;border:1px solid #e2ddd6;border-left:5px solid #c8490c;border-radius:10px;padding:16px 18px;margin-bottom:14px">'
        + '<div style="font-size:15px;font-weight:700;font-family:Georgia,serif;margin-bottom:6px">The 80/20 of the book</div>'
        + '<div style="font-size:13px;color:#4a4540;line-height:1.7">'
        + '<b style="color:#c8490c">Key Accounts (Tier A):</b> ' + pareto.a_n + ' accounts (~' + pyFloatStr(pareto.a_pct_n) + '% of the book) drive ' + fm(pareto.a_rev) + ' &mdash; ' + pyFloatStr(pareto.a_pct_rev) + '% of revenue. Protect these first.<br>'
        + '<b>Long Tail (Tier B):</b> ' + pareto.b_n + ' accounts (~' + pyFloatStr(pareto.b_pct_n) + '%) make up ' + fm(pareto.b_rev) + ' &mdash; ' + pyFloatStr(pareto.b_pct_rev) + '%. Keep warm, batch the outreach.'
        + '</div></div>';
    var dueHtml = paretoBanner
        + '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:10px 14px;font-size:12px;color:#1a5276;margin-bottom:14px">Expected $ = average order size over the trailing 12 months. Check off each account as the order is placed &mdash; the outstanding total updates live and is saved in your browser, so you and the pod can see what is still open.</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px">'
        + tile('Expected Revenue &mdash; ' + curMonthName, aggspan('exp_this', fm(expThis), 'money'), aggspan('due_n', String(dueRows.length), 'int') + ' accounts due', true)
        + tile('Expected Revenue &mdash; ' + nextMonthName, aggspan('exp_next', fm(expNext), 'money'), aggspan('next_n', String(nextMonthDue.length), 'int') + ' accounts due')
        + '</div>'
        + '<h3 style="font-family:Georgia,serif;font-size:16px;margin:6px 0 10px">Due in ' + curMonthName + '</h3>'
        + dueSection('\u2605 Key Accounts &mdash; Tier A', 'Top ~20% of accounts / ~80% of revenue. Call these first.', curT[0], 'cur', 'A', '#c8490c')
        + dueSection('Long Tail &mdash; Tier B', 'Bottom ~80% of accounts / ~20% of revenue. Batch these.', curT[1], 'cur', 'B', '#9e9086')
        + '<h3 style="font-family:Georgia,serif;font-size:16px;margin:18px 0 10px">Due in ' + nextMonthName + '</h3>'
        + dueSection('\u2605 Key Accounts &mdash; Tier A', 'Top ~20% of accounts / ~80% of revenue.', nxtT[0], 'next', 'A', '#c8490c')
        + dueSection('Long Tail &mdash; Tier B', 'Bottom ~80% of accounts / ~20% of revenue.', nxtT[1], 'next', 'B', '#9e9086');

    // ── Month call plan ──────────────────────────────────────────────────────
    var weekStarts = [];
    for (var wd = curMonthStart.getTime(); wd < nextMonthStart.getTime(); wd += 7 * MS)
        weekStarts.push(new Date(wd));
    var lastDayOfMonth = new Date(nextMonthStart.getTime() - MS).getUTCDate();
    var scheduleKeys = [], schedule = {};
    function pushSched(label, item) {
        if (!(label in schedule)) { schedule[label] = []; scheduleKeys.push(label); }
        schedule[label].push(item);
    }
    var seen = {};
    CVALS.slice().sort(function (a, b) { return b.rev_2025 - a.rev_2025; }).forEach(function (v) {
        if (v.status === 'snoozed' || !v.expected_next) return;
        var en = parseDate(v.expected_next);
        if (!(en.getTime() >= curMonthStart.getTime() && en.getTime() < nextMonthStart.getTime())) return;
        var wkNum = Math.min(Math.floor(tdDays(en.getTime(), curMonthStart.getTime()) / 7) + 1, weekStarts.length);
        var ws = weekStarts[wkNum - 1];
        var label = 'Week ' + wkNum + ' (' + MON_ABBR[curMonthStart.getUTCMonth()] + ' ' + ws.getUTCDate()
            + '-' + Math.min(ws.getUTCDate() + 6, lastDayOfMonth) + ')';
        pushSched(label, { name: v.name, reason: 'Expected Order Due', expected_next: v.expected_next,
            rev_2025: v.rev_2025, rev_2026_ytd: v.rev_2026_ytd, status: v.status, cadence: v.cadence,
            last_activity_date: v.last_activity_date, last_activity_title: v.last_activity_title,
            priority: 'medium', avg_gap: v.avg_gap });
        seen[v.name] = 1;
    });
    CVALS.filter(function (x) { return x.status === 'significantly_overdue'; })
        .sort(function (a, b) { return b.rev_2025 - a.rev_2025; }).slice(0, 8).forEach(function (v) {
        if (seen[v.name]) return;
        var label = 'Week 1 (' + MON_ABBR[curMonthStart.getUTCMonth()] + ' ' + pad(curMonthStart.getUTCDate())
            + '-' + Math.min(curMonthStart.getUTCDate() + 6, lastDayOfMonth) + ')';
        pushSched(label, { name: v.name, reason: 'Significantly Overdue - Urgent', expected_next: v.expected_next,
            rev_2025: v.rev_2025, rev_2026_ytd: v.rev_2026_ytd, status: v.status, cadence: v.cadence,
            last_activity_date: v.last_activity_date, last_activity_title: v.last_activity_title,
            priority: 'high', avg_gap: v.avg_gap });
        seen[v.name] = 1;
    });
    CVALS.filter(function (x) { return x.status === 'overdue'; })
        .sort(function (a, b) { return b.rev_2025 - a.rev_2025; }).slice(0, 6).forEach(function (v) {
        if (seen[v.name]) return;
        var label = weekStarts.length > 1 ? 'Week 2' : 'Week 1';
        for (var i = 0; i < scheduleKeys.length; i++) {
            if (scheduleKeys[i].indexOf('Week 2') >= 0) { label = scheduleKeys[i]; break; }
        }
        pushSched(label, { name: v.name, reason: 'Overdue - Follow Up', expected_next: v.expected_next,
            rev_2025: v.rev_2025, rev_2026_ytd: v.rev_2026_ytd, status: v.status, cadence: v.cadence,
            last_activity_date: v.last_activity_date, last_activity_title: v.last_activity_title,
            priority: 'high', avg_gap: v.avg_gap });
        seen[v.name] = 1;
    });
    var PRI = { high: 0, medium: 1, low: 2 };
    scheduleKeys.forEach(function (wk) {
        schedule[wk].sort(function (a, b) {
            var d = (PRI[a.priority] === undefined ? 2 : PRI[a.priority]) - (PRI[b.priority] === undefined ? 2 : PRI[b.priority]);
            return d !== 0 ? d : (b.rev_2025 - a.rev_2025);
        });
    });

    var currentWeekIdx = Math.min(Math.floor(tdDays(T, curMonthStart.getTime()) / 7), weekStarts.length - 1);
    function daysAgo(dateStr) {
        if (!dateStr) return null;
        var d = parseDate(dateStr);
        if (!d) return null;
        var n = tdDays(T, d.getTime());
        if (n === 0) return 'today';
        if (n === 1) return 'yesterday';
        if (n < 7) return n + ' days ago';
        if (n < 30) { var w = Math.floor(n / 7); return w + (w === 1 ? ' week ago' : ' weeks ago'); }
        var m = pyRound(n / 30.44);
        return m + (m === 1 ? ' month ago' : ' months ago');
    }
    function callObjective(row) {
        var cdata = customers.get(row.name) || {};
        var mo = cdata.months_overdue;
        if (row.reason.indexOf('Significantly Overdue') >= 0) {
            var suffix = (mo && mo > 0) ? ' \u2014 ' + pyFloatStr(pyRound(mo, 1)) + ' months past expected' : '';
            return 'Urgent check-in: well past expected reorder window' + suffix;
        }
        if (row.reason.indexOf('Overdue') >= 0) return 'Follow up: order is past due, confirm reorder plans';
        return 'Touch base: order expected around ' + fd(row.expected_next);
    }
    function actText(row) {
        var ago = daysAgo(row.last_activity_date);
        if (row.last_activity_title && ago) return { t: '"' + String(row.last_activity_title).slice(0, 60) + '" &mdash; ' + ago, warn: false };
        if (ago) return { t: 'Last contact ' + ago, warn: false };
        return { t: 'No contact on record', warn: true };
    }
    function acCard(row, cid, revVal, revLbl, withPri, priority) {
        var a = actText(row);
        var gapStr = row.avg_gap ? ' <span style="font-size:11px;color:#9e9086">Avg gap: ' + gapStr1(row.avg_gap) + ' mo</span>' : '';
        var cd = customers.get(row.name) || {};
        return '<div class="ac ownrow" data-owner="' + String(cd.owner || '').toLowerCase() + '" id="' + cid + '">'
            + '<div>'
            + '<div class="ac-name">' + row.name + (withPri ? ' ' + pbadge(priority) + (POD_MODE ? ' ' + obadge(cd.owner) : '') : '') + notetag(cd) + '</div>'
            + '<div class="ac-obj">' + callObjective(row) + '</div>'
            + '<div class="ac-meta">' + sbadge(row.status) + ' ' + cbadge(row.cadence) + gapStr + '</div>'
            + '<div class="ac-act' + (a.warn ? ' warn' : '') + '">' + a.t + '</div>'
            + '</div>'
            + '<div class="ac-right">'
            + '<div class="ac-rev">' + fm(revVal) + '</div>'
            + '<div class="ac-rev-lbl">' + revLbl + '</div>'
            + (withPri ? '<div style="font-size:11px;color:#9e9086;margin-bottom:6px">2025: ' + fm(row.rev_2025) + '</div>' : '')
            + '<label class="call-lbl" id="l' + cid + '" onclick="tc(\'' + cid + '\');return false;">'
            + '<input type="checkbox" onclick="event.stopPropagation()"> Called'
            + '</label>'
            + '</div></div>';
    }

    var totalCalls = 0, highTotal = 0;
    scheduleKeys.forEach(function (k) {
        totalCalls += schedule[k].length;
        schedule[k].forEach(function (r) { if (r.priority === 'high') highTotal++; });
    });
    var SCHED_CSS = '<style>'
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
        + '</style>';
    var schedHtml = SCHED_CSS
        + '<div class="sc-banner">'
        + '<div><h2>' + curMonthName + ' Call Plan</h2><p>Work HIGH priority first each week. Check off accounts as you call.</p></div>'
        + '<div class="sc-stat"><div class="big">' + totalCalls + '</div>'
        + '<div class="lbl">' + highTotal + ' HIGH &middot; ' + (totalCalls - highTotal) + ' expected orders</div></div>'
        + '</div>';
    scheduleKeys.slice().sort().forEach(function (wk, wkIdx) {
        var rows = schedule[wk];
        if (!rows.length) return;
        var isCur = (wkIdx === currentWeekIdx);
        var parts = wk.split('(');
        var numStr = parts[0].trim();
        var dateStr = parts.length > 1 ? '(' + parts.slice(1).join('(') : '';
        var hi = rows.filter(function (r) { return r.priority === 'high'; });
        var md = rows.filter(function (r) { return r.priority !== 'high'; });
        schedHtml += '<div class="wk-card">'
            + '<div class="wk-hdr' + (isCur ? ' cur' : '') + '">'
            + '<div><span class="wk-title">' + numStr + '</span>'
            + '<span class="wk-dates">' + dateStr + '</span>'
            + (isCur ? '<span class="cur-badge">THIS WEEK</span>' : '')
            + '</div>'
            + '<div class="wk-counts">'
            + (hi.length ? '<span class="wk-ct hi">' + hi.length + ' HIGH</span>' : '')
            + (md.length ? '<span class="wk-ct md">' + md.length + (md.length === 1 ? ' EXPECTED ORDER' : ' EXPECTED ORDERS') + '</span>' : '')
            + '</div></div>'
            + '<div class="pri-section">';
        if (hi.length) {
            schedHtml += '<div class="pri-hdr hi">&#9888; HIGH PRIORITY &mdash; Call These First</div>';
            hi.forEach(function (row, i) { schedHtml += acCard(row, 'c' + wkIdx + 'h' + i, row.rev_2025, '2025 rev', false); });
        }
        if (md.length) {
            schedHtml += '<div class="pri-hdr md">&#x25cf; EXPECTED ORDERS &mdash; Touch Base</div>';
            md.forEach(function (row, i) { schedHtml += acCard(row, 'c' + wkIdx + 'm' + i, row.rev_2025, '2025 rev', false); });
        }
        schedHtml += '<div class="sec-pad"></div></div></div>';
    });

    // ── This week: day-by-day ────────────────────────────────────────────────
    var dow = TODAY.getUTCDay();
    var weekMonday = new Date(T - ((dow + 6) % 7) * MS);
    var weekDays = [];
    for (var wdi = 0; wdi < 5; wdi++) weekDays.push(new Date(weekMonday.getTime() + wdi * MS));
    var weekList = [], weekSeen = {};
    CVALS.filter(function (x) { return x.status === 'significantly_overdue'; })
        .sort(function (a, b) { return b.rev_2025 - a.rev_2025; }).slice(0, 10).forEach(function (v) {
        weekList.push({ c: v, priority: 'high', reason: 'Significantly Overdue - Urgent' });
        weekSeen[v.name] = 1;
    });
    CVALS.filter(function (x) { return x.status === 'overdue'; })
        .sort(function (a, b) { return b.rev_2025 - a.rev_2025; }).slice(0, 8).forEach(function (v) {
        if (weekSeen[v.name]) return;
        weekList.push({ c: v, priority: 'high', reason: 'Overdue - Follow Up' });
        weekSeen[v.name] = 1;
    });
    dueRows.slice().sort(function (a, b) {
        var an = a.expected_next || '9999', bn = b.expected_next || '9999';
        if (an < bn) return -1;
        if (an > bn) return 1;
        return b.expected_value - a.expected_value;
    }).slice(0, 15).forEach(function (v) {
        if (weekSeen[v.name]) return;
        weekList.push({ c: v, priority: 'medium', reason: 'Expected Order Due' });
        weekSeen[v.name] = 1;
    });
    var nWeek = weekList.length;
    var perDay = nWeek ? Math.max(1, Math.ceil(nWeek / 5)) : 0;
    var dayBins = [];
    for (var bi = 0; bi < 5; bi++) dayBins.push(weekList.slice(bi * perDay, (bi + 1) * perDay));
    var weekHigh = weekList.filter(function (e) { return e.priority === 'high'; }).length;
    var weekExpRev = sum(weekList, function (e) { return e.c.expected_value; });

    var weekHtml = '<div class="sc-banner">'
        + '<div><h2>Call Plan &mdash; Week of ' + MONTH_NAMES[weekMonday.getUTCMonth()] + ' ' + pad(weekMonday.getUTCDate()) + '</h2>'
        + '<p>Priority-first: HIGH accounts land Monday&ndash;Tuesday. Check off as you call.</p></div>'
        + '<div class="sc-stat"><div class="big">' + nWeek + '</div>'
        + '<div class="lbl">' + weekHigh + ' HIGH &middot; ' + fm(weekExpRev) + ' expected reorder value</div></div>'
        + '</div>';
    if (!weekList.length)
        weekHtml += '<p style="color:#9e9086;font-size:13px">No calls needed this week \u2014 nothing overdue or due this month.</p>';
    weekDays.forEach(function (day, di) {
        var entries = dayBins[di] || [];
        var isToday = ymd(day) === ymd(TODAY);
        var dayExp = sum(entries, function (e) { return e.c.expected_value; });
        var nHi = entries.filter(function (e) { return e.priority === 'high'; }).length;
        var nMd = entries.length - nHi;
        weekHtml += '<div class="wk-card">'
            + '<div class="wk-hdr' + (isToday ? ' cur' : '') + '">'
            + '<div><span class="wk-title">' + DAY_NAMES[day.getUTCDay()] + '</span>'
            + '<span class="wk-dates">' + MON_ABBR[day.getUTCMonth()] + ' ' + pad(day.getUTCDate()) + '</span>'
            + (isToday ? '<span class="cur-badge">TODAY</span>' : '')
            + '</div>'
            + '<div class="wk-counts">'
            + (nHi ? '<span class="wk-ct hi">' + nHi + ' HIGH</span>' : '')
            + (nMd ? '<span class="wk-ct md">' + nMd + ' EXPECTED</span>' : '')
            + '<span class="wk-ct" style="background:#eef4ee;color:#1a6639">' + fm(dayExp) + '</span>'
            + '</div></div>'
            + '<div class="pri-section">';
        if (!entries.length)
            weekHtml += '<p style="color:#9e9086;font-size:13px;padding:12px 0">No calls scheduled.</p>';
        entries.forEach(function (e, i) {
            var row = e.c;
            var rowIn = { name: row.name, reason: e.reason, expected_next: row.expected_next,
                rev_2025: row.rev_2025, status: row.status, cadence: row.cadence,
                last_activity_date: row.last_activity_date, last_activity_title: row.last_activity_title,
                avg_gap: row.avg_gap };
            weekHtml += acCard(rowIn, 'wd' + di + 'i' + i, row.expected_value, 'expected reorder', true, e.priority);
        });
        weekHtml += '<div class="sec-pad"></div></div></div>';
    });

    // ── Cadence tab ──────────────────────────────────────────────────────────
    var outCad = CVALS.filter(function (c) { return c.cadence === 'out_of_cadence' && c.rev_2025 > 0; })
                      .sort(function (a, b) { return b.rev_2025 - a.rev_2025; });
    var cadHtml = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px;margin-bottom:14px"><div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Cadence by Status</div><canvas id="cadChart" height="80"></canvas></div>'
        + '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px"><div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Top Out-of-Cadence Accounts</div>'
        + '<div style="overflow:auto;max-height:62vh;border:1px solid #f0ece7;border-radius:8px"><table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
    (POD_MODE ? ['Owner'] : []).concat(['Customer','Status','2025 Rev','Last Activity','Notes','Exp. Next']).forEach(function (h) {
        cadHtml += '<th style="background:#f0ece7;padding:7px 9px;font-weight:600;font-size:11px;text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;text-align:left;white-space:nowrap;position:sticky;top:0;z-index:2;cursor:pointer">' + h + '<span class="sarw" style="opacity:.35;font-size:9px"> \u21c5</span></th>';
    });
    cadHtml += '</tr></thead><tbody>';
    outCad.slice(0, 80).forEach(function (c) {
        cadHtml += '<tr class="ownrow" data-owner="' + ownLower(c) + '" style="border-bottom:1px solid #f0ece7">'
            + (POD_MODE ? '<td style="padding:7px 9px">' + obadge(c.owner) + '</td>' : '')
            + '<td style="padding:7px 9px"><b>' + c.name + '</b></td>'
            + '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>'
            + '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_2025) + '</td>'
            + '<td style="padding:7px 9px;white-space:nowrap">' + (c.last_activity_date ? fd(c.last_activity_date) : '\u2014') + '</td>'
            + '<td style="padding:7px 9px;font-size:11px;color:#6b6460">' + String(c.last_activity_title || '').slice(0, 50) + '</td>'
            + '<td style="padding:7px 9px;white-space:nowrap">' + (c.expected_next ? fd(c.expected_next) : '\u2014') + '</td>'
            + '</tr>';
    });
    cadHtml += '</tbody></table></div></div>';

    // ── Rep controls ─────────────────────────────────────────────────────────
    var repbar = '', repSelect = '';
    if (POD_MODE) {
        var opts = '<option value="__ALL__">All reps \u2014 whole pod</option>';
        viewMembers.forEach(function (m) {
            opts += '<option value="' + m.split('"').join('') + '">' + m + '</option>';
        });
        repbar = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:8px 10px;background:#fff;border:1px solid #e2ddd6;border-radius:8px;width:fit-content">'
            + '<span style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9e9086">View by rep</span>'
            + '<select class="repsel" onchange="applyRep(this.value)" style="padding:6px 10px;border-radius:7px;border:1px solid #e2ddd6;background:#fff;font-size:13px;font-weight:600;color:#1a1714">' + opts + '</select></div>';
        repSelect = '<div style="display:flex;align-items:center;gap:8px">'
            + '<span style="color:#9e9086;font-size:11px;letter-spacing:.6px;text-transform:uppercase">View by rep</span>'
            + '<select id="repFilter" onchange="applyRep(this.value)" style="padding:7px 11px;border-radius:7px;border:1px solid #4a4038;background:#2a2420;color:#fff;font-size:13px;font-weight:600">' + opts + '</select></div>';
    }

    var cadLabels = JSON.stringify(STAT_ORDER.map(function (s) { return STATUS_LABELS[s] || s; }));
    var monthYearStr = curMonthName;
    var genStr = MONTH_NAMES[TODAY.getUTCMonth()] + ' ' + pad(TODAY.getUTCDate()) + ', ' + TODAY.getUTCFullYear();

    return {
        panels: {
            summary: summary, retention: retHtml, chart: chartHtml, risk: riskHtml,
            table: tableHtml, due: dueHtml, week: weekHtml, schedule: schedHtml, cadence: cadHtml
        },
        repbar: repbar, repSelect: repSelect,
        VIEW_AGG: VIEW_AGG, cadLabels: cadLabels,
        REP_NAME: REP_NAME, DASH_ID: DASH_ID,
        monthYearStr: monthYearStr, genStr: genStr,
        stats: {
            customers: customers.size, composite: composite, at_risk: pyRound(atRisk, 2),
            total_exposure: pyRound(totalExposure, 2), total_2025: pyRound(total2025, 2),
            total_2026_ytd: pyRound(total2026Ytd, 2), exp_this: pyRound(expThis, 2),
            due_n: dueRows.length, week_calls: nWeek, snoozed: statusCounts.snoozed || 0
        }
    };
}

    // ═══ SHELL ═══════════════════════════════════════════════════════════════
    var SHELL_CSS = [
        '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"DM Sans",Arial,sans-serif;background:#f7f6f3;color:#1a1714;font-size:14px}.hdr{background:#1a1714;border-top:3px solid #c8490c;padding:16px 26px;display:flex;align-items:center;justify-content:space-between}.hdr h1{color:#fff;font-size:21px;font-family:"DM Serif Display",Georgia,serif}.hdr .sub{color:#9e9086;font-size:11px;margin-bottom:2px}.nav{background:#fff;border-bottom:2px solid #e2ddd6;padding:0 20px;display:flex;gap:2px;overflow-x:auto}.nav button{background:none;border:none;padding:12px 15px;cursor:pointer;font-size:13px;font-weight:500;color:#6b6460;border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap}.nav button.on,.nav button:hover{color:#1a1714;border-bottom-color:#c8490c}.pnl{display:none;padding:20px 24px}.pnl.on{display:block}#custT td{padding:7px 12px}#custT tbody tr:hover{background:#faf8f5}table.sortable td{white-space:nowrap}tr.er.done{opacity:.5}tr.er.done td b{text-decoration:line-through}input.erck{width:16px;height:16px;cursor:pointer}'
    ].join('');
    var CLIENT_JS = [
        'var VIEW_AGG=__VIEW_AGG__;var CADLBL=["Growing", "On Track", "New 2026", "Not Yet Due", "Declining", "Overdue", "Sig. Overdue", "Gone"];function curRep(){return window._REP||"__ALL__";}function curAgg(){return VIEW_AGG[curRep()]||VIEW_AGG["__ALL__"];}function money(x){return "$"+Math.round(x||0).toLocaleString();}function show(id,btn){document.querySelectorAll(".pnl").forEach(function(p){p.classList.remove("on");});document.querySelectorAll(".nav button").forEach(function(b){b.classList.remove("on");});document.getElementById("p-"+id).classList.add("on");btn.classList.add("on");if(id==="chart")buildRevChart(curAgg());if(id==="cadence")buildCadChart(curAgg());}function filterT(){var q=(document.getElementById("tblSearch").value||"").toLowerCase();var st=document.getElementById("tblSt").value;var cd=document.getElementById("tblCad").value;var rep=curRep().toLowerCase();var rows=document.querySelectorAll("#custTbody tr");var n=0;rows.forEach(function(r){var ow=r.getAttribute("data-owner")||"";var show=(rep==="__all__"||ow===rep)&&(!q||r.getAttribute("data-name").indexOf(q)>=0)&&(!st||r.getAttribute("data-status")===st)&&(!cd||r.getAttribute("data-cadence")===cd);r.style.display=show?"":"none";if(show)n++;});var el=document.getElementById("tblCnt");if(el)el.textContent=n+" customers";}function fmtVal(v,f){if(v===undefined||v===null)return"";if(f==="money")return money(v);return v;}function setTxt(id,t){var e=document.getElementById(id);if(e)e.textContent=t;}function setW(id,p){var e=document.getElementById(id);if(e)e.style.width=Math.min(100,Math.max(0,p))+"%";}function scoreCol(c){return c>=70?"#27ae60":c>=50?"#e67e22":"#c8490c";}function healthTxt(c){return c>=70?"Healthy":c>=50?"Needs Attention":"At Risk";}function rebuildChips(sc){var box=document.getElementById("statusChips");if(!box)return;var order=["growing","on_track","new_2026","not_yet_due","snoozed","declining_2026","overdue","significantly_overdue","gone","erratic","one_time_2025","one_time_old"];var COL={"gone": "#c0392b", "significantly_overdue": "#e74c3c", "overdue": "#e67e22", "growing": "#27ae60", "on_track": "#2980b9", "declining_2026": "#8e44ad", "not_yet_due": "#16a085", "new_2026": "#3498db", "erratic": "#d35400", "one_time_2025": "#7f8c8d", "one_time_old": "#7f8c8d", "snoozed": "#95a5a6"},LB={"gone": "Gone", "significantly_overdue": "Sig. Overdue", "overdue": "Overdue", "growing": "Growing", "on_track": "On Track", "declining_2026": "Declining", "not_yet_due": "Not Yet Due", "new_2026": "New 2026", "erratic": "Erratic", "one_time_2025": "One-Time 2025", "one_time_old": "One-Time (Old)", "snoozed": "Snoozed"};box.innerHTML="";order.forEach(function(s){var n=(sc||{})[s]||0;if(!n)return;var d=document.createElement("div");d.style.cssText="background:"+(COL[s]||"#7f8c8d")+";color:#fff;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600";d.textContent=(LB[s]||s)+": "+n;box.appendChild(d);});}function applyRep(v){window._REP=v;var hs=document.getElementById("repFilter");if(hs)hs.value=v;document.querySelectorAll(".repsel").forEach(function(s){s.value=v;});var a=VIEW_AGG[v]||VIEW_AGG["__ALL__"];document.querySelectorAll("[data-agg]").forEach(function(el){var f=el.getAttribute("data-agg"),fmt=el.getAttribute("data-fmt");if(f==="__health__"){el.textContent=healthTxt(a.composite);return;}if(a[f]!==undefined)el.textContent=fmtVal(a[f],fmt);});setTxt("retScoreNum",a.composite);setTxt("retAcctPct",a.acct_pct+"%");setTxt("retRevPct",a.rev_pct+"%");setW("retAcctBar",a.acct_pct);setW("retRevBar",a.rev_pct);setTxt("retMA",a.ma);setTxt("retRET",a.ret);var rh=document.getElementById("retHealth");if(rh){rh.textContent=healthTxt(a.composite);rh.style.background=a.composite>=70?"#d5f5e3":a.composite>=50?"#fef3cd":"#fde8e8";rh.style.color=a.composite>=70?"#1a6639":a.composite>=50?"#8a5700":"#8b1a1a";}var sn=document.getElementById("retScoreNum");if(sn&&sn.parentElement)sn.parentElement.style.color=scoreCol(a.composite);var rsc=document.getElementById("retScope");if(rsc)rsc.textContent=v==="__ALL__"?"\u2014 whole pod":"\u2014 "+v;rebuildChips(a.status_counts);var lv=v.toLowerCase();document.querySelectorAll(".ownrow").forEach(function(el){if(el.closest&&el.closest("#custTbody"))return;el.style.display=(v==="__ALL__"||(el.getAttribute("data-owner")||"")===lv)?"":"none";});filterT();rollupDue();rollupCalls();if(document.getElementById("p-chart").classList.contains("on"))buildRevChart(a);if(document.getElementById("p-cadence").classList.contains("on"))buildCadChart(a);}function rollupDue(){document.querySelectorAll("table").forEach(function(t){var tot=t.querySelector("tr.totalrow");if(!tot)return;var exp=0,r25=0,r26=0,n=0;t.querySelectorAll("tr.er").forEach(function(tr){if(tr.style.display==="none")return;n++;exp+=parseFloat(tr.getAttribute("data-exp"))||0;r25+=parseFloat(tr.getAttribute("data-r25"))||0;r26+=parseFloat(tr.getAttribute("data-r26"))||0;});var s=function(k,val){var c=tot.querySelector("[data-roll=\\""+k+"\\"]");if(c)c.textContent=val;};s("n",n);s("e',
        'xp",money(exp));s("r25",money(r25));s("r26",money(r26));});}function rollupCalls(){["p-week","p-schedule"].forEach(function(pid){var p=document.getElementById(pid);if(!p)return;var vis=0;p.querySelectorAll(".ac").forEach(function(c){if(c.style.display!=="none")vis++;});var big=p.querySelector(".sc-stat .big");if(big)big.textContent=vis;});}function parseCell(t){t=(t||"").trim();if(t===""||t==="\u2014")return{n:-Infinity,s:""};var m=t.replace(/[$,]/g,"");if(/^-?\\d+(\\.\\d+)?$/.test(m))return{n:parseFloat(m),s:t.toLowerCase()};var d=t.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);if(d)return{n:new Date(+d[3],+d[1]-1,+d[2]).getTime(),s:t};return{n:NaN,s:t.toLowerCase()};}function sortTable(t,idx,th){var tb=t.tBodies[0];if(!tb)return;var rows=[].slice.call(tb.rows).filter(function(r){return !r.classList.contains("totalrow");});var totals=[].slice.call(tb.rows).filter(function(r){return r.classList.contains("totalrow");});var pk=rows.map(function(r){return parseCell((r.cells[idx]||{}).textContent);});var allNum=pk.some(function(x){return !isNaN(x.n)&&x.n!==-Infinity;})&&pk.every(function(x){return !isNaN(x.n);});var same=t._sc===idx;var dir=same?-t._sd:(allNum?-1:1);rows.sort(function(a,b){var av=parseCell((a.cells[idx]||{}).textContent),bv=parseCell((b.cells[idx]||{}).textContent);if(allNum)return (av.n-bv.n)*dir;return (av.s<bv.s?-1:av.s>bv.s?1:0)*dir;});rows.forEach(function(r){tb.appendChild(r);});totals.forEach(function(r){tb.appendChild(r);});t._sc=idx;t._sd=dir;var hs=th.parentElement.children;for(var i=0;i<hs.length;i++){var ar=hs[i].querySelector(".sarw");if(ar){ar.textContent=" \\u21c5";ar.style.opacity=".35";}}var a2=th.querySelector(".sarw");if(a2){a2.textContent=dir<0?" \\u2193":" \\u2191";a2.style.opacity="1";}}function initSort(){document.querySelectorAll("table.sortable").forEach(function(t){var hr=t.tHead&&t.tHead.rows[0];if(!hr)return;[].slice.call(hr.cells).forEach(function(th,idx){if((th.textContent||"").trim().charAt(0)==="\\u2713")return;th.addEventListener("click",function(){sortTable(t,idx,th);});});});}function buildRevChart(a){try{var c=document.getElementById("revChart");if(!c||typeof Chart==="undefined")return;if(window._revC)window._revC.destroy();window._revC=new Chart(c.getContext("2d"),{type:"bar",data:{labels:["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],datasets:[{label:"2023",data:a.rev_2023,backgroundColor:"#b8c8e8",borderRadius:3},{label:"2024",data:a.rev_2024,backgroundColor:"#b8a9d4",borderRadius:3},{label:"2025",data:a.rev_2025,backgroundColor:"#2d6a4f",borderRadius:3},{label:"2026",data:a.rev_2026,backgroundColor:"#e55d1e",borderRadius:3}]},options:{responsive:true,plugins:{legend:{position:"top"}},scales:{y:{ticks:{callback:function(v){return "$"+Math.round(v/1000)+"k";}}}}}});}catch(e){}}function buildCadChart(a){try{var c=document.getElementById("cadChart");if(!c||typeof Chart==="undefined")return;if(window._cadC)window._cadC.destroy();window._cadC=new Chart(c.getContext("2d"),{type:"bar",data:{labels:CADLBL,datasets:[{label:"In Cadence",data:a.cad_in,backgroundColor:"#27ae60",borderRadius:3},{label:"Out of Cadence",data:a.cad_out,backgroundColor:"#e67e22",borderRadius:3},{label:"No Activity",data:a.cad_no,backgroundColor:"#7f8c8d",borderRadius:3}]},options:{responsive:true,plugins:{legend:{position:"top"}},scales:{x:{stacked:true},y:{stacked:true,ticks:{precision:0}}}}});}catch(e){}}initSort();(function(){var rows=document.querySelectorAll("#custTbody tr");var el=document.getElementById("tblCnt");if(el)el.textContent=rows.length+" customers";})();var SK="retdash_pod_fay_taylor_gianna";function loadState(){try{return JSON.parse(localStorage.getItem(SK)||"{}");}catch(e){return {};}}function saveState(s){try{localStorage.setItem(SK,JSON.stringify(s));}catch(e){}}function tc(id){var card=document.getElementById(id);var lbl=document.getElementById("l"+id);var cb=lbl.querySelector("input");var now=!card.classList.contains("done");card.classList.toggle("done",now);lbl.classList.toggle("ck",now);if(cb)cb.checked=now;var s=loadState();if(now){s[id]=1;}else{delete s[id];}saveState(s);}function erToggle(cb){var tr=cb.closest("tr");var id=tr.getAttribute("data-id");var now=cb.checked;tr.classList.toggle("done",now);var s=loadState();if(now){s[id]=1;}else{delete s[id];}saveState(s);updateOutstanding();}function updateOutstanding(){var g={};document.querySelectorAll("tr.er").forEach(function(tr){var k=tr.getAttribute("data-period")+"_"+tr.getAttribute("data-tier");if(!g[k])g[k]={rem:0,n:0,dn:0};var e=parseFloat(tr.getAttribute("data-exp"))||0;var d=tr.classList.contains("done");g[k].n++;if(d){g[k].dn++;}else{g[k].rem+=e;}});Object.keys(g).forEach(function(k){var el=document.getElementById("out_"+k);if(el){var x=g[k];el.textContent="$"+Math.round(x.rem).toLocaleString()+" outstanding \u00b7 "+x.dn+"/"+x.n+" done";}});}function applyState(){var s=loadState();document.querySelectorAll(".ac").forEach(function(c){if(s[c.id]){c.classList.add("done");var l=document.getEle',
        'mentById("l"+c.id);if(l){l.classList.add("ck");var cb=l.querySelector("input");if(cb)cb.checked=true;}}});document.querySelectorAll("tr.er").forEach(function(tr){var cb=tr.querySelector("input.erck");if(s[tr.getAttribute("data-id")]){tr.classList.add("done");if(cb)cb.checked=true;}});updateOutstanding();}applyState();'
    ].join('');

    function page(d, elapsedMs) {
        var refreshNote = 'Live from NetSuite \u00b7 loaded in ' + (elapsedMs / 1000).toFixed(1) + 's';
        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
            + '<title>' + d.REP_NAME + ' Retention Dashboard &mdash; ' + d.monthYearStr + '</title>'
            + '<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">'
            + '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>'
            + '<style>' + SHELL_CSS
            + '.rfr{background:#2a2420;border:1px solid #4a4038;color:#fff;font-size:12px;font-weight:600;'
            + 'padding:7px 13px;border-radius:7px;cursor:pointer;display:flex;align-items:center;gap:6px}'
            + '.rfr:hover{background:#3a322c}.rfr.busy{opacity:.6;cursor:default}'
            + '</style></head><body>'
            + '<div class="hdr"><div><div class="sub">RETENTION DASHBOARD &mdash; LIVE FROM NETSUITE</div>'
            + '<h1>' + d.REP_NAME + ' &mdash; ' + d.monthYearStr + '</h1></div>'
            + '<div style="display:flex;align-items:center;gap:18px">' + d.repSelect
            + '<div style="text-align:right"><button class="rfr" id="rfrBtn" onclick="doRefresh()">'
            + '<span>\u21bb</span> Refresh</button>'
            + '<div style="color:#9e9086;font-size:11px;margin-top:4px">' + refreshNote + '</div></div>'
            + '</div></div>'
            + '<div class="nav">'
            + '<button class="on" onclick="show(\'summary\',this)">Summary</button>'
            + '<button onclick="show(\'retention\',this)">Retention Score</button>'
            + '<button onclick="show(\'chart\',this)">Revenue Chart</button>'
            + '<button onclick="show(\'risk\',this)">Risk Cards</button>'
            + '<button onclick="show(\'table\',this)">All Customers</button>'
            + '<button onclick="show(\'due\',this)">Expected Reorders</button>'
            + '<button onclick="show(\'week\',this)">Call This Week</button>'
            + '<button onclick="show(\'schedule\',this)">Month Call Plan</button>'
            + '<button onclick="show(\'cadence\',this)">Activity Cadence</button>'
            + '</div>'
            + '<div id="p-summary" class="pnl on">' + d.panels.summary + '</div>'
            + '<div id="p-retention" class="pnl">' + d.panels.retention + '</div>'
            + '<div id="p-chart" class="pnl">' + d.repbar + d.panels.chart + '</div>'
            + '<div id="p-risk" class="pnl">' + d.repbar + d.panels.risk + '</div>'
            + '<div id="p-table" class="pnl">' + d.repbar + d.panels.table + '</div>'
            + '<div id="p-due" class="pnl">' + d.repbar + d.panels.due + '</div>'
            + '<div id="p-week" class="pnl">' + d.repbar + d.panels.week + '</div>'
            + '<div id="p-schedule" class="pnl">' + d.repbar + d.panels.schedule + '</div>'
            + '<div id="p-cadence" class="pnl">' + d.repbar + d.panels.cadence + '</div>'
            + '<script>'
            + CLIENT_JS.replace('__VIEW_AGG__', JSON.stringify(d.VIEW_AGG))
            + 'function doRefresh(){var b=document.getElementById("rfrBtn");'
            + 'if(b){b.classList.add("busy");b.innerHTML="<span>\u21bb</span> Refreshing\u2026";}'
            + 'var u=window.location.href.split("#")[0];'
            + 'u+=(u.indexOf("?")>=0?"&":"?")+"_ts="+Date.now();window.location.href=u;}'
            + '<\/script></body></html>';
    }

    function errorPage(e) {
        return '<!DOCTYPE html><html><body style="font-family:DM Sans,Arial,sans-serif;padding:44px;color:#1a1714">'
            + '<h2 style="font-family:Georgia,serif">Dashboard could not be built</h2>'
            + '<p style="color:#6b6460;max-width:620px;line-height:1.6">The Suitelet reached NetSuite but '
            + 'could not complete the retention calculation. Nothing was changed - this dashboard is '
            + 'read-only. Check the script execution log for the full stack.</p>'
            + '<pre style="background:#f7f6f3;border:1px solid #e2ddd6;border-radius:8px;padding:14px;'
            + 'font-size:12px;overflow:auto">' + String((e && (e.message || e.name)) || e) + '</pre>'
            + '<p><a href="javascript:location.reload()" style="color:#c8490c;font-weight:600">Try again</a></p>'
            + '</body></html>';
    }

    function onRequest(context) {
        var response = context.response;
        response.setHeader({ name: 'Content-Type', value: 'text/html; charset=UTF-8' });
        // Always live: never let a browser or proxy serve a stale render.
        response.setHeader({ name: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' });
        response.setHeader({ name: 'Pragma', value: 'no-cache' });

        if (context.request.method !== 'GET') {
            response.write({ output: 'Method not allowed - this Suitelet only serves GET.' });
            return;
        }

        var started = Date.now();
        try {
            var raw = loadRaw();
            // Midnight today, UTC, so the date maths matches the Python engine.
            var now = new Date();
            var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
            var d = buildDashboard(raw, today);
            var elapsed = Date.now() - started;
            log.audit({
                title: 'Retention pod dashboard rendered',
                details: d.stats.customers + ' customers | score ' + d.stats.composite
                    + ' | at risk ' + d.stats.at_risk + ' | ' + elapsed + 'ms | user '
                    + runtime.getCurrentUser().id
            });
            response.write({ output: page(d, elapsed) });
        } catch (e) {
            log.error({ title: 'Retention pod dashboard failed', details: (e && e.stack) || String(e) });
            response.write({ output: errorPage(e) });
        }
    }

    return { onRequest: onRequest };
});