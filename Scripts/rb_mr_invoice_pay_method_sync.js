/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Royal Bag - Safety net + backfill for the invoice "Paid by" field (custbody_rb_pay_method).
 *
 * Finds paid invoices whose Pay Method is still blank and fills it in. This catches
 * invoices where NetSuite applied a deposit automatically in the background (system-created
 * deposit applications don't always trigger User Event scripts).
 *
 * Script parameter (create on the Script record, Parameters tab):
 *   custscript_rb_pm_days_back  - Integer - how many days back to look (blank = 7)
 *
 * Suggested setup:
 *   Deployment 1 "Safety net": schedule every 30 minutes, days back blank (7).
 *   Deployment 2 "Backfill":   run once manually with days back = 365 (or however far you want).
 *
 * Requires rb_pay_method_lib.js in the same folder.
 */
define(['N/query', 'N/runtime', 'N/log', './rb_pay_method_lib'], (query, runtime, log, lib) => {

    const getInputData = () => {
        const param = runtime.getCurrentScript().getParameter({ name: 'custscript_rb_pm_days_back' });
        const daysBack = Number(param) > 0 ? Number(param) : 7;

        return {
            type: 'suiteql',
            query: `SELECT t.id
                      FROM transaction t
                     WHERE t.type = 'CustInvc'
                       AND t.custbody_rb_pay_method IS NULL
                       AND t.trandate >= SYSDATE - ?
                       AND EXISTS (SELECT 1
                                     FROM nexttransactionlinelink l
                                     JOIN transaction p ON p.id = l.nextdoc
                                    WHERE l.previousdoc = t.id
                                      AND p.type IN ('CustPymt', 'DepAppl', 'CustCred'))`,
            params: [daysBack]
        };
    };

    const map = (ctx) => {
        const row = JSON.parse(ctx.value);
        const invoiceId = (row.values && row.values[0]) || row.id;
        try {
            if (lib.syncInvoice(invoiceId)) ctx.write({ key: 'updated', value: invoiceId });
        } catch (e) {
            log.error({ title: `Could not update invoice ${invoiceId}`, details: e });
        }
    };

    const summarize = (summary) => {
        let updated = 0;
        summary.output.iterator().each(() => { updated++; return true; });
        summary.mapSummary.errors.iterator().each((key, err) => {
            log.error({ title: `Map error on ${key}`, details: err });
            return true;
        });
        log.audit({ title: 'Pay method sync finished', details: `Invoices updated: ${updated}` });
    };

    return { getInputData, map, summarize };
});