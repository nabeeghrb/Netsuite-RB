/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * RoyalBag weekly L10 scorecard -- live from NetSuite, one page for everyone.
 *
 * Opens as the person viewing it (runtime.getCurrentUser()):
 *   - Sara (and anyone listed in custscript_rb_sc_directors) gets the Director's TEAM file:
 *     her team rows to enter in Success.co, a tab per pod, a tab per person, Dig into the data.
 *   - A pod lead (Fay, Mendy) gets own rows + "My pod" + a tab per pod member.
 *   - Every other rep gets their own rows only. Nobody else's names or numbers appear.
 * Every load pulls the records with SuiteQL and computes on the spot, so there is no
 * weekly refresh: the four-week window rolls forward by itself every Monday.
 *
 * Script parameters (all optional):
 *   custscript_rb_sc_admins        comma-separated employee ids who may switch view (?view=team|<First name>).
 *                                  Deliberately NOT role-based: with "Execute As Role" the reported
 *                                  role can be the elevated one, which would hand every rep the switch.
 *   custscript_rb_sc_directors     comma-separated employee ids who get the TEAM view (default: 7 = Sara Ziegler)
 *   custscript_rb_sc_cache_minutes cache a computed page for N minutes (default 10, 0 = off)
 *
 * URL parameters:  view=team|<First name> (admins) \u00b7 refresh=1 (skip the cache) \u00b7 diag=1 (admins, JSON)
 *
 * DEPLOY (this one file is everything -- calendar, engine and page are bundled inside it)
 *   1. File Cabinet > SuiteScripts: upload this file.
 *   2. Customization > Scripting > Scripts > New: pick the file, type Suitelet.
 *      Add the three optional parameters above (Free-Form Text, Free-Form Text, Integer).
 *   3. Deploy: Status Released. Execute As Role = Administrator (or any role that can see
 *      messages, cases, phone calls, customers, contacts, transactions and saved search
 *      customsearch_rep_customer_by_most_recent). Audience: the sales roles / employees.
 *      Who sees what is decided by the viewer's employee id, never by the role.
 *   4. Open the deployment URL. First load takes longest (all queries + retention); repeat
 *      loads inside the cache window are instant. ~650 governance units on a cold load.
 *
 * Roster, pods, targets, row notes and the operating calendar live in the bundled ENGINE
 * and CAL blocks below -- edit them there (search for "rosters" and "TARGETS").
 */
