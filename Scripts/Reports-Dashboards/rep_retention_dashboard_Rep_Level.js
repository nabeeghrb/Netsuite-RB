/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Retention Dashboard — live Suitelet
 * ------------------------------------------------------------------
 * Renders the rep retention dashboard directly from NetSuite on every
 * page load. No saved searches, no scheduled refresh, no static files.
 *
 * Version 2 - rep switching + viewer access gate
 * ------------------------------------------------------------------
 * v2 changes over v1:
 *   - An employee flagged issalesrep='T' with no assigned accounts (admins,
 *     IT, ops) no longer hits a dead-end error page.
 *   - Only reps with actual data appear in the picker, labelled with volume.
 *   - Viewing is gated by role; non-sales roles are refused outright.
 *   - A rep with no accounts yet sees an empty state, not a colleague's book.
 *
 * Rep resolution:
 *   1. ?rep=<employeeId>, when the viewer is allowed to switch.
 *   2. The logged-in employee, IF they have transaction data.
 *   3. Otherwise the highest-volume rep, with a banner explaining the
 *      substitution. The picker stays on screen either way.
 *
 * Only reps who actually have data appear in the picker, each with its
 * transaction count, so there are no empty selections to fall into.
 *
 * Access gate (new in TEST2):
 *   Viewing is limited to admins, roles listed in ALLOWED_VIEWER_ROLE_IDS,
 *   and sales reps viewing their own book. Anyone else - procurement,
 *   warehouse, AP, a curious contractor with the URL - gets an access
 *   denied page instead of somebody's revenue. This is a second line of
 *   defence: the Roles audience on the Suitelet deployment record is still
 *   the primary control.
 *
 *   A sales rep with no accounts yet (new hire) sees a friendly empty state,
 *   NOT another rep's book.
 *
 * Time zone:
 *   "Today" is derived from the logged-in user's Home > Set Preferences >
 *   Time Zone, not the server clock, so late-evening and early-morning
 *   users see the correct current date, month and week. All SuiteQL dates
 *   are returned as date-only strings (TO_CHAR) so no UTC shift can occur.
 */
