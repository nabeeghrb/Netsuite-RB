/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * rb_cs_duplicate_po_alert.js
 *
 * Warns the user in real time when the PO# (otherrefnum) already exists on
 * another Sales Order for the same customer. Shows a persistent warning banner
 * and asks for confirmation at save time.
 *
 * Deploy on: Sales Order (Applies To = Sales Order)
 */
define(['N/query', 'N/ui/message', 'N/ui/dialog', 'N/url'], (query, message, dialog, url) => {

    // ---------------------------------------------------------------------
    // Config
    // ---------------------------------------------------------------------
    const WATCHED_FIELDS = ['otherrefnum', 'entity'];
    const ACK_FIELD      = 'custbody_rb_dup_po_ack';  // checkbox: "Duplicate PO Acknowledged"
    const EXCLUDE_STATUS = ['SalesOrd:C'];            // C = Cancelled
    const MATCH_SIBLINGS = false;                     // true = also match other customers under same parent

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------
    let banner     = null;
    let duplicates = [];
    let allowSave  = false;

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /** Strip whitespace/punctuation and uppercase so "PO 12-345" == "po12345" */
    const normalize = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');

    function findDuplicates(entityId, poNum, currentId) {
        const key = normalize(poNum);
        if (!entityId || !key) return [];

        const entityClause = MATCH_SIBLINGS
            ? `AND (t.entity = ? OR t.entity IN (
                   SELECT c2.id FROM customer c2
                   WHERE c2.parent = (SELECT c1.parent FROM customer c1 WHERE c1.id = ?)
                     AND c2.parent IS NOT NULL))`
            : 'AND t.entity = ?';

        let sql = `
            SELECT
                t.id,
                t.tranid,
                TO_CHAR(t.trandate, 'MM/DD/YYYY') AS trandate,
                t.otherrefnum,
                BUILTIN.DF(t.status)  AS statustext,
                BUILTIN.DF(t.entity)  AS customername,
                BUILTIN.DF(t.employee) AS salesrep
            FROM transaction t
            WHERE t.type = 'SalesOrd'
              AND t.otherrefnum IS NOT NULL
              AND REGEXP_REPLACE(UPPER(t.otherrefnum), '[^A-Z0-9]', '') = ?
              AND t.status NOT IN (${EXCLUDE_STATUS.map(() => '?').join(',')})
              ${entityClause}`;

        const params = [key].concat(EXCLUDE_STATUS);
        params.push(entityId);
        if (MATCH_SIBLINGS) params.push(entityId);

        if (currentId) {
            sql += ' AND t.id <> ?';
            params.push(currentId);
        }
        sql += ' ORDER BY t.trandate DESC, t.id DESC';

        try {
            return query.runSuiteQL({ query: sql, params: params }).asMappedResults();
        } catch (e) {
            console.error('[DupPO] lookup failed: ' + e.message);
            return [];
        }
    }

    function clearBanner() {
        if (banner) {
            try { banner.hide(); } catch (e) { /* already gone */ }
            banner = null;
        }
    }

    function soLink(id, tranid) {
        const link = url.resolveRecord({ recordType: 'salesorder', recordId: id, isEditMode: false });
        return `<a href="${link}" target="_blank" style="text-decoration:underline;">${tranid || id}</a>`;
    }

    function showBanner(dups, poNum) {
        clearBanner();
        if (!dups.length) return;

        const list = dups.map(d =>
            `${soLink(d.id, d.tranid)} &nbsp;&mdash;&nbsp; ${d.trandate} &nbsp;|&nbsp; ${d.statustext}` +
            (d.salesrep ? ` &nbsp;|&nbsp; ${d.salesrep}` : '')
        ).join('<br/>');

        banner = message.create({
            title: `Possible duplicate — PO# ${poNum} already used by this customer`,
            message: `<div style="margin-top:4px;line-height:1.6;">${list}</div>
                      <div style="margin-top:6px;">Please confirm this is a genuine second order before saving.</div>`,
            type: message.Type.WARNING
        });
        banner.show();
    }

    function recheck(rec) {
        const entityId = rec.getValue({ fieldId: 'entity' });
        const poNum    = rec.getValue({ fieldId: 'otherrefnum' });
        duplicates = findDuplicates(entityId, poNum, rec.id);
        allowSave = false;
        showBanner(duplicates, poNum);
    }

    // ---------------------------------------------------------------------
    // Entry points
    // ---------------------------------------------------------------------

    function pageInit(context) {
        clearBanner();
        duplicates = [];
        allowSave  = false;
        if (context.mode === 'edit' || context.mode === 'copy') {
            recheck(context.currentRecord);
        }
    }

    function fieldChanged(context) {
        if (WATCHED_FIELDS.indexOf(context.fieldId) === -1) return;
        recheck(context.currentRecord);
    }

    function saveRecord(context) {
        if (!duplicates.length || allowSave) return true;

        const rec   = context.currentRecord;
        const poNum = rec.getValue({ fieldId: 'otherrefnum' });
        const refs  = duplicates.map(d => `${d.tranid} (${d.trandate}, ${d.statustext})`).join('\n');

        dialog.confirm({
            title: 'Duplicate PO# detected',
            message: `This customer already has the following order(s) with PO# ${poNum}:\n\n${refs}\n\n` +
                     `Save this order anyway?`
        }).then((confirmed) => {
            if (!confirmed) return;
            allowSave = true;
            try { rec.setValue({ fieldId: ACK_FIELD, value: true, ignoreFieldChange: true }); } catch (e) { /* field not deployed */ }
            resubmit();
        }).catch((e) => console.error('[DupPO] dialog error: ' + e.message));

        return false; // block this pass; the .then() re-triggers save
    }

    /** Re-run NetSuite's normal save flow after the user confirms. */
    function resubmit() {
        try {
            // eslint-disable-next-line no-undef
            NLDoMainFormButtonAction('submitter', true);
        } catch (e) {
            const form = document.forms['main_form'];
            if (form) form.submit();
        }
    }

    return { pageInit, fieldChanged, saveRecord };
});