define(['N/query', 'N/search', 'N/runtime', 'N/cache', 'N/url', 'N/format', 'N/log'],
function (query, search, runtime, cache, url, format, log) {
    // ================================================================== bundled modules
    // Everything the page needs lives in this one file: the operating calendar, the
    // scorecard engine and the page renderer. No other script, file or HTML is loaded.
    var CAL = (function () {
    return {
"timezone": "America/New_York",
"week": {
"0": [
9.0,
17.0
],
"1": [
9.0,
17.0
],
"2": [
9.0,
17.0
],
"3": [
9.0,
17.0
],
"4": [
9.0,
13.0
]
},
"eve_close": 13.0,
"first": "2025-01-01",
"last": "2027-12-24",
"days": {
"2025-01-01": {
"kind": "closed",
"closes_at": null,
"names": [
"New Year's Day"
]
},
"2025-03-14": {
"kind": "closed",
"closes_at": null,
"names": [
"Purim"
]
},
"2025-04-12": {
"kind": "weekend",
"closes_at": 13.0,
"names": [
"Pesach eve"
]
},
"2025-04-13": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-14": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-15": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-16": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-17": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-18": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-19": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-04-20": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2025-05-26": {
"kind": "closed",
"closes_at": null,
"names": [
"Memorial Day"
]
},
"2025-06-01": {
"kind": "weekend",
"closes_at": 13.0,
"names": [
"Shavuos eve"
]
},
"2025-06-02": {
"kind": "closed",
"closes_at": null,
"names": [
"Shavuos"
]
},
"2025-06-03": {
"kind": "closed",
"closes_at": null,
"names": [
"Shavuos"
]
},
"2025-07-04": {
"kind": "closed",
"closes_at": null,
"names": [
"Independence Day"
]
},
"2025-08-03": {
"kind": "weekend",
"closes_at": null,
"names": [
"9 of Av"
]
},
"2025-09-01": {
"kind": "closed",
"closes_at": null,
"names": [
"Labor Day"
]
},
"2025-09-22": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Rosh Hashana eve"
]
},
"2025-09-23": {
"kind": "closed",
"closes_at": null,
"names": [
"Rosh Hashana"
]
},
"2025-09-24": {
"kind": "closed",
"closes_at": null,
"names": [
"Rosh Hashana"
]
},
"2025-10-01": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Yom Kippur eve"
]
},
"2025-10-02": {
"kind": "closed",
"closes_at": null,
"names": [
"Yom Kippur"
]
},
"2025-10-06": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Succos eve"
]
},
"2025-10-07": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-08": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-09": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-10": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-11": {
"kind": "weekend",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-12": {
"kind": "weekend",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-13": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2025-10-14": {
"kind": "closed",
"closes_at": null,
"names": [
"Shmini Atzeres"
]
},
"2025-10-15": {
"kind": "closed",
"closes_at": null,
"names": [
"Simchas Torah"
]
},
"2025-11-27": {
"kind": "closed",
"closes_at": null,
"names": [
"Thanksgiving"
]
},
"2025-12-25": {
"kind": "closed",
"closes_at": null,
"names": [
"Christmas"
]
},
"2026-01-01": {
"kind": "closed",
"closes_at": null,
"names": [
"New Year's Day"
]
},
"2026-03-03": {
"kind": "closed",
"closes_at": null,
"names": [
"Purim"
]
},
"2026-04-01": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Pesach eve"
]
},
"2026-04-02": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-03": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-04": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-05": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-06": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-07": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-08": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-04-09": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2026-05-21": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Shavuos eve"
]
},
"2026-05-22": {
"kind": "closed",
"closes_at": null,
"names": [
"Shavuos"
]
},
"2026-05-23": {
"kind": "weekend",
"closes_at": null,
"names": [
"Shavuos"
]
},
"2026-05-25": {
"kind": "closed",
"closes_at": null,
"names": [
"Memorial Day"
]
},
"2026-07-03": {
"kind": "closed",
"closes_at": null,
"names": [
"Independence Day"
]
},
"2026-07-23": {
"kind": "closed",
"closes_at": null,
"names": [
"9 of Av"
]
},
"2026-09-07": {
"kind": "closed",
"closes_at": null,
"names": [
"Labor Day"
]
},
"2026-09-11": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Rosh Hashana eve"
]
},
"2026-09-12": {
"kind": "weekend",
"closes_at": null,
"names": [
"Rosh Hashana"
]
},
"2026-09-13": {
"kind": "weekend",
"closes_at": null,
"names": [
"Rosh Hashana"
]
},
"2026-09-20": {
"kind": "weekend",
"closes_at": 13.0,
"names": [
"Yom Kippur eve"
]
},
"2026-09-21": {
"kind": "closed",
"closes_at": null,
"names": [
"Yom Kippur"
]
},
"2026-09-25": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Succos eve"
]
},
"2026-09-26": {
"kind": "weekend",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-09-27": {
"kind": "weekend",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-09-28": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-09-29": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-09-30": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-10-01": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-10-02": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2026-10-03": {
"kind": "weekend",
"closes_at": null,
"names": [
"Shmini Atzeres"
]
},
"2026-10-04": {
"kind": "weekend",
"closes_at": null,
"names": [
"Simchas Torah"
]
},
"2026-11-26": {
"kind": "closed",
"closes_at": null,
"names": [
"Thanksgiving"
]
},
"2026-12-25": {
"kind": "closed",
"closes_at": null,
"names": [
"Christmas"
]
},
"2027-01-01": {
"kind": "closed",
"closes_at": null,
"names": [
"New Year's Day"
]
},
"2027-03-23": {
"kind": "closed",
"closes_at": null,
"names": [
"Purim"
]
},
"2027-04-21": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Pesach eve"
]
},
"2027-04-22": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-23": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-24": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-25": {
"kind": "weekend",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-26": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-27": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-28": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-04-29": {
"kind": "closed",
"closes_at": null,
"names": [
"Pesach"
]
},
"2027-05-31": {
"kind": "closed",
"closes_at": null,
"names": [
"Memorial Day"
]
},
"2027-06-10": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Shavuos eve"
]
},
"2027-06-11": {
"kind": "closed",
"closes_at": null,
"names": [
"Shavuos"
]
},
"2027-06-12": {
"kind": "weekend",
"closes_at": null,
"names": [
"Shavuos"
]
},
"2027-07-05": {
"kind": "closed",
"closes_at": null,
"names": [
"Independence Day"
]
},
"2027-08-12": {
"kind": "closed",
"closes_at": null,
"names": [
"9 of Av"
]
},
"2027-09-06": {
"kind": "closed",
"closes_at": null,
"names": [
"Labor Day"
]
},
"2027-10-01": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Rosh Hashana eve"
]
},
"2027-10-02": {
"kind": "weekend",
"closes_at": null,
"names": [
"Rosh Hashana"
]
},
"2027-10-03": {
"kind": "weekend",
"closes_at": null,
"names": [
"Rosh Hashana"
]
},
"2027-10-10": {
"kind": "weekend",
"closes_at": 13.0,
"names": [
"Yom Kippur eve"
]
},
"2027-10-11": {
"kind": "closed",
"closes_at": null,
"names": [
"Yom Kippur"
]
},
"2027-10-15": {
"kind": "half",
"closes_at": 13.0,
"names": [
"Succos eve"
]
},
"2027-10-16": {
"kind": "weekend",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-17": {
"kind": "weekend",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-18": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-19": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-20": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-21": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-22": {
"kind": "closed",
"closes_at": null,
"names": [
"Succos"
]
},
"2027-10-23": {
"kind": "weekend",
"closes_at": null,
"names": [
"Shmini Atzeres"
]
},
"2027-10-24": {
"kind": "weekend",
"closes_at": null,
"names": [
"Simchas Torah"
]
},
"2027-11-25": {
"kind": "closed",
"closes_at": null,
"names": [
"Thanksgiving"
]
},
"2027-12-24": {
"kind": "closed",
"closes_at": null,
"names": [
"Christmas"
]
}
}
};
})();

    var ENGINE = (function (CAL) {

    // ------------------------------------------------------------ rosters
    // Every identity record per rep. Resolved against message.entity/author, not
    // employee \u2014 several reps send mail under a Contact or CustJob record.
    var IDS = {
        Fay: [749, 74925, 709177],
        Mendy: [8, 49875, 54892],
        Taylor: [496615, 938190],
        Gianna: [1006783],
        Sruly: [317501],
        Renee: [21, 54934, 55060, 43439],
        Riki: [20],
        Moshe: [653584, 723235, 666412]
    };
    var REP = {};
    Object.keys(IDS).forEach(function (r) { IDS[r].forEach(function (i) { REP[i] = r; }); });

    // Primary employee record per person. scorecard.py uses this narrower map
    // (not REP) for the call-AI and open-ticket rows; kept separate on purpose so
    // the numbers reproduce exactly.
    var RID = { 749: 'Fay', 8: 'Mendy', 20: 'Riki', 21: 'Renee', 496615: 'Taylor',
        317501: 'Sruly', 1006783: 'Gianna', 653584: 'Moshe', 729961: 'Ari' };
    var OWN = { 749: 'Fay', 8: 'Mendy', 20: 'Riki', 21: 'Renee', 496615: 'Taylor',
        317501: 'Sruly', 1006783: 'Gianna', 653584: 'Moshe' };
    // employee id of the person viewing the Suitelet -> whose scorecard it is
    var EMPLOYEE_TO_REP = { 749: 'Fay', 8: 'Mendy', 496615: 'Taylor', 1006783: 'Gianna',
        317501: 'Sruly', 21: 'Renee', 20: 'Riki', 653584: 'Moshe' };

    var FULL = { Fay: 'Fay Singer', Mendy: 'Mendy Eagle', Taylor: 'Taylor Kennedy',
        Gianna: 'Gianna Saviano', Sruly: 'Sruly Marsow', Renee: 'Renee Goldenberg',
        Riki: 'Riki Friedman', Moshe: 'Moshe Naiman', Sara: 'Sara Ziegler' };
    var PODS = {
        Evergreen: { lead: 'Fay', members: ['Fay', 'Taylor', 'Gianna'] },
        Mendy: { lead: 'Mendy', members: ['Mendy', 'Renee', 'Sruly'] }
    };
    var POD_OF = {};
    Object.keys(PODS).forEach(function (p) { PODS[p].members.forEach(function (m) { POD_OF[m] = p; }); });
    var REPS = ['Fay', 'Taylor', 'Gianna', 'Mendy', 'Renee', 'Sruly'];
    var OTHER = ['Moshe', 'Riki'];          // measured, not pod-scored
    var EVERYONE = ['Fay', 'Mendy', 'Taylor', 'Gianna', 'Sruly', 'Renee', 'Riki', 'Moshe'];

    var AUTOMATION = { 351732: 1, 112863: 1, '-4': 1, '-5': 1 };   // RB Customer Support, Billing, system
    // Colleagues who legitimately answer customers but are not on the scorecard.
    // Their replies count towards COVERAGE, never towards a rep's SPEED.
    var COLLEAGUE = {
        903165: 'Veronica Marpuri (procurement)',
        134082: 'Rachel Gestetner (procurement)',
        6: 'Gitty Fasten (procurement)',
        829265: 'Samuel Rephen (bookkeeping)',
        448221: 'Jessica Magill'
    };
    var CATCHALL = { 28480: 1, 50200: 1, 74925: 1 };
    // How the catch-all buckets are labelled everywhere a customer name appears.
    var NAME_OVERRIDE = { 28480: 'C999 Anonymous (catch-all)', 50200: 'Royal Bag Inc (own record)' };

    // Sara, 5 Oct: no individual Sales $ row, and no commitments row, for these three.
    var NO_SALES = { Taylor: 1, Gianna: 1, Sruly: 1 };
    var NO_COMMITMENTS = { Taylor: 1, Gianna: 1, Sruly: 1 };
    var TICKET_ROW = ['Taylor', 'Gianna', 'Sruly'];
    var TICKET_HOLDERS = ['Moshe', 'Sruly', 'Taylor', 'Gianna'];
    var NO_RETENTION = { Moshe: 1 };
    var TARGETS = { Fay: 64583, Mendy: 58333, Riki: 16607, Renee: 29000 };
    var STALE = 10;
    var HVT = { Evergreen: 6000, Mendy: 11000 };           // business days untouched before a ticket counts as stalled
    // Row notes that describe the population rather than the number. Edit here.
    var NOTE = { Renee: 'on paid family leave for this window \u2014 rows are blank, not zero' };
    var RETENTION_EXTRA = {
        Gianna: ' Gianna\u2019s book is empty \u2014 she joined in August, so 0.0 is an empty state, not a result.'
    };
    var ACT = { 1: 'Sales follow-up', 2: 'Credit needed', 3: 'Replacement needed', 4: 'Operations review' };
    var STN = { 1: 'New', 3: 'Escalated', 4: 'Re-Opened', 6: 'Awaiting customer',
        7: 'Customer responded', 9: 'Reviewing' };

    // ------------------------------------------------------------ time
    // Every naive datetime is held as milliseconds from Date.UTC(...) of its wall
    // clock fields. Nothing here ever consults the server's time zone.
    var MIN = 60000, HOUR = 3600000, DAY = 86400000;
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function P(s) {                         // 'YYYY-MM-DD HH:MM:SS' -> ms
        if (!s) return null;
        var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s));
        if (!m) return null;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function iso(ms) {
        var d = new Date(ms);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    function fmtMin(ms) {
        var d = new Date(ms);
        return iso(ms) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    }
    function floorDay(ms) { return Math.floor(ms / DAY) * DAY; }
    function weekday(ms) { return (new Date(ms).getUTCDay() + 6) % 7; }   // Mon=0, like Python

    // US Eastern daylight time: 2nd Sunday of March 07:00 UTC -> 1st Sunday of Nov 06:00 UTC.
    function nthSunday(y, month0, n) {
        var first = new Date(Date.UTC(y, month0, 1)).getUTCDay();
        return Date.UTC(y, month0, 1 + ((7 - first) % 7) + 7 * (n - 1));
    }
    function isEDT(utcMs) {
        var y = new Date(utcMs).getUTCFullYear();
        return utcMs >= nthSunday(y, 2, 2) + 7 * HOUR && utcMs < nthSunday(y, 10, 1) + 6 * HOUR;
    }
    function utcToEtDst(ms) { return ms - (isEDT(ms) ? 4 : 5) * HOUR; }
    function utcToEtFixed(ms) { return ms - 4 * HOUR; }      // the Python's rule; parity tests only

    // Python's round(): half-to-even on the exact binary value.
    function pyRound(x, nd) {
        if (x == null || !isFinite(x)) return x;
        nd = nd || 0;
        var neg = x < 0, s = Math.abs(x).toFixed(30), dot = s.indexOf('.');
        var ip = s.slice(0, dot), fp = s.slice(dot + 1);
        var keep = ip + fp.slice(0, nd), rest = fp.slice(nd);
        var up;
        if (rest[0] > '5') up = true;
        else if (rest[0] < '5') up = false;
        else if (/[1-9]/.test(rest.slice(1))) up = true;
        else up = (+keep[keep.length - 1]) % 2 === 1;
        var digits = keep.split('').map(Number);
        if (up) {
            var i = digits.length - 1;
            while (i >= 0) { if (digits[i] === 9) { digits[i] = 0; i--; } else { digits[i]++; break; } }
            if (i < 0) digits.unshift(1);
        }
        var str = digits.join('');
        var v = nd ? +(str.slice(0, str.length - nd) + '.' + str.slice(str.length - nd)) : +str;
        return neg ? -v : v;
    }

    // ------------------------------------------------------- business clock
    // Mon-Thu 09:00-17:00, Fri 09:00-13:00 ET, minus every closure in the company
    // calendar (Jewish holidays and their eves, six US holidays).
    var HOURS = { 0: [9, 17], 1: [9, 17], 2: [9, 17], 3: [9, 17], 4: [9, 13] };
    var CLOSURES = {}, HALFDAYS = {};
    Object.keys(CAL.days).forEach(function (k) {
        var v = CAL.days[k];
        if (v.kind === 'closed') CLOSURES[k] = 1;
        if (v.kind === 'half' && v.closes_at) HALFDAYS[k] = v.closes_at;
    });

    var WIN_CACHE = {};
    function win(dayMs) {
        if (dayMs in WIN_CACHE) return WIN_CACHE[dayMs];
        return (WIN_CACHE[dayMs] = win0(dayMs));
    }
    function win0(dayMs) {
        var k = iso(dayMs), wd = weekday(dayMs);
        if (CLOSURES[k] || !HOURS[wd]) return null;
        var a = HOURS[wd][0], b = HOURS[wd][1];
        if (HALFDAYS[k] != null) b = Math.min(b, HALFDAYS[k]);
        if (b <= a) return null;
        return [dayMs + Math.trunc(a) * HOUR, dayMs + Math.trunc(b) * HOUR];
    }

    /** Business minutes between two ET datetimes. */
    function bmin(t0, t1) {
        if (t1 <= t0) return 0;
        var tot = 0, d = floorDay(t0), end = floorDay(t1);
        while (d <= end) {
            var w = win(d);
            if (w) {
                var s = Math.max(w[0], t0), e = Math.min(w[1], t1);
                if (e > s) tot += ((e - s) / 1000) / 60;
            }
            d += DAY;
        }
        return tot;
    }

    /** An event outside business hours starts the clock at the next open. */
    function clockStart(t) {
        var d = floorDay(t);
        for (var i = 0; i < 14; i++) {
            var w = win(d);
            if (w) {
                if (t <= w[0]) return w[0];
                if (t < w[1]) return t;
            }
            d += DAY;
        }
        return t;
    }

    // ------------------------------------------------------- the window
    /** Four complete Mon-Sun weeks ending the Sunday before today, oldest first. */
    function weeksEnding(todayIso) {
        var t = P(todayIso), monday = t - weekday(t) * DAY, out = [];
        for (var i = 0; i < 4; i++) {
            var a = monday - 7 * (4 - i) * DAY;
            out.push([iso(a), iso(a + 6 * DAY)]);
        }
        return out;
    }
    function weekLabel(w) {
        var a = new Date(P(w[0])), b = new Date(P(w[1]));
        if (a.getUTCMonth() === b.getUTCMonth())
            return a.getUTCDate() + '\u2013' + b.getUTCDate() + ' ' + MON[b.getUTCMonth()];
        return a.getUTCDate() + ' ' + MON[a.getUTCMonth()] + '\u2013' + b.getUTCDate() + ' ' + MON[b.getUTCMonth()];
    }
    /** A week with no business minutes at all is a closure week: blank, never zero. */
    function closedWeeks(weeks) {
        var idx = [], why = {};
        weeks.forEach(function (w, i) {
            var a = P(w[0]);
            if (bmin(a, a + 7 * DAY) === 0) {
                idx.push(i);
                var names = [];
                for (var d = a; d < a + 7 * DAY; d += DAY) {
                    var c = CAL.days[iso(d)];
                    if (c && c.kind === 'closed') (c.names || []).forEach(function (n) {
                        if (names.indexOf(n) < 0) names.push(n);
                    });
                }
                why[i] = names.join(', ');
            }
        });
        return { idx: idx, why: why };
    }
    function dayMonth(isoStr) {
        var d = new Date(P(isoStr));
        return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    }

    // --------------------------------------------- stage-1 exclusion rules
    var MACHINE = [
        [/^authorization expiration/, 'Payment gateway notice'],
        [/^ups:.*one-time passcode/, 'UPS passcode'],
        [/ups needs info for customs/, 'UPS customs bot'],
        [/^a paypal request has been approved/, 'PayPal bot'],
        [/^bill payments have been scheduled/, 'AP bot'],
        [/has sent you a package/, 'File-transfer notice'],
        [/^new message in general mb/, 'Voicemail notice'],
        [/^new fax message/, 'Fax notice'],
        [/(missed call & voicemail|voice message from|ringcentral)/, 'Voicemail notice'],
        [/^(customer support|order inquiry|sample request)\s*-\s*\d+$/, 'Web-form auto-ticket'],
        [/^(automatic reply|out of office|automatische|automatic response)/, 'Out-of-office auto-reply'],
        [/(undeliverable|delivery has failed|mail delivery failed)/, 'Bounce']
    ];
    var NOREPLY_LIST = /(new supply manager order request|new service request.*location id|total w)/;

    /** Returns [inDenominator, reason]. */
    function classify(subj) {
        var s = String(subj || '').toLowerCase().trim();
        for (var i = 0; i < MACHINE.length; i++) if (MACHINE[i][0].test(s)) return [false, MACHINE[i][1]];
        if (NOREPLY_LIST.test(s)) return [false, 'Total Wine no-reply list'];
        if (!s) return [false, 'Empty subject'];
        return [true, 'Customer email'];
    }
    function isOOO(subj) { return classify(subj)[1] === 'Out-of-office auto-reply'; }

    // Reply prefixes in every language seen in this mailbox, plus Exchange's tags.
    var PREFIX = /^\s*(re|fw|fwd|aw|tr|res|rif|sv|vs|vb|antw|\u56de\u590d|\u7b54\u590d|\u8f49\u5bc4|\u8f6c\u53d1|\u56de\u8986)\s*[:\uff1a]\s*/i;
    var TAG = /^\s*[\[\{\(]\s*(external|extern|ext|caution|suspected spam)\s*[\]\}\)]\s*/i;
    // A quote / order / invoice reference is a far stronger thread key than a subject.
    var REF = /\b(QT\d{3,}|SO\d{3,}|INV\d{6,}|OPP\d{3,})\b/i;

    function cut(s, n) { var a = Array.from(String(s == null ? '' : s)); return a.length > n ? a.slice(0, n).join('') : a.join(''); }
    function norm(s) {
        s = String(s || '');
        for (var i = 0; i < 10; i++) {
            var s2 = s.replace(PREFIX, '').replace(TAG, '');
            if (s2 === s) break;
            s = s2;
        }
        return cut(s.toLowerCase().replace(/\s+/g, ' ').trim(), 55);
    }
    function threadkey(m) {
        var r = REF.exec(m.subject || '');
        return m.entity + '\u0001' + (r ? 'ref:' + r[1].toUpperCase() : norm(m.subject));
    }

    var EMAIL_RE = /[A-Za-z0-9_.+-]+@[A-Za-z0-9_-]+\.[A-Za-z0-9_.]{2,}/g;
    /** Subjects carry email addresses \u2014 customers' and our own shared mailboxes. Mask them. */
    function safe(t) { return String(t || '').replace(EMAIL_RE, '[address]'); }

    function money0(v) {                     // Python f"${v:,.0f}"
        var neg = v < 0 || Object.is(v, -0), r = pyRound(Math.abs(v || 0));
        return '$' + (neg ? '-' : '') + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ---------------------------------------------------------- helpers
    function num(v) { return v == null || v === '' ? null : (typeof v === 'number' ? v : Number(v)); }
    function groupBy(list, keyf) {
        var m = new Map();
        list.forEach(function (x) { var k = keyf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
        return m;
    }
    function sortBy(list, keyf, desc) {     // stable, like Python sorted(); desc keeps tie order
        return list.slice().sort(function (a, b) {
            var x = keyf(a), y = keyf(b);
            if (x < y) return desc ? 1 : -1;
            if (x > y) return desc ? -1 : 1;
            return 0;
        });
    }
    /** First index in a list sorted by ._et whose ._et >= t. */
    function lowerBound(list, t) {
        var lo = 0, hi = list.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid]._et < t) lo = mid + 1; else hi = mid; }
        return lo;
    }
    /** First index whose ._et > t. */
    function upperBound(list, t) {
        var lo = 0, hi = list.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid]._et <= t) lo = mid + 1; else hi = mid; }
        return lo;
    }

    function pct(vals, thr) {
        var v = vals.filter(function (x) { return x != null; });
        if (!v.length) return null;
        return pyRound(v.filter(function (x) { return x <= thr; }).length / v.length * 100);
    }

    // =====================================================================
    //  compute(data, opts) -> observations shared by every person's page
    // =====================================================================
    function compute(data, opts) {
        var today = opts.today;                               // 'YYYY-MM-DD' (ET)
        var WEEKS = opts.weeks || weeksEnding(today);
        var toEt = opts.fixedUtcOffset ? utcToEtFixed : utcToEtDst;
        // The last moment the data can see. A response window that has not elapsed
        // before this cannot be scored as a miss \u2014 it has not had its time yet.
        var CUTOFF = P(opts.dataCutoff);
        var NOW = P(opts.now);                                 // open-backlog clock
        var AGE_FROM = P(opts.quoteAgeFrom || today);

        function weekof(ms) {
            var k = iso(ms);
            for (var i = 0; i < WEEKS.length; i++) if (WEEKS[i][0] <= k && k <= WEEKS[i][1]) return i;
            return null;
        }
        function weekofD(s) {
            for (var i = 0; i < WEEKS.length; i++) if (WEEKS[i][0] <= s && s <= WEEKS[i][1]) return i;
            return null;
        }

        // ---- normalise ids (SuiteQL may hand them back as strings) ----
        var msgs = (data.messages || []).map(function (m) {
            return { id: num(m.id), author: num(m.author), entity: num(m.entity), activity: num(m.activity),
                transaction: num(m.transaction), incoming: m.incoming, subject: m.subject, msgdate: m.msgdate };
        });
        var cases = (data.cases || []).map(function (c) {
            return { id: num(c.id), casenumber: c.casenumber, title: c.title, company: num(c.company),
                assigned: num(c.assigned), status: num(c.status), category: num(c.category),
                created: c.created, closed: c.closed };
        });
        var calls = (data.calls || []).map(function (c) {
            return { id: num(c.id), owner: num(c.owner), assigned: num(c.assigned), company: num(c.company),
                title: c.title, created: c.created, issue_cat: num(c.issue_cat), action: num(c.action),
                aiproc: c.aiproc, sent_end: num(c.sent_end) };
        });
        var custs = (data.customers || []).map(function (c) {
            return { id: num(c.id), salesrep: num(c.salesrep), entitystatus: num(c.entitystatus), created: c.created,
                firstorder: c.firstorder || null, hvtflag: c.hvtflag };
        });
        var quotes = (data.quotes || []).map(function (q) {
            return { id: num(q.id), tranid: q.tranid, entity: num(q.entity), employee: num(q.employee),
                status: q.status, foreigntotal: num(q.foreigntotal), created: q.created };
        });
        var opps = (data.opps || []).map(function (o) {
            return { id: num(o.id), entity: num(o.entity), employee: num(o.employee), created: o.created };
        });
        var orders = (data.orders || []).map(function (o) {
            return { id: num(o.id), tranid: o.tranid, entity: num(o.entity), employee: num(o.employee),
                status: o.status, foreigntotal: num(o.foreigntotal), trandate: o.trandate, created: o.created };
        });
        var open = (data.openCases || []).map(function (c) {
            return { id: num(c.id), company: num(c.company), assigned: num(c.assigned), status: num(c.status),
                title: c.title, created: c.created, touched: c.touched, out_n: num(c.out_n),
                in_n: num(c.in_n), last_out_utc: c.last_out_utc, last_in_utc: c.last_in_utc };
        });

        var spamCases = {};
        cases.forEach(function (c) { if (c.category === 8 || c.status === 10) spamCases[c.id] = 1; });

        // ============================================ 1. EMAIL RESPONSE
        // Thread engine: each inbound customer email -> next outbound from a rep,
        // wherever it was filed. Consecutive inbounds collapse into one clock.
        msgs.forEach(function (m) { m._et = toEt(P(m.msgdate)); });
        msgs = sortBy(msgs, function (m) { return m._et; });

        var threads = groupBy(msgs.filter(function (m) { return m.entity; }), threadkey);
        var em = [];
        threads.forEach(function (ms, key) {
            var ent = ms[0].entity, i = 0;
            while (i < ms.length) {
                var m = ms[i];
                if (m.incoming !== 'T') { i++; continue; }
                var cl = classify(m.subject), keep = cl[0];
                if (m.activity != null && spamCases[m.activity]) keep = false;   // team marked it spam
                var j = i;
                while (j + 1 < ms.length && ms[j + 1].incoming === 'T') j++;
                var reply = null, off = null;
                for (var k = j + 1; k < ms.length; k++) {
                    var n = ms[k];
                    if (n.incoming === 'T') break;
                    if (AUTOMATION[n.author]) continue;
                    if (isOOO(n.subject)) continue;            // an auto-reply is not a reply
                    if (REP[n.author]) { reply = n; break; }
                    off = off || n;
                }
                if (keep) {
                    var start = clockStart(m._et);
                    em.push({
                        kind: 'email', cust: ent, subject: m.subject, in_at: fmtMin(m._et),
                        week: weekof(m._et), rep: reply ? REP[reply.author] : null,
                        mins: reply ? bmin(start, reply._et) : null,
                        filed: reply ? (reply.activity ? 'case' : reply.transaction ? 'order/quote' : 'customer record') : null,
                        off_roster: !!(off && !reply), msgid: m.id, _t: m._et,
                        'case': reply ? reply.activity : (m.activity || null),
                        tran: reply ? reply.transaction : (m.transaction || null)
                    });
                }
                i = j + 1;
            }
        });

        // Second pass \u2014 coverage. A reply under a new subject breaks the thread key
        // while the customer plainly heard back; re-check against that customer's
        // whole outbound stream within two business days, and LABEL it.
        var outByCust = groupBy(msgs.filter(function (m) {
            return m.incoming === 'F' && m.entity && !AUTOMATION[m.author];
        }), function (m) { return m.entity; });

        em.forEach(function (o) {
            if (o.mins != null) { o.outcome = 'answered'; return; }
            var t = o._t, cs = clockStart(t);
            // Same result as filtering the whole stream: it is sorted by time and business
            // minutes never shrink as time moves on, so stop at the first one past 960.
            var stream = outByCust.get(o.cust) || [], later = [];
            for (var x = lowerBound(stream, t); x < stream.length; x++) {
                if (bmin(cs, stream[x]._et) > 960) break;
                later.push(stream[x]);
            }
            var rr = null;
            for (var q = 0; q < later.length; q++) if (REP[later[q].author]) { rr = later[q]; break; }
            if (rr) {
                o.outcome = 'answered_other_thread'; o.rep_other = REP[rr.author];
                o.other_mins = pyRound(bmin(cs, rr._et));
            } else if (later.length) {
                var first = later[0];
                if (COLLEAGUE[first.author]) {
                    o.outcome = 'answered_colleague'; o.by = COLLEAGUE[first.author];
                    o.colleague_mins = pyRound(bmin(cs, first._et));
                } else o.outcome = 'answered_off_roster';
                o.off_id = first.author;
            } else o.outcome = 'no_reply';
        });
        // Who is holding the conversation: the last roster rep to write to that
        // customer BEFORE the inbound arrived.
        var repOutByCust = new Map();
        outByCust.forEach(function (v, k) { repOutByCust.set(k, v.filter(function (m) { return REP[m.author]; })); });
        em.forEach(function (o) {
            var prior = repOutByCust.get(o.cust) || [], n = upperBound(prior, o._t);
            o.held_by = n ? REP[prior[n - 1].author] : null;
        });

        // ============================================ 2. TICKETS
        var byCase = groupBy(msgs.filter(function (m) { return m.activity; }), function (m) { return m.activity; });
        var tk = [];
        cases.forEach(function (c) {
            if (c.category === 8 || c.status === 10) return;              // spam
            var created = P(c.created);                                   // supportcase is ET
            var w = weekof(created);
            if (w == null) return;
            var cl = classify(c.title);
            var repOut = (byCase.get(c.id) || []).filter(function (m) {
                return m.incoming === 'F' && REP[m.author] && !isOOO(m.subject);
            });
            var first = repOut.length ? repOut[0]._et : null;
            var start = clockStart(created);
            tk.push({
                kind: 'ticket', id: c.id, no: c.casenumber, title: c.title, cust: c.company, week: w,
                in_denom: cl[0], why_out: cl[0] ? null : cl[1], assigned: REP[c.assigned] || null,
                rep: repOut.length ? REP[repOut[0].author] : null,
                reply_mins: first != null ? bmin(start, first) : null,
                created: cut(c.created, 16),
                resolve_mins: c.closed ? bmin(start, P(c.closed)) : null,
                closed: !!c.closed
            });
        });

        // ============================================ 3. LEADS
        // CONTACT = a logged call or an outbound email from a rep. Nothing else.
        // Voicemails ARE contact here (the lead heard from us) but never sentiment.
        var VOICEMAIL = /voicemail|voice mail|no conversation|no answer|left (a )?message|lvm/i;
        var callTitle = {};
        calls.forEach(function (c) { callTitle[c.id] = c.title || ''; });
        var touch = new Map();
        function push(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); }
        calls.forEach(function (c) {
            if (c.company && REP[c.owner]) push(touch, c.company, ['call', P(c.created), c.id, REP[c.owner]]);
        });
        msgs.forEach(function (m) {
            if (m.incoming === 'F' && m.entity && REP[m.author]) push(touch, m.entity, ['email', m._et, m.id, REP[m.author]]);
        });
        // WORK is not contact. Opps created inside 15 minutes are the web form's
        // round-robin assignment, not a person doing something.
        var work = new Map();
        quotes.forEach(function (q) { if (q.entity && REP[q.employee]) push(work, q.entity, ['quote', P(q.created), q.id, REP[q.employee]]); });
        opps.forEach(function (o) { if (o.entity && REP[o.employee]) push(work, o.entity, ['opportunity', P(o.created), o.id, REP[o.employee]]); });
        work.forEach(function (v, k) { work.set(k, sortBy(v, function (x) { return x[1]; })); });
        touch.forEach(function (v, k) { touch.set(k, sortBy(v, function (x) { return x[1]; })); });
        var qByCust = groupBy(quotes.filter(function (q) { return q.entity; }), function (q) { return q.entity; });

        var ld = [];
        var GRACE = 90 * MIN, AUTO_GAP = 15 * MIN;
        custs.forEach(function (c) {
            var cr = P(c.created), w = weekof(cr);
            if (c.entitystatus === 22) return;                              // 22 = Spam
            // Leads outside the four weeks still count for the 30/90-day windows.
            var owner = REP[c.salesrep] || null, start = clockStart(cr);
            var ts = (touch.get(c.id) || []).filter(function (t) { return t[1] >= cr - GRACE; });
            var first = ts.length ? ts[0] : null;
            var ws = (work.get(c.id) || []).filter(function (t) { return t[1] >= cr + AUTO_GAP; });
            var fw = ws.length ? ws[0] : null;
            var qs = sortBy((qByCust.get(c.id) || []).filter(function (q) { return P(q.created) >= cr; }),
                function (q) { return q.created; });
            var elapsed = bmin(start, CUTOFF);
            ld.push({
                kind: 'lead', cust: c.id, week: w, owner: owner,
                web: owner == null,           // rep-less web records are not leads (win rate)
                created: cut(c.created, 16), status: c.entitystatus,
                resp_mins: first ? bmin(start, first[1]) : null,
                resp_by: first ? first[3] : null, resp_type: first ? first[0] : null,
                resp_voicemail: !!(first && first[0] === 'call' && VOICEMAIL.test(callTitle[first[2]] || '')),
                resp_id: first ? first[2] : null, resp_at: first ? fmtMin(first[1]) : null,
                work_mins: fw ? bmin(start, fw[1]) : null, work_type: fw ? fw[0] : null,
                work_id: fw ? fw[2] : null, work_by: fw ? fw[3] : null,
                elapsed: pyRound(elapsed), scorable_1bd: elapsed >= 480, scorable_2bd: elapsed >= 960,
                quote_mins: qs.length ? bmin(start, P(qs[0].created)) : null,
                quote_id: qs.length ? qs[0].id : null, quote_no: qs.length ? qs[0].tranid : null
            });
        });

        // ============================================ 4. QUOTES
        // Sent = the outgoing rep email attached to the estimate. Follow-up = any later one.
        var byTran = groupBy(msgs.filter(function (m) {
            return m.transaction && m.incoming === 'F' && REP[m.author];
        }), function (m) { return m.transaction; });
        var qt = quotes.map(function (q) {
            var cr = P(q.created), sends = byTran.get(q.id) || [], sent = sends.length ? sends[0]._et : null;
            return {
                kind: 'quote', id: q.id, no: q.tranid, cust: q.entity, week: weekof(cr),
                rep: REP[q.employee] || null, status: q.status, value: q.foreigntotal || 0,
                created: cut(q.created, 16), send_mins: sent != null ? bmin(clockStart(cr), sent) : null,
                sent: sent != null, followups: Math.max(0, sends.length - 1),
                age_days: Math.round((AGE_FROM - floorDay(cr)) / DAY)
            };
        });

        // ============================================ 5. SALES $
        // The customsearch4450/4451 filter, reproduced to the cent: no Pending
        // Approval (A), Cancelled (C), Closed (H) or Void (X); no blanket SO; rep
        // required; dated by TRANDATE. Status E IS counted.
        var DEAD = { A: 1, C: 1, H: 1, X: 1 };
        var rev = {}, od = [];
        orders.forEach(function (o) {
            if (DEAD[o.status]) return;
            var w = weekofD(o.trandate);
            if (w == null) return;
            var r = REP[o.employee] || null, v = o.foreigntotal || 0;
            if (r) { rev[r] = rev[r] || {}; rev[r][w] = (rev[r][w] || 0) + v; }
            od.push({ kind: 'order', id: o.id, no: o.tranid, cust: o.entity, week: w, rep: r, value: v,
                created: cut(o.created, 16), trandate: o.trandate, status: o.status });
        });

        // A new customer is a record whose FIRST EVER order (customer.firstorderdate)
        // falls in the window. Attributed the SAME way as the lead denominator:
        // customer.salesrep first, then the rep on the first order.
        var firstOrder = {};
        sortBy(od, function (o) { return o.trandate; }).forEach(function (o) {
            if (!(o.cust in firstOrder)) firstOrder[o.cust] = o;
        });
        var nc = [];
        custs.forEach(function (c) {
            if (!c.firstorder) return;
            var w = weekofD(String(c.firstorder).slice(0, 10));
            if (w == null) return;
            var fo = firstOrder[c.id] || null;
            var web = REP[c.salesrep] == null;
            var rep = REP[c.salesrep] || (fo ? fo.rep : null);
            var pod = rep ? (POD_OF[rep] || null) : null;
            var val = fo ? fo.value : 0;
            nc.push({ kind: 'newcust', cust: c.id, week: w, rep: rep, pod: pod, first_order: val, web: web,
                order_no: fo ? fo.no : null, order_id: fo ? fo.id : null, firstorder: String(c.firstorder).slice(0, 10),
                flagged: c.hvtflag === 'T',
                // HVT field is unpopulated in NetSuite, so this is DERIVED.
                hvt: !!(pod && val * 12 >= HVT[pod]), annualised: val * 12 });
        });

        // ============================================ 6. CALLS
        var cl6 = [];
        calls.forEach(function (c) {
            var w = weekof(P(c.created));
            if (w == null) return;
            if (String(c.title || '').trim().toLowerCase() === 'no conversation') return;  // never scored
            var s = c.sent_end;
            cl6.push({ kind: 'call', id: c.id, week: w, rep: REP[c.owner] || REP[c.assigned] || null,
                cust: c.company, sent: s, positive: s === 1, negative: s === -1, scored: s != null,
                issue: c.issue_cat, title: cut(c.title || '', 60) });
        });
        // the AI-coverage and commitments rows read the same calls on the primary-id map
        var rich = calls.map(function (c) {
            var k = iso(P(c.created)), wk = null;
            for (var i = 0; i < WEEKS.length; i++) if (WEEKS[i][0] <= k && k <= WEEKS[i][1]) { wk = i; break; }
            return { id: c.id, created: c.created, title: c.title, action: c.action, aiproc: c.aiproc,
                _rep: RID[c.owner] || RID[c.assigned] || null, _week: wk };
        });
        var callWhen = {};
        calls.forEach(function (c) { callWhen[c.id] = cut(c.created, 16); });

        // ============================================ open backlog
        // Idle = nothing has happened to the record; unaffected by WHERE a reply was filed.
        open.forEach(function (r) {
            r._who = OWN[r.assigned] || null;
            r._label = r._who || (r.assigned == null ? 'nobody' : 'off roster');
            r._idle = pyRound(bmin(P(r.touched), NOW) / 480, 1);
            r._age = pyRound(bmin(P(r.created), NOW) / 480, 1);
            var o = r.last_out_utc ? toEt(P(r.last_out_utc)) : null;
            var i = r.last_in_utc ? toEt(P(r.last_in_utc)) : null;
            r._ball = !(r.out_n || 0) ? 'no reply on the ticket'
                : (i != null && o != null && i > o) ? 'customer came back'
                    : r.status === 6 ? 'waiting on the customer' : 'with you';
            // scorecard.py words the same four states for the team view
            r._ballT = !(r.out_n || 0) ? 'never replied to on the ticket'
                : (i != null && o != null && i > o) ? 'customer came back'
                    : r.status === 6 ? 'waiting on the customer' : 'with us';
        });

        em.forEach(function (o) { delete o._t; });
        function outc(k) { return em.filter(function (e) { return e.outcome === k; }); }

        // ---- order accuracy inputs: issue-tagged tickets + every order raised ----
        var tagged = (data.tagCases || data.cases || []).map(function (c) {
            return { id: num(c.id), casenumber: c.casenumber, title: c.title, issue: num(c.issue), sub: num(c.sub),
                assigned: num(c.assigned), status: num(c.status), category: num(c.category), created: c.created };
        }).filter(function (x) { return x.issue && x.category !== 8 && x.status !== 10; });
        var ordersAll = (data.ordersAll || []).map(function (o) {
            return { id: num(o.id), tranid: o.tranid, status: o.status, created: o.created };
        }).filter(function (o) { return o.status !== 'X'; });
        var catchall = (data.catchall || []).map(function (x) {
            return { id: num(x.id), title: x.title, dom: x.dom || '', status: num(x.status), category: num(x.category),
                created: x.created };
        }).filter(function (x) { return !(x.category === 8 || x.status === 10); });

        return {
            weeks: WEEKS, email: em, ticket: tk, lead: ld, quote: qt, order: od, call: cl6,
            rich: rich, callWhen: callWhen, open: open, revenue: rev, newcust: nc,
            unanswered: outc('no_reply'), thread_gap: outc('answered_other_thread'),
            offroster: outc('answered_off_roster'), colleague: outc('answered_colleague'),
            untraceable: tk.filter(function (t) { return t.in_denom && t.rep == null && CATCHALL[t.cust]; }),
            real_miss: tk.filter(function (t) { return t.in_denom && t.rep == null && !CATCHALL[t.cust]; }),
            tagged: tagged, ordersAll: ordersAll, catchall: catchall, domCust: data.domCust || {}
        };
    }

    // =====================================================================
    //  rows \u2014 the individual-level scorecard rows (scorecard.py order)
    // =====================================================================
    function DAYF(f) { return function (x) { return cut(x[f] || '', 10); }; }
    function Opct(items, datef, okf) { return items.map(function (x) { return [datef(x), okf(x) ? 1 : 0, 1]; }); }
    function Ocount(items, datef) { return items.map(function (x) { return [datef(x), 1, 0]; }); }
    function Osum(items, datef, amtf) { return items.map(function (x) { return [datef(x), amtf(x), 0]; }); }
    function series(fn) { return [0, 1, 2, 3].map(fn); }

    function rowsFor(r, C, retention, closed) {
        var rows = [];
        var level = REPS.indexOf(r) >= 0 ? 'individual' : (OTHER.indexOf(r) >= 0 ? 'measured' : null);
        if (!level) return rows;
        function add(mid, name, target, unit, weekly, o) {
            o = o || {};
            rows.push({ mid: mid, name: name, target: target, unit: unit, owner: r, level: level,
                weekly: weekly, invert: !!o.invert, detail: o.detail || '', note: o.note || '',
                drill: o.drill || null, obs: o.obs !== undefined ? o.obs : null, mode: o.mode || null });
        }
        var em = C.email, tk = C.ticket, ld = C.lead, cl = C.call, rich = C.rich;

        // #1 Email response within 2 business hours
        add('#1', 'Emails responded to within 2 hours', 100, '%', series(function (w) {
            return pct(em.filter(function (x) { return x.rep === r && x.week === w; }).map(function (x) { return x.mins; }), 120);
        }), {
            obs: Opct(em.filter(function (x) { return x.rep === r && x.mins != null; }), DAYF('in_at'),
                function (x) { return x.mins <= 120; }), mode: 'pct',
            detail: 'Every inbound customer email, threaded by reference number across the ticket, '
                + 'the quote and the order. Machine mail and the Total Wine no-reply list are out '
                + 'of the denominator. An out-of-office auto-reply is not a reply.',
            note: NOTE[r] || ''
        });

        // #2 Ticket first reply within 2 hours \u2014 support reps only
        if (TICKET_ROW.indexOf(r) >= 0) {
            var mine2 = tk.filter(function (x) { return x.in_denom && x.assigned === r; });
            add('#2', '% of tickets first reply within 2 hours', 100, '%', series(function (w) {
                return pct(mine2.filter(function (x) { return x.week === w; }).map(function (x) { return x.reply_mins; }), 120);
            }), {
                obs: Opct(mine2.filter(function (x) { return x.reply_mins != null; }), DAYF('created'),
                    function (x) { return x.reply_mins <= 120; }), mode: 'pct',
                detail: 'Tickets assigned to the rep, spam and machine mail excluded, measured from '
                    + 'ticket creation to the first reply logged on that ticket.'
            });
        }

        // #5 Lead to first response within 1 business day
        if (REPS.indexOf(r) >= 0) {
            add('#5', 'Lead to first response within 1 day', 100, '%', series(function (w) {
                return pct(ld.filter(function (x) { return x.owner === r && x.week === w; }).map(function (x) { return x.resp_mins; }), 480);
            }), {
                obs: Opct(ld.filter(function (x) { return x.owner === r && x.resp_mins != null; }), DAYF('created'),
                    function (x) { return x.resp_mins <= 480; }), mode: 'pct',
                detail: 'New lead or prospect record to the first logged call or outbound email on that '
                    + 'account. Leads tagged Spam are excluded.', note: NOTE[r] || ''
            });
        }

        // #12i Sales $ \u2014 not for Taylor, Gianna, Sruly (their $ still count in pod/team)
        if (!NO_SALES[r]) {
            add('#12i', 'Sales $', TARGETS[r] == null ? null : TARGETS[r], '$', series(function (w) {
                return pyRound((C.revenue[r] || {})[w] || 0);
            }), {
                obs: Osum(C.order.filter(function (x) { return x.rep === r; }), DAYF('trandate'),
                    function (x) { return x.value; }), mode: 'sum',
                detail: 'Approved sales orders dated in the week by this rep, on the '
                    + 'customsearch4450 filter.', note: NOTE[r] || ''
            });
        }

        // #15a / #15n Call sentiment
        add('#15a', '% of positive calls', 60, '%', series(function (w) {
            var c = cl.filter(function (x) { return x.rep === r && x.week === w && x.scored; });
            return c.length ? pyRound(c.filter(function (x) { return x.positive; }).length / c.length * 100) : null;
        }), {
            obs: Opct(cl.filter(function (x) { return x.rep === r && x.scored; }),
                function (x) { return cut(C.callWhen[x.id] || '', 10); }, function (x) { return x.positive; }), mode: 'pct',
            detail: 'AI-scored customer sentiment at the end of the call. Voicemails and no-answers '
                + 'are excluded \u2014 they can never score well.', note: NOTE[r] || ''
        });
        add('#15n', 'Calls that ended negative', 0, 'count', series(function (w) {
            return cl.filter(function (x) { return x.rep === r && x.week === w && x.negative; }).length;
        }), {
            obs: Ocount(cl.filter(function (x) { return x.rep === r && x.negative; }),
                function (x) { return cut(C.callWhen[x.id] || '', 10); }), mode: 'count',
            detail: 'Calls the AI scored as ending on a negative note. Not a verdict on the rep \u2014 '
                + 'some calls are a customer arriving angry about something that happened '
                + 'upstream. Each one is worth opening, which is what the list is for. Read it '
                + 'with the AI-coverage row: an unscored call cannot show up here.',
            drill: 'calls_negative', invert: true, note: NOTE[r] || ''
        });

        // #15c AI coverage \u2014 the integrity check under the sentiment rows
        add('#15c', 'AI coverage of logged calls', 100, '%', series(function (w) {
            var c = rich.filter(function (x) { return x._rep === r && x._week === w; });
            return c.length ? pyRound(c.filter(function (x) { return x.aiproc === 'T'; }).length / c.length * 100) : null;
        }), {
            obs: Opct(rich.filter(function (x) { return x._rep === r && x._week != null; }), DAYF('created'),
                function (x) { return x.aiproc === 'T'; }), mode: 'pct',
            detail: 'Share of this rep\u2019s logged calls the AI actually scored. This row exists '
                + 'because the sentiment rows above are silent about it: an unscored call is '
                + 'not a neutral call, it is a call with no opinion, and a rep with low '
                + 'coverage looks clean for the wrong reason. Read the sentiment row only as '
                + 'far as this one supports it.',
            drill: 'ai_unscored', note: NOTE[r] || ''
        });

        // #16 Commitments the AI heard on a call \u2014 not for Taylor, Gianna, Sruly
        if (!NO_COMMITMENTS[r]) {
            add('#16', 'Commitments made on calls', null, 'count', series(function (w) {
                return rich.filter(function (x) { return x._rep === r && x._week === w && ACT[x.action]; }).length;
            }), {
                obs: Ocount(rich.filter(function (x) { return x._rep === r && ACT[x.action]; }), DAYF('created')),
                mode: 'count',
                detail: 'Calls where the AI heard a concrete commitment \u2014 a follow-up, a credit, a '
                    + 'replacement, an operations review. Not a score: a list of what was promised, '
                    + 'so the L10 can ask whether it happened. Closing these is not yet tracked '
                    + 'anywhere, which is the honest gap.',
                drill: 'commitments'
            });
        }

        // #17 Retention \u2014 carried over from the retention system, never recomputed here
        var rv = retention && retention.reps ? retention.reps[FULL[r]] : null;
        var retNote, dash = [null, null, null, null];
        if (NO_RETENTION[r]) {
            // Moshe holds tickets, not a book of accounts: no retention rows, as in the Python.
        } else if (rv) {
            retNote = retNote_(retention);
            var tot = (rv.cin || 0) + (rv.cout || 0) + (rv.cno || 0);
            var cad = tot ? pyRound(rv.cin / tot * 100) : null;
            add('#17i', 'Retention score', 75, '%', [rv.composite, rv.composite, rv.composite, rv.composite],
                { detail: 'This rep\u2019s own book, on the retention system\u2019s formula.', note: retNote + (rv.accounts === 0 ? ' ' + FULL[r].split(' ')[0] + '\u2019s book is empty \u2014 no accounts are assigned yet, so 0.0 is an empty state, not a result.' : (rv.accounts == null ? (RETENTION_EXTRA[r] || '') : '')) });
            add('#17j', 'Proactive check-ins in cadence', 80, '%', [cad, cad, cad, cad],
                { detail: 'Accounts on a proactive rotation whose check-in is on time.', note: retNote });
            add('#17k', 'Accounts overdue a reorder', 0, 'count', [rv.overdue_n, rv.overdue_n, rv.overdue_n, rv.overdue_n],
                { detail: 'Accounts past their expected reorder date with nobody on them.', note: retNote, invert: true });
        } else {
            // No honest source -> a dash and a stated reason. Never a hidden row, never a zero.
            retNote = 'Not available \u2014 the retention figures could not be computed on this load, '
                + 'so this shows a dash rather than a guess.';
            add('#17i', 'Retention score', 75, '%', dash.slice(), { detail: 'This rep\u2019s own book, on the retention system\u2019s formula.', note: retNote });
            add('#17j', 'Proactive check-ins in cadence', 80, '%', dash.slice(), { detail: 'Accounts on a proactive rotation whose check-in is on time.', note: retNote });
            add('#17k', 'Accounts overdue a reorder', 0, 'count', dash.slice(), { detail: 'Accounts past their expected reorder date with nobody on them.', note: retNote, invert: true });
        }

        // #18 Open tickets untouched over 10 business days \u2014 a live position
        if (TICKET_HOLDERS.indexOf(r) >= 0) {
            var n = C.open.filter(function (x) { return x._who === r && x._idle > STALE; }).length;
            add('#18', 'Open tickets untouched over ' + STALE + ' business days', 0, 'count', [n, n, n, n], {
                detail: 'Tickets assigned to this person that are still open and that nobody has '
                    + 'touched in more than ' + STALE + ' business days. Lower is better; zero is a clean '
                    + 'queue. This counts movement on the record, not messages, so it is unaffected '
                    + 'by a reply being filed on the quote or the order instead of the ticket.',
                drill: 'open_stale', invert: true,
                note: 'A live snapshot of the queue as it stands, not a weekly rate, so the four '
                    + 'columns repeat one figure rather than pretending to a trend.'
            });
        }

        // A closure week is blank, not zero.
        rows.forEach(function (row) { closed.forEach(function (w) { row.weekly[w] = null; }); });
        return rows;
    }

    // =====================================================================
    //  queues \u2014 only this person's own evidence, plus the lists nobody owns
    // =====================================================================
    function queuesFor(who, C, R, WLAB) {
        // R = resolvers: cname(id), caseNo(id), tranInfo(id) -> {tranid, type}|null, link(kind,id)
        var L = R.link;
        function recordOf(x) {
            if (x['case']) return ['Ticket ' + (R.caseNo(x['case']) || String(x['case'])), L('case', x['case'])];
            if (x.tran) {
                var t = R.tranInfo(x.tran);
                if (t && t.tranid) return [t.tranid, L(t.type ? 'type:' + t.type : (String(t.tranid).indexOf('SO') === 0 ? 'order' : 'quote'), x.tran)];
                return ['Quote/order ' + x.tran, L('any', x.tran)];
            }
            return ['No ticket \u2014 customer record', L('cust', x.cust)];
        }
        var q = {}, uo = {};
        // Every list reaches back as far as its records were pulled; the week column is
        // blank outside the four scored weeks and the page's date window does the rest.
        function WK(x) { return x.week != null ? WLAB[x.week] : ''; }
        var un = C.unanswered;
        var tkOwner = {};
        C.ticket.forEach(function (t) { tkOwner[t.id] = t.assigned; });
        // Yours if it sits on a ticket assigned to you, or you were the last to write to them.
        var mine = un.filter(function (x) {
            return (x['case'] && tkOwner[x['case']] === who) || x.held_by === who;
        });
        q.unanswered = {
            title: 'Customer email with no reply \u2014 yours to pick up',
            why: 'Inbound mail with nothing going back out, on an account you are holding \u2014 '
                + 'either the ticket is assigned to you, or you were the last person to write '
                + 'to that customer. Open each one. Some will turn out to have been answered '
                + 'from Outlook or filed on the quote, which the measurement cannot see; those '
                + 'are worth knowing about too, because the customer record will not show it '
                + 'either.',
            cols: ['Week', 'Received', 'Customer', 'Subject', 'Record', 'Open'],
            rows: sortBy(mine, function (y) { return y.in_at; }, true).map(function (x) {
                var ro = recordOf(x);
                return [WK(x), x.in_at, R.cname(x.cust), cut(safe(x.subject), 58), ro[0], ro[1]];
            })
        };

        var lu = C.lead.filter(function (x) { return x.owner === who && x.resp_mins == null; });
        q.leads = {
            title: 'Leads you have not contacted',
            why: 'A new lead assigned to you with no call and no outbound email. Contact means '
                + 'the customer heard from you \u2014 raising a quote or an opportunity does not count.',
            cols: ['Week', 'Created', 'Lead', 'Any work done?', 'Open'],
            rows: sortBy(lu, function (y) { return y.created; }, true).map(function (x) {
                return [WK(x), x.created, R.cname(x.cust),
                    x.work_mins != null ? x.work_type + ' raised' : 'nothing yet', L('cust', x.cust)];
            })
        };

        var op = C.open.filter(function (x) { return x._who === who; });
        if (op.length) {
            q.backlog = {
                title: 'Your open tickets',
                why: 'Everything assigned to you that is still open, longest untouched first. '
                    + '"Idle" means nothing has happened to the ticket at all \u2014 no reply, no status '
                    + 'change, no note. Some of these will be work you finished and never closed; '
                    + 'those still need closing, because an open ticket is a promise the system '
                    + 'thinks is outstanding. Where it says the customer came back, check before '
                    + 'you trust it \u2014 if you answered from the quote or the order, this cannot see it.',
                cols: ['Idle (bd)', 'Age (bd)', 'Opened', 'Status', 'Where the ball is', 'Customer', 'Subject', 'Open'],
                rows: sortBy(op, function (y) { return -y._idle; }).map(function (x) {
                    return [x._idle, x._age, cut(x.created, 10), STN[x.status] != null ? STN[x.status] : x.status,
                        x._ball, R.cname(x.company), cut(safe(x.title), 52), L('case', x.id)];
                })
            };
        }

        var neg = C.call.filter(function (x) { return x.rep === who && x.week != null && x.negative; });
        if (neg.length) {
            q.neg_calls = {
                title: 'Your calls that ended on a negative note',
                why: 'The AI scored the customer as still unhappy at the end of the call. That is '
                    + 'not automatically a mark against you \u2014 plenty of these are someone arriving '
                    + 'angry about something that happened upstream. They are here so you can open '
                    + 'them, and so nothing gets closed out while the customer is still annoyed.',
                cols: ['Week', 'Logged', 'Customer', 'Subject', 'Open call'],
                rows: sortBy(neg, function (y) { return y.week; }, true).map(function (x) {
                    return [WK(x), C.callWhen[x.id] || '', R.cname(x.cust), cut(safe(x.title), 58), L('call', x.id)];
                })
            };
        }
        // AI-coverage gaps are a system issue for Sara, not a rep worklist \u2014 not here.

        var mytk = C.ticket.filter(function (x) { return x.assigned === who && x.in_denom; });
        if (mytk.length) {
            var slow = mytk.filter(function (x) { return x.reply_mins != null && x.reply_mins > 120; });
            if (slow.length) q.tk_slow = {
                title: 'Your tickets where the first reply took over 2 business hours',
                why: 'The ticket got an answer, just not inside the target. Sorted slowest '
                    + 'first. Worth a look for a pattern \u2014 one bad day reads very differently '
                    + 'from the same type of ticket always running long.',
                cols: ['Week', 'Opened', 'Business hrs to reply', 'Customer', 'Subject', 'Open ticket'],
                rows: sortBy(slow, function (y) { return -y.reply_mins; }).map(function (x) {
                    return [WK(x), cut(x.created, 16), pyRound(x.reply_mins / 60, 1),
                        R.cname(x.cust), cut(safe(x.title), 52), L('case', x.id)];
                })
            };
            var nore = mytk.filter(function (x) { return x.reply_mins == null; });
            if (nore.length) q.tk_noreply = {
                title: 'Your tickets with no reply logged on the ticket',
                why: 'Nothing was filed against these tickets. Plenty will have been answered '
                    + 'from Outlook or on the quote \u2014 that is exactly the point of showing '
                    + 'them to you rather than scoring you on them. Where you did answer, the '
                    + 'fix is to reply from the ticket so it is on the record; where you did '
                    + 'not, it is still open on the customer\u2019s side.',
                cols: ['Week', 'Opened', 'Customer', 'Subject', 'Open ticket'],
                rows: sortBy(nore, function (y) { return y.created; }, true).map(function (x) {
                    return [WK(x), cut(x.created, 16), R.cname(x.cust), cut(safe(x.title), 58), L('case', x.id)];
                })
            };
            var sres = mytk.filter(function (x) { return x.resolve_mins != null && x.resolve_mins > 960; });
            if (sres.length) q.tk_slowclose = {
                title: 'Your tickets that took more than 2 business days to close',
                why: 'Closed, but outside the resolution target. Some of this is genuinely '
                    + 'waiting on a customer or on production; the list is here so the slow '
                    + 'ones can be told apart from the stuck ones.',
                cols: ['Week', 'Opened', 'Business days to close', 'Customer', 'Subject', 'Open ticket'],
                rows: sortBy(sres, function (y) { return -y.resolve_mins; }).map(function (x) {
                    return [WK(x), cut(x.created, 16), pyRound(x.resolve_mins / 480, 1),
                        R.cname(x.cust), cut(safe(x.title), 52), L('case', x.id)];
                })
            };
            var ct = mytk.filter(function (x) { return CATCHALL[x.cust]; });
            if (ct.length) q.tk_catchall = {
                title: 'Your tickets sitting on a catch-all customer record',
                why: 'These are on the Anonymous or Royal Bag record rather than the real '
                    + 'customer, because NetSuite could not match the sender to a contact. '
                    + 'Nothing you did \u2014 but while a ticket sits on a bucket, a reply filed '
                    + 'anywhere other than that exact ticket cannot be matched back to it, so '
                    + 'these can never be scored fairly either way. Reassigning one to the '
                    + 'right customer fixes it for good.',
                cols: ['Week', 'Opened', 'Customer', 'Subject', 'Open ticket'],
                rows: sortBy(ct, function (y) { return y.created; }, true).map(function (x) {
                    return [WK(x), cut(x.created, 16), R.cname(x.cust), cut(safe(x.title), 58), L('case', x.id)];
                })
            };
        }

        // ---- nobody owns these: identical on every file ----
        var nolead = C.lead.filter(function (x) { return x.owner == null && x.resp_mins == null; });
        if (nolead.length) uo.u_leads = {
            title: 'Leads that arrived with no rep on them',
            why: 'A lead with no sales rep cannot be chased, because nobody is accountable '
                + 'for it. These are not assigned to you \u2014 they are here because they are '
                + 'assigned to no one, and they will sit until somebody claims them.',
            cols: ['Week', 'Created', 'Lead', 'Any work done?', 'Open'],
            rows: sortBy(nolead, function (y) { return y.created; }, true).map(function (x) {
                return [WK(x), x.created, R.cname(x.cust),
                    x.work_mins != null ? x.work_type + ' raised' : 'nothing at all', L('cust', x.cust)];
            })
        };
        // _who is null catches both: no assignee at all, and held by someone off the roster.
        var noown = C.open.filter(function (x) { return x._who == null; });
        if (noown.length) uo.u_tickets = {
            title: 'Open tickets nobody on the team owns',
            why: 'Open, ageing, and belonging to no one on this board. Most have no assignee '
                + 'at all; a few are assigned to someone off the sales roster, shown as \u201coff roster\u201d. '
                + 'Claim anything here that is yours \u2014 the longer it sits the more likely the '
                + 'customer has already chased it somewhere else.',
            cols: ['Idle (bd)', 'Age (bd)', 'Opened', 'Status', 'Assigned to', 'Where the ball is', 'Customer', 'Subject', 'Open'],
            rows: sortBy(noown, function (y) { return -y._idle; }).map(function (x) {
                return [x._idle, x._age, cut(x.created, 10), STN[x.status] != null ? STN[x.status] : x.status,
                    x._label, x._ball, R.cname(x.company), cut(safe(x.title), 52), L('case', x.id)];
            })
        };
        var noheld = un.filter(function (x) { return !x.held_by && !(x['case'] && tkOwner[x['case']]); });
        if (noheld.length) uo.u_email = {
            title: 'Unanswered email on accounts nobody is holding',
            why: 'Inbound mail with no reply, where the ticket is unassigned AND nobody on '
                + 'the team has written to that customer before. There is no obvious owner, '
                + 'which is exactly why these go unanswered longest.',
            cols: ['Week', 'Received', 'Customer', 'Subject', 'Record', 'Open'],
            rows: sortBy(noheld, function (y) { return y.in_at; }, true).map(function (x) {
                var ro = recordOf(x);
                return [WK(x), x.in_at, R.cname(x.cust), cut(safe(x.subject), 58), ro[0], ro[1]];
            })
        };

        var qs = C.quote.filter(function (x) { return x.rep === who && !x.sent; });
        q.quotes_unsent = {
            title: 'Quotes you raised that never went out',
            why: 'The quote exists in NetSuite but no email carrying it reached the customer. '
                + 'Work that was done and did not land.',
            cols: ['Week', 'Quote', 'Created', 'Value', 'Age (days)', 'Open'],
            rows: sortBy(qs, function (y) { return y.created; }, true).map(function (x) {
                return [WK(x), x.no, x.created, money0(x.value), x.age_days, L('quote', x.id)];
            })
        };
        var fu = C.quote.filter(function (x) { return x.rep === who && x.sent && x.followups === 0; });
        q.quotes_nofollow = {
            title: 'Quotes you sent with no follow-up',
            why: 'It reached the customer and nothing went out after it.',
            cols: ['Week', 'Quote', 'Created', 'Value', 'Open'],
            rows: sortBy(fu, function (y) { return y.created; }, true).map(function (x) {
                return [WK(x), x.no, x.created, money0(x.value), L('quote', x.id)];
            })
        };
        return { mine: q, unowned: uo };
    }

    /** Ids the page will show, so names/case numbers/transaction numbers can be
     *  looked up for just those (the customer table is ~21,700 rows). */
    function referencedIds(who, C) {
        var R = { cname: function (i) { ids.cust[i] = 1; return ''; },
            caseNo: function (i) { ids['case'][i] = 1; return ''; },
            tranInfo: function (i) { ids.tran[i] = 1; return null; },
            link: function () { return ''; } };
        var ids = { cust: {}, 'case': {}, tran: {} };
        queuesFor(who, C, R, ['', '', '', '']);
        return { cust: Object.keys(ids.cust).map(Number), 'case': Object.keys(ids['case']).map(Number),
            tran: Object.keys(ids.tran).map(Number) };
    }

    // =====================================================================
    //  the leakage gate \u2014 one person per page
    // =====================================================================
    /** Every per-rep page may name only that rep. Mask, never loosen. */
    /**
     * The leakage gate. A rep page may name only that rep; a pod lead's page only the
     * pod; the Director's page anyone. No page may carry an email address. Mask, never loosen.
     */
    function leakGate(who, pay, allowed) {
        var masked = 0, allow = allowed || [who];
        var needles = [];
        EVERYONE.forEach(function (k) {
            if (allow.indexOf(k) >= 0) return;
            var full = FULL[k], parts = full.split(' ');
            [full, parts[0], parts[parts.length - 1]].forEach(function (n) { needles.push(n); });
        });
        var re = needles.length ? new RegExp('\\b(' + needles.map(function (n) {
            return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('|') + ')\\b', 'g') : null;
        function scrub(v) {
            if (typeof v === 'string') {
                var s = v.replace(EMAIL_RE, function () { masked++; return '[address]'; });
                if (re && s.indexOf('http') !== 0) s = s.replace(re, function () { masked++; return '[colleague]'; });
                return s;
            }
            if (Array.isArray(v)) return v.map(scrub);
            if (v && typeof v === 'object') {
                var o = {};
                Object.keys(v).forEach(function (k) { o[k] = scrub(v[k]); });
                return o;
            }
            return v;
        }
        ['queues', 'unowned'].forEach(function (k) { pay[k] = scrub(pay[k]); });
        Object.keys(pay.members || {}).forEach(function (m) {
            if (pay.members[m].queues) pay.members[m].queues = scrub(pay.members[m].queues);
        });
        var bad = pay.individual.some(function (r) { return r.owner !== who; })
            || (pay.pod || []).some(function (r) { return r.owner !== who; });
        return { masked: masked, ownershipOk: !bad };
    }

    /** The whole payload for one person \u2014 what personal.py emits as `const D`. */
    function personPayload(who, C, R, retention, asOf) {
        var WLAB = C.weeks.map(weekLabel);
        var cw = closedWeeks(C.weeks);
        var Q = queuesFor(who, C, R, WLAB);
        return {
            me: who, meFull: FULL[who], weeks: WLAB, closedWeeks: cw.idx, asOf: asOf,
            individual: rowsFor(who, C, retention, cw.idx),
            pod: [], podName: null, podMembers: [],
            queues: Q.mine, unowned: Q.unowned, members: {}, solo: true,
            closedWhy: cw.why, weekRanges: C.weeks, span: [C.weeks[0][0], C.weeks[C.weeks.length - 1][1]]
        };
    }

    // =====================================================================
    //  team + pod rows (scorecard.py, levels 'team' and 'pod')
    // =====================================================================
    var ISSNAME = { 2: 'Quality', 4: 'Wrong item/quantity received', 5: 'Delayed order', 7: 'Other',
        8: 'Product Issues', 9: 'Delivery Issues', 10: 'Returns & Exchanges',
        11: 'Billing & Payment', 12: 'Tracking & Updates', 14: 'Others' };
    var SUBNAME = { 2: 'Defective Item', 3: 'Wrong Item Sent', 4: 'Missing Item',
        5: 'Product not as described', 7: 'Not Received',
        8: 'Delivered to Wrong Address', 10: 'Late shipment', 11: 'Return Request',
        12: 'Exchange Request', 14: 'Incorrect Charge', 15: 'Tracking Not Updating',
        16: 'No Shipping Notification', 17: 'Carrier Delay', 18: 'Lost Package' };
    var REPNAME = { 749: 'Fay', 74925: 'Fay', 8: 'Mendy', 49875: 'Mendy', 496615: 'Taylor',
        938190: 'Taylor', 1006783: 'Gianna', 317501: 'Sruly', 21: 'Renee',
        20: 'Riki', 653584: 'Moshe', 723235: 'Moshe', 666412: 'Moshe' };
    // Tier 1 is the only tier that is order accuracy: did we send the right things,
    // complete, to the right place. Everything else has a different owner.
    function tier(x) {
        var sb = x.sub, i = x.issue;
        if (sb === 3 || sb === 4 || sb === 8 || (sb == null && i === 4)) return 'Order accuracy';
        if (sb === 2 || sb === 5 || (sb == null && i === 2)) return 'Product quality';
        if (sb === 10 || (sb == null && i === 5)) return 'Late shipment';
        if (sb === 7 || sb === 15 || sb === 17 || sb === 18) return 'Carrier';
        if (sb === 11 || sb === 12) return 'Customer-initiated';
        if (sb === 14) return 'Billing';
        if (sb === 16) return 'Systems';
        return 'Untyped';
    }
    var MACHINE_DOM = { 'id.ups.com': 1, 'ups.com': 1, 'ringcentral.com': 1, 'compuvoip.com': 1, 'stamps.com': 1,
        'postman.co.kr': 1, 'mwwondemand.com': 1, 'greensoft-usa.com': 1, 'compliancexl.com': 1, 'staples.com': 1 };
    var FREEMAIL = { 'gmail.com': 1, 'aol.com': 1, 'yahoo.com': 1, 'orange.fr': 1, 'hotmail.com': 1,
        'outlook.com': 1, 'icloud.com': 1 };
    function catchallVerdict(dom, domCust) {
        if (dom === 'royalbag.com') return [1, 'Forwarded in by a colleague'];
        if (domCust[dom]) return [0, 'Fixable \u2014 add the sender as a contact'];
        if (MACHINE_DOM[dom]) return [3, 'Vendor or system notification'];
        if (FREEMAIL[dom]) return [2, 'Free-mail address \u2014 no domain to match on'];
        return [2, 'Domain not on any customer record'];
    }
    var PCT_ROUND = function (n, d) { return d ? pyRound(n / d * 100) : null; };

    function teamRows(C, retention, closed) {
        var rows = [];
        function add(mid, name, target, unit, owner, level, weekly, o) {
            o = o || {};
            rows.push({ mid: mid, name: name, target: target, unit: unit, owner: owner, level: level,
                weekly: weekly, invert: !!o.invert, detail: o.detail || '', note: o.note || '',
                drill: o.drill || null, obs: o.obs !== undefined ? o.obs : null, mode: o.mode || null });
        }
        var em = C.email, tk = C.ticket, ld = C.lead, qt = C.quote, cl = C.call, nc = C.newcust, WEEKS = C.weeks;
        function inMem(mem, r) { return mem.indexOf(r) >= 0; }
        var podNames = Object.keys(PODS);

        // #4 tickets resolved within 2 business days (team)
        add('#4', '% of tickets resolved within 2 business days', 85, '%', 'Sara', 'team', series(function (w) {
            return pct(tk.filter(function (x) { return x.in_denom && x.week === w; }).map(function (x) { return x.resolve_mins; }), 960);
        }), { obs: Opct(tk.filter(function (x) { return x.in_denom && x.resolve_mins != null; }), DAYF('created'),
            function (x) { return x.resolve_mins <= 960; }), mode: 'pct',
            detail: 'Created to closed on the business-hours clock. The most trustworthy number in the '
                + 'set \u2014 95% of tickets carry a close timestamp, so it has no coverage problem.' });

        add('#5b', 'Lead contact coverage \u2014 all leads (within 2 business days)', 100, '%', 'Sara', 'team', series(function (w) {
            return pct(ld.filter(function (x) { return x.week === w; }).map(function (x) { return x.resp_mins; }), 960);
        }), { obs: Opct(ld.filter(function (x) { return x.resp_mins != null; }), DAYF('created'),
            function (x) { return x.resp_mins <= 960; }), mode: 'pct',
            detail: 'Every new lead, including the ones that arrive with no rep assigned. Contact means a '
                + 'call or an outbound email \u2014 the customer actually heard from us. A quote or an '
                + 'opportunity is work, not contact.',
            note: 'Set at 2 business days to start, while the individual rows run at 1 business day. '
                + 'The 1-day figure is on the row below so you can see the gap you are closing.',
            drill: 'leads_untouched' });
        add('#5c', 'Lead contact coverage \u2014 the 1-day goal', 100, '%', 'Sara', 'team', series(function (w) {
            return pct(ld.filter(function (x) { return x.week === w; }).map(function (x) { return x.resp_mins; }), 480);
        }), { obs: Opct(ld.filter(function (x) { return x.resp_mins != null; }), DAYF('created'),
            function (x) { return x.resp_mins <= 480; }), mode: 'pct',
            detail: 'The same population measured at 1 business day. Watch this one; score the 2-day row.',
            drill: 'leads_untouched' });

        podNames.forEach(function (p) {
            var v = PODS[p];
            add('#6', p + ' pod \u2014 % of quotes sent within 2 days', 60, '%', v.lead, 'pod', series(function (w) {
                return pct(ld.filter(function (x) { return inMem(v.members, x.owner) && x.week === w; }).map(function (x) { return x.quote_mins; }), 960);
            }), { obs: Opct(ld.filter(function (x) { return inMem(v.members, x.owner) && x.quote_mins != null; }), DAYF('created'),
                function (x) { return x.quote_mins <= 960; }), mode: 'pct',
                detail: 'Lead created to the quote reaching the customer. Counts the whole pod\u2019s output '
                    + 'under the pod lead.' });
        });
        podNames.forEach(function (p) {
            var v = PODS[p];
            add('#10', p + ' pod \u2014 quote follow-ups completed', 60, '%', v.lead, 'pod', series(function (w) {
                var qs = qt.filter(function (x) { return inMem(v.members, x.rep) && x.week === w && x.sent; });
                return qs.length ? pyRound(qs.filter(function (x) { return x.followups >= 1; }).length / qs.length * 100) : null;
            }), { obs: Opct(qt.filter(function (x) { return inMem(v.members, x.rep) && x.sent; }), DAYF('created'),
                function (x) { return x.followups >= 1; }), mode: 'pct',
                detail: 'Of the quotes this pod sent, the share that got at least one further outbound '
                    + 'contact on the same quote.', drill: 'quotes_nofollow' });
        });
        podNames.forEach(function (p) {
            var v = PODS[p];
            add('#13', p + ' new customers', p === 'Evergreen' ? 2 : 1, 'count', v.lead, 'pod', series(function (w) {
                return nc.filter(function (x) { return inMem(v.members, x.rep) && x.week === w; }).length;
            }), { obs: Ocount(nc.filter(function (x) { return inMem(v.members, x.rep); }), DAYF('firstorder')), mode: 'count',
                detail: 'A customer whose first ever order landed in the week.', drill: 'newcust' });
            add('#13b', p + ' new high-impact customers', 1, 'count', v.lead, 'pod', series(function (w) {
                return nc.filter(function (x) { return inMem(v.members, x.rep) && x.week === w && x.hvt; }).length;
            }), { obs: Ocount(nc.filter(function (x) { return inMem(v.members, x.rep) && x.hvt; }), DAYF('firstorder')), mode: 'count',
                detail: 'First order annualised against this pod\u2019s threshold ($' + money0(HVT[p]).replace('$', '') + ').',
                note: 'DERIVED. The high-impact field is unset on almost every customer record and '
                    + 'estimated budget is empty, so this cannot be read from NetSuite \u2014 it is inferred '
                    + 'from first-order size. Marking the back-fill accounts would make it real.',
                drill: 'newcust_hvt' });
        });
        podNames.forEach(function (p) {
            var v = PODS[p];
            add('#9', p + ' win rate', 20, '%', v.lead, 'pod', series(function (w) {
                var li = ld.filter(function (x) { return inMem(v.members, x.owner) && x.week === w && !x.web; }).length;
                var cv = nc.filter(function (x) { return inMem(v.members, x.rep) && x.week === w && !x.web; }).length;
                return li ? pyRound(cv / li * 100) : null;
            }), { detail: 'Conversions this week \u00f7 leads received this week, as two independent counts \u2014 '
                + 'the conversions need not come from this week\u2019s leads. Rep-less web and '
                + 'phone records are excluded from both halves.' });
        });
        add('#9t', 'Team win rate', 20, '%', 'Sara', 'team', series(function (w) {
            var li = ld.filter(function (x) { return x.week === w && !x.web; }).length;
            var cv = nc.filter(function (x) { return x.week === w && !x.web; }).length;
            return li ? pyRound(cv / li * 100) : null;
        }), { detail: 'Conversions \u00f7 leads received, both counted independently. Records created '
            + 'with no sales rep are excluded from both halves: those are web and phone '
            + 'orders that should have been entered as customers, not leads. They convert '
            + 'at far higher rates than rep-owned leads, so leaving them in produced a blended '
            + 'rate that described neither population.', drill: 'web_leads' });
        podNames.forEach(function (p) {
            var v = PODS[p];
            add('#12', p + ' pod Sales $', TARGETS[v.lead] == null ? null : TARGETS[v.lead], '$', v.lead, 'pod', series(function (w) {
                var t = 0; v.members.forEach(function (m) { t += ((C.revenue[m] || {})[w] || 0); });
                return pyRound(t);
            }), { obs: Osum(C.order.filter(function (x) { return inMem(v.members, x.rep); }), DAYF('trandate'),
                function (x) { return x.value; }), mode: 'sum',
                detail: 'Approved sales orders dated in the week by anyone in the pod. Pending '
                    + 'approval, cancelled, voided and blanket orders excluded \u2014 the same filter '
                    + 'as saved search customsearch4450, reproduced to the cent.' });
        });

        // #7 / #7b order accuracy
        var t1 = C.tagged.filter(function (x) { return tier(x) === 'Order accuracy'; });
        var inW = function (x, w) { var k = cut(x.created, 10); return WEEKS[w][0] <= k && k <= WEEKS[w][1]; };
        var oN = 0, eN = 0;
        WEEKS.forEach(function (wk, w) {
            oN += C.ordersAll.filter(function (x) { return inW(x, w); }).length;
            eN += t1.filter(function (x) { return inW(x, w); }).length;
        });
        add('#7', 'Order accuracy', 99.5, '%', 'Sara', 'team', series(function (w) {
            var n = C.ordersAll.filter(function (x) { return inW(x, w); }).length;
            var e = t1.filter(function (x) { return inW(x, w); }).length;
            return n ? pyRound(100 - e / n * 100, 2) : null;
        }), { detail: 'Orders that went out right, as a share of orders raised. An error is a Tier-1 fault '
            + 'only \u2014 Wrong Item Sent, Missing Item, or Delivered to Wrong Address. Returns, '
            + 'exchanges, carrier problems, late shipments and billing disputes are real work but '
            + 'they are not order accuracy, and folding them in would make the number un-actionable.',
            note: eN + ' error' + (eN === 1 ? '' : 's') + ' against ' + money0(oN).slice(1) + ' orders across these four weeks. '
                + 'Three caveats worth knowing: the denominator is orders RAISED, not shipped; without a '
                + 'ticket\u2192order link the errors cannot be de-duplicated, so one bad shipment spawning two '
                + 'tickets would count twice; and this only counts errors a customer reported and Moshe '
                + 'tagged, so it is a floor, not a census. Target shown at 99.5% \u2014 the spec says 100%, '
                + 'which would mean never making a mistake.', drill: 'order_accuracy' });
        add('#7b', 'Order mistakes \u2014 count', 1, 'count', 'Sara', 'team', series(function (w) {
            return t1.filter(function (x) { return inW(x, w); }).length;
        }), { detail: 'The same errors as a raw count: Wrong Item Sent, Missing Item, Delivered to '
            + 'Wrong Address. Lower is better \u2014 zero is a clean week.', drill: 'order_accuracy', invert: true });

        add('#15b', 'Negative sentiment call count', 1, 'count', 'Sara', 'team', series(function (w) {
            return cl.filter(function (x) { return x.week === w && x.negative; }).length;
        }), { obs: Ocount(cl.filter(function (x) { return x.negative; }), function (x) { return cut(C.callWhen[x.id] || '', 10); }),
            mode: 'count', detail: 'Calls the AI scored as ending negative. Target is fewer than one a week, each '
                + 'reviewed. Lower is better \u2014 zero is a clean week.', drill: 'calls_negative', invert: true });

        // #17 pod retention
        var RN = retNote(retention);
        podNames.forEach(function (p) {
            var v = PODS[p];
            var rv = retention && retention.pods ? retention.pods[p] : null;
            if (!rv) return;
            add('#17', p + ' pod retention score', 75, '%', v.lead, 'pod', [rv.composite, rv.composite, rv.composite, rv.composite],
                { detail: '0.4 \u00d7 accounts retained + 0.6 \u00d7 revenue retained, across accounts with two or '
                    + 'more orders and revenue in either prior year. The retention system\u2019s own '
                    + 'formula, unchanged.', note: RN });
            var tot = rv.cin + rv.cout + rv.cno, cad = tot ? pyRound(rv.cin / tot * 100) : null;
            add('#17b', p + ' pod proactive check-ins in cadence', 80, '%', v.lead, 'pod', [cad, cad, cad, cad],
                { detail: 'Accounts with a proactive rotation whose check-in is being run on time. '
                    + 'Population is only accounts that have a rotation \u2014 an account without one is '
                    + 'not unmanaged, it is covered by the reorder measure instead.', note: RN });
            add('#17c', p + ' pod accounts overdue a reorder', 0, 'count', v.lead, 'pod', [rv.overdue_n, rv.overdue_n, rv.overdue_n, rv.overdue_n],
                { detail: 'Accounts past their expected reorder date with nobody on them. Lower is '
                    + 'better. These are the reorder touches that have not happened.', note: RN, invert: true });
        });

        var BACKNOTE = 'A live snapshot of the queue as it stands, not a weekly rate, so the four '
            + 'columns repeat one figure rather than pretending to a trend.';
        var op = C.open;
        podNames.forEach(function (p) {
            var v = PODS[p];
            var po = op.filter(function (x) { return inMem(v.members, x._who); });
            var a = po.filter(function (x) { return x._idle > STALE; }).length;
            add('#18p', p + ' pod \u2014 open tickets untouched over ' + STALE + ' business days', 0, 'count', v.lead, 'pod', [a, a, a, a],
                { detail: 'Every open ticket held by anyone in the pod that has not moved in more than '
                    + STALE + ' business days. ' + po.length + ' of the pod\'s tickets are open in total. '
                    + 'Rolled up so the pod lead can see the queue they are accountable for rather '
                    + 'than only their own rows.', drill: 'open_stale', invert: true, note: BACKNOTE });
            var b = po.filter(function (x) { return x._ballT === 'customer came back' || x._ballT === 'never replied to on the ticket'; }).length;
            add('#18q', p + ' pod \u2014 open tickets where the customer is waiting', null, 'count', v.lead, 'pod', [b, b, b, b],
                { detail: 'Pod tickets where the last thing on the record came from the customer, or where '
                    + 'nothing has gone out at all. A worklist, not a score \u2014 a reply filed on the '
                    + 'quote or the order is invisible to it, which was measured rather than assumed.',
                    drill: 'open_ball_ours', note: BACKNOTE });
        });
        var nStale = op.filter(function (x) { return x._idle > STALE; }).length;
        add('#18t', 'Open tickets untouched over ' + STALE + ' business days', 0, 'count', 'Sara', 'team', [nStale, nStale, nStale, nStale],
            { detail: 'The whole open queue: ' + op.length + ' tickets are open right now and ' + nStale + ' of '
                + 'them have not moved in over ' + STALE + ' business days. Includes the ones with nobody '
                + 'assigned.', drill: 'open_stale', invert: true, note: BACKNOTE });
        var nU = op.filter(function (x) { return x._who == null && x.assigned == null; }).length;
        add('#18u', 'Open tickets with nobody assigned', 0, 'count', 'Sara', 'team', [nU, nU, nU, nU],
            { detail: 'An open ticket with no assignee cannot be chased and belongs to no one. This is a '
                + 'routing gap, not a performance number.', drill: 'open_unassigned', invert: true, note: BACKNOTE });

        function covered(x) {
            return (x.mins != null && x.mins <= 480) || (x.other_mins != null && x.other_mins <= 480)
                || (x.colleague_mins != null && x.colleague_mins <= 480);
        }
        add('#3', 'Response coverage \u2014 answered within 1 business day', 100, '%', 'Sara', 'team', series(function (w) {
            var v = em.filter(function (x) { return x.week === w; });
            return v.length ? pyRound(v.filter(covered).length / v.length * 100) : null;
        }), { obs: Opct(em, DAYF('in_at'), covered), mode: 'pct',
            detail: 'Every in-scope inbound customer email where SOMEBODY at RoyalBag replied inside one '
                + 'business day. Counts three things the speed rows deliberately exclude: replies sent '
                + 'under a changed subject, replies filed on a different record, and replies from a '
                + 'colleague off the scorecard \u2014 procurement on a proof approval, bookkeeping on an '
                + 'invoice. The question this row answers is whether the customer heard back, not who '
                + 'gets the credit. The shortfall is a queue to work, not a number to chase.', drill: 'unanswered' });

        rows.forEach(function (row) { closed.forEach(function (w) { row.weekly[w] = null; }); });
        return rows;
    }

    // =====================================================================
    //  the Director's lists (scorecard.py queues)
    // =====================================================================
    function teamQueues(C, R, WLAB) {
        var L = R.link;
        function wk(x) { return x.week != null ? WLAB[x.week] : ''; }
        function recordOf(x) {
            if (x['case']) return ['Ticket ' + (R.caseNo(x['case']) || String(x['case'])), L('case', x['case'])];
            if (x.tran) {
                var t = R.tranInfo(x.tran);
                if (t && t.tranid) return [t.tranid, L(t.type ? 'type:' + t.type : (String(t.tranid).indexOf('SO') === 0 ? 'order' : 'quote'), x.tran)];
                return ['Quote/order ' + x.tran, L('any', x.tran)];
            }
            return ['No ticket \u2014 on the customer record', L('cust', x.cust)];
        }
        function stn(s) { return STN[s] != null ? STN[s] : s; }
        var em = C.email, ld = C.lead, qt = C.quote, nc = C.newcust, op = C.open, rich = C.rich;
        var q = {};
        q.unanswered = { title: 'Inbound customer email with no reply from anyone on the roster',
            why: 'These are the emails behind the response-coverage gap. Roughly half sit on a '
                + 'catch-all customer record, where a reply filed anywhere but the ticket itself '
                + 'cannot be matched \u2014 those are listed separately below.',
            cols: ['Week', 'Received', 'Subject', 'Customer', 'Record', 'Open record', 'Customer record'],
            rows: sortBy(C.unanswered, function (y) { return y.in_at; }, true).map(function (x) {
                var ro = recordOf(x);
                return [wk(x), x.in_at, cut(safe(x.subject), 64), R.cname(x.cust), ro[0], ro[1], L('cust', x.cust)];
            }) };
        q.untraceable = { title: 'Tickets that cannot be traced \u2014 the customer is a catch-all record',
            why: 'The ticket carries "Anonymous customer" (C999) or Royal Bag\u2019s own record instead '
                + 'of a real account. If the rep answered from the order or the quote, nothing links '
                + 'that reply back to this ticket. This is the single fix that would make response '
                + 'coverage trustworthy.',
            cols: ['Week', 'Ticket', 'Created', 'Subject', 'Assigned', 'Open'],
            rows: sortBy(C.untraceable, function (y) { return y.created; }, true).map(function (x) {
                return [wk(x), x.no, x.created, cut(safe(x.title), 70), x.assigned || '\u2014', L('case', x.id)];
            }) };
        q.real_miss = { title: 'Real misses \u2014 a named customer, in scope, and no reply on the ticket',
            why: 'These carry a real customer record, so nothing is hiding. Open a handful: if the '
                + 'reply went out from Outlook rather than NetSuite, that changes the conclusion and '
                + 'is worth knowing.',
            cols: ['Week', 'Ticket', 'Created', 'Subject', 'Customer', 'Assigned', 'Open'],
            rows: sortBy(C.real_miss, function (y) { return y.created; }, true).map(function (x) {
                return [wk(x), x.no, x.created, cut(safe(x.title), 70), R.cname(x.cust), x.assigned || 'unassigned', L('case', x.id)];
            }) };
        q.leads_untouched = { title: 'Leads that got no call and no email',
            why: 'A new lead nobody contacted. Where the owner is blank the lead arrived without a '
                + 'rep assigned \u2014 those are the ones most likely to sit.',
            cols: ['Week', 'Created', 'Lead', 'Owner', 'Any work done?', 'Open'],
            rows: sortBy(ld.filter(function (y) { return y.resp_mins == null; }), function (y) { return y.created; }, true).map(function (x) {
                return [wk(x), x.created, R.cname(x.cust), x.owner || 'unassigned',
                    x.work_mins != null ? x.work_type + ' raised by ' + x.work_by : 'nothing at all', L('cust', x.cust)];
            }) };
        q.quotes_unsent = { title: 'Quotes created but never emailed to the customer',
            why: 'Work that was done and never reached the customer. A quote sitting unsent in '
                + 'NetSuite is not a response.',
            cols: ['Week', 'Quote', 'Created', 'Value', 'Rep', 'Age (days)', 'Open'],
            rows: sortBy(qt.filter(function (y) { return !y.sent; }), function (y) { return y.created; }, true).map(function (x) {
                return [wk(x), x.no, x.created, money0(x.value), x.rep || '\u2014', x.age_days, L('quote', x.id)];
            }) };
        q.quotes_nofollow = { title: 'Quotes sent with no follow-up',
            why: 'The quote reached the customer and nothing went out after it.',
            cols: ['Week', 'Quote', 'Created', 'Value', 'Rep', 'Open'],
            rows: sortBy(qt.filter(function (y) { return y.sent && y.followups === 0; }), function (y) { return y.created; }, true).map(function (x) {
                return [wk(x), x.no, x.created, money0(x.value), x.rep || '\u2014', L('quote', x.id)];
            }) };
        var tg = C.tagged, t1n = tg.filter(function (x) { return tier(x) === 'Order accuracy'; }).length;
        var tgFrom = tg.length ? tg.reduce(function (a, x) { return x.created < a ? x.created : a; }, '9999').slice(0, 10) : '';
        q.order_accuracy = { title: 'Every issue-tagged ticket \u2014 ' + (tg.length ? dayMonth(tgFrom) + ' to ' + dayMonth(C.weeks[3][1]) + ' and since' : 'none in the window'),
            why: 'All ' + tg.length + ' tagged tickets, sorted so the order-accuracy ones come first. Only the '
                + t1n + ' marked "Order accuracy" count against the measurable; the rest are shown '
                + 'because they are the reason the raw tagged count is not the error count.',
            cols: ['Tier', 'Created', 'Ticket', 'Subject', 'Issue', 'Sub-issue', 'Tagged by', 'Open'],
            rows: sortBy(sortBy(tg, function (y) { return y.created; }), function (y) { return tier(y) !== 'Order accuracy' ? 1 : 0; }).map(function (x) {
                return [tier(x), cut(x.created, 16), x.casenumber, cut(safe(x.title), 46),
                    ISSNAME[x.issue] != null ? ISSNAME[x.issue] : String(x.issue), SUBNAME[x.sub] || '\u2014',
                    REPNAME[x.assigned] || 'unassigned', L('case', x.id)];
            }) };
        q.calls_negative = { title: 'Calls that ended negative', why: 'Every one of these is meant to be reviewed.',
            cols: ['Week', 'Logged', 'Rep', 'Subject', 'Issue', 'Open'],
            rows: C.call.filter(function (x) { return x.negative; }).map(function (x) {
                return [wk(x), C.callWhen[x.id] || '', x.rep || '\u2014', safe(x.title), x.issue || '\u2014', L('call', x.id)];
            }) };
        var byIdle = function (list) { return sortBy(list, function (y) { return -y._idle; }); };
        q.open_stale = { title: 'Open tickets nobody has touched in over ' + STALE + ' business days',
            why: 'The whole open queue, oldest-idle first. Idle means nothing has happened to the '
                + 'record \u2014 no reply, no status change, no note \u2014 so this is unaffected by a reply '
                + 'being filed on the quote or the order instead of the ticket. Some of these are '
                + 'finished work that was never closed; those still need closing, because an open '
                + 'ticket is a promise to the customer that the system thinks is outstanding.',
            cols: ['Idle (bd)', 'Age (bd)', 'Opened', 'Assigned to', 'Status', 'Where the ball is', 'Customer', 'Subject', 'Open ticket'],
            rows: byIdle(op).map(function (x) {
                return [x._idle, x._age, cut(x.created, 10), x._label, stn(x.status), x._ballT, R.cname(x.company), cut(safe(x.title), 52), L('case', x.id)];
            }) };
        q.open_ball_ours = { title: 'Open tickets where the customer came back and nothing has gone out since',
            why: 'The closest thing to \u201cquote sent, no follow-up\u201d, and the reason it is a list '
                + 'rather than a score: it reads the last message ON THE TICKET, and this team '
                + 'files plenty of replies on the quote, the order or the customer record instead. '
                + 'Checked on the 22 that could be verified \u2014 14 had a human reply somewhere else. '
                + 'So work this list, do not judge anyone by its length.',
            cols: ['Idle (bd)', 'Age (bd)', 'Opened', 'Assigned to', 'Status', 'Customer', 'Subject', 'Open ticket'],
            rows: byIdle(op.filter(function (y) { return y._ballT === 'customer came back' || y._ballT === 'never replied to on the ticket'; })).map(function (x) {
                return [x._idle, x._age, cut(x.created, 10), x._label, stn(x.status), R.cname(x.company), cut(safe(x.title), 58), L('case', x.id)];
            }) };
        var domCust = C.domCust || {};
        var cc = C.catchall.map(function (x) {
            var v = catchallVerdict(x.dom, domCust), n = domCust[x.dom];
            return [v[0], [v[1], x.created, x.dom, cut(safe(x.title), 58), n ? n + ' record' + (n > 1 ? 's' : '') : '\u2014', L('case', x.id)]];
        });
        cc = sortBy(sortBy(cc, function (y) { return y[1][1]; }), function (y) { return y[0]; }).map(function (y) { return y[1]; });
        q.catchall = { title: 'Tickets that landed on a catch-all record instead of the customer',
            why: 'NetSuite attaches an inbound email to a customer by matching the SENDER ADDRESS '
                + 'to a contact record. Every one of these ' + C.catchall.length + ' failed that match, so the case fell '
                + 'to the default customer, C999 Anonymous (28480) or Royal Bag Inc (50200). Sorted so the fixable '
                + 'ones come first: where the sender\u2019s domain is already on a customer record, adding that '
                + 'person as a contact routes them correctly from the next email onward.',
            cols: ['Verdict', 'Created', 'Sender domain', 'Subject', 'Customer records on that domain', 'Open ticket'],
            rows: cc };
        q.colleague = { title: 'Answered by a colleague off the scorecard',
            why: 'A RoyalBag colleague replied inside two business days \u2014 procurement handling a '
                + 'proof approval, or bookkeeping on an invoice question. The customer heard back, '
                + 'so these count towards coverage. They are kept out of the speed rows on purpose: '
                + 'scoring a procurement rep\u2019s proof approval as a sales rep\u2019s response time would '
                + 'be wrong in both directions.',
            cols: ['Week', 'Received', 'Subject', 'Answered by', 'Business mins', 'Customer', 'Open'],
            rows: sortBy(C.colleague, function (y) { return y.in_at; }, true).map(function (x) {
                return [wk(x), x.in_at, cut(safe(x.subject), 62), x.by || '\u2014', x.colleague_mins, R.cname(x.cust), L('cust', x.cust)];
            }) };
        q.thread_gap = { title: 'Answered, but under a different subject line',
            why: 'A roster rep replied to this customer inside two business days, but not in the '
                + 'same conversation \u2014 they changed the subject, or opened a fresh quote in reply. '
                + 'The customer heard back, so these count towards coverage. They are kept out of '
                + 'the speed rows because pairing the wrong reply to the wrong email would make the '
                + 'response time meaningless.',
            cols: ['Week', 'Received', 'Subject', 'Customer', 'Replied by', 'Within (bmin)', 'Open'],
            rows: sortBy(C.thread_gap, function (y) { return y.in_at; }, true).map(function (x) {
                return [wk(x), x.in_at, cut(safe(x.subject), 64), R.cname(x.cust), x.rep_other || '\u2014',
                    x.other_mins != null ? x.other_mins : null, L('cust', x.cust)];
            }) };
        var webConv = {};
        nc.forEach(function (y) { if (y.web) webConv[y.cust] = 1; });
        q.web_leads = { title: 'Records created with no sales rep \u2014 excluded from win rate',
            why: 'Records created with no lead source and no rep. They are mostly web and phone orders '
                + 'that entered as leads instead of as customers. Counting them distorts the team win '
                + 'rate, so they are excluded from both halves. Fixing the entry path at source removes '
                + 'the distortion permanently.',
            cols: ['Week', 'Customer', 'Created', 'Converted', 'First order', 'Open record'],
            rows: sortBy(ld.filter(function (y) { return y.web; }), function (y) { return y.created; }, true).map(function (x) {
                var f = null;
                for (var i = 0; i < nc.length; i++) if (nc[i].cust === x.cust) { f = nc[i]; break; }
                return [wk(x), R.cname(x.cust), x.created, webConv[x.cust] ? 'yes' : 'no', f ? money0(f.first_order) : '\u2014', L('cust', x.cust)];
            }) };
        q.commitments = { title: 'Commitments the AI heard on a call',
            why: 'A follow-up, a credit, a replacement or an operations review that a customer '
                + 'was told would happen. Nothing in NetSuite records whether it did \u2014 there is no '
                + 'completion flag on this field \u2014 so this is a queue to work through in the L10, '
                + 'not a score. Making it scoreable needs a close-out step on the call record.',
            cols: ['Week', 'Logged', 'Rep', 'Commitment', 'Subject', 'Open call'],
            rows: sortBy(rich.filter(function (y) { return ACT[y.action]; }), function (y) { return y.created; }, true).map(function (x) {
                return [x._week != null ? WLAB[x._week] : cut(x.created, 10), cut(x.created, 16), x._rep || 'unassigned', ACT[x.action], cut(safe(x.title), 52), L('call', x.id)];
            }) };
        q.ai_unscored = { title: 'Logged calls the AI never scored',
            why: 'Every sentiment figure on this board is computed on scored calls only. These '
                + 'calls are invisible to it \u2014 they are not neutral, they simply have no opinion '
                + 'attached. Until coverage is even across reps, compare the sentiment rows with '
                + 'that in mind rather than reading them as like for like.',
            cols: ['Week', 'Logged', 'Rep', 'Subject', 'Open call'],
            rows: sortBy(rich.filter(function (y) { return y.aiproc !== 'T'; }), function (y) { return y.created; }, true).map(function (x) {
                return [x._week != null ? WLAB[x._week] : cut(x.created, 10), cut(x.created, 16), x._rep || 'unassigned', cut(safe(x.title), 60), L('call', x.id)];
            }) };
        var uo = {};
        uo.open_noowner = { title: 'Open tickets nobody on the team owns',
            why: 'Open, ageing, and belonging to no one on this board. Most have no assignee at '
                + 'all; a few are assigned to someone off the sales roster, shown as \u201coff roster\u201d. '
                + 'Either way nobody here is accountable, so they sit. This is a list to clear, '
                + 'not a measure \u2014 there is deliberately no score attached to it.',
            cols: ['Idle (bd)', 'Age (bd)', 'Opened', 'Assigned to', 'Status', 'Where the ball is', 'Customer', 'Subject', 'Open ticket'],
            rows: byIdle(op.filter(function (y) { return y._who == null; })).map(function (x) {
                return [x._idle, x._age, cut(x.created, 10), x._label, stn(x.status), x._ballT, R.cname(x.company), cut(safe(x.title), 58), L('case', x.id)];
            }) };
        return { queues: q, unowned: uo };
    }

    /** "The records behind this list begin <date>" on every list, from its own rows. */
    var DATE_HEAD = /^\d{4}-\d{2}-\d{2}/;
    function addFloors(qs) {
        Object.keys(qs || {}).forEach(function (k) {
            var q = qs[k], f = null;
            if (!q || !q.rows) return;
            q.rows.forEach(function (r) {
                for (var i = 0; i < r.length; i++) {
                    if (typeof r[i] === 'string' && DATE_HEAD.test(r[i])) {
                        var d = r[i].slice(0, 10);
                        if (f == null || d < f) f = d;
                        break;
                    }
                }
            });
            if (f && q.floor == null) {
                q.floor = f;
                q.why = q.why + ' The records behind this list begin ' + f + ' \u2014 a date window reaching '
                    + 'further back than that cannot show more, because nothing older was pulled.';
            }
        });
        return qs;
    }

    function retNote_(retention) { return retNote(retention); }
    function retNote(retention) {
        var when = retention && retention.asOf ? dayMonth(retention.asOf) : 'today';
        return 'Computed live on the retention system\u2019s formula as of ' + when + ' \u2014 one position, '
            + 'not a weekly rate, so the four columns repeat it rather than pretending to a trend.';
    }

    function baseMeta(C, asOf) {
        var cw = closedWeeks(C.weeks);
        return { cw: cw, WLAB: C.weeks.map(weekLabel), meta: {
            closedWeeks: cw.idx, closedWhy: cw.why, asOf: asOf, weekRanges: C.weeks,
            span: [C.weeks[0][0], C.weeks[C.weeks.length - 1][1]] } };
    }
    function assign(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }

    /** A pod lead's page: own rows, pod rows, and a tab per pod member with their lists. */
    function podLeadPayload(who, C, R, retention, asOf) {
        var b = baseMeta(C, asOf), pod = POD_OF[who];
        var pay = personPayload(who, C, R, retention, asOf);
        var tr = teamRows(C, retention, b.cw.idx);
        pay.pod = tr.filter(function (r) { return r.owner === who && r.level === 'pod'; });
        pay.podName = pod;
        pay.podMembers = PODS[pod].members.filter(function (m) { return m !== who; });
        pay.members = {};
        pay.podMembers.forEach(function (m) {
            pay.members[m] = { name: FULL[m], rows: rowsFor(m, C, retention, b.cw.idx),
                queues: addFloors(queuesFor(m, C, R, b.WLAB).mine) };
        });
        pay.solo = false;
        return pay;
    }

    /** The Director's page \u2014 exactly the shape personal.py's build_sara() emits. */
    function directorPayload(C, R, retention, asOf) {
        var b = baseMeta(C, asOf);
        var tr = teamRows(C, retention, b.cw.idx);
        var TQ = teamQueues(C, R, b.WLAB);
        var keys = ['unanswered', 'untraceable', 'real_miss', 'leads_untouched', 'quotes_unsent', 'quotes_nofollow',
            'order_accuracy', 'calls_negative', 'open_stale', 'open_ball_ours', 'catchall', 'colleague', 'thread_gap',
            'web_leads', 'commitments', 'ai_unscored'];
        var queues = {};
        keys.forEach(function (k) { if (TQ.queues[k]) queues[k] = TQ.queues[k]; });
        var pay = assign({ me: 'Sara', meFull: FULL.Sara, weeks: b.WLAB,
            individual: tr.filter(function (r) { return r.owner === 'Sara' && r.level === 'team'; }),
            pod: [], podName: null, podMembers: [], members: {},
            queues: addFloors(queues), unowned: addFloors(TQ.unowned), solo: false }, b.meta);
        Object.keys(PODS).forEach(function (p) {
            var v = PODS[p];
            pay.members['pod_' + p] = { name: p + ' pod \u2014 ' + v.members.map(function (m) { return FULL[m].split(' ')[0]; }).join(', '),
                rows: tr.filter(function (r) { return r.owner === v.lead && r.level === 'pod'; }), queues: null };
        });
        EVERYONE.forEach(function (m) {
            pay.members['who_' + m] = { name: FULL[m] + (m === 'Riki' || m === 'Moshe' ? ' \u2014 measured, not pod-scored' : ' \u2014 ' + (POD_OF[m] || '') + ' pod'),
                rows: rowsFor(m, C, retention, b.cw.idx), queues: null };
        });
        return pay;
    }

    /** Every id a page will need a name / number for: walk the payload builders with recording resolvers. */
    function referencedIdsFor(kind, who, C, retention) {
        var ids = { cust: {}, 'case': {}, tran: {} };
        var R = { cname: function (i) { if (i != null) ids.cust[i] = 1; return ''; },
            caseNo: function (i) { ids['case'][i] = 1; return ''; },
            tranInfo: function (i) { ids.tran[i] = 1; return null; },
            link: function () { return ''; } };
        if (kind === 'director') directorPayload(C, R, retention, '');
        else if (kind === 'podlead') podLeadPayload(who, C, R, retention, '');
        else personPayload(who, C, R, retention, '');
        return { cust: Object.keys(ids.cust).map(Number), 'case': Object.keys(ids['case']).map(Number),
            tran: Object.keys(ids.tran).map(Number) };
    }

    // =====================================================================
    //  retention \u2014 a live port of the retention-pod processor (process_pod.py)
    //  Same statuses, same 0.4 x accounts + 0.6 x revenue composite, same cadence
    //  rule, same snooze/note exclusions. Positions, never weekly rates.
    // =====================================================================
    // Global account exceptions from the retention skill. "snooze" hides the account
    // (counted retained, never flagged); "note" keeps it visible. owner scopes a match.
    var RET_EXCLUSIONS = [
        { name: 'Mario Badescu', owner: 'Mendy Eagle', type: 'snooze', until: '2026-12-31' },
        { name: 'SMM Holdings LLC', owner: 'Mendy Eagle', type: 'snooze', until: null },
        { name: 'Oh Nuts', owner: 'Mendy Eagle', type: 'snooze', until: null },
        { name: 'AMR Management', owner: 'Mendy Eagle', type: 'snooze', until: null },
        { name: 'FAROUK Systems', owner: 'Mendy Eagle', type: 'snooze', until: '2026-08-31' },
        { name: 'Spice Kingdom', owner: 'Mendy Eagle', type: 'snooze', until: '2026-09-30' },
        { name: 'Richard Bauer & Co.', owner: 'Mendy Eagle', type: 'note', until: null },
        { name: 'Robin Industries', owner: 'Renee Goldenberg', type: 'snooze', until: '2026-10-15' },
        { name: 'Bag Factory', owner: 'Renee Goldenberg', type: 'snooze', until: null },
        { name: 'Crown Staple', owner: 'Renee Goldenberg', type: 'snooze', until: null },
        { name: 'Wilmington Fibre', owner: 'Renee Goldenberg', type: 'snooze', until: null },
        { name: 'Ken Craft', owner: 'Renee Goldenberg', type: 'snooze', until: null },
        { name: 'Tara & Sons', owner: 'Renee Goldenberg', type: 'snooze', until: null },
        { name: 'Matachi', owner: 'Renee Goldenberg', type: 'snooze', until: null },
        { name: 'Smith & Warren', owner: 'Renee Goldenberg', type: 'note', until: null },
        { name: 'Precision Resource', owner: 'Renee Goldenberg', type: 'note', until: null },
        { name: 'Lions Services', owner: 'Fay Singer', type: 'note', until: null },
        { name: 'Tedder Industries', owner: 'Fay Singer', type: 'snooze', until: '2026-10-01' },
        { name: 'The Smart Group', owner: 'Fay Singer', type: 'snooze', until: null },
        { name: 'Schoolhouse Supplies', owner: 'Fay Singer', type: 'snooze', until: '2027-06-01' },
        { name: 'Selkirk Sport', owner: 'Fay Singer', type: 'snooze', until: '2026-10-01' }
    ];
    var RET_REPS = ['Fay', 'Mendy', 'Taylor', 'Gianna', 'Sruly', 'Renee', 'Riki'];   // Moshe holds no book
    var RET_IDS = { 749: 'Fay', 8: 'Mendy', 496615: 'Taylor', 1006783: 'Gianna', 317501: 'Sruly', 21: 'Renee', 20: 'Riki' };

    function mean(a) { var s = 0; a.forEach(function (x) { s += x; }); return s / a.length; }
    function stdev(a) {                      // sample standard deviation, like statistics.stdev
        var m = mean(a), s = 0; a.forEach(function (x) { s += (x - m) * (x - m); }); return Math.sqrt(s / (a.length - 1));
    }
    function ymDiff(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
    function daysBetween(a, b) { return Math.floor((b - a) / DAY); }   // timedelta.days

    /**
     * agg: [{customer, ownerid, kind:'invoice'|'salesorder', ym, amt, cnt, maxd:'YYYY-MM-DD'}]
     * activity: [{customer, salesrep, date:'YYYY-MM-DD'|null}]
     * todayIso: the office date. Returns {asOf, reps:{'Full Name':view}, pods:{pod:view}}.
     */
    function retentionCompute(agg, activity, todayIso) {
        var TODAY = P(todayIso), CY = +todayIso.slice(0, 4), PY = CY - 1, PY2 = CY - 2, PY3 = CY - 3;
        var MONTHS_CY = Math.max(1, +todayIso.slice(5, 7) - 1);
        var EX = RET_EXCLUSIONS.filter(function (e) { return e.type === 'note' || e.until == null || P(e.until) > TODAY; })
            .map(function (e) { return { name: e.name.toLowerCase(), owner: (e.owner || '').toLowerCase(), type: e.type }; });
        function exMatch(e, cname, owner) {
            var cl = String(cname).trim().toLowerCase();
            if (!(cl.indexOf(e.name) >= 0 || e.name.indexOf(cl) >= 0)) return false;
            if (e.owner) { var co = String(owner || '').toLowerCase(); if (e.owner.indexOf(co) < 0 && co.indexOf(e.owner) < 0) return false; }
            return true;
        }
        var tx = {}, ownRev = {}, ownCnt = {};
        agg.forEach(function (r) {
            var y = +String(r.maxd).slice(0, 4);
            if (r.kind === 'invoice' && y > PY2) return;
            if (r.kind !== 'invoice' && y < PY) return;
            var cust = String(r.customer || '').trim();
            if (r.kind === 'invoice') cust = cust.replace(/^C\d+\s+/, '');
            if (!cust) return;
            var owner = RET_IDS[r.ownerid] ? FULL[RET_IDS[r.ownerid]] : '\u2014';
            var n = Math.max(1, num(r.cnt) || 1), amt = (num(r.amt) || 0) / n, d = P(String(r.maxd).slice(0, 10));
            tx[cust] = tx[cust] || [];
            for (var i = 0; i < n; i++) tx[cust].push({ d: d, ym: String(r.maxd).slice(0, 7), amt: amt });
            ownRev[cust] = ownRev[cust] || {}; ownCnt[cust] = ownCnt[cust] || {};
            ownRev[cust][owner] = (ownRev[cust][owner] || 0) + (num(r.amt) || 0);
            ownCnt[cust][owner] = (ownCnt[cust][owner] || 0) + n;
        });
        var act = {};
        activity.forEach(function (a) {
            var c = String(a.customer || '').trim();
            if (!c || !RET_IDS[a.salesrep]) return;
            var d = a.date ? P(a.date) : null;
            if (d != null && d > TODAY) d = null;
            if (!(c in act)) act[c] = d;
            else if (d != null && (act[c] == null || d > act[c])) act[c] = d;
        });
        var custs = [];
        Object.keys(tx).forEach(function (name) {
            var t = sortBy(tx[name], function (x) { return x.d; });
            var byYear = {}, monthly = {};
            t.forEach(function (x) { var y = new Date(x.d).getUTCFullYear(); byYear[y] = (byYear[y] || 0) + x.amt; monthly[x.ym] = (monthly[x.ym] || 0) + x.amt; });
            var first = t[0].d, last = t[t.length - 1].d, n = t.length;
            var months = Object.keys(monthly).sort();
            var gaps = [];
            for (var i = 0; i + 1 < months.length; i++) gaps.push(ymDiff(months[i], months[i + 1]));
            var avgGap = gaps.length ? mean(gaps) : null;
            var cvGap = (avgGap && gaps.length >= 2) ? stdev(gaps) / avgGap : 0;
            var ma = months.map(function (k) { return monthly[k]; });
            var cvAmt = 0;
            if (ma.length >= 2) { var mm = mean(ma); cvAmt = mm > 0 ? stdev(ma) / mm : 0; }
            var expNext = avgGap ? last + avgGap * 30.44 * DAY : null;
            var r1 = pyRound(byYear[PY] || 0, 2), r2 = pyRound(byYear[PY2] || 0, 2), r3 = pyRound(byYear[PY3] || 0, 2);
            var ytd = pyRound(byYear[CY] || 0, 2), ann = ytd > 0 ? pyRound(ytd / MONTHS_CY * 12, 2) : 0;
            var firstYear = new Date(first).getUTCFullYear(), st;
            if (firstYear >= CY && !(r1 > 0 || r2 > 0 || r3 > 0)) st = 'new';
            else if (n === 1 && firstYear === PY) st = 'one_time_py';
            else if (n === 1) st = 'one_time_old';
            else if (ytd > 0) {
                if (r1 > 0) { var ratio = ann / r1; st = ratio >= 1.15 ? 'growing' : ratio >= 0.70 ? 'on_track' : 'declining'; }
                else st = 'on_track';
            } else {
                var since = daysBetween(last, TODAY) / 30.44;
                if (since > 12) st = 'gone';
                else if (expNext != null && expNext > TODAY) st = 'not_yet_due';
                else if (expNext != null) {
                    var over = daysBetween(expNext, TODAY) / 30.44, thr = avgGap ? avgGap * 1.5 : 4.5;
                    st = over >= thr ? 'significantly_overdue' : 'overdue';
                } else st = since > 6 ? 'significantly_overdue' : 'overdue';
            }
            if (months.length >= 3 && cvGap > 1.0 && cvAmt > 1.0 && st !== 'new' && st !== 'one_time_py' && st !== 'one_time_old') st = 'erratic';
            var owner = '\u2014', best = null;
            Object.keys(ownRev[name] || {}).forEach(function (o) {
                var k = [ownRev[name][o], ownCnt[name][o] || 0];
                if (!best || k[0] > best[0] || (k[0] === best[0] && k[1] > best[1])) { best = k; owner = o; }
            });
            var snooze = EX.some(function (e) { return e.type !== 'note' && exMatch(e, name, owner); });
            if (snooze) st = 'snoozed';
            var ad = act[name], cad;
            if (ad == null) cad = 'no_activity';
            else cad = daysBetween(ad, TODAY) / 30.44 <= (avgGap || 3.0) ? 'in_cadence' : 'out_of_cadence';
            custs.push({ name: name, owner: owner, n: n, r1: r1, r2: r2, status: st, cadence: cad });
        });
        var RETAINED = { growing: 1, on_track: 1, not_yet_due: 1, 'new': 1, snoozed: 1 };
        function view(sub) {
            var ma = sub.filter(function (c) { return c.n >= 2 && (c.r2 > 0 || c.r1 > 0); });
            var ret = ma.filter(function (c) { return RETAINED[c.status]; });
            var ap = ma.length ? ret.length / ma.length * 100 : 0;
            var t = 0, tr = 0; ma.forEach(function (c) { t += c.r1; }); ret.forEach(function (c) { tr += c.r1; });
            var rp = t > 0 ? tr / t * 100 : 0;
            function cnt(f) { return sub.filter(f).length; }
            return { composite: pyRound(0.4 * ap + 0.6 * rp, 1), acct_pct: pyRound(ap, 1), rev_pct: pyRound(rp, 1),
                ma: ma.length, ret: ret.length, accounts: sub.length,
                overdue_n: cnt(function (c) { return c.status === 'overdue' || c.status === 'significantly_overdue'; }),
                cin: cnt(function (c) { return c.cadence === 'in_cadence'; }),
                cout: cnt(function (c) { return c.cadence === 'out_of_cadence'; }),
                cno: cnt(function (c) { return c.cadence === 'no_activity'; }) };
        }
        var out = { asOf: todayIso, reps: {}, pods: {} };
        RET_REPS.forEach(function (r) { out.reps[FULL[r]] = view(custs.filter(function (c) { return c.owner === FULL[r]; })); });
        Object.keys(PODS).forEach(function (p) {
            var fn = PODS[p].members.map(function (m) { return FULL[m]; });
            out.pods[p] = view(custs.filter(function (c) { return fn.indexOf(c.owner) >= 0; }));
        });
        return out;
    }

    return {
        // config
        IDS: IDS, REP: REP, FULL: FULL, PODS: PODS, EVERYONE: EVERYONE, EMPLOYEE_TO_REP: EMPLOYEE_TO_REP,
        CATCHALL: CATCHALL, NAME_OVERRIDE: NAME_OVERRIDE, CAL_LAST: CAL.last, CAL_FIRST: CAL.first,
        // clock + window
        P: P, iso: iso, fmtMin: fmtMin, bmin: bmin, clockStart: clockStart, weeksEnding: weeksEnding,
        weekLabel: weekLabel, closedWeeks: closedWeeks, utcToEt: utcToEtDst, pyRound: pyRound, DAY: DAY,
        // pipeline
        classify: classify, norm: norm, safe: safe,
        compute: compute, rowsFor: rowsFor, queuesFor: queuesFor, referencedIds: referencedIds,
        personPayload: personPayload, leakGate: leakGate, teamRows: teamRows, teamQueues: teamQueues,
        podLeadPayload: podLeadPayload, directorPayload: directorPayload, referencedIdsFor: referencedIdsFor,
        addFloors: addFloors, tier: tier, retentionCompute: retentionCompute, RET_IDS: RET_IDS, FREEMAIL: FREEMAIL, MACHINE_DOM: MACHINE_DOM, POD_OF: POD_OF, HVT: HVT
    };
})(CAL);

    var PAGEMOD = (function () {
    var HEAD = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Royal Bag &middot; __TITLE__ &middot; scorecard</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500&family=Inter:wght@400;600&display=swap\" rel=\"stylesheet\">\n<style>\n:root{\n --display:\"Space Grotesk\",ui-sans-serif,system-ui,sans-serif;\n --body:\"Inter\",ui-sans-serif,system-ui,-apple-system,sans-serif;\n --paper:#EDF0F3; --card:#FFFFFF; --ink:#101418; --muted:#6E7A87; --faint:#98A3AE;\n --rule:#E1E7EC; --accent:#0F5F63; --accent-soft:#E4EEEE; --radius:14px;\n --good:#0ca30c; --warn:#fab219; --crit:#d03b3b;\n --goodbg:#E8F5E9; --warnbg:#FDF4E0; --critbg:#FBEAEA; --nilbg:#F2F5F7;\n}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 var(--body);\n padding:32px 22px 70px;-webkit-text-size-adjust:100%}\n.wrap{max-width:1140px;margin:0 auto}\nh1{font-family:var(--display);font-size:26px;font-weight:500;letter-spacing:-.02em;margin:0 0 4px}\n.sub{font-size:13.5px;color:var(--muted);margin:0 0 4px}\n.stamp{font-family:var(--display);font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;\n color:var(--faint);margin-bottom:18px}\nh2{font-family:var(--display);font-size:12.5px;font-weight:500;letter-spacing:.1em;\n text-transform:uppercase;color:var(--muted);margin:26px 0 10px}\nh3{font-family:var(--display);font-size:15px;font-weight:500;letter-spacing:-.01em;margin:0 0 6px}\n.lede{font-size:13.5px;color:var(--muted);margin:0 0 14px;max-width:76ch}\n.card{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);\n padding:19px 21px 17px;margin-bottom:15px}\n.controls{position:sticky;top:0;z-index:5;background:var(--paper);padding:10px 0 12px;\n display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--rule);\n margin-bottom:6px}\nselect,input[type=search]{font:inherit;font-size:13.5px;padding:7px 11px;border:1px solid var(--rule);\n border-radius:9px;background:var(--card);color:var(--ink)}\n.tabs{display:flex;gap:2px;flex-wrap:wrap;margin:18px 0 0;border-bottom:1px solid var(--rule)}\n.tabs button{font-family:var(--display);font-size:12px;font-weight:500;letter-spacing:.08em;\n text-transform:uppercase;padding:10px 15px;border:0;background:none;color:var(--muted);\n cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}\n.tabs button:hover{color:var(--ink)}\n.tabs button[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent)}\n.hid{display:none}\n.pane{display:none;padding-top:18px}.pane.on{display:block}\n.digctl{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:14px 0}\n.digctl select,.digctl input[type=search],.digctl input[type=date]{\n  padding:7px 10px;border:1px solid var(--rule);border-radius:9px;background:var(--card);\n  color:var(--ink);font:inherit;font-size:13px}\n.digctl select{min-width:300px;max-width:100%}\n.digctl input[type=search]{flex:1;min-width:190px}\n.digctl label{font-size:12px;color:var(--muted)}\n.pre button{padding:5px 10px;margin-right:4px;border:1px solid var(--rule);border-radius:8px;\n  background:var(--card);color:var(--muted);font:inherit;font-size:12px;cursor:pointer}\n.pre button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}\n.dcount{font-size:12px;color:var(--muted);margin-left:auto}\n#dwhy{color:var(--muted);font-size:13.5px;max-width:74ch;margin:.3em 0 1em}\ntable{border-collapse:collapse;width:100%;font-size:13px}\nth,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--rule);vertical-align:top}\nth{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);\n position:sticky;top:0;background:var(--card)}\ntd.n,th.n{text-align:right;font-variant-numeric:tabular-nums}\ntbody tr:hover{background:var(--nilbg)}\n.big{font-family:var(--display);font-size:33px;font-weight:500;letter-spacing:-.03em;line-height:1.05}\n.lab{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}\n.foot{font-size:11.5px;color:var(--muted);margin-top:5px}\n.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin:4px 0 6px}\n.tile{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);padding:16px 18px}\n.pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;margin-left:8px}\n.ok{background:var(--goodbg);color:var(--good)} .wa{background:var(--warnbg);color:#8a6100}\n.cr{background:var(--critbg);color:var(--crit)} .nu{background:var(--nilbg);color:var(--faint)}\n.cell{display:inline-block;min-width:56px;text-align:right;padding:3px 8px;border-radius:6px;\n font-variant-numeric:tabular-nums;font-weight:600}\n.note{background:var(--warnbg);border-left:3px solid var(--warn);padding:9px 12px;\n border-radius:0 8px 8px 0;font-size:12.5px;color:var(--muted);margin-top:7px;max-width:76ch}\n.gap{border:1px dashed var(--rule);border-radius:10px;padding:13px 15px;margin:12px 0;\n font-size:13px;color:var(--muted);background:var(--card)}\n.mid{font-size:12px;color:var(--faint)}\na{color:var(--accent)}\na.open{text-decoration:none;font-size:11.5px;padding:3px 9px;border:1px solid var(--rule);\n border-radius:7px;white-space:nowrap;display:inline-block;color:var(--accent)}\na.open:hover{background:var(--accent-soft)}\n.tall{max-height:62vh;overflow:auto;border:1px solid var(--rule);border-radius:var(--radius);\n background:var(--card)}\n.scroll{overflow-x:auto}\n.enter{background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--radius);\n padding:17px 19px;margin-bottom:16px}\n.enter h3{color:var(--accent)}\n.enter table{font-size:13.5px}\n.enter th{background:transparent}\n.empty{padding:26px;text-align:center;color:var(--faint);font-size:13.5px}\n.credit{margin-top:36px;padding-top:15px;border-top:1px solid var(--rule);\n font-size:12px;color:var(--faint)}\n@media(max-width:700px){body{padding:20px 14px 50px}h1{font-size:21px}.big{font-size:27px}}\n</style></head><body><div class=\"wrap\">\n";
    var JS = "\n<script>\nconst D = __PAYLOAD__;\nconst $ = s => document.querySelector(s);\nconst el = (t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;\n  if(x!==undefined)n.textContent=x;return n;};\n/* The week column to highlight on the All view. Follows the same rule as the\n   default window: the last week that actually had working hours. */\nlet WEEK = D.weeks.length-1;\n\nfunction cls(v,t,u,inv){\n  if(v==null||t==null) return 'nu';\n  if(inv) return v<t?'ok':(v===t?'wa':'cr');\n  if(u==='count') return v>=t?'ok':(v>0?'wa':'cr');\n  if(u==='$') return v>=t?'ok':(v>=t*0.7?'wa':'cr');\n  return v>=t?'ok':(v>=t-15?'wa':'cr');\n}\nfunction fmt(v,u){\n  if(v==null) return '\u2014';\n  if(u==='$') return '$'+Math.round(v).toLocaleString();\n  if(u==='count') return String(v);\n  return v+'%';\n}\n\n/* The numbers to type into Success.co. These follow the date window like everything\n   else, so what you read here is what the rest of the page is showing. */\nfunction enterBox(mount, rows, heading){\n  const box = el('div','enter');\n  const lbl = RANGE ? (RANGE[0]+' to '+RANGE[1]) : D.weeks[WEEK];\n  box.appendChild(el('h3', null, heading));\n  box.appendChild(el('p','lede','These are the figures for '+lbl+\n    '. Type them straight into Success.co.'));\n  const t=el('table'), th=el('thead'), tr=el('tr');\n  ['Measurable','Target','Your number'].forEach((h,i)=>tr.appendChild(el('th',i==2?'n':null,h)));\n  th.appendChild(tr); t.appendChild(th);\n  const tb=el('tbody');\n  rows.forEach(r=>{\n    const row=el('tr');\n    row.appendChild(el('td',null,r.name));\n    row.appendChild(el('td',null,r.target==null?'\u2014':fmt(r.target,r.unit)));\n    const td=el('td','n');\n    const v = RANGE\n      ? (r.obs==null ? null : foldObs(r.obs, r.mode, RANGE[0], RANGE[1]))\n      : r.weekly[WEEK];\n    const sp = el('span','cell '+cls(v,r.target,r.unit,r.invert), fmt(v,r.unit));\n    if(RANGE && r.obs==null)\n      sp.title='A current position, not a weekly rate \u2014 it does not rescope to a window.';\n    td.appendChild(sp);\n    row.appendChild(td); tb.appendChild(row);\n  });\n  t.appendChild(tb); box.appendChild(t);\n  mount.appendChild(box);\n}\n\nfunction rowTable(mount, rows){\n  if(!rows.length){ mount.appendChild(el('div','empty','No measurables on this view.')); return; }\n  const t=el('table'), th=el('thead'), tr=el('tr');\n  const heads = RANGE ? ['Measurable','Target', RANGE[0]+' \u2192 '+RANGE[1]]\n                      : ['Measurable','Target',...D.weeks];\n  heads.forEach((h,i)=>tr.appendChild(el('th',i>=2?'n':null,h)));\n  th.appendChild(tr); t.appendChild(th);\n  const tb=el('tbody');\n  rows.forEach(r=>{\n    const row=el('tr');\n    const c=el('td');\n    c.appendChild(el('strong',null,r.name));\n    c.appendChild(document.createElement('br'));\n    c.appendChild(el('span','mid', r.mid+' \u00b7 '+r.detail));\n    if(r.note) c.appendChild(el('div','note', r.note));\n    row.appendChild(c);\n    row.appendChild(el('td','n', r.target==null?'\u2014':fmt(r.target,r.unit)));\n    if(RANGE){\n      const td=el('td','n');\n      if(r.obs==null){\n        // A position, not a rate -- retention score, the open backlog. There is no\n        // honest way to recompute it for an arbitrary window, so it says so.\n        const sp=el('span','cell','\u2014');\n        sp.title='This is a current position, not a weekly rate \u2014 it does not rescope.';\n        td.appendChild(sp);\n      } else {\n        const v=foldObs(r.obs, r.mode, RANGE[0], RANGE[1]);\n        td.appendChild(el('span','cell '+cls(v,r.target,r.unit,r.invert), fmt(v,r.unit)));\n      }\n      row.appendChild(td);\n    } else {\n      r.weekly.forEach((v,i)=>{\n        const td=el('td','n');\n        const sp=el('span','cell '+cls(v,r.target,r.unit,r.invert), fmt(v,r.unit));\n        if(i===WEEK) sp.style.outline='2px solid var(--accent)';\n        if((D.closedWeeks||[]).indexOf(i)>=0){\n          sp.textContent='\u2014'; sp.className='cell';\n          sp.title='Office closed all week'+(((D.closedWhy||{})[i])?' \u2014 '+D.closedWhy[i]:'')+'. No working hours, so nothing to measure.';\n        }\n        td.appendChild(sp); row.appendChild(td);\n      });\n    }\n    tb.appendChild(row);\n  });\n  t.appendChild(tb);\n  const s=el('div','scroll'); s.appendChild(t); mount.appendChild(s);\n}\n\nfunction queueBlock(mount, q, key){\n  const all = q.rows;\n  const card = el('div','card');\n  card.appendChild(el('h3', null, q.title));\n  card.appendChild(el('p','lede', q.why));\n  const bar = el('div'); bar.style.cssText='display:flex;gap:9px;align-items:center;margin-bottom:10px';\n  const cnt = el('span','mid'); bar.appendChild(cnt);\n  card.appendChild(bar);\n  const host = el('div','tall'); card.appendChild(host);\n  function draw(){\n    // The one global window decides this list too -- no second picker to disagree with it.\n    const rows = all.filter(inRange);\n    cnt.textContent = rows.length+' of '+all.length+' row'+(all.length===1?'':'s')\n                    + (RANGE ? ' in this window' : '');\n    host.innerHTML='';\n    if(!rows.length){ host.appendChild(el('div','empty',\n      RANGE ? 'Nothing in this date window.' : 'Nothing here \u2014 clean sheet.')); return; }\n    const t=el('table'), th=el('thead'), tr=el('tr');\n    q.cols.forEach(c=>tr.appendChild(el('th',null,c)));\n    th.appendChild(tr); t.appendChild(th);\n    const tb=el('tbody');\n    rows.slice(0,400).forEach(r=>{\n      const row=el('tr');\n      r.forEach(cell=>{\n        const td=el('td');\n        if(typeof cell==='string' && cell.startsWith('http')){\n          const a=el('a','open','NetSuite \u2192'); a.href=cell; a.target='_blank'; a.rel='noopener';\n          td.appendChild(a);\n        } else td.textContent = cell==null?'':cell;\n        row.appendChild(td);\n      });\n      tb.appendChild(row);\n    });\n    t.appendChild(tb); host.appendChild(t);\n  }\n  draw();\n  mount.appendChild(card);\n  return ()=>draw();\n}\n\n/* ---- period filter ------------------------------------------------------\n   Every row ships its own observations as [date, numerator, denominator], with\n   the business-hours arithmetic already applied upstream. So rescoping a number\n   is a date comparison and a sum -- the clock, the holiday calendar and the\n   closure rules are never re-implemented here and cannot drift from the build.\n   This fold was cross-checked against all 198 precomputed weekly figures. */\nvar RANGE = null;          // [start, end] inclusive, or null for \"All\"\n\n/* One date rule for the whole page. Every list is filtered by scanning its row for\n   a YYYY-MM-DD and comparing; every scorecard row is folded over the same window.\n   Sara, 9 Oct: one filter on every tab, not three that disagree. */\nvar DATE_RE = /(\\d{4}-\\d{2}-\\d{2})/;\nfunction rowDate(r){\n  for(var i=0;i<r.length;i++){\n    var c=r[i];\n    if(typeof c==='string'){\n      var m=c.match(DATE_RE);\n      if(m && c.indexOf('netsuite.com')<0) return m[1];   // links carry digits too\n    }\n  }\n  return null;\n}\nfunction inRange(r){\n  if(!RANGE) return true;\n  var d=rowDate(r);\n  if(!d) return false;                 // undated row cannot be placed in a window\n  return d>=RANGE[0] && d<=RANGE[1];\n}\n\nfunction rnd(x){const f=Math.floor(x);return (x-f===0.5)?(f%2===0?f:f+1):Math.round(x);}\nfunction foldObs(o, mode, a, b){\n  let n=0, den=0;\n  for(let i=0;i<o.length;i++){\n    const d=o[i][0];\n    if(!d) continue;\n    if(a && d<a) continue;\n    if(b && d>b) continue;\n    n += o[i][1]; den += o[i][2];\n  }\n  if(mode==='pct') return den ? rnd(n/den*100) : null;\n  return mode==='sum' ? rnd(n) : n;\n}\n\n/* ---- the one date filter ------------------------------------------------\n   Sara, 9 Oct: the same presets on every tab, defaulting to last week.\n   \"Last week\" means the most recent COMPLETED week that had working hours. The\n   plain last calendar week can be a full closure -- 28 Sep-4 Oct 2026 was Succos --\n   and defaulting to it opens the file on a board of dashes that reads as broken.\n   Skipping it is one line; the label always names the window it landed on, and\n   says so when a closed week was stepped over. Set SKIP_CLOSED=false for strict\n   last-calendar-week. */\nvar SKIP_CLOSED = true;\n\nfunction lastScoredWeek(){   /* also sets which column the All view outlines */\n  const wr = D.weekRanges || [], cw = D.closedWeeks || [];\n  for(let i=wr.length-1; i>=0; i--){\n    if(SKIP_CLOSED && cw.indexOf(i)>=0) continue;\n    return i;\n  }\n  return -1;\n}\n\nfunction iso(d){ return d.toISOString().slice(0,10); }\n\nfunction applyRange(kind){\n  const f=$('#pf'), t=$('#pt'), custom = kind==='c';\n  f.classList.toggle('hid', !custom); t.classList.toggle('hid', !custom);\n  let lab='';\n  if(kind==='all'){\n    RANGE=null;\n    lab='All four weeks \u00b7 '+D.span[0]+' to '+D.span[1]+' \u00b7 trend by week';\n  } else if(kind==='lw'){\n    const i=lastScoredWeek();\n    if(i<0){ RANGE=null; lab='No week with working hours in range.'; }\n    else {\n      RANGE=D.weekRanges[i].slice();\n      lab='Last week \u00b7 '+RANGE[0]+' to '+RANGE[1];\n      const skipped=(D.weekRanges.length-1)-i;\n      if(skipped>0) lab+=' \u2014 the '+(skipped===1?'week':skipped+' weeks')+\n        ' after it had no working hours (office closed), so nothing to show there';\n    }\n  } else if(custom){\n    RANGE = f.value ? [f.value, t.value || D.asOf] : null;\n    lab = RANGE ? ('Showing '+RANGE[0]+' to '+RANGE[1]) : 'Pick a start date';\n  } else {\n    const n=+kind, st=new Date(D.asOf); st.setDate(st.getDate()-n);\n    RANGE=[iso(st), D.asOf];\n    lab='Last '+n+' days \u00b7 '+RANGE[0]+' to '+RANGE[1];\n  }\n  $('#perlab').textContent=lab;\n  renderAll();\n}\n\nfunction rangeSetup(){\n  document.querySelectorAll('#rpre button').forEach(function(b){\n    b.onclick=function(){\n      document.querySelectorAll('#rpre button').forEach(function(x){\n        x.setAttribute('aria-pressed', x===b)});\n      applyRange(b.dataset.r);\n    };\n  });\n  [$('#pf'),$('#pt')].forEach(function(e){ e.onchange=function(){ applyRange('c'); }; });\n  const li = lastScoredWeek();\n  if(li >= 0) WEEK = li;                  // highlight the same week the default lands on\n  applyRange('lw');                       // the default, every time the file opens\n}\n\nconst redraws = [];\nfunction buildPane(id, rows, queues, heading, lede){\n  const m = $(id); m.innerHTML='';\n  if(lede) m.appendChild(el('p','lede', lede));\n  if(rows && rows.length) enterBox(m, rows, heading);\n  if(rows && rows.length){ m.appendChild(el('h2',null,'Four-week trend')); rowTable(m, rows); }\n  if(queues){\n    m.appendChild(el('h2',null,'What to look at'));\n    Object.keys(queues).forEach(k=>{ redraws.push(queueBlock(m, queues[k], k)); });\n  }\n}\n\n/* ---- Dig into the data -------------------------------------------------\n   Same shape as the team dashboard: one picker, a search box, a date window\n   with presets, and the records underneath. Sectioned into what is yours and\n   what belongs to nobody, because the second group is the one that rots. */\nvar DIG = null;\nfunction digSetup(){\n  const mine = D.queues || {}, un = D.unowned || {};\n  if(!Object.keys(mine).length && !Object.keys(un).length) return;\n  DIG = Object.assign({}, mine, un);\n  const sel = $('#dsel');\n  function group(label, obj){\n    const keys = Object.keys(obj);\n    if(!keys.length) return;\n    const g = el('optgroup'); g.label = label;\n    keys.forEach(function(k){\n      const o = el('option'); o.value = k;\n      o.dataset.base = obj[k].title;      // count is filled in by digCounts()\n      g.appendChild(o);\n    });\n    sel.appendChild(g);\n  }\n  group('Yours to work', mine);\n  group('Nobody owns these', un);\n  sel.onchange = digDraw;\n  $('#dfind').oninput = digDraw;\n  digDraw();\n}\n\n/* The count beside each list is what the CURRENT window holds, not the all-time total.\n   It read as a fixed number before and contradicted the table underneath it. */\nfunction digCounts(){\n  const sel = $('#dsel');\n  if(!sel) return;\n  Array.prototype.forEach.call(sel.options, function(o){\n    const q = DIG[o.value];\n    if(!q || !o.dataset.base) return;\n    o.textContent = o.dataset.base + ' (' + q.rows.filter(inRange).length + ')';\n  });\n}\n\nfunction digDraw(){\n  const k = $('#dsel').value, q = DIG[k];\n  if(!q) return;\n  $('#dtitle').textContent = q.title;\n  $('#dwhy').textContent = q.why;\n  const term = $('#dfind').value.toLowerCase();\n  const rows = q.rows.filter(function(r){\n    if(term && !r.join(' ').toLowerCase().includes(term)) return false;\n    return inRange(r);\n  });\n  $('#dcount').textContent = rows.length + ' of ' + q.rows.length + ' records';\n  digCounts();\n  const host = $('#dtable'); host.innerHTML='';\n  const t = el('table'), th = el('thead'), tr = el('tr');\n  q.cols.forEach(function(c){ tr.appendChild(el('th',null,c)); });\n  th.appendChild(tr); t.appendChild(th);\n  const tb = el('tbody');\n  if(!rows.length){\n    const r0 = el('tr'), td = el('td',null,\n      RANGE ? 'Nothing in this date window.' : 'Nothing here \u2014 this queue is clear.');\n    td.colSpan = q.cols.length; r0.appendChild(td); tb.appendChild(r0);\n  }\n  rows.slice(0,800).forEach(function(r){\n    const row = el('tr');\n    r.forEach(function(cell,i){\n      const td = el('td');\n      if(typeof cell==='string' && cell.indexOf('http')===0){\n        const a2 = el('a',null,'open'); a2.href=cell; a2.target='_blank';\n        a2.rel='noopener'; td.appendChild(a2);\n      } else td.textContent = cell==null ? '' : cell;\n      row.appendChild(td);\n    });\n    tb.appendChild(row);\n  });\n  t.appendChild(tb); host.appendChild(t);\n}\n\nfunction renderAll(){\n  redraws.length=0;\n  buildPane('#p-me', D.individual, null,\n    'Enter these in Success.co',\n    'Your own measurables. Nobody else\u2019s numbers appear in this file.');\n  if(D.pod && D.pod.length){\n    buildPane('#p-pod', D.pod, null, 'Enter these pod numbers in Success.co',\n      'These count the whole pod\u2019s activity and are scored under your name.');\n  }\n  Object.keys(D.members||{}).forEach(m=>{\n    buildPane('#p-'+m, D.members[m].rows, D.members[m].queues, 'Their numbers this week',\n      D.members[m].name + ' \u2014 for you as pod lead. They have their own copy of this.');\n  });\n  if(DIG) digDraw();                      // the dig tab is on the same window as everything else\n}\n\ndocument.addEventListener('DOMContentLoaded',()=>{\n  digSetup();\n  rangeSetup();                           // calls renderAll() with the default window\n  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{\n    document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));\n    document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='p-'+b.dataset.t));\n  });\n});\n</script>\n";

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function safeJson(o) {
        return JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }

    var CONTROLS = '<div class="controls"><label class="lab">Dates</label>'
        + '<span id="rpre" class="pre">'
        + '<button data-r="lw" aria-pressed="true">Last week</button>'
        + '<button data-r="14">14d</button><button data-r="30">30d</button>'
        + '<button data-r="90">90d</button><button data-r="all">All</button>'
        + '<button data-r="c">Custom</button></span>'
        + '<input type="date" id="pf" class="hid"><input type="date" id="pt" class="hid">'
        + '<span class="mid" id="perlab"></span></div>'
        + '<p class="stamp">This window applies to every tab &mdash; the measurables, '
        + 'the lists underneath them and Dig into the data. Business hours only '
        + '(Mon&ndash;Thu 9&ndash;5, Fri 9&ndash;1 ET), holidays and closures excluded.</p>';
    function digPane(lede, ph) {
        return '<section class="pane" id="p-dig">'
            + '<p class="lede">' + lede + '</p>'
            + '<div class="digctl">'
            + '<select id="dsel"></select>'
            + '<input type="search" id="dfind" placeholder="Search &mdash; customer, subject, ' + ph + 'reference&hellip;">'
            + '</div>'
            + '<div class="digctl">'
            + '<span class="dcount" id="dcount"></span>'
            + '</div>'
            + '<h2 id="dtitle"></h2><p class="why" id="dwhy"></p>'
            + '<div id="dtable"></div></section>';
    }

    /**
     * The three layouts personal.py emits, from one payload shape:
     *   kind 'director' -> build_sara()   (team rows, a tab per pod and per person)
     *   kind 'podlead'  -> build(who, include_pod=True)
     *   kind 'rep'      -> build(who)
     * @param {Object} o  { kind, stamp, tzNote, notices:[string], adminBar: html|null }
     */
    function render(pay, o) {
        o = o || {};
        var kind = o.kind || 'rep', full = pay.meFull, tabs, panes, h1, sub, dig, credit;
        if (kind === 'director') {
            tabs = [['me', 'My team rows']];
            panes = ['<section class="pane on" id="p-me"></section>'];
            Object.keys(pay.members || {}).forEach(function (k) {
                var label = k.indexOf('pod_') === 0 ? k.slice(4) + ' pod' : String(pay.members[k].name).split(' ')[0];
                tabs.push([k, label]);
                panes.push('<section class="pane" id="p-' + esc(k) + '"></section>');
            });
            h1 = 'Weekly scorecard &middot; team';
            sub = 'Your rows to enter, then the same four weeks read by pod and by '
                + 'person. Every rep also has their own file showing only themselves.';
            dig = digPane('Every number on the board, with the records behind it. '
                + 'Pick a list, narrow it by date or search, and open any row in NetSuite. '
                + 'Each rep has the same tab on their own file, scoped to their work.', 'rep, ');
            credit = 'The phone, service and retention dashboards stay where they '
                + 'are &mdash; this does not try to replace them. It carries the scorecard rows and '
                + 'the evidence behind them, and you open those for the deep dive.';
        } else {
            tabs = [['me', 'My scorecard']];
            panes = ['<section class="pane on" id="p-me"></section>'];
            if (kind === 'podlead') {
                tabs.push(['pod', 'My pod']);
                panes.push('<section class="pane" id="p-pod"></section>');
                Object.keys(pay.members || {}).forEach(function (m) {
                    tabs.push([m, String(pay.members[m].name).split(' ')[0]]);
                    panes.push('<section class="pane" id="p-' + esc(m) + '"></section>');
                });
            }
            h1 = 'Weekly scorecard &middot; ' + esc(full);
            sub = kind === 'podlead'
                ? 'This file covers you and the ' + esc(pay.podName) + ' pod you lead. Each member also has their own copy.'
                : 'This file covers you only. No other rep\u2019s numbers, names or records appear anywhere in it.';
            dig = digPane('Every number on your scorecard has the records behind it here. '
                + 'Pick a list or search it; the date window at the top of the page applies here too. Open any row straight in '
                + 'NetSuite. The second group belongs to nobody &mdash; those are the ones that '
                + 'sit longest, so they are on everyone&rsquo;s page.', '');
            credit = 'Every figure is computed from NetSuite records, not typed in. '
                + 'Open any row in the lists to see the record behind it. '
                + 'Where something cannot be measured honestly it shows a dash and says why &mdash; '
                + 'a blank is never a zero.';
        }
        tabs.push(['dig', 'Dig into the data']);
        panes.push(dig);
        var tabhtml = tabs.map(function (t, i) {
            return '<button data-t="' + esc(t[0]) + '" role="tab" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' + esc(t[1]) + '</button>';
        }).join('');
        var notices = (o.notices || []).map(function (n) { return '<div class="gap">' + esc(n) + '</div>'; }).join('');
        return HEAD.replace('__TITLE__', esc(full))
            + (o.adminBar || '')
            + '<h1>' + h1 + '</h1>'
            + '<p class="sub">' + sub + '</p>'
            + '<p class="stamp">Royal Bag &middot; ' + esc(o.stamp || '') + ' &middot; live NetSuite</p>'
            + (o.tzNote ? '<p class="stamp">' + esc(o.tzNote) + '</p>' : '')
            + notices
            + CONTROLS
            + '<div class="tabs" role="tablist">' + tabhtml + '</div>'
            + panes.join('')
            + '<div class="credit">' + credit + '</div>'
            + '</div>' + JS.replace('__PAYLOAD__', function () { return safeJson(pay); })
            + '</body></html>';
    }

    /** A plain page for "no scorecard for you" and errors, in the same design. */
    function message(title, body) {
        return HEAD.replace('__TITLE__', esc(title)) + '<h1>' + esc(title) + '</h1><div class="gap">'
            + esc(body) + '</div></div></body></html>';
    }

    return { render: render, message: message };
})();

    // ================================================================== the Suitelet


    var E = ENGINE, PAGE = PAGEMOD;      // bundled below this file by the build step
    var EASTERN = 'America/New_York';
    var DIRECTOR_DEFAULT = [7];          // Sara Ziegler
    var ADMIN_DEFAULT = [546334];        // Nabeegh Ahmed -- used when custscript_rb_sc_admins is blank

    // ------------------------------------------------------------ SuiteQL
    // PAGINATION IS NOT OPTIONAL. message, transaction, customer and supportcase
    // all run to thousands of rows; one un-paged call returns a page and looks complete.
    var SQL_COUNT = 0;
    function runAll(sql) {
        SQL_COUNT++;
        var out = [];
        var paged = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        paged.pageRanges.forEach(function (r) {
            paged.fetch({ index: r.index }).data.asMappedResults().forEach(function (row) { out.push(row); });
        });
        if (paged.count != null && paged.count !== out.length)
            throw new Error('Pagination mismatch: expected ' + paged.count + ' rows, collected ' + out.length);
        return out;
    }
    function inBatches(ids, size, fn) {
        var out = [];
        for (var i = 0; i < ids.length; i += size) out = out.concat(fn(ids.slice(i, i + size)));
        return out;
    }
    function d(isoStr) { return "TO_DATE('" + isoStr + "','YYYY-MM-DD')"; }
    function addDays(isoStr, n) { return E.iso(E.P(isoStr) + n * E.DAY); }
    var TS = "'YYYY-MM-DD HH24:MI:SS'";

    // ------------------------------------------------------------ time zones
    // What each table hands back, measured on this account (5 Nov 2026):
    //   message.messagedate                   -> UTC
    //   phonecall.createddate                 -> US Eastern wall time
    //   supportcase / customer / transaction  -> the VIEWER's NetSuite time-zone preference
    // The engine runs on the office clock (Eastern), so viewer-zone fields are moved
    // to Eastern before anything is computed, and list times are shown back in the
    // viewer's own zone at the end.
    var TZ_TABLE = {              // standard offset (hours), DST rule
        'America/New_York': [-5, 'us'], 'US/Eastern': [-5, 'us'], 'America/Detroit': [-5, 'us'],
        'America/Indiana/Indianapolis': [-5, 'us'], 'America/Toronto': [-5, 'us'],
        'America/Chicago': [-6, 'us'], 'US/Central': [-6, 'us'], 'America/Winnipeg': [-6, 'us'],
        'America/Denver': [-7, 'us'], 'US/Mountain': [-7, 'us'], 'America/Phoenix': [-7, null],
        'America/Los_Angeles': [-8, 'us'], 'US/Pacific': [-8, 'us'], 'America/Vancouver': [-8, 'us'],
        'America/Anchorage': [-9, 'us'], 'Pacific/Honolulu': [-10, null],
        'Europe/London': [0, 'eu'], 'Europe/Dublin': [0, 'eu'], 'Europe/Lisbon': [0, 'eu'],
        'Europe/Paris': [1, 'eu'], 'Europe/Berlin': [1, 'eu'], 'Europe/Amsterdam': [1, 'eu'],
        'Europe/Madrid': [1, 'eu'], 'Europe/Rome': [1, 'eu'], 'Europe/Warsaw': [1, 'eu'],
        'Europe/Kiev': [2, 'eu'], 'Europe/Kyiv': [2, 'eu'], 'Europe/Bucharest': [2, 'eu'],
        'Asia/Jerusalem': [2, 'il'], 'Asia/Tel_Aviv': [2, 'il'],
        'Asia/Karachi': [5, null], 'Asia/Kolkata': [5.5, null], 'Asia/Calcutta': [5.5, null],
        'Asia/Manila': [8, null], 'Asia/Shanghai': [8, null], 'Asia/Dubai': [4, null], 'UTC': [0, null], 'GMT': [0, null]
    };
    function nthSun(y, m0, n) {   // n-th Sunday (n=-1: last) of month, as UTC ms of 00:00
        if (n > 0) { var f = new Date(Date.UTC(y, m0, 1)).getUTCDay(); return Date.UTC(y, m0, 1 + ((7 - f) % 7) + 7 * (n - 1)); }
        var last = new Date(Date.UTC(y, m0 + 1, 0)); return Date.UTC(y, m0, last.getUTCDate() - last.getUTCDay());
    }
    function dstOn(rule, std, utc) {
        var y = new Date(utc).getUTCFullYear(), H = 3600000;
        if (rule === 'us') {          // 2nd Sun Mar 02:00 local std -> 1st Sun Nov 02:00 local dst
            var a = nthSun(y, 2, 2) + 2 * H - std * H, b = nthSun(y, 10, 1) + 2 * H - (std + 1) * H;
            return utc >= a && utc < b;
        }
        if (rule === 'eu') { return utc >= nthSun(y, 2, -1) + H && utc < nthSun(y, 9, -1) + H; }
        if (rule === 'il') {          // Friday before last Sunday of March 02:00 -> last Sunday Oct 02:00
            return utc >= nthSun(y, 2, -1) - 2 * 86400000 + 2 * H - std * H && utc < nthSun(y, 9, -1) + 2 * H - (std + 1) * H;
        }
        return false;
    }
    var INTL_OK = null;
    function intlOffset(tz, utc) {            // minutes; null when Intl/tz is unavailable
        if (INTL_OK === false) return null;
        try {
            var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
                day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            var p = {}; f.formatToParts(new Date(utc)).forEach(function (x) { p[x.type] = x.value; });
            var wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
            INTL_OK = true;
            return Math.round((wall - utc) / 60000);
        } catch (e) { INTL_OK = false; return null; }
    }
    function zone(tz) {
        var t = TZ_TABLE[tz];
        var known = !!t || intlOffset(tz, Date.now()) != null;
        function off(utc) {                   // minutes east of UTC at instant utc
            if (t) return (t[0] + (dstOn(t[1], t[0], utc) ? 1 : 0)) * 60;
            var m = intlOffset(tz, utc);
            return m == null ? (-5 + (dstOn('us', -5, utc) ? 1 : 0)) * 60 : m;
        }
        return {
            tz: tz, known: known,
            toUtc: function (wall) { var u = wall - off(wall) * 60000; return wall - off(u) * 60000; },
            fromUtc: function (utc) { return utc + off(utc) * 60000; }
        };
    }
    var ET = zone(EASTERN);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function stamp(ms, withSec) {
        var x = new Date(ms);
        return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()) + ' '
            + pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes()) + (withSec ? ':' + pad(x.getUTCSeconds()) : '');
    }
    /** viewer wall-clock string -> Eastern wall-clock string, same format */
    function viewerToEt(V, s) {
        if (!s || V.tz === EASTERN) return s;
        var ms = E.P(s);
        if (isNaN(ms)) return s;
        return stamp(ET.fromUtc(V.toUtc(ms)), s.length > 16);
    }
    function shiftFields(rows, V, fields) {
        if (V.tz === EASTERN) return rows;
        rows.forEach(function (r) { fields.forEach(function (f) { if (r[f]) r[f] = viewerToEt(V, String(r[f])); }); });
        return rows;
    }
    /** Eastern 'YYYY-MM-DD HH:MM' list times -> the viewer's own zone, for display only. */
    var DT16 = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    function displayInViewerZone(qs, V) {
        if (V.tz === EASTERN || !qs) return;
        Object.keys(qs).forEach(function (k) {
            var q = qs[k];
            if (!q || !q.rows) return;
            q.rows.forEach(function (r) {
                for (var i = 0; i < r.length; i++)
                    if (typeof r[i] === 'string' && DT16.test(r[i])) r[i] = stamp(V.fromUtc(ET.toUtc(E.P(r[i] + ':00'))), false);
            });
        });
    }

    // ------------------------------------------------------------ the pull
    /** Every query, from pull.py, with the windows derived from today. */
    function pull(weeks, today, V) {
        var W = {
            msg_from: addDays(weeks[0][0], -14), msg_to: addDays(today, 2),    // tail PAST today: late replies
            case_from: addDays(weeks[0][0], -14), case_to: addDays(today, 1),
            call_from: addDays(weeks[0][0], -14), call_to: addDays(today, 1),
            lead_from: addDays(today, -96),                                     // the 90-day preset has range
            order_from: addDays(today, -96), to: addDays(today, 1)
        };
        var t0 = Date.now(), data = {};

        // ~1,600 rows/week. NEVER aggregate on this table with a filter on author.
        data.messages = runAll(
            "SELECT id, author, entity, activity, transaction, incoming, subject, " +
            "TO_CHAR(messagedate," + TS + ") AS msgdate FROM message " +
            "WHERE messagedate >= " + d(W.msg_from) + " AND messagedate < " + d(W.msg_to) + " ORDER BY id");

        // supportfirstreply is populated on ~27% of cases, so first reply comes from messages.
        // issue / sub-issue ride along: the order-accuracy measure reads them from the same rows.
        data.cases = shiftFields(runAll(
            "SELECT id, casenumber, title, issue, custevent_rb_ticket_sub_issue AS sub, company, assigned, status, category, " +
            "TO_CHAR(datecreated," + TS + ") AS created, TO_CHAR(enddate," + TS + ") AS closed FROM supportcase " +
            "WHERE datecreated >= " + d(W.case_from) + " AND datecreated < " + d(W.case_to) + " ORDER BY id"), V, ['created', 'closed']);

        // The live open backlog -- status NOT IN (5,10) = not Closed, not Spam.
        data.openCases = shiftFields(runAll(
            "SELECT c.id, c.casenumber, c.company, c.assigned, c.status, c.category, c.title, " +
            "TO_CHAR(c.datecreated," + TS + ") AS created, TO_CHAR(c.lastmodifieddate," + TS + ") AS touched, " +
            "(SELECT COUNT(*) FROM message m WHERE m.activity = c.id AND m.incoming='F') AS out_n, " +
            "(SELECT COUNT(*) FROM message m WHERE m.activity = c.id AND m.incoming='T') AS in_n, " +
            "(SELECT TO_CHAR(MAX(m.messagedate)," + TS + ") FROM message m WHERE m.activity = c.id AND m.incoming='F') AS last_out_utc, " +
            "(SELECT TO_CHAR(MAX(m.messagedate)," + TS + ") FROM message m WHERE m.activity = c.id AND m.incoming='T') AS last_in_utc " +
            "FROM supportcase c WHERE c.status NOT IN (5, 10) AND c.datecreated >= TO_DATE('2026-01-01','YYYY-MM-DD')" +
            " ORDER BY c.id"), V, ['created', 'touched']);

        // Tickets on a catch-all customer, for the routing diagnosis. Only the sender's
        // DOMAIN leaves the server -- never the address.
        data.catchall = shiftFields(runAll(
            "SELECT id, title, status, category, LOWER(SUBSTR(email, INSTR(email,'@')+1)) AS dom, " +
            "TO_CHAR(datecreated," + TS + ") AS created FROM supportcase WHERE company IN (28480, 50200) " +
            "AND datecreated >= " + d(W.case_from) + " AND datecreated < " + d(W.case_to) + " ORDER BY id"), V, ['created']);

        // Use the _num sentiment field. The text list has a different id order and
        // reading it silently swaps Neutral and Negative. phonecall times are Eastern already.
        data.calls = runAll(
            "SELECT id, owner, assigned, company, title, TO_CHAR(createddate," + TS + ") AS created, " +
            "custevent_rb_issue_category AS issue_cat, custevent_rb_action_required AS action, " +
            "custevent_rb_aiprocessed AS aiproc, custevent_rb_customer_sentiment_end_num AS sent_end " +
            "FROM phonecall WHERE createddate >= " + d(W.call_from) + " AND createddate < " + d(W.call_to) + " ORDER BY id");

        // Every new customer/prospect record IS a lead. entitystatus 22 = Spam.
        data.customers = shiftFields(runAll(
            "SELECT id, salesrep, entitystatus, custentity_atlas_high_impact AS hvtflag, " +
            "TO_CHAR(datecreated," + TS + ") AS created, TO_CHAR(firstorderdate,'YYYY-MM-DD') AS firstorder " +
            "FROM customer WHERE datecreated >= " + d(W.lead_from) + " AND datecreated < " + d(W.to) + " ORDER BY id"), V, ['created']);

        data.quotes = shiftFields(runAll(
            "SELECT id, tranid, entity, employee, status, foreigntotal, TO_CHAR(createddate," + TS + ") AS created " +
            "FROM transaction WHERE recordtype = 'estimate' AND createddate >= " + d(W.lead_from) +
            " AND createddate < " + d(W.to) + " ORDER BY id"), V, ['created']);

        // Opportunities only so they can be EXCLUDED from lead contact.
        data.opps = shiftFields(runAll(
            "SELECT id, tranid, entity, employee, TO_CHAR(createddate," + TS + ") AS created FROM transaction " +
            "WHERE recordtype = 'opportunity' AND createddate >= " + d(W.lead_from) + " AND createddate < " + d(W.to) +
            " ORDER BY id"), V, ['created']);

        // THIS FILTER IS NOT A GUESS: it reproduces customsearch4450/4451 to the cent.
        data.orders = shiftFields(runAll(
            "SELECT id, tranid, entity, employee, status, foreigntotal, TO_CHAR(trandate,'YYYY-MM-DD') AS trandate, " +
            "TO_CHAR(createddate," + TS + ") AS created FROM transaction WHERE recordtype = 'salesorder' " +
            "AND trandate >= " + d(W.order_from) + " AND trandate < " + d(W.to) + " AND employee IS NOT NULL AND status <> 'A' " +
            "AND (custbody_rb_blanket_so IS NULL OR custbody_rb_blanket_so <> 'T') ORDER BY id"), V, ['created']);

        // Every order RAISED (the order-accuracy denominator), whatever its rep or status.
        data.ordersAll = shiftFields(runAll(
            "SELECT id, tranid, status, TO_CHAR(createddate," + TS + ") AS created FROM transaction " +
            "WHERE recordtype = 'salesorder' AND createddate >= " + d(W.case_from) + " AND createddate < " + d(W.to) +
            " ORDER BY id"), V, ['created']);

        // How many customer records already carry each catch-all sender domain -- live from contacts.
        var doms = {};
        data.catchall.forEach(function (x) {
            var dm = String(x.dom || '');
            if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dm) && dm !== 'royalbag.com' && !E.FREEMAIL[dm] && !E.MACHINE_DOM[dm]) doms[dm] = 1;
        });
        data.domCust = {};
        inBatches(Object.keys(doms), 500, function (b) {
            return runAll("SELECT LOWER(SUBSTR(email, INSTR(email,'@')+1)) AS dom, COUNT(DISTINCT company) AS n FROM contact " +
                "WHERE company IS NOT NULL AND company NOT IN (28480, 50200) AND LOWER(SUBSTR(email, INSTR(email,'@')+1)) IN ('" +
                b.join("','") + "') GROUP BY LOWER(SUBSTR(email, INSTR(email,'@')+1))");
        }).forEach(function (r) { data.domCust[r.dom] = Number(r.n); });

        data._ms = Date.now() - t0;
        data._window = W;
        return data;
    }

    /** verify_pull(): the checks that have actually gone wrong in real builds. */
    function verifyPull(data, today) {
        var problems = [], latest = '', seen = {}, dup = false;
        data.messages.forEach(function (m) { if (m.msgdate > latest) latest = m.msgdate; if (seen[m.id]) dup = true; seen[m.id] = 1; });
        // THE ONE THAT BIT TWICE: a truncated tail makes recent inbound look unanswered.
        if (latest.slice(0, 10) < addDays(today, -1))
            problems.push('The newest email in the data is ' + (latest || 'missing') + '. Recent inbound may read as unanswered.');
        if (dup) problems.push('Duplicate message ids \u2014 pages were merged wrong.');
        if (data.orders.some(function (o) { return o.status === 'A'; })) problems.push('A Pending Approval order survived the sales filter.');
        return problems;
    }

    // ------------------------------------------------------------ retention (live)
    function retentionPull(today) {
        var ids = Object.keys(E.RET_IDS).join(',');
        var CY = +today.slice(0, 4);
        var agg = runAll(
            "SELECT NVL(c.companyname, c.entityid) AS customer, c.salesrep AS ownerid, t.recordtype AS kind, " +
            "TO_CHAR(t.trandate,'YYYY-MM') AS ym, SUM(t.foreigntotal) AS amt, COUNT(*) AS cnt, " +
            "MAX(TO_CHAR(t.trandate,'YYYY-MM-DD')) AS maxd FROM transaction t JOIN customer c ON c.id = t.entity " +
            "WHERE ((t.recordtype = 'salesorder' AND t.trandate >= " + d((CY - 1) + '-01-01') + ") OR " +
            "(t.recordtype = 'invoice' AND t.trandate >= " + d((CY - 3) + '-01-01') + " AND t.trandate < " + d((CY - 1) + '-01-01') + ")) " +
            "AND c.salesrep IN (" + ids + ") " +
            "GROUP BY NVL(c.companyname, c.entityid), c.salesrep, t.recordtype, TO_CHAR(t.trandate,'YYYY-MM') " +
            "ORDER BY 1, 2, 3, 4");
        // Activity: the retention system's own saved search, newest activity per customer.
        var act = [];
        function open(withFilter) {
            var s = search.load({ id: 'customsearch_rep_customer_by_most_recent' });
            if (withFilter) {
                var f = s.filters.slice();
                f.push(search.createFilter({ name: 'salesrep', operator: search.Operator.ANYOF, values: Object.keys(E.RET_IDS) }));
                s.filters = f;
            }
            return { s: s, pg: s.runPaged({ pageSize: 1000 }) };
        }
        var o;
        try { o = open(true); } catch (e) { log.debug('retention activity: running unfiltered', e.message); o = open(false); }
        var cols = o.s.columns, ci = {};
        cols.forEach(function (c, i) {
            var l = String(c.label || c.name || '').toLowerCase();
            if (ci.name == null && (l === 'name' || c.name === 'entityid' || c.name === 'companyname' || c.name === 'altname')) ci.name = i;
            if (ci.rep == null && (l.indexOf('sales rep') >= 0 || c.name === 'salesrep')) ci.rep = i;
            if (ci.date == null && l.indexOf('date') >= 0) ci.date = i;
        });
        if (ci.name == null || ci.rep == null || ci.date == null) throw new Error('retention activity search columns not recognised');
        function isoOf(raw) {
            if (!raw) return null;
            try { var dt = format.parse({ value: raw, type: format.Type.DATE }); if (dt && !isNaN(dt.getTime())) return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
            catch (e) { /* fall through */ }
            var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw));
            return m ? m[3] + '-' + pad(+m[1]) + '-' + pad(+m[2]) : null;
        }
        o.pg.pageRanges.forEach(function (r) {
            o.pg.fetch({ index: r.index }).data.forEach(function (res) {
                var nm = res.getValue(cols[ci.name]);
                if (!nm || /^\d+$/.test(String(nm))) nm = res.getText(cols[ci.name]) || nm;
                act.push({ customer: nm, salesrep: Number(res.getValue(cols[ci.rep])), date: isoOf(res.getValue(cols[ci.date])) });
            });
        });
        return { agg: agg, activity: act };
    }

    // ------------------------------------------------------------ lookups
    function names(ids) {
        var out = {};
        inBatches(ids.filter(function (i) { return i != null && !isNaN(i); }), 900, function (b) {
            return runAll('SELECT id, entityid, companyname, isperson FROM customer WHERE id IN (' + b.join(',') + ')');
        }).forEach(function (r) {
            var n = r.companyname || r.entityid;
            // A name that is itself an email address is not shown -- these pages get passed around.
            if (n && /@/.test(n)) n = '(record ' + r.id + ')';
            if (n) out[Number(r.id)] = n;
        });
        Object.keys(E.NAME_OVERRIDE).forEach(function (k) { out[k] = E.NAME_OVERRIDE[k]; });
        return out;
    }
    function caseNos(ids, known) {
        var need = ids.filter(function (i) { return !known[i]; });
        inBatches(need, 900, function (b) {
            return runAll('SELECT id, casenumber FROM supportcase WHERE id IN (' + b.join(',') + ')');
        }).forEach(function (r) { known[Number(r.id)] = r.casenumber; });
        return known;
    }
    function tranInfo(ids) {
        var out = {};
        inBatches(ids, 900, function (b) {
            return runAll('SELECT id, tranid, recordtype FROM transaction WHERE id IN (' + b.join(',') + ')');
        }).forEach(function (r) { out[Number(r.id)] = { tranid: r.tranid, type: r.recordtype }; });
        return out;
    }
    function linker(base) {
        var NS = base + '/app/';
        var TYPE_PATH = { estimate: 'accounting/transactions/estimate.nl?id=',
            salesorder: 'accounting/transactions/salesord.nl?id=',
            opportunity: 'accounting/transactions/opprtnty.nl?id=',
            invoice: 'accounting/transactions/custinvc.nl?id=' };
        var L = { 'case': 'crm/support/supportcase.nl?id=', quote: 'accounting/transactions/estimate.nl?id=',
            order: 'accounting/transactions/salesord.nl?id=', cust: 'common/entity/custjob.nl?id=',
            call: 'crm/calendar/call.nl?id=', any: 'accounting/transactions/transaction.nl?id=' };
        return function (kind, id) {
            if (kind.indexOf('type:') === 0) return NS + (TYPE_PATH[kind.slice(5)] || L.any) + id;
            return NS + L[kind] + id;
        };
    }

    // ------------------------------------------------------------ cache (chunked: N/cache values cap at 500KB)
    var CHUNK = 400000;
    function cacheGet(c, key) {
        var head = c.get({ key: key });
        if (!head) return null;
        var h = JSON.parse(head), s = '';
        for (var i = 0; i < h.n; i++) { var part = c.get({ key: key + ':' + i }); if (part == null) return null; s += part; }
        return JSON.parse(s);
    }
    function cachePut(c, key, obj, ttl) {
        var s = JSON.stringify(obj), n = Math.ceil(s.length / CHUNK);
        if (n > 12) return;
        for (var i = 0; i < n; i++) c.put({ key: key + ':' + i, value: s.slice(i * CHUNK, (i + 1) * CHUNK), ttl: ttl });
        c.put({ key: key, value: JSON.stringify({ n: n }), ttl: ttl });
    }

    // ------------------------------------------------------------ build one page
    function build(view, ctx) {
        var nowUtc = Date.now();
        var etNow = ET.fromUtc(nowUtc);
        var nowEt = stamp(etNow, true), today = nowEt.slice(0, 10);
        var weeks = E.weeksEnding(today);
        var V = ctx.zone;
        var data = pull(weeks, today, V);
        var problems = verifyPull(data, today);

        // Retention is a position shared by every page; compute once and keep it a few hours.
        var retention = null, retErr = null;
        try {
            var rkey = 'ret:v2:' + today;
            retention = ctx.cache ? cacheGet(ctx.cache, rkey) : null;
            if (!retention) {
                var rp = retentionPull(today);
                retention = E.retentionCompute(rp.agg, rp.activity, today);
                if (ctx.cache) cachePut(ctx.cache, rkey, retention, 6 * 3600);
            }
        } catch (e) { retErr = e.message || String(e); log.error('retention', e); retention = null; }

        var C = E.compute(data, { today: today, weeks: weeks, dataCutoff: nowEt, now: nowEt, quoteAgeFrom: today });

        // Names, case numbers and transaction numbers -- only for what this page shows.
        var ids = E.referencedIdsFor(view.kind, view.who, C, retention);
        var NM = names(ids.cust);
        var CN = {};
        data.cases.forEach(function (c) { CN[Number(c.id)] = c.casenumber; });
        caseNos(ids['case'], CN);
        var TI = tranInfo(ids.tran);
        var R = {
            cname: function (i) { return i == null ? '\u2014' : (NM[i] || 'record ' + i); },
            caseNo: function (i) { return CN[i] || null; },
            tranInfo: function (i) { return TI[i] || null; },
            link: linker(ctx.base)
        };
        var pay, allowed;
        if (view.kind === 'director') { pay = E.directorPayload(C, R, retention, today); allowed = E.EVERYONE.slice(); }
        else if (view.kind === 'podlead') { pay = E.podLeadPayload(view.who, C, R, retention, today); allowed = E.PODS[E.POD_OF[view.who]].members.slice(); }
        else { pay = E.personPayload(view.who, C, R, retention, today); E.addFloors(pay.queues); E.addFloors(pay.unowned); allowed = [view.who]; }
        var gate = E.leakGate(view.who || 'Sara', pay, allowed);
        if (!gate.ownershipOk) throw new Error('Leakage gate: a row on this page belongs to someone else.');

        displayInViewerZone(pay.queues, V);
        displayInViewerZone(pay.unowned, V);
        Object.keys(pay.members || {}).forEach(function (m) { displayInViewerZone(pay.members[m].queues, V); });

        var notices = problems.slice();
        if (!retention) notices.push('Retention rows show a dash: the retention figures could not be computed on this load' + (retErr ? ' (' + retErr + ')' : '') + '.');
        if (today > E.CAL_LAST) notices.push('The company calendar ends ' + E.CAL_LAST + ' \u2014 closures after that are not known, so business hours may be overstated. Extend the calendar block in this script.');
        if (!V.known) notices.push('Your NetSuite time zone (' + V.tz + ') is not one this page knows, so record times are read as Eastern. Times may be shifted.');

        log.audit('scorecard built', { view: view.kind, who: view.who, ms: data._ms, sql: SQL_COUNT, messages: data.messages.length,
            cases: data.cases.length, open: data.openCases.length, calls: data.calls.length, masked: gate.masked,
            problems: problems.length, governance_left: runtime.getCurrentScript().getRemainingUsage() });
        return {
            pay: pay, notices: notices, kind: view.kind,
            stamp: 'computed ' + stamp(V.fromUtc(nowUtc), false) + ' ' + V.tz,
            tzNote: V.tz === EASTERN ? 'Times are US Eastern \u2014 the office clock.'
                : 'Times in the lists are in your NetSuite time zone (' + V.tz + '). Business hours are measured on the office clock (US Eastern).',
            diag: { window: data._window, counts: { messages: data.messages.length, cases: data.cases.length,
                open: data.openCases.length, calls: data.calls.length, customers: data.customers.length,
                quotes: data.quotes.length, opps: data.opps.length, orders: data.orders.length,
                ordersAll: data.ordersAll.length, catchall: data.catchall.length },
                retention: retention, pull_ms: data._ms, sql: SQL_COUNT, masked: gate.masked, problems: problems,
                viewer_tz: V.tz, governance_left: runtime.getCurrentScript().getRemainingUsage() }
        };
    }

    function idList(name, dflt) {
        var v = runtime.getCurrentScript().getParameter({ name: name });
        if (v == null || v === '') return dflt;
        return String(v).split(',').map(function (s) { return Number(String(s).trim()); }).filter(Boolean);
    }
    function viewFor(user, params, isAdmin, directors) {
        var me = E.EMPLOYEE_TO_REP[Number(user.id)] || null;
        var v = directors.indexOf(Number(user.id)) >= 0 ? { kind: 'director', who: null }
            : me ? { kind: E.PODS[E.POD_OF[me]] && E.PODS[E.POD_OF[me]].lead === me ? 'podlead' : 'rep', who: me } : null;
        var asked = params.view || params.rep;
        if (asked && isAdmin) {
            if (String(asked).toLowerCase() === 'team') return { kind: 'director', who: null };
            var k = E.EVERYONE.filter(function (n) { return n.toLowerCase() === String(asked).toLowerCase(); })[0];
            if (k) return { kind: E.PODS[E.POD_OF[k]] && E.PODS[E.POD_OF[k]].lead === k ? 'podlead' : 'rep', who: k };
        }
        return v;
    }

    function onRequest(context) {
        var req = context.request, res = context.response;
        if (req.method !== 'GET') { res.write(PAGE.message('Scorecard', 'Use GET.')); return; }
        var user = runtime.getCurrentUser();
        var script = runtime.getCurrentScript();
        var admins = idList('custscript_rb_sc_admins', ADMIN_DEFAULT);
        var directors = idList('custscript_rb_sc_directors', DIRECTOR_DEFAULT);
        var isAdmin = admins.indexOf(Number(user.id)) >= 0;
        var view = viewFor(user, req.parameters, isAdmin, directors);
        // An admin who is not on the roster lands on the team view rather than an empty page.
        if (!view && isAdmin) view = { kind: 'director', who: null };

        var bar = null;
        if (isAdmin) {
            var link = function (v, label) {
                return '<a href="' + url.resolveScript({ scriptId: script.id, deploymentId: script.deploymentId, params: { view: v } }) + '">' + label + '</a>';
            };
            bar = '<p class="mid">Admin view &middot; ' + [link('team', 'Team (Sara)')].concat(E.EVERYONE.map(function (n) { return link(n, n); })).join(' &middot; ') + '</p>';
        }
        if (!view) {
            res.write(PAGE.message('Weekly scorecard', isAdmin
                ? 'You are not on the scorecard roster. Pick a view above, or add ?view=team or ?view=<first name> to the URL.'
                : 'There is no scorecard for your login. If you think there should be, ask for your employee record to be added to the roster.')
                .replace('<h1>', (bar || '') + '<h1>'));
            return;
        }

        var tz = String(user.getPreference({ name: 'TIMEZONE' }) || EASTERN);
        var V = zone(tz);
        var mins = script.getParameter({ name: 'custscript_rb_sc_cache_minutes' });
        mins = mins === null || mins === '' ? 10 : Number(mins);
        var c = cache.getCache({ name: 'rb_scorecard_v2', scope: cache.Scope.PROTECTED });
        var key = 'p:' + view.kind + ':' + (view.who || 'team') + ':' + tz;
        var out = null;
        try {
            if (mins > 0 && req.parameters.refresh !== '1') out = cacheGet(c, key);
            if (!out) {
                var base = 'https://' + url.resolveDomain({ hostType: url.HostType.APPLICATION });
                out = build(view, { base: base, zone: V, cache: mins > 0 ? c : null });
                if (mins > 0) cachePut(c, key, out, Math.max(300, mins * 60));
            }
        } catch (e) {
            log.error('scorecard failed', e);
            res.write(PAGE.message('Weekly scorecard', 'The scorecard could not be computed: ' + (e.message || e)
                + '. Nothing is shown rather than a partial page.'));
            return;
        }
        if (req.parameters.diag === '1' && isAdmin) {
            res.setHeader({ name: 'Content-Type', value: 'application/json' });
            res.write(JSON.stringify({ view: view, timezone: tz, diag: out.diag, notices: out.notices }, null, 1));
            return;
        }
        res.write(PAGE.render(out.pay, { kind: out.kind, stamp: out.stamp, tzNote: out.tzNote, notices: out.notices, adminBar: bar }));
    }

    return { onRequest: onRequest };
});