define(['N/query', 'N/runtime', 'N/format', 'N/url', 'N/log'],
function (query, runtime, format, url, log) {
    'use strict';

    // ══════════════════════════════════════════════════════════════════
    // CONFIG
    // ══════════════════════════════════════════════════════════════════

    // Set false to hard-lock ordinary reps to their own book of business.
    // Admins (see ADMIN_ROLE_IDS) can always switch regardless of this flag.
    var ALLOW_REP_SWITCH = true;

    // Roles permitted to view any rep. 3 = Administrator, 18 = Full Access.
    // Add your own custom manager/ops role IDs here as needed.
    var ADMIN_ROLE_IDS = ['3', '18'];

    // Roles allowed to view the dashboard for ANY rep without being full
    // administrators - sales management, ownership, analysts. Put the role
    // internal IDs here (Setup > Users/Roles > Manage Roles, the ID column).
    // Leave empty to restrict all-rep viewing to ADMIN_ROLE_IDS only.
    var ALLOWED_VIEWER_ROLE_IDS = ['1029'];   // 1029 = Sales Manager

    // When false, a viewer who is neither an admin, an allowed role, nor a
    // sales rep with their own book is refused. Set true only if you are
    // relying purely on the deployment's Roles audience for security.
    var OPEN_TO_ALL_ROLES = false;

    // Employees flagged issalesrep='T' who are not really carrying a book
    // (IT, ops, admins). They are dropped from the picker and never treated
    // as the default rep. Employee internal IDs, as strings.
    var NON_SELLING_REPS = ['546334'];   // Nabeegh Ahmed - NetSuite Admin / IT

    // Chart.js. To avoid any CSP/offline issues, upload chart.umd.min.js to
    // the File Cabinet and replace this with its public URL. Charts fail
    // silently if unreachable; every chart has a "View as table" fallback.
    var CHART_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

    /**
     * Account exceptions, keyed by rep name (lower-case).
     *   type 'snooze' -> account hidden from risk cards, call plans and
     *                    expected reorders; shows a grey Snoozed badge.
     *   type 'note'   -> account stays fully visible with a yellow NOTE
     *                    tooltip carrying the reason.
     *   until: 'YYYY-MM-DD' or null (null = until removed). Once the date
     *   passes the account simply returns to the normal view — the script
     *   never takes an automated action.
     */
    var EXCLUSIONS = {
        'fay singer': [
            { name: 'Tedder Industries',   until: '2026-10-01', type: 'snooze', reason: 'Ordered ahead of schedule' },
            { name: 'The Smart Group',     until: null,         type: 'snooze', reason: 'Orders via Bizink' },
            { name: 'Schoolhouse Supplies',until: '2027-06-01', type: 'snooze', reason: 'Long reorder cycle' },
            { name: 'Selkirk Sport',       until: '2026-10-01', type: 'snooze', reason: 'Ordered ahead of schedule' },
            { name: 'Lions Services',      until: null,         type: 'note',   reason: 'Special handling - see account notes' }
        ],
        'mendy eagle': [
            { name: 'Mario Badescu',       until: '2026-12-31', type: 'snooze', reason: 'Ordered ahead of schedule' },
            { name: 'AMR Management',      until: null,         type: 'snooze', reason: 'Blanket PO in place' },
            { name: 'FAROUK Systems',      until: '2026-08-31', type: 'snooze', reason: 'Ordered ahead of schedule' },
            { name: 'Spice Kingdom',       until: '2026-09-30', type: 'snooze', reason: 'Ordered ahead of schedule' },
            { name: 'Richard Bauer',       until: null,         type: 'note',   reason: 'Special handling - see account notes' }
        ],
        'renee goldenberg': [
            { name: 'Robin Industries',    until: '2026-10-15', type: 'snooze', reason: 'Ordered ahead of schedule' },
            { name: 'Matachi',             until: null,         type: 'snooze', reason: 'Blanket PO in place' },
            { name: 'Smith & Warren',      until: null,         type: 'note',   reason: 'Special handling - see account notes' },
            { name: 'Precision Resource',  until: null,         type: 'note',   reason: 'Special handling - see account notes' }
        ]
    };

    var STATUS_COLORS = {
        gone: '#c0392b', significantly_overdue: '#e74c3c', overdue: '#e67e22',
        growing: '#27ae60', on_track: '#2980b9', declining_cur: '#8e44ad',
        not_yet_due: '#16a085', new_cur: '#3498db', erratic: '#d35400',
        one_time_prior: '#7f8c8d', one_time_old: '#7f8c8d', snoozed: '#95a5a6'
    };
    var CADENCE_COLORS = { in_cadence: '#27ae60', out_of_cadence: '#e67e22', no_activity: '#7f8c8d' };
    var CADENCE_LABELS = { in_cadence: 'In Cadence', out_of_cadence: 'Out of Cadence', no_activity: 'No Activity' };
    var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var MONTHS_LONG  = ['January','February','March','April','May','June','July',
                        'August','September','October','November','December'];
    var DAYS_LONG    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    var STATUS_ORDER = ['growing','on_track','new_cur','not_yet_due','snoozed','declining_cur',
                        'overdue','significantly_overdue','gone','erratic','one_time_prior','one_time_old'];

    // ══════════════════════════════════════════════════════════════════
    // GENERIC HELPERS
    // ══════════════════════════════════════════════════════════════════

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fm(v) {
        if (!v) return '$0';
        var n = Math.round(v);
        var neg = n < 0;
        n = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-$' : '$') + n;
    }

    /** 'YYYY-MM-DD' -> 'MM/DD/YYYY' */
    function fd(s) {
        if (!s) return '&mdash;';
        var p = String(s).split('-');
        return (p.length === 3) ? (p[1] + '/' + p[2] + '/' + p[0]) : s;
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function iso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }

    /** Parse 'MM/DD/YYYY' or 'YYYY-MM-DD' into a local-midnight Date. */
    function parseDate(s) {
        if (!s) return null;
        s = String(s).trim();
        var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        return null;
    }

    var MS_DAY = 86400000;
    /** Whole days between two dates, floored (matches Python timedelta.days). */
    function dayDiff(a, b) { return Math.floor((a.getTime() - b.getTime()) / MS_DAY); }
    function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
    function monthsBetweenKeys(a, b) {
        var pa = a.split('-'), pb = b.split('-');
        return (+pb[0] - +pa[0]) * 12 + (+pb[1] - +pa[1]);
    }
    function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
    function stdev(a) { // sample standard deviation (n-1), as per Python statistics.stdev
        if (a.length < 2) return 0;
        var m = mean(a), s = 0, i;
        for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
        return Math.sqrt(s / (a.length - 1));
    }
    function r2(v) { return Math.round(v * 100) / 100; }

    // ══════════════════════════════════════════════════════════════════
    // TIME ZONE — resolve "today" in the logged-in user's own time zone
    // ══════════════════════════════════════════════════════════════════

    function resolveToday() {
        var out = { date: null, tz: 'server default', source: 'server clock' };
        var tz = null;
        try { tz = runtime.getCurrentUser().getPreference({ name: 'TIMEZONE' }); } catch (e) { tz = null; }

        if (tz) {
            try {
                var s = format.format({ value: new Date(), type: format.Type.DATETIMETZ, timezone: tz });
                var d = parseDate(s);   // NetSuite emits M/D/YYYY h:mm am/pm
                if (d) {
                    out.date = d;
                    out.tz = String(tz);
                    out.source = 'user time zone preference';
                    return out;
                }
            } catch (e2) {
                log.audit({ title: 'Retention Dashboard', details: 'Time zone conversion failed, using server clock: ' + e2.message });
            }
        }
        var n = new Date();
        out.date = new Date(n.getFullYear(), n.getMonth(), n.getDate());
        return out;
    }

    // ══════════════════════════════════════════════════════════════════
    // DATA ACCESS
    // ══════════════════════════════════════════════════════════════════

    /** Paged SuiteQL — never truncates, unlike a single 5,000-row fetch. */
    function runPaged(sql, params) {
        var rows = [];
        var paged = query.runSuiteQLPaged({ query: sql, params: params || [], pageSize: 1000 });
        paged.pageRanges.forEach(function (pr) {
            var page = paged.fetch({ index: pr.index });
            page.data.asMappedResults().forEach(function (r) { rows.push(r); });
        });
        return rows;
    }

    function val(row, key) {
        if (row[key] !== undefined) return row[key];
        var up = key.toUpperCase();
        return (row[up] !== undefined) ? row[up] : null;
    }

    /** Transaction volume per rep, used to filter and label the picker. */
    function getRepTxnCounts(fromDate) {
        var rows = runPaged(
            "SELECT cu.salesrep AS rep, COUNT(*) AS n " +
            "FROM transaction t JOIN customer cu ON cu.id = t.entity " +
            "WHERE t.recordtype IN ('salesorder', 'invoice') " +
            "  AND t.trandate >= TO_DATE(?, 'MM/DD/YYYY') " +
            "  AND cu.salesrep IS NOT NULL " +
            "GROUP BY cu.salesrep", [fromDate]);
        var map = {};
        rows.forEach(function (r) {
            var id = String(val(r, 'rep'));
            var n = parseInt(val(r, 'n'), 10);
            if (id && !isNaN(n)) map[id] = n;
        });
        return map;
    }

    /** True when the viewer's role may look at any rep's book. */
    function isAdminViewer() {
        try {
            var u = runtime.getCurrentUser();
            var rid = String(u.role);
            var rname = String(u.roleId || '').toLowerCase();
            if (ADMIN_ROLE_IDS.indexOf(rid) >= 0) return true;
            if (rname.indexOf('administrator') >= 0 || rname.indexOf('full access') >= 0) return true;
        } catch (e) { /* fall through */ }
        return false;
    }

    function getSalesReps() {
        var rows = runPaged(
            "SELECT e.id AS id, e.firstname || ' ' || e.lastname AS full_name " +
            "FROM employee e WHERE e.issalesrep = 'T' AND e.isinactive = 'F' " +
            "ORDER BY e.firstname, e.lastname", []);
        return rows.map(function (r) {
            return { id: String(val(r, 'id')), name: String(val(r, 'full_name') || '').trim() };
        }).filter(function (r) { return r.name; });
    }

    /**
     * Sales orders from the start of last year forward.
     * Rep ownership comes from customer.salesrep — verified to match what the
     * "Rep Sales for Claude Retention Project (SZ)" saved search reports.
     * All statuses are included (the saved search counts cancelled orders too);
     * adding a status filter here would shift the totals.
     */
    function getOrders(repId, fromDate) {
        return runPaged(
            "SELECT t.entity AS cid, TO_CHAR(t.trandate, 'MM/DD/YYYY') AS d, " +
            "       ROUND(NVL(t.foreigntotal, 0), 2) AS a " +
            "FROM transaction t " +
            "JOIN customer cu ON cu.id = t.entity " +
            "WHERE t.recordtype = 'salesorder' " +
            "  AND cu.salesrep = ? " +
            "  AND t.trandate >= TO_DATE(?, 'MM/DD/YYYY') " +
            "ORDER BY t.trandate, t.id", [repId, fromDate]);
    }

    /** Invoice history for the two years before the order window. */
    function getInvoices(repId, fromDate, toDate) {
        return runPaged(
            "SELECT t.entity AS cid, TO_CHAR(t.trandate, 'MM/DD/YYYY') AS d, " +
            "       ROUND(NVL(t.foreigntotal, 0), 2) AS a " +
            "FROM transaction t " +
            "JOIN customer cu ON cu.id = t.entity " +
            "WHERE t.recordtype = 'invoice' " +
            "  AND cu.salesrep = ? " +
            "  AND t.trandate >= TO_DATE(?, 'MM/DD/YYYY') " +
            "  AND t.trandate <= TO_DATE(?, 'MM/DD/YYYY') " +
            "ORDER BY t.trandate, t.id", [repId, fromDate, toDate]);
    }

    /**
     * Customer names plus most recent activity (max task due date and the
     * title of that task) — the same definition the "Rep Customer by most
     * recent activity" saved search uses.
     */
    function getCustomers(repId, sinceDate) {
        return runPaged(
            "SELECT c.id AS cid, NVL(c.companyname, c.entityid) AS n, " +
            "       (SELECT TO_CHAR(MAX(t2.duedate), 'MM/DD/YYYY') FROM task t2 WHERE t2.company = c.id) AS ld, " +
            "       (SELECT MAX(t3.title) KEEP (DENSE_RANK LAST ORDER BY t3.duedate) " +
            "          FROM task t3 WHERE t3.company = c.id) AS ti " +
            "FROM customer c " +
            "WHERE c.salesrep = ? " +
            "  AND EXISTS (SELECT 1 FROM transaction t WHERE t.entity = c.id " +
            "              AND t.recordtype IN ('salesorder', 'invoice') " +
            "              AND t.trandate >= TO_DATE(?, 'MM/DD/YYYY'))", [repId, sinceDate]);
    }

    // ══════════════════════════════════════════════════════════════════
    // BUILD CUSTOMER PROFILES + ANALYTICS
    // ══════════════════════════════════════════════════════════════════

    function buildModel(repName, TODAY, orderRows, invoiceRows, custRows) {
        var CUR = TODAY.getFullYear();
        var PRIOR = CUR - 1, PRIOR2 = CUR - 2, PRIOR3 = CUR - 3;
        var MONTHS_CUR = Math.max(1, TODAY.getMonth()); // completed months this year

        // ---- exclusions for this rep -------------------------------------
        var exList = [];
        (EXCLUSIONS[String(repName).toLowerCase()] || []).forEach(function (ex) {
            var until = ex.until ? parseDate(ex.until) : null;
            var type = (ex.type || 'snooze').toLowerCase();
            if (type === 'note' || until === null || until > TODAY) {
                exList.push({ name: String(ex.name).toLowerCase(), until: until, type: type, reason: ex.reason || '' });
            }
        });
        function exMatch(ex, cname) {
            var cl = String(cname).toLowerCase();
            return cl.indexOf(ex.name) >= 0 || ex.name.indexOf(cl) >= 0;
        }
        function excludedInfo(cname) {
            var snooze = null, note = null;
            exList.forEach(function (ex) {
                if (!exMatch(ex, cname)) return;
                if (ex.type === 'note') { if (!note) note = ex; }
                else if (!snooze) { snooze = ex; }
            });
            return snooze || note;
        }
        function noteInfo(cname) {
            var found = null;
            exList.forEach(function (ex) { if (!found && ex.type === 'note' && exMatch(ex, cname)) found = ex; });
            return found;
        }

        // ---- customer id -> name / activity ------------------------------
        var byId = {}, activity = {};
        custRows.forEach(function (r) {
            var id = String(val(r, 'cid'));
            var nm = String(val(r, 'n') || '').replace(/^C\d+\s+/, '').trim() || 'Unknown';
            byId[id] = nm;
            var ld = val(r, 'ld');
            if (ld) {
                var d = parseDate(ld);
                if (d && d > TODAY) d = null;
                var prev = activity[nm];
                if (!prev || (d && (!prev.date || d > prev.date))) {
                    activity[nm] = { date: d, title: String(val(r, 'ti') || '') };
                }
            }
        });
        function nameFor(id) { return byId[String(id)] || 'Unknown'; }

        // ---- transactions -------------------------------------------------
        var txns = {};
        function addTxn(rows, minYear, maxYear) {
            rows.forEach(function (r) {
                var d = parseDate(val(r, 'd'));
                if (!d) return;
                var y = d.getFullYear();
                if (minYear !== null && y < minYear) return;
                if (maxYear !== null && y > maxYear) return;
                var amt = parseFloat(val(r, 'a'));
                if (isNaN(amt)) amt = 0;
                var cn = nameFor(val(r, 'cid'));
                if (!txns[cn]) txns[cn] = [];
                txns[cn].push({ date: d, amount: amt });
            });
        }
        addTxn(invoiceRows, null, PRIOR2);
        addTxn(orderRows, PRIOR, null);

        // ---- profiles ------------------------------------------------------
        var customers = {};
        var cutoff12 = addDays(TODAY, -365);

        Object.keys(txns).forEach(function (cname) {
            var list = txns[cname];
            list.sort(function (a, b) { return a.date - b.date; });

            var revByYear = {}, monthlyRev = {}, amounts = [], i, t;
            for (i = 0; i < list.length; i++) {
                t = list[i];
                var y = t.date.getFullYear(), mk = monthKey(t.date);
                revByYear[y] = (revByYear[y] || 0) + t.amount;
                monthlyRev[mk] = (monthlyRev[mk] || 0) + t.amount;
                amounts.push(t.amount);
            }

            var totalRev = 0;
            for (i = 0; i < amounts.length; i++) totalRev += amounts[i];
            var firstOrder = list[0].date, lastOrder = list[list.length - 1].date;
            var nOrders = list.length;

            var activeMonths = Object.keys(monthlyRev).sort();
            var nActiveMonths = activeMonths.length;
            var gaps = [];
            for (i = 0; i < activeMonths.length - 1; i++) {
                gaps.push(monthsBetweenKeys(activeMonths[i], activeMonths[i + 1]));
            }
            var avgGap = gaps.length ? mean(gaps) : null;
            var stdGap = gaps.length >= 2 ? stdev(gaps) : 0;
            var cvGap = (avgGap && avgGap > 0 && gaps.length >= 2) ? (stdGap / avgGap) : 0;

            var monthAmounts = [];
            Object.keys(monthlyRev).forEach(function (k) { monthAmounts.push(monthlyRev[k]); });
            var cvAmount = 0;
            if (monthAmounts.length >= 2) {
                var mm = mean(monthAmounts);
                cvAmount = mm > 0 ? (stdev(monthAmounts) / mm) : 0;
            }

            var expectedNext = null, monthsOverdue = null;
            if (avgGap) {
                var en = new Date(lastOrder.getTime() + avgGap * 30.44 * MS_DAY);
                expectedNext = new Date(en.getFullYear(), en.getMonth(), en.getDate());
                monthsOverdue = r2(dayDiff(TODAY, expectedNext) / 30.44);
            }

            var recent = [];
            for (i = 0; i < list.length; i++) if (list[i].date >= cutoff12) recent.push(list[i].amount);
            var expectedValue = recent.length ? r2(mean(recent)) : (amounts.length ? r2(mean(amounts)) : 0);

            var revP3 = r2(revByYear[PRIOR3] || 0), revP2 = r2(revByYear[PRIOR2] || 0);
            var revP  = r2(revByYear[PRIOR] || 0),  revCur = r2(revByYear[CUR] || 0);
            var revCurAnn = revCur > 0 ? r2((revCur / MONTHS_CUR) * 12) : 0;
            var hasCur = revCur > 0;
            var firstYear = firstOrder.getFullYear();

            var status;
            if (firstYear >= CUR && !(revP > 0 || revP2 > 0 || revP3 > 0)) {
                status = 'new_cur';
            } else if (nOrders === 1 && firstYear === PRIOR) {
                status = 'one_time_prior';
            } else if (nOrders === 1) {
                status = 'one_time_old';
            } else if (hasCur) {
                if (revP > 0) {
                    var ratio = revCurAnn / revP;
                    status = ratio >= 1.15 ? 'growing' : (ratio >= 0.70 ? 'on_track' : 'declining_cur');
                } else {
                    status = 'on_track';
                }
            } else {
                var monthsSince = dayDiff(TODAY, lastOrder) / 30.44;
                if (monthsSince > 12) {
                    status = 'gone';
                } else if (expectedNext && expectedNext > TODAY) {
                    status = 'not_yet_due';
                } else if (expectedNext) {
                    var overage = dayDiff(TODAY, expectedNext) / 30.44;
                    var threshold = avgGap ? avgGap * 1.5 : 4.5;
                    status = overage >= threshold ? 'significantly_overdue' : 'overdue';
                } else {
                    status = monthsSince > 6 ? 'significantly_overdue' : 'overdue';
                }
            }

            if (nActiveMonths >= 3 && cvGap > 1.0 && cvAmount > 1.0 &&
                status !== 'new_cur' && status !== 'one_time_prior' && status !== 'one_time_old') {
                status = 'erratic';
            }

            var excl = excludedInfo(cname);
            if (excl && excl.type !== 'note') status = 'snoozed';
            var nt = noteInfo(cname);

            var act = activity[cname] || null;
            var actD = act ? act.date : null;
            var gapForCadence = avgGap ? avgGap : 3.0;
            var cadence;
            if (!actD) cadence = 'no_activity';
            else cadence = (dayDiff(TODAY, actD) / 30.44 <= gapForCadence) ? 'in_cadence' : 'out_of_cadence';

            customers[cname] = {
                name: cname, total_rev: r2(totalRev),
                rev_p3: revP3, rev_p2: revP2, rev_prior: revP,
                rev_cur_ytd: revCur, rev_cur_ann: revCurAnn,
                monthly_rev: monthlyRev,
                first_order: iso(firstOrder), last_order: iso(lastOrder),
                n_orders: nOrders, n_active_months: nActiveMonths,
                avg_gap: avgGap ? r2(avgGap) : null,
                cv_gap: cvGap, cv_amount: cvAmount,
                expected_next: expectedNext ? iso(expectedNext) : null,
                expected_next_d: expectedNext,
                months_overdue: monthsOverdue, has_cur: hasCur,
                expected_value: expectedValue,
                snooze_until: (excl && excl.type !== 'note' && excl.until) ? iso(excl.until) : null,
                snooze_reason: (excl && excl.type !== 'note') ? excl.reason : null,
                note_reason: nt ? nt.reason : null,
                status: status, cadence: cadence,
                last_activity_date: actD ? iso(actD) : null,
                last_activity_title: act ? act.title : ''
            };
        });

        // ---- aggregate analytics -------------------------------------------
        var all = [];
        Object.keys(customers).forEach(function (k) { all.push(customers[k]); });

        var materiallyActive = all.filter(function (v) {
            return v.n_orders >= 2 && (v.rev_p2 > 0 || v.rev_prior > 0);
        });
        var retainedSet = { growing: 1, on_track: 1, not_yet_due: 1, new_cur: 1, snoozed: 1 };
        var retained = materiallyActive.filter(function (v) { return retainedSet[v.status]; });

        var acctPct = materiallyActive.length ? (retained.length / materiallyActive.length * 100) : 0;
        var revPriorTotal = 0, revPriorRetained = 0;
        materiallyActive.forEach(function (v) { revPriorTotal += v.rev_prior; });
        retained.forEach(function (v) { revPriorRetained += v.rev_prior; });
        var revPct = revPriorTotal > 0 ? (revPriorRetained / revPriorTotal * 100) : 0;
        var composite = Math.round((0.4 * acctPct + 0.6 * revPct) * 10) / 10;

        var atRisk = 0, decliningGap = 0, totalPrior = 0, totalCurYtd = 0;
        var statusCounts = {}, cadenceCounts = {}, monthlyTotals = {};
        all.forEach(function (v) {
            if (v.status === 'significantly_overdue' || v.status === 'gone' || v.status === 'overdue') {
                atRisk += v.rev_prior;
            }
            if (v.status === 'declining_cur') decliningGap += Math.max(0, v.rev_prior - v.rev_cur_ann);
            totalPrior += v.rev_prior;
            totalCurYtd += v.rev_cur_ytd;
            statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
            cadenceCounts[v.cadence] = (cadenceCounts[v.cadence] || 0) + 1;
            Object.keys(v.monthly_rev).forEach(function (mo) {
                monthlyTotals[mo] = (monthlyTotals[mo] || 0) + v.monthly_rev[mo];
            });
        });

        return {
            CUR: CUR, PRIOR: PRIOR, PRIOR2: PRIOR2, PRIOR3: PRIOR3, MONTHS_CUR: MONTHS_CUR,
            customers: customers, all: all,
            materiallyActive: materiallyActive, retained: retained,
            acctPct: acctPct, revPct: revPct, composite: composite,
            atRisk: atRisk, decliningGap: decliningGap, totalExposure: atRisk + decliningGap,
            totalPrior: totalPrior, totalCurYtd: totalCurYtd,
            totalCurAnn: (totalCurYtd / MONTHS_CUR) * 12,
            statusCounts: statusCounts, cadenceCounts: cadenceCounts, monthlyTotals: monthlyTotals
        };
    }

    // ══════════════════════════════════════════════════════════════════
    // HTML BUILDING BLOCKS
    // ══════════════════════════════════════════════════════════════════

    function makeLabels(M) {
        return {
            gone: 'Gone', significantly_overdue: 'Sig. Overdue', overdue: 'Overdue',
            growing: 'Growing', on_track: 'On Track', declining_cur: 'Declining',
            not_yet_due: 'Not Yet Due', new_cur: 'New ' + M.CUR, erratic: 'Erratic',
            one_time_prior: 'One-Time ' + M.PRIOR, one_time_old: 'One-Time (Old)', snoozed: 'Snoozed'
        };
    }

    function buildHtml(M, repName, TODAY, tzInfo, repList, curRepId, scriptUrl, opts) {
        opts = opts || {};
        var LABELS = makeLabels(M);
        var customers = M.customers;

        function sbadge(s) {
            return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;' +
                   'font-weight:600;color:#fff;background:' + (STATUS_COLORS[s] || '#7f8c8d') + '">' +
                   (LABELS[s] || s) + '</span>';
        }
        function cbadge(c) {
            return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;' +
                   'font-weight:600;color:#fff;background:' + (CADENCE_COLORS[c] || '#7f8c8d') + '">' +
                   (CADENCE_LABELS[c] || c) + '</span>';
        }
        function pbadge(p) {
            var c = { high: '#c8490c', medium: '#e67e22', low: '#27ae60' }[p] || '#7f8c8d';
            return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;' +
                   'font-weight:600;color:#fff;background:' + c + '">' + p.toUpperCase() + '</span>';
        }
        function notetag(c) {
            if (!c || !c.note_reason) return '';
            return ' <span title="' + esc(c.note_reason) + '" style="display:inline-block;padding:1px 6px;' +
                   'border-radius:9px;font-size:10px;font-weight:700;color:#8a5700;background:#fef3cd;' +
                   'border:1px solid #f0d98a;cursor:help">NOTE</span>';
        }
        function bbar(pct, color) {
            return '<div style="background:#f0ece7;border-radius:4px;height:8px"><div style="background:' + color +
                   ';border-radius:4px;height:8px;width:' + Math.min(100, Math.max(0, pct)) + '%"></div></div>';
        }
        function tile(label, val2, sub, red) {
            var vStyle = 'font-size:22px;font-weight:700' + (red ? ';color:#c8490c' : '');
            return '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:16px 18px">' +
                '<div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;' +
                'color:#9e9086;margin-bottom:5px">' + label + '</div>' +
                '<div style="' + vStyle + '">' + val2 + '</div>' +
                (sub ? '<div style="font-size:12px;color:#9e9086;margin-top:3px">' + sub + '</div>' : '') +
                '</div>';
        }

        var healthWord = M.composite >= 70 ? 'Healthy' : (M.composite >= 50 ? 'Needs Attention' : 'At Risk');
        var scoreC = M.composite >= 70 ? '#27ae60' : (M.composite >= 50 ? '#e67e22' : '#c8490c');

        // ---------- SUMMARY ----------
        var sc = M.statusCounts, cc = M.cadenceCounts;
        var summary = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-bottom:18px">' +
            tile(M.PRIOR + ' Total', fm(M.totalPrior), '', false) +
            tile(M.CUR + ' YTD', fm(M.totalCurYtd), 'Ann: ' + fm(M.totalCurAnn), false) +
            tile('Revenue At Risk', fm(M.atRisk), 'Overdue+gone accounts\u2019 ' + M.PRIOR, true) +
            tile('Declining Gap', fm(M.decliningGap), 'Pace vs ' + M.PRIOR, true) +
            tile('Total Exposure', fm(M.totalExposure), '', true) +
            tile('Retention Score', M.composite + '/100', healthWord, false) +
            tile('Overdue', String((sc.overdue || 0) + (sc.significantly_overdue || 0)),
                 (sc.significantly_overdue || 0) + ' significant', false) +
            tile('Not Yet Due', String(sc.not_yet_due || 0), 'Expected soon', false) +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px;margin-bottom:14px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Activity Cadence</div>' +
            '<div style="display:flex;gap:28px;flex-wrap:wrap">' +
            '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#27ae60">' + (cc.in_cadence || 0) + '</div><div style="font-size:11px;color:#6b6460">In Cadence</div></div>' +
            '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#e67e22">' + (cc.out_of_cadence || 0) + '</div><div style="font-size:11px;color:#6b6460">Out of Cadence</div></div>' +
            '<div style="text-align:center"><div style="font-size:26px;font-weight:700;color:#7f8c8d">' + (cc.no_activity || 0) + '</div><div style="font-size:11px;color:#6b6460">No Activity</div></div>' +
            '</div></div>';

        var chips = '<div style="display:flex;flex-wrap:wrap;gap:7px">';
        STATUS_ORDER.forEach(function (st) {
            var n = sc[st] || 0;
            if (!n) return;
            chips += '<div style="background:' + (STATUS_COLORS[st] || '#7f8c8d') + ';color:#fff;padding:5px 11px;' +
                     'border-radius:6px;font-size:12px;font-weight:600">' + (LABELS[st] || st) + ': ' + n + '</div>';
        });
        chips += '</div>';
        summary += '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:18px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:10px;font-family:Georgia,serif">Status Breakdown</div>' +
            chips + '</div>';

        // ---------- RETENTION ----------
        var healthBg = M.composite >= 70 ? '#d5f5e3' : (M.composite >= 50 ? '#fef3cd' : '#fde8e8');
        var healthFc = M.composite >= 70 ? '#1a6639' : (M.composite >= 50 ? '#8a5700' : '#8b1a1a');
        var ret = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:22px;margin-bottom:14px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:14px;font-family:Georgia,serif">Retention Score</div>' +
            '<div style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;background:' +
            healthBg + ';color:' + healthFc + ';margin-bottom:12px">' + healthWord + '</div>' +
            '<div style="font-size:48px;font-weight:800;color:' + scoreC + ';line-height:1;margin-bottom:8px">' +
            M.composite + '<span style="font-size:18px;color:#9e9086">/100</span></div>' +
            '<div style="max-width:380px;margin-bottom:12px">' +
            '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#6b6460;margin-bottom:3px">' +
            '<span>Account Retention</span><span>' + (Math.round(M.acctPct * 10) / 10) + '%</span></div>' + bbar(M.acctPct, '#2980b9') + '</div>' +
            '<div><div style="display:flex;justify-content:space-between;font-size:12px;color:#6b6460;margin-bottom:3px">' +
            '<span>Revenue Retention</span><span>' + (Math.round(M.revPct * 10) / 10) + '%</span></div>' + bbar(M.revPct, '#27ae60') + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:#9e9086">' + M.materiallyActive.length +
            ' materially active customers &nbsp;|&nbsp; ' + M.retained.length + ' retained</div></div>';

        // ---------- REVENUE CHART ----------
        var years = [M.PRIOR3, M.PRIOR2, M.PRIOR, M.CUR];
        var revYrs = {};
        years.forEach(function (y) { revYrs[y] = {}; });
        Object.keys(M.monthlyTotals).forEach(function (mk) {
            var y = parseInt(mk.substring(0, 4), 10), mn = parseInt(mk.substring(5, 7), 10);
            if (revYrs[y]) revYrs[y][mn] = (revYrs[y][mn] || 0) + M.monthlyTotals[mk];
        });

        var chartTable = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
            '<thead><tr><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2ddd6;color:#9e9086;font-weight:600">Month</th>';
        years.forEach(function (y) {
            chartTable += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2ddd6;color:#9e9086;font-weight:600">' + y + '</th>';
        });
        chartTable += '</tr></thead><tbody>';
        MONTHS_SHORT.forEach(function (mn, idx) {
            chartTable += '<tr style="border-bottom:1px solid #f0ece7"><td style="padding:6px 8px;font-weight:500">' + mn + '</td>';
            years.forEach(function (y) {
                var v = revYrs[y][idx + 1] || 0;
                var st = v > 0 ? 'color:#c8490c;font-weight:600' : 'color:#ccc';
                chartTable += '<td style="padding:6px 8px;text-align:right;' + st + '">' + (v > 0 ? fm(v) : '&mdash;') + '</td>';
            });
            chartTable += '</tr>';
        });
        chartTable += '</tbody></table></div>';

        var chartHtml = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:22px;margin-bottom:14px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:14px;font-family:Georgia,serif">Monthly Revenue ' +
            M.PRIOR3 + '&ndash;' + M.CUR + '</div>' +
            '<canvas id="revChart" height="90" style="margin-bottom:14px"></canvas>' +
            '<details><summary style="cursor:pointer;font-size:12px;color:#9e9086">View as table</summary>' +
            chartTable + '</details></div>';

        // ---------- RISK CARDS ----------
        var riskSet = { significantly_overdue: 1, gone: 1, overdue: 1, declining_cur: 1 };
        var priorRevs = M.all.filter(function (c) { return c.rev_prior > 0; })
                             .map(function (c) { return c.rev_prior; })
                             .sort(function (a, b) { return a - b; });
        var median = priorRevs.length ? priorRevs[Math.floor(priorRevs.length / 2)] : 0;
        var riskCusts = M.all.filter(function (c) { return riskSet[c.status] && c.rev_prior >= median; })
                             .sort(function (a, b) { return b.rev_prior - a.rev_prior; });

        var riskHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">';
        riskCusts.slice(0, 24).forEach(function (c) {
            var desc = '';
            if (c.status === 'significantly_overdue') {
                desc = 'Expected reorder ' + fd(c.expected_next) + ' (avg gap ' + (c.avg_gap || '?') + ' mo). ' +
                       Math.round(c.months_overdue || 0) + ' months past due.';
            } else if (c.status === 'gone') {
                desc = 'Last order ' + fd(c.last_order) + '. No activity >12 months.';
            } else if (c.status === 'overdue') {
                desc = 'Expected ' + fd(c.expected_next) + '. About ' + Math.round(c.months_overdue || 0) + ' month(s) overdue.';
            } else if (c.status === 'declining_cur') {
                var gap = Math.max(0, (c.rev_prior || 0) - (c.rev_cur_ann || 0));
                desc = 'Pacing ' + fm(c.rev_cur_ann) + ' ann. vs ' + fm(c.rev_prior) + ' in ' + M.PRIOR + '. Gap: ' + fm(gap) + '.';
            }
            var actInfo = c.last_activity_date ? fd(c.last_activity_date) : 'No activity logged';
            riskHtml += '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:14px;border-left:4px solid ' +
                (STATUS_COLORS[c.status] || '#e74c3c') + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
                '<div style="font-weight:700;font-size:13px">' + esc(c.name) + notetag(c) + '</div>' + sbadge(c.status) + '</div>' +
                '<div style="font-size:12px;color:#6b6460;margin-bottom:6px">' + M.PRIOR + ': ' + fm(c.rev_prior) +
                ' &nbsp; ' + M.CUR + ' YTD: ' + fm(c.rev_cur_ytd) + '</div>' +
                '<div style="font-size:12px;color:#4a4540;margin-bottom:8px;line-height:1.5">' + desc + '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + cbadge(c.cadence) +
                '<span style="font-size:11px;color:#9e9086">' + actInfo + '</span></div></div>';
        });
        riskHtml += '</div>';

        // ---------- ALL CUSTOMERS ----------
        var sortedCusts = M.all.slice().sort(function (a, b) { return (b.rev_prior || 0) - (a.rev_prior || 0); });
        var tblRows = '';
        sortedCusts.forEach(function (c) {
            var actInfo = c.last_activity_date ? fd(c.last_activity_date) : '&mdash;';
            var note = esc(String(c.last_activity_title || '').substring(0, 40));
            tblRows += '<tr data-status="' + c.status + '" data-cadence="' + c.cadence + '" data-name="' +
                esc(c.name.toLowerCase().replace(/"/g, '').substring(0, 60)) + '">' +
                '<td><b>' + esc(c.name) + '</b>' + notetag(c) + '</td>' +
                '<td>' + sbadge(c.status) + '</td>' +
                '<td style="text-align:right">' + fm(c.rev_prior) + '</td>' +
                '<td style="text-align:right">' + fm(c.rev_cur_ytd) + '</td>' +
                '<td style="text-align:right">' + fm(c.rev_cur_ann) + '</td>' +
                '<td>' + fd(c.last_order) + '</td>' +
                '<td>' + (c.expected_next ? fd(c.expected_next) : '&mdash;') + '</td>' +
                '<td>' + cbadge(c.cadence) + '</td>' +
                '<td>' + actInfo + '</td>' +
                '<td style="font-size:11px;color:#6b6460">' + note + '</td></tr>';
        });

        var tableHtml = '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
            '<input type="text" id="tblSearch" placeholder="Search..." oninput="filterT()" ' +
            'style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px;min-width:190px">' +
            '<select id="tblSt" onchange="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px">' +
            '<option value="">All Statuses</option>';
        STATUS_ORDER.forEach(function (st) {
            tableHtml += '<option value="' + st + '">' + (LABELS[st] || st) + '</option>';
        });
        tableHtml += '</select><select id="tblCad" onchange="filterT()" style="padding:7px 11px;border:1px solid #e2ddd6;border-radius:7px;font-size:13px">' +
            '<option value="">All Cadences</option><option value="in_cadence">In Cadence</option>' +
            '<option value="out_of_cadence">Out of Cadence</option><option value="no_activity">No Activity</option>' +
            '</select><span id="tblCnt" style="font-size:12px;color:#9e9086;align-self:center"></span>' +
            '<span style="font-size:11px;color:#c8aa90;align-self:center">click a column heading to sort</span></div>' +
            '<div style="overflow:auto;border:1px solid #e2ddd6;border-radius:10px;height:calc(100vh - 250px);min-height:360px">' +
            '<table id="custT" class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
        var TH = 'background:#f0ece7;padding:8px 10px;font-weight:600;font-size:11px;text-transform:uppercase;' +
                 'color:#6b6460;border-bottom:2px solid #e2ddd6;position:sticky;top:0;z-index:2;white-space:nowrap;cursor:pointer;';
        var headers = ['Customer', 'Status', M.PRIOR + ' Rev', M.CUR + ' YTD', M.CUR + ' Ann.',
                       'Last Order', 'Exp. Next', 'Cadence', 'Last Activity', 'Notes'];
        headers.forEach(function (h) {
            var isNum = (h === M.PRIOR + ' Rev' || h === M.CUR + ' YTD' || h === M.CUR + ' Ann.');
            tableHtml += '<th style="' + TH + 'text-align:' + (isNum ? 'right' : 'left') + '">' + h +
                         '<span class="sarw" style="opacity:.35;font-size:9px"> \u21c5</span></th>';
        });
        tableHtml += '</tr></thead><tbody id="custTbody">' + tblRows + '</tbody></table></div>';

        // ---------- EXPECTED REORDERS ----------
        var curMonthStart = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
        var nextMonthStart = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 1);
        var monthAfterStart = new Date(TODAY.getFullYear(), TODAY.getMonth() + 2, 1);

        function dueBetween(startD, endD) {
            return M.all.filter(function (c) {
                return c.status !== 'snoozed' && c.expected_next_d &&
                       c.expected_next_d >= startD && c.expected_next_d < endD;
            }).sort(function (a, b) { return b.expected_value - a.expected_value; });
        }
        var dueRows = dueBetween(curMonthStart, nextMonthStart);
        var nextRows = dueBetween(nextMonthStart, monthAfterStart);

        function sumBy(arr, k) { var s = 0; arr.forEach(function (x) { s += x[k]; }); return s; }
        var expRevThis = sumBy(dueRows, 'expected_value');
        var expRevNext = sumBy(nextRows, 'expected_value');

        function dueTable(rows) {
            if (!rows.length) return '<p style="color:#9e9086;font-size:13px">None expected this period.</p>';
            var h = '<div style="overflow:auto;max-height:62vh;border:1px solid #f0ece7;border-radius:8px">' +
                '<table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
            var cols = ['Customer', 'Status', 'Last Order', 'Exp. Date', 'Expected $',
                        M.PRIOR + ' Rev', M.CUR + ' YTD', 'Avg Gap', 'Cadence', 'Last Activity', 'Notes'];
            cols.forEach(function (col) {
                var al = (col === 'Expected $' || col === M.PRIOR + ' Rev' || col === M.CUR + ' YTD') ? 'right' : 'left';
                h += '<th style="background:#f0ece7;padding:7px 9px;text-align:' + al + ';font-weight:600;font-size:11px;' +
                     'text-transform:uppercase;color:#6b6460;border-bottom:2px solid #e2ddd6;white-space:nowrap;' +
                     'position:sticky;top:0;z-index:2;cursor:pointer">' + col +
                     '<span class="sarw" style="opacity:.35;font-size:9px"> \u21c5</span></th>';
            });
            h += '</tr></thead><tbody>';
            rows.forEach(function (c) {
                h += '<tr style="border-bottom:1px solid #f0ece7">' +
                    '<td style="padding:7px 9px"><b>' + esc(c.name) + '</b>' + notetag(c) + '</td>' +
                    '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>' +
                    '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.last_order) + '</td>' +
                    '<td style="padding:7px 9px;white-space:nowrap">' + fd(c.expected_next) + '</td>' +
                    '<td style="padding:7px 9px;text-align:right;font-weight:700;color:#c8490c">' + fm(c.expected_value) + '</td>' +
                    '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_prior) + '</td>' +
                    '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_cur_ytd) + '</td>' +
                    '<td style="padding:7px 9px">' + (c.avg_gap ? (Math.round(c.avg_gap) + ' mo') : '&mdash;') + '</td>' +
                    '<td style="padding:7px 9px">' + cbadge(c.cadence) + '</td>' +
                    '<td style="padding:7px 9px;white-space:nowrap">' + (c.last_activity_date ? fd(c.last_activity_date) : '&mdash;') + '</td>' +
                    '<td style="padding:7px 9px;font-size:11px;color:#6b6460">' + esc(String(c.last_activity_title || '').substring(0, 50)) + '</td>' +
                    '</tr>';
            });
            h += '<tr class="totalrow" style="background:#fff8f0;border-top:2px solid #c8490c">' +
                '<td style="padding:8px 9px;font-weight:700">TOTAL (' + rows.length + ' accounts)</td>' +
                '<td></td><td></td><td></td>' +
                '<td style="padding:8px 9px;text-align:right;font-weight:800;color:#c8490c;font-size:14px">' + fm(sumBy(rows, 'expected_value')) + '</td>' +
                '<td style="padding:8px 9px;text-align:right;font-weight:600">' + fm(sumBy(rows, 'rev_prior')) + '</td>' +
                '<td style="padding:8px 9px;text-align:right;font-weight:600">' + fm(sumBy(rows, 'rev_cur_ytd')) + '</td>' +
                '<td colspan="4"></td></tr></tbody></table></div>';
            return h;
        }

        var curMonthName = MONTHS_LONG[TODAY.getMonth()] + ' ' + TODAY.getFullYear();
        var nextMonthName = MONTHS_LONG[nextMonthStart.getMonth()] + ' ' + nextMonthStart.getFullYear();

        var dueHtml = '<div style="background:#f0f8ff;border:1px solid #aed6f1;border-radius:8px;padding:10px 14px;' +
            'font-size:12px;color:#1a5276;margin-bottom:14px">Based on historical ordering cadence. Expected $ = average ' +
            'order size over the trailing 12 months. Reach out proactively to keep these accounts on track.</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px">' +
            tile('Expected Revenue &mdash; ' + curMonthName, fm(expRevThis), dueRows.length + ' accounts due', true) +
            tile('Expected Revenue &mdash; ' + nextMonthName, fm(expRevNext), nextRows.length + ' accounts due', false) +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px;margin-bottom:14px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Due in ' +
            curMonthName + ' (' + dueRows.length + ')</div>' + dueTable(dueRows) + '</div>' +
            '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Due in ' +
            nextMonthName + ' (' + nextRows.length + ')</div>' + dueTable(nextRows) + '</div>';

        // ---------- shared call-plan helpers ----------
        function daysAgo(dateStr) {
            if (!dateStr) return null;
            var d = parseDate(dateStr);
            if (!d) return null;
            var n = dayDiff(TODAY, d);
            if (n === 0) return 'today';
            if (n === 1) return 'yesterday';
            if (n < 7) return n + ' days ago';
            if (n < 30) { var w = Math.floor(n / 7); return w + (w === 1 ? ' week ago' : ' weeks ago'); }
            var mo = Math.round(n / 30.44);
            return mo + (mo === 1 ? ' month ago' : ' months ago');
        }
        function callObjective(reason, cname, expNext) {
            var cd = customers[cname] || {};
            var mo = cd.months_overdue;
            if (reason.indexOf('Significantly Overdue') >= 0) {
                var suffix = (mo && mo > 0) ? (' \u2014 ' + (Math.round(mo * 10) / 10) + ' months past expected') : '';
                return 'Urgent check-in: well past expected reorder window' + suffix;
            }
            if (reason.indexOf('Overdue') >= 0) return 'Follow up: order is past due, confirm reorder plans';
            return 'Touch base: order expected around ' + fd(expNext);
        }
        function activityLine(row) {
            var ago = daysAgo(row.last_activity_date);
            if (row.last_activity_title && ago) {
                return { txt: '"' + esc(String(row.last_activity_title).substring(0, 60)) + '" &mdash; ' + ago, warn: false };
            }
            if (ago) return { txt: 'Last contact ' + ago, warn: false };
            return { txt: 'No contact on record', warn: true };
        }
        function accountCard(cid, row, objText, revMain, revLbl, revSub, prioBadge) {
            var a = activityLine(row);
            var gapStr = row.avg_gap ? (' <span style="font-size:11px;color:#9e9086">Avg gap: ' +
                         (Math.round(row.avg_gap * 10) / 10) + ' mo</span>') : '';
            return '<div class="ac" id="' + cid + '"><div>' +
                '<div class="ac-name">' + esc(row.name) + (prioBadge || '') + notetag(customers[row.name]) + '</div>' +
                '<div class="ac-obj">' + objText + '</div>' +
                '<div class="ac-meta">' + sbadge(row.status) + ' ' + cbadge(row.cadence) + gapStr + '</div>' +
                '<div class="ac-act' + (a.warn ? ' warn' : '') + '">' + a.txt + '</div></div>' +
                '<div class="ac-right">' +
                '<div class="ac-rev">' + revMain + '</div>' +
                '<div class="ac-rev-lbl">' + revLbl + '</div>' +
                (revSub || '') +
                '<label class="call-lbl" id="l' + cid + '" onclick="tc(\'' + cid + '\');return false;">' +
                '<input type="checkbox" onclick="event.stopPropagation()"> Called</label>' +
                '</div></div>';
        }

        var SC_CSS = '<style>' +
            '.sc-banner{background:linear-gradient(135deg,#1a1714 0%,#2d2520 100%);color:#fff;border-radius:10px;padding:16px 22px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center}' +
            '.sc-banner h2{font-size:17px;font-weight:700;font-family:"DM Serif Display",Georgia,serif;margin-bottom:4px}' +
            '.sc-banner p{font-size:12px;color:#c4b9b0}' +
            '.sc-stat .big{font-size:26px;font-weight:700;color:#ff8c6b;text-align:right}' +
            '.sc-stat .lbl{font-size:11px;color:#c4b9b0;text-align:right}' +
            '.wk-card{background:#fff;border:1px solid #e2ddd6;border-radius:10px;margin-bottom:14px;overflow:hidden}' +
            '.wk-hdr{padding:13px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #f0ece7}' +
            '.wk-hdr.cur{background:#fff8f0;border-bottom-color:#c8490c}' +
            '.wk-title{font-size:16px;font-weight:700;font-family:"DM Serif Display",Georgia,serif}' +
            '.wk-dates{font-size:13px;color:#9e9086;margin-left:8px}' +
            '.cur-badge{display:inline-block;background:#c8490c;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:10px;vertical-align:middle;letter-spacing:.5px}' +
            '.wk-counts{display:flex;gap:8px}' +
            '.wk-ct{font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;white-space:nowrap}' +
            '.wk-ct.hi{background:#fde8e0;color:#c8490c}' +
            '.wk-ct.md{background:#fef3e2;color:#b07818}' +
            '.pri-section{padding:0 18px}' +
            '.pri-hdr{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:10px 0 6px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f0ece7;margin-bottom:2px}' +
            '.pri-hdr.hi{color:#c8490c}' +
            '.pri-hdr.md{color:#b07818}' +
            '.ac{display:grid;grid-template-columns:1fr auto;gap:12px;padding:11px 0;border-bottom:1px solid #f0ece7;align-items:start}' +
            '.ac:last-child{border-bottom:none}' +
            '.ac.done{opacity:.4}' +
            '.ac.done .ac-name{text-decoration:line-through}' +
            '.ac-name{font-weight:700;font-size:14px;margin-bottom:3px}' +
            '.ac-obj{font-size:12px;color:#4a4440;margin-bottom:5px;font-style:italic}' +
            '.ac-meta{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:4px}' +
            '.ac-act{font-size:11px;color:#6b6460}' +
            '.ac-act.warn{color:#e67e22;font-weight:500}' +
            '.ac-right{text-align:right;flex-shrink:0;min-width:90px}' +
            '.ac-rev{font-size:16px;font-weight:700}' +
            '.ac-rev-lbl{font-size:10px;color:#9e9086;margin-bottom:8px}' +
            '.call-lbl{display:flex;align-items:center;gap:5px;justify-content:flex-end;cursor:pointer;font-size:12px;font-weight:600;color:#2980b9;user-select:none;margin-top:4px}' +
            '.call-lbl input{cursor:pointer}' +
            '.call-lbl.ck{color:#27ae60}' +
            '.sec-pad{padding-bottom:14px}' +
            '</style>';

        // ---------- MONTH CALL PLAN ----------
        var weekStarts = [];
        var wd = new Date(curMonthStart.getTime());
        while (wd < nextMonthStart) { weekStarts.push(new Date(wd.getTime())); wd = addDays(wd, 7); }
        var lastDayOfMonth = addDays(nextMonthStart, -1).getDate();

        var schedule = {}, seen = {};
        function pushSched(label, entry) {
            if (!schedule[label]) schedule[label] = [];
            schedule[label].push(entry);
        }
        function schedEntry(v, reason, priority) {
            return { name: v.name, reason: reason, expected_next: v.expected_next, rev_prior: v.rev_prior,
                     rev_cur_ytd: v.rev_cur_ytd, status: v.status, cadence: v.cadence,
                     last_activity_date: v.last_activity_date, last_activity_title: v.last_activity_title,
                     priority: priority, avg_gap: v.avg_gap };
        }

        M.all.slice().sort(function (a, b) { return b.rev_prior - a.rev_prior; }).forEach(function (v) {
            if (v.status === 'snoozed' || !v.expected_next_d) return;
            var en = v.expected_next_d;
            if (en >= curMonthStart && en < nextMonthStart) {
                var wkNum = Math.min(Math.floor(dayDiff(en, curMonthStart) / 7) + 1, weekStarts.length);
                var ws = weekStarts[wkNum - 1];
                var label = 'Week ' + wkNum + ' (' + MONTHS_SHORT[curMonthStart.getMonth()] + ' ' + ws.getDate() +
                            '-' + Math.min(ws.getDate() + 6, lastDayOfMonth) + ')';
                pushSched(label, schedEntry(v, 'Expected Order Due', 'medium'));
                seen[v.name] = 1;
            }
        });

        M.all.filter(function (x) { return x.status === 'significantly_overdue'; })
             .sort(function (a, b) { return b.rev_prior - a.rev_prior; })
             .slice(0, 8).forEach(function (v) {
            if (seen[v.name]) return;
            var label = 'Week 1 (' + MONTHS_SHORT[curMonthStart.getMonth()] + ' ' + pad2(curMonthStart.getDate()) +
                        '-' + Math.min(curMonthStart.getDate() + 6, lastDayOfMonth) + ')';
            pushSched(label, schedEntry(v, 'Significantly Overdue - Urgent', 'high'));
            seen[v.name] = 1;
        });

        M.all.filter(function (x) { return x.status === 'overdue'; })
             .sort(function (a, b) { return b.rev_prior - a.rev_prior; })
             .slice(0, 6).forEach(function (v) {
            if (seen[v.name]) return;
            var label = weekStarts.length > 1 ? 'Week 2' : 'Week 1';
            Object.keys(schedule).forEach(function (wl) { if (wl.indexOf('Week 2') === 0) label = wl; });
            pushSched(label, schedEntry(v, 'Overdue - Follow Up', 'high'));
            seen[v.name] = 1;
        });

        var prioOrder = { high: 0, medium: 1, low: 2 };
        Object.keys(schedule).forEach(function (wk) {
            schedule[wk].sort(function (a, b) {
                var pa = prioOrder[a.priority] === undefined ? 2 : prioOrder[a.priority];
                var pb = prioOrder[b.priority] === undefined ? 2 : prioOrder[b.priority];
                return (pa - pb) || (b.rev_prior - a.rev_prior);
            });
        });

        var totalCalls = 0, highTotal = 0;
        Object.keys(schedule).forEach(function (wk) {
            totalCalls += schedule[wk].length;
            schedule[wk].forEach(function (r) { if (r.priority === 'high') highTotal++; });
        });
        var currentWeekIdx = Math.min(Math.floor(dayDiff(TODAY, curMonthStart) / 7), Math.max(0, weekStarts.length - 1));

        var schedHtml = SC_CSS +
            '<div class="sc-banner"><div><h2>' + curMonthName + ' Call Plan</h2>' +
            '<p>Work HIGH priority first each week. Check off accounts as you call.</p></div>' +
            '<div class="sc-stat"><div class="big">' + totalCalls + '</div>' +
            '<div class="lbl">' + highTotal + ' HIGH &middot; ' + (totalCalls - highTotal) + ' expected orders</div></div></div>';

        Object.keys(schedule).sort().forEach(function (wk, wkIdx) {
            var rows = schedule[wk];
            if (!rows.length) return;
            var isCur = (wkIdx === currentWeekIdx);
            var parts = wk.split('(');
            var wkNumStr = parts[0].trim();
            var wkDateStr = parts.length > 1 ? ('(' + parts.slice(1).join('(')) : '';
            var hiRows = rows.filter(function (r) { return r.priority === 'high'; });
            var mdRows = rows.filter(function (r) { return r.priority !== 'high'; });

            schedHtml += '<div class="wk-card"><div class="wk-hdr' + (isCur ? ' cur' : '') + '">' +
                '<div><span class="wk-title">' + wkNumStr + '</span>' +
                '<span class="wk-dates">' + wkDateStr + '</span>' +
                (isCur ? '<span class="cur-badge">THIS WEEK</span>' : '') + '</div>' +
                '<div class="wk-counts">' +
                (hiRows.length ? '<span class="wk-ct hi">' + hiRows.length + ' HIGH</span>' : '') +
                (mdRows.length ? '<span class="wk-ct md">' + mdRows.length +
                    (mdRows.length === 1 ? ' EXPECTED ORDER' : ' EXPECTED ORDERS') + '</span>' : '') +
                '</div></div><div class="pri-section">';

            if (hiRows.length) {
                schedHtml += '<div class="pri-hdr hi">&#9888; HIGH PRIORITY &mdash; Call These First</div>';
                hiRows.forEach(function (row, i) {
                    schedHtml += accountCard('c' + wkIdx + 'h' + i, row,
                        callObjective(row.reason, row.name, row.expected_next),
                        fm(row.rev_prior), M.PRIOR + ' rev', '', '');
                });
            }
            if (mdRows.length) {
                schedHtml += '<div class="pri-hdr md">&#x25cf; EXPECTED ORDERS &mdash; Touch Base</div>';
                mdRows.forEach(function (row, i) {
                    schedHtml += accountCard('c' + wkIdx + 'm' + i, row,
                        callObjective(row.reason, row.name, row.expected_next),
                        fm(row.rev_prior), M.PRIOR + ' rev', '', '');
                });
            }
            schedHtml += '<div class="sec-pad"></div></div></div>';
        });

        // ---------- CALL THIS WEEK (day by day) ----------
        var dow = (TODAY.getDay() + 6) % 7;               // 0 = Monday
        var weekMonday = addDays(TODAY, -dow);
        var weekList = [], weekSeen = {};

        M.all.filter(function (x) { return x.status === 'significantly_overdue'; })
             .sort(function (a, b) { return b.rev_prior - a.rev_prior; })
             .slice(0, 10).forEach(function (v) {
            weekList.push({ c: v, priority: 'high', reason: 'Significantly Overdue - Urgent' });
            weekSeen[v.name] = 1;
        });
        M.all.filter(function (x) { return x.status === 'overdue'; })
             .sort(function (a, b) { return b.rev_prior - a.rev_prior; })
             .slice(0, 8).forEach(function (v) {
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
        for (var b = 0; b < 5; b++) dayBins.push(weekList.slice(b * perDay, (b + 1) * perDay));

        var weekHigh = weekList.filter(function (e) { return e.priority === 'high'; }).length;
        var weekExpRev = 0;
        weekList.forEach(function (e) { weekExpRev += e.c.expected_value; });

        var weekHtml = '<div class="sc-banner"><div><h2>Call Plan &mdash; Week of ' +
            MONTHS_LONG[weekMonday.getMonth()] + ' ' + pad2(weekMonday.getDate()) + '</h2>' +
            '<p>Priority-first: HIGH accounts land Monday&ndash;Tuesday. Check off as you call.</p></div>' +
            '<div class="sc-stat"><div class="big">' + nWeek + '</div>' +
            '<div class="lbl">' + weekHigh + ' HIGH &middot; ' + fm(weekExpRev) + ' expected reorder value</div></div></div>';

        if (!nWeek) {
            weekHtml += '<p style="color:#9e9086;font-size:13px">No calls needed this week &mdash; nothing overdue or due this month.</p>';
        }

        for (var di = 0; di < 5; di++) {
            var day = addDays(weekMonday, di);
            var entries = dayBins[di] || [];
            var isToday = (iso(day) === iso(TODAY));
            var dayExp = 0;
            entries.forEach(function (e) { dayExp += e.c.expected_value; });
            var nHi = entries.filter(function (e) { return e.priority === 'high'; }).length;
            var nMd = entries.length - nHi;

            weekHtml += '<div class="wk-card"><div class="wk-hdr' + (isToday ? ' cur' : '') + '">' +
                '<div><span class="wk-title">' + DAYS_LONG[day.getDay()] + '</span>' +
                '<span class="wk-dates">' + MONTHS_SHORT[day.getMonth()] + ' ' + pad2(day.getDate()) + '</span>' +
                (isToday ? '<span class="cur-badge">TODAY</span>' : '') + '</div>' +
                '<div class="wk-counts">' +
                (nHi ? '<span class="wk-ct hi">' + nHi + ' HIGH</span>' : '') +
                (nMd ? '<span class="wk-ct md">' + nMd + ' EXPECTED</span>' : '') +
                '<span class="wk-ct" style="background:#eef4ee;color:#1a6639">' + fm(dayExp) + '</span>' +
                '</div></div><div class="pri-section">';

            if (!entries.length) {
                weekHtml += '<p style="color:#9e9086;font-size:13px;padding:12px 0">No calls scheduled.</p>';
            }
            entries.forEach(function (e, i) {
                var row = e.c;
                weekHtml += accountCard('wd' + di + 'i' + i, row,
                    callObjective(e.reason, row.name, row.expected_next),
                    fm(row.expected_value), 'expected reorder',
                    '<div style="font-size:11px;color:#9e9086;margin-bottom:6px">' + M.PRIOR + ': ' + fm(row.rev_prior) + '</div>',
                    ' ' + pbadge(e.priority));
            });
            weekHtml += '<div class="sec-pad"></div></div></div>';
        }

        // ---------- ACTIVITY CADENCE ----------
        var outCad = M.all.filter(function (c) { return c.cadence === 'out_of_cadence' && c.rev_prior > 0; })
                          .sort(function (a, b) { return b.rev_prior - a.rev_prior; });
        var cadHtml = '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px;margin-bottom:14px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Cadence by Status</div>' +
            '<canvas id="cadChart" height="80"></canvas></div>' +
            '<div style="background:#fff;border:1px solid #e2ddd6;border-radius:10px;padding:20px">' +
            '<div style="font-size:15px;font-weight:700;margin-bottom:12px;font-family:Georgia,serif">Top Out-of-Cadence Accounts</div>' +
            '<div style="overflow:auto;max-height:62vh;border:1px solid #f0ece7;border-radius:8px">' +
            '<table class="sortable" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
        ['Customer', 'Status', M.PRIOR + ' Rev', 'Last Activity', 'Notes', 'Exp. Next'].forEach(function (h) {
            cadHtml += '<th style="background:#f0ece7;padding:7px 9px;font-weight:600;font-size:11px;text-transform:uppercase;' +
                'color:#6b6460;border-bottom:2px solid #e2ddd6;text-align:left;white-space:nowrap;position:sticky;top:0;' +
                'z-index:2;cursor:pointer">' + h + '<span class="sarw" style="opacity:.35;font-size:9px"> \u21c5</span></th>';
        });
        cadHtml += '</tr></thead><tbody>';
        outCad.slice(0, 60).forEach(function (c) {
            cadHtml += '<tr style="border-bottom:1px solid #f0ece7">' +
                '<td style="padding:7px 9px"><b>' + esc(c.name) + '</b>' + notetag(c) + '</td>' +
                '<td style="padding:7px 9px">' + sbadge(c.status) + '</td>' +
                '<td style="padding:7px 9px;text-align:right">' + fm(c.rev_prior) + '</td>' +
                '<td style="padding:7px 9px;white-space:nowrap">' + (c.last_activity_date ? fd(c.last_activity_date) : '&mdash;') + '</td>' +
                '<td style="padding:7px 9px;font-size:11px;color:#6b6460">' + esc(String(c.last_activity_title || '').substring(0, 50)) + '</td>' +
                '<td style="padding:7px 9px;white-space:nowrap">' + (c.expected_next ? fd(c.expected_next) : '&mdash;') + '</td>' +
                '</tr>';
        });
        cadHtml += '</tbody></table></div></div>';

        // ---------- chart data ----------
        function seriesFor(y) {
            var a = [];
            for (var i = 1; i <= 12; i++) a.push(r2(revYrs[y][i] || 0));
            return JSON.stringify(a);
        }
        var statOrderJ = ['growing','on_track','new_cur','not_yet_due','declining_cur','overdue','significantly_overdue','gone'];
        function cadCount(st, cad) {
            var n = 0;
            M.all.forEach(function (c) { if (c.status === st && c.cadence === cad) n++; });
            return n;
        }
        var cadLabels = JSON.stringify(statOrderJ.map(function (s) { return LABELS[s] || s; }));
        var cadIn  = JSON.stringify(statOrderJ.map(function (s) { return cadCount(s, 'in_cadence'); }));
        var cadOut = JSON.stringify(statOrderJ.map(function (s) { return cadCount(s, 'out_of_cadence'); }));
        var cadNo  = JSON.stringify(statOrderJ.map(function (s) { return cadCount(s, 'no_activity'); }));

        // ---------- rep picker ----------
        var picker = '';
        if (opts.showPicker && repList.length > 1) {
            picker = '<select id="repSel" onchange="switchRep()" style="background:#2d2520;color:#fff;border:1px solid #4a423c;' +
                     'border-radius:6px;padding:6px 10px;font-size:12px;font-family:inherit">';
            repList.forEach(function (r) {
                picker += '<option value="' + esc(r.id) + '"' + (r.id === String(curRepId) ? ' selected' : '') + '>' +
                          esc(r.name) + (r.txns ? ' (' + r.txns + ')' : '') + '</option>';
            });
            picker += '</select>';
        }

        // ---------- assemble ----------
        var monthYear = MONTHS_LONG[TODAY.getMonth()] + ' ' + TODAY.getFullYear();
        var generated = MONTHS_LONG[TODAY.getMonth()] + ' ' + pad2(TODAY.getDate()) + ', ' + TODAY.getFullYear();

        var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1.0">' +
            '<title>' + esc(repName) + ' Retention Dashboard &mdash; ' + monthYear + '</title>' +
            '<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">' +
            '<script src="' + CHART_JS_URL + '"><\/script>' +
            '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"DM Sans",Arial,sans-serif;background:#f7f6f3;color:#1a1714;font-size:14px}' +
            '.hdr{background:#1a1714;border-top:3px solid #c8490c;padding:16px 26px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}' +
            '.hdr h1{color:#fff;font-size:21px;font-family:"DM Serif Display",Georgia,serif}' +
            '.hdr .sub{color:#9e9086;font-size:11px;margin-bottom:2px}' +
            '.nav{background:#fff;border-bottom:2px solid #e2ddd6;padding:0 20px;display:flex;gap:2px;overflow-x:auto}' +
            '.nav button{background:none;border:none;padding:12px 15px;cursor:pointer;font-size:13px;font-weight:500;color:#6b6460;border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap}' +
            '.nav button.on,.nav button:hover{color:#1a1714;border-bottom-color:#c8490c}' +
            '.pnl{display:none;padding:20px 24px}.pnl.on{display:block}' +
            '#custT td{padding:7px 12px}#custT tbody tr:hover{background:#faf8f5}table.sortable td{white-space:nowrap}' +
            '</style></head><body>' +
            '<div class="hdr"><div><div class="sub">RETENTION DASHBOARD &mdash; LIVE FROM NETSUITE</div>' +
            '<h1>' + esc(repName) + ' &mdash; ' + monthYear + '</h1></div>' +
            '<div style="display:flex;align-items:center;gap:14px">' + picker +
            '<div style="color:#9e9086;font-size:12px;text-align:right">Generated ' + generated +
            '<div style="font-size:10px;color:#6b6460">' + esc(tzInfo.tz) + '</div></div></div></div>' +
            (opts.notice ? '<div style="background:#fff8f0;border-bottom:1px solid #f0d98a;color:#8a5700;' +
                'padding:9px 26px;font-size:12.5px">' + opts.notice + '</div>' : '') +
            '<div class="nav">' +
            '<button class="on" onclick="show(\'summary\',this)">Summary</button>' +
            '<button onclick="show(\'retention\',this)">Retention Score</button>' +
            '<button onclick="show(\'chart\',this)">Revenue Chart</button>' +
            '<button onclick="show(\'risk\',this)">Risk Cards</button>' +
            '<button onclick="show(\'table\',this)">All Customers</button>' +
            '<button onclick="show(\'due\',this)">Expected Reorders</button>' +
            '<button onclick="show(\'week\',this)">Call This Week</button>' +
            '<button onclick="show(\'schedule\',this)">Month Call Plan</button>' +
            '<button onclick="show(\'cadence\',this)">Activity Cadence</button>' +
            '</div>' +
            '<div id="p-summary" class="pnl on">' + summary + '</div>' +
            '<div id="p-retention" class="pnl">' + ret + '</div>' +
            '<div id="p-chart" class="pnl">' + chartHtml + '</div>' +
            '<div id="p-risk" class="pnl">' + riskHtml + '</div>' +
            '<div id="p-table" class="pnl">' + tableHtml + '</div>' +
            '<div id="p-due" class="pnl">' + dueHtml + '</div>' +
            '<div id="p-week" class="pnl">' + weekHtml + '</div>' +
            '<div id="p-schedule" class="pnl">' + schedHtml + '</div>' +
            '<div id="p-cadence" class="pnl">' + cadHtml + '</div>' +
            '<script>' +
            'var SCRIPT_URL=' + JSON.stringify(scriptUrl) + ';' +
            'function switchRep(){var s=document.getElementById("repSel");if(!s)return;var u=SCRIPT_URL;u+=(u.indexOf("?")>=0?"&":"?")+"rep="+encodeURIComponent(s.value);window.location.href=u;}' +
            'function show(id,btn){document.querySelectorAll(".pnl").forEach(function(p){p.classList.remove("on");});document.querySelectorAll(".nav button").forEach(function(b){b.classList.remove("on");});document.getElementById("p-"+id).classList.add("on");btn.classList.add("on");if(id==="chart"&&!window._cv){buildRevChart();window._cv=true;}if(id==="cadence"&&!window._cc){buildCadChart();window._cc=true;}}' +
            'function filterT(){var q=(document.getElementById("tblSearch").value||"").toLowerCase();var st=document.getElementById("tblSt").value;var cd=document.getElementById("tblCad").value;var rows=document.querySelectorAll("#custTbody tr");var n=0;rows.forEach(function(r){var sh=(!q||r.getAttribute("data-name").indexOf(q)>=0)&&(!st||r.getAttribute("data-status")===st)&&(!cd||r.getAttribute("data-cadence")===cd);r.style.display=sh?"":"none";if(sh)n++;});var el=document.getElementById("tblCnt");if(el)el.textContent=n+" customers";}' +
            'function buildRevChart(){try{var c=document.getElementById("revChart");if(!c||typeof Chart==="undefined")return;new Chart(c.getContext("2d"),{type:"bar",data:{labels:' + JSON.stringify(MONTHS_SHORT) + ',datasets:[' +
            '{label:"' + M.PRIOR3 + '",data:' + seriesFor(M.PRIOR3) + ',backgroundColor:"#b8c8e8",borderRadius:3},' +
            '{label:"' + M.PRIOR2 + '",data:' + seriesFor(M.PRIOR2) + ',backgroundColor:"#b8a9d4",borderRadius:3},' +
            '{label:"' + M.PRIOR + '",data:' + seriesFor(M.PRIOR) + ',backgroundColor:"#2d6a4f",borderRadius:3},' +
            '{label:"' + M.CUR + '",data:' + seriesFor(M.CUR) + ',backgroundColor:"#e55d1e",borderRadius:3}]},' +
            'options:{responsive:true,plugins:{legend:{position:"top"}},scales:{y:{ticks:{callback:function(v){return "$"+Math.round(v/1000)+"k";}}}}}});}catch(e){}}' +
            'function buildCadChart(){try{var c=document.getElementById("cadChart");if(!c||typeof Chart==="undefined")return;new Chart(c.getContext("2d"),{type:"bar",data:{labels:' + cadLabels + ',datasets:[{label:"In Cadence",data:' + cadIn + ',backgroundColor:"#27ae60",borderRadius:3},{label:"Out of Cadence",data:' + cadOut + ',backgroundColor:"#e67e22",borderRadius:3},{label:"No Activity",data:' + cadNo + ',backgroundColor:"#7f8c8d",borderRadius:3}]},options:{responsive:true,plugins:{legend:{position:"top"}},scales:{x:{stacked:true},y:{stacked:true,ticks:{precision:0}}}}});}catch(e){}}' +
            '(function(){var rows=document.querySelectorAll("#custTbody tr");var el=document.getElementById("tblCnt");if(el)el.textContent=rows.length+" customers";})();' +
            'function parseCell(t){t=(t||"").trim();if(t===""||t==="\u2014")return{n:-Infinity,s:""};var m=t.replace(/[$,]/g,"");if(/^-?\\d+(\\.\\d+)?$/.test(m))return{n:parseFloat(m),s:t.toLowerCase()};var d=t.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);if(d)return{n:new Date(+d[3],+d[1]-1,+d[2]).getTime(),s:t};return{n:NaN,s:t.toLowerCase()};}' +
            'function sortTable(t,idx,th){var tb=t.tBodies[0];if(!tb)return;var rows=[].slice.call(tb.rows).filter(function(r){return !r.classList.contains("totalrow");});var totals=[].slice.call(tb.rows).filter(function(r){return r.classList.contains("totalrow");});var pk=rows.map(function(r){return parseCell((r.cells[idx]||{}).textContent);});var allNum=pk.some(function(x){return !isNaN(x.n)&&x.n!==-Infinity;})&&pk.every(function(x){return !isNaN(x.n);});var same=t._sc===idx;var dir=same?-t._sd:(allNum?-1:1);rows.sort(function(a,b){var av=parseCell((a.cells[idx]||{}).textContent),bv=parseCell((b.cells[idx]||{}).textContent);if(allNum)return (av.n-bv.n)*dir;return (av.s<bv.s?-1:av.s>bv.s?1:0)*dir;});rows.forEach(function(r){tb.appendChild(r);});totals.forEach(function(r){tb.appendChild(r);});t._sc=idx;t._sd=dir;var hs=th.parentElement.children;for(var i=0;i<hs.length;i++){var ar=hs[i].querySelector(".sarw");if(ar){ar.textContent=" \\u21c5";ar.style.opacity=".35";}}var a2=th.querySelector(".sarw");if(a2){a2.textContent=dir<0?" \\u2193":" \\u2191";a2.style.opacity="1";}}' +
            'document.querySelectorAll("table.sortable").forEach(function(t){var hr=t.tHead&&t.tHead.rows[0];if(!hr)return;[].slice.call(hr.cells).forEach(function(th,idx){th.addEventListener("click",function(){sortTable(t,idx,th);});});});' +
            'function tc(id){var card=document.getElementById(id);var lbl=document.getElementById("l"+id);var cb=lbl.querySelector("input");if(card.classList.contains("done")){card.classList.remove("done");lbl.classList.remove("ck");cb.checked=false;}else{card.classList.add("done");lbl.classList.add("ck");cb.checked=true;}}' +
            '<\/script></body></html>';

        return html;
    }

    // ══════════════════════════════════════════════════════════════════
    // ENTRY POINT
    // ══════════════════════════════════════════════════════════════════

    function messagePage(title, msg, accent) {
        return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Retention Dashboard</title></head>' +
            '<body style="font-family:Arial,sans-serif;background:#f7f6f3;padding:40px;color:#1a1714">' +
            '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2ddd6;border-left:4px solid ' +
            (accent || '#c8490c') + ';border-radius:10px;padding:24px">' +
            '<h2 style="margin-bottom:10px;font-size:18px">' + title + '</h2>' +
            '<p style="font-size:14px;line-height:1.6;color:#4a4540">' + msg + '</p></div></body></html>';
    }

    function errorPage(msg) {
        return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Retention Dashboard</title></head>' +
            '<body style="font-family:Arial,sans-serif;background:#f7f6f3;padding:40px;color:#1a1714">' +
            '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2ddd6;border-left:4px solid #c8490c;' +
            'border-radius:10px;padding:24px"><h2 style="margin-bottom:10px;font-size:18px">Retention Dashboard</h2>' +
            '<p style="font-size:14px;line-height:1.6;color:#4a4540">' + esc(msg) + '</p></div></body></html>';
    }

    function onRequest(context) {
        var response = context.response;
        response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });

        try {
            // --- today, in the logged-in user's time zone ---------------
            var tzInfo = resolveToday();
            var TODAY = tzInfo.date;

            // --- resolve the rep ----------------------------------------
            var reps = getSalesReps();
            if (!reps.length) {
                response.write(errorPage('No active sales reps were found in this account.'));
                return;
            }

            var currentUserId = String(runtime.getCurrentUser().id);
            var isAdmin = isAdminViewer();

            var viewerRoleId = '';
            try { viewerRoleId = String(runtime.getCurrentUser().role); } catch (eR) { viewerRoleId = ''; }
            var isAllowedRole = ALLOWED_VIEWER_ROLE_IDS.indexOf(viewerRoleId) >= 0;
            var viewsAnyRep = isAdmin || isAllowedRole || OPEN_TO_ALL_ROLES;

            // --- date windows -------------------------------------------
            var CUR = TODAY.getFullYear();
            var ordersFrom  = '01/01/' + (CUR - 1);
            var invoiceFrom = '01/01/' + (CUR - 3);
            var invoiceTo   = '12/31/' + (CUR - 2);

            // --- only offer reps who actually have data ------------------
            var counts = getRepTxnCounts(invoiceFrom);
            reps.forEach(function (r) { r.txns = counts[r.id] || 0; });

            var pickable = reps.filter(function (r) {
                return r.txns > 0 && NON_SELLING_REPS.indexOf(r.id) < 0;
            }).sort(function (a, b) { return b.txns - a.txns; });

            if (!pickable.length) {
                response.write(errorPage('No sales rep in this account has sales orders or invoices ' +
                    'since ' + invoiceFrom + '. Check that customers carry a Sales Rep on the customer record.'));
                return;
            }

            // --- access gate ---------------------------------------------
            var isRepWithBook = false, isFlaggedRep = false, selfName = '';
            pickable.forEach(function (r) { if (r.id === currentUserId) isRepWithBook = true; });
            reps.forEach(function (r) { if (r.id === currentUserId) { isFlaggedRep = true; selfName = r.name; } });

            if (!viewsAnyRep && !isRepWithBook && !isFlaggedRep) {
                log.audit({ title: 'Retention Dashboard access denied',
                            details: 'employee=' + currentUserId + ' role=' + viewerRoleId });
                response.write(messagePage('Access restricted',
                    'This dashboard shows sales revenue for an individual sales rep. Your login is not ' +
                    'set up as a sales rep, and your role is not on the approved viewer list, so there ' +
                    'is nothing here for you to see.<br><br>If you need access, ask a NetSuite ' +
                    'administrator to add your role internal ID (' + esc(viewerRoleId || 'unknown') + ') ' +
                    'to ALLOWED_VIEWER_ROLE_IDS in the dashboard script.', '#c0392b'));
                return;
            }

            // A genuine sales rep with no accounts yet - show an empty state
            // rather than handing them a colleague's book.
            if (!viewsAnyRep && isFlaggedRep && !isRepWithBook) {
                response.write(messagePage('No accounts assigned yet',
                    'Hi ' + esc(selfName) + ' - you are set up as a sales rep, but no customers are ' +
                    'currently assigned to you with sales orders or invoices since ' + invoiceFrom + '.' +
                    '<br><br>Once accounts are assigned on the customer record (Sales Rep field) and ' +
                    'orders start landing, this dashboard will populate automatically.', '#2980b9'));
                return;
            }

            var canSwitch = viewsAnyRep || (isRepWithBook && ALLOW_REP_SWITCH);

            // --- resolve which rep to show -------------------------------
            var requested = canSwitch ? context.request.parameters.rep : null;
            var repId = null, notice = '';

            if (requested) {
                pickable.forEach(function (r) { if (r.id === String(requested)) repId = r.id; });
                if (!repId) {
                    notice = 'Requested rep has no sales orders or invoices in this window, ' +
                             'so a rep with data is shown instead. Use the selector to choose another.';
                }
            }
            if (!repId) {
                pickable.forEach(function (r) { if (r.id === currentUserId) repId = r.id; });
            }
            if (!repId) {
                // Logged-in user carries no book: admin, IT, ops, or a brand
                // new hire. Show the biggest book rather than dead-ending.
                repId = pickable[0].id;
                if (!notice) {
                    notice = 'Your login' + (selfName ? ' (' + esc(selfName) + ')' : '') +
                             ' has no accounts assigned, so <b>' + esc(pickable[0].name) +
                             '</b> is shown by default.' +
                             (canSwitch ? ' Use the selector above to view a different rep.'
                                        : ' Ask an administrator for access to switch reps.');
                }
            }

            var viewingSelf = (repId === currentUserId);
            var repName = '';
            pickable.forEach(function (r) { if (r.id === repId) repName = r.name; });

            // --- pull ----------------------------------------------------
            var orderRows   = getOrders(repId, ordersFrom);
            var invoiceRows = getInvoices(repId, invoiceFrom, invoiceTo);
            var custRows    = getCustomers(repId, invoiceFrom);

            if (!orderRows.length && !invoiceRows.length) {
                // Should not happen now that the picker is data-filtered, but if
                // it does, fall back rather than dead-ending the user.
                log.audit({ title: 'Retention Dashboard', details: 'No rows for rep ' + repId + ' despite non-zero count' });
                response.write(errorPage('No sales orders or invoices were found for ' + esc(repName) +
                    '. Check that the customers are assigned to this rep on the customer record ' +
                    '(Sales Rep field), or go back and choose a different rep.'));
                return;
            }

            // --- model + render ------------------------------------------
            var model = buildModel(repName, TODAY, orderRows, invoiceRows, custRows);

            var scriptUrl = url.resolveScript({
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                returnExternalUrl: false
            });

            log.audit({
                title: 'Retention Dashboard rendered',
                details: 'rep=' + repName + ' (' + repId + ') admin=' + isAdmin +
                         ' allowedRole=' + isAllowedRole + ' role=' + viewerRoleId +
                         ' canSwitch=' + canSwitch + ' pickable=' + pickable.length +
                         ' selfView=' + viewingSelf +
                         ' customers=' + model.all.length + ' orders=' + orderRows.length +
                         ' invoices=' + invoiceRows.length + ' tz=' + tzInfo.tz +
                         ' today=' + iso(TODAY) + ' remainingUsage=' + runtime.getCurrentScript().getRemainingUsage()
            });

            response.write(buildHtml(model, repName, TODAY, tzInfo, pickable, repId, scriptUrl, {
                showPicker: canSwitch,
                notice: notice
            }));

        } catch (e) {
            log.error({ title: 'Retention Dashboard failed', details: (e.message || e) + ' | ' + (e.stack || '') });
            response.write(errorPage('The dashboard could not be built: ' + (e.message || e) +
                ' — the full error is in the script execution log.'));
        }
    }

    return { onRequest: onRequest };
});