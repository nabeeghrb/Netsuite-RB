/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Royal Bag - Shared logic for the invoice "Paid by" field (custbody_rb_pay_method).
 *
 * Rebuilds the label from scratch from everything applied to the invoice:
 *   Customer Payment                      -> that payment's method
 *   Deposit Application -> Customer Deposit -> the deposit's method
 *   Credit Memo                            -> "Credit Memo"
 *
 * Labels:
 *   Card    -> "Credit Card ending in 1234" (or just "Credit Card" when no masked number is stored)
 *   Check   -> "Check #10452"
 *   Other   -> payment method name, e.g. "ACH", "Wire", "Cash"
 *
 * Used by rb_ue_payment_method_to_invoice.js and rb_mr_invoice_pay_method_sync.js.
 * Keep this file in the same File Cabinet folder as those two scripts.
 */
define(['N/record', 'N/query', 'N/search', 'N/log'], (record, query, search, log) => {

    const INVOICE_FIELD = 'custbody_rb_pay_method';

    /**
     * Customer-friendly payment method names for the invoice.
     * Key = method name in NetSuite (case-insensitive), value = what prints on the invoice.
     */
    const METHOD_DISPLAY_NAMES = {
        'credit card (external)': 'Credit Card'
    };

    const cleanName = (name) => {
        const trimmed = String(name || '').trim();
        return METHOD_DISPLAY_NAMES[trimmed.toLowerCase()] || trimmed;
    };

    const safeText = (rec, fieldId) => {
        try { return String(rec.getText({ fieldId }) || ''); } catch (e) { return ''; }
    };
    const safeValue = (rec, fieldId) => {
        try { return String(rec.getValue({ fieldId }) || ''); } catch (e) { return ''; }
    };

    /** Builds the label for one Customer Payment or Customer Deposit record. */
    const labelFromRecord = (rec) => {
        const method   = cleanName(safeText(rec, 'paymentmethod'));
        const option   = cleanName(safeText(rec, 'paymentoption'));
        const ccMasked = safeValue(rec, 'ccnumber');
        const checkNum = safeValue(rec, 'checknum').trim();

        // 1) Card (or other instrument with a masked number) -> brand + last 4
        for (const src of [option, ccMasked]) {
            const m = src.match(/(\d{4})\D*$/);
            if (m) {
                let brand = method || option.replace(/[\d*•xX#\-\s]+$/, '').replace(/ending in$/i, '').trim();
                if (!brand) brand = 'Card';
                return `${brand} ending in ${m[1]}`;
            }
        }

        // 2) Check -> check number
        if (checkNum && (!method || /check|cheque/i.test(method))) {
            return `Check #${checkNum}`;
        }

        // 3) Anything else -> method name
        return method || option || '';
    };

    const runQuery = (sql, params) => query.runSuiteQL({ query: sql, params }).asMappedResults();

    /** Everything applied to the invoice that should appear in "Paid by". */
    const getSources = (invoiceId) => {
        const sources = [];
        const applied = runQuery(
            `SELECT DISTINCT t.id, t.type
               FROM nexttransactionlinelink l
               JOIN transaction t ON t.id = l.nextdoc
              WHERE l.previousdoc = ?
                AND t.type IN ('CustPymt', 'DepAppl', 'CustCred')
              ORDER BY t.id`,
            [invoiceId]
        );

        applied.forEach((row) => {
            if (row.type === 'CustPymt') {
                sources.push({ type: record.Type.CUSTOMER_PAYMENT, id: row.id });
            } else if (row.type === 'CustCred') {
                sources.push({ fixedLabel: 'Credit Memo' });
            } else if (row.type === 'DepAppl') {
                // A deposit application carries no method itself; use the deposit it came from.
                runQuery(
                    `SELECT DISTINCT t.id
                       FROM previoustransactionlinelink l
                       JOIN transaction t ON t.id = l.previousdoc
                      WHERE l.nextdoc = ? AND t.type = 'CustDep'`,
                    [row.id]
                ).forEach((dep) => sources.push({ type: record.Type.CUSTOMER_DEPOSIT, id: dep.id }));
            }
        });
        return sources;
    };

    /** Builds the full "Paid by" text for an invoice, e.g. "Credit Card, Check #10452". */
    const buildInvoiceLabel = (invoiceId) => {
        const labels = [];
        getSources(invoiceId).forEach((src) => {
            let label = src.fixedLabel || '';
            if (!label) {
                try {
                    label = labelFromRecord(record.load({ type: src.type, id: src.id }));
                } catch (e) {
                    log.error({ title: `Could not read ${src.type} ${src.id}`, details: e });
                }
            }
            if (label && !labels.includes(label)) labels.push(label);
        });
        return labels.join(', ');
    };

    /** Recalculates the field on one invoice. Only writes when the value changes. */
    const syncInvoice = (invoiceId) => {
        if (!invoiceId) return false;
        const label = buildInvoiceLabel(invoiceId);
        const current = search.lookupFields({
            type: search.Type.INVOICE, id: invoiceId, columns: [INVOICE_FIELD]
        })[INVOICE_FIELD] || '';

        if (current === label) return false;

        record.submitFields({
            type: record.Type.INVOICE,
            id: invoiceId,
            values: { [INVOICE_FIELD]: label },
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
        return true;
    };

    /** Invoices a Customer Deposit has been applied to (through its deposit applications). */
    const invoicesForDeposit = (depositId) => runQuery(
        `SELECT DISTINCT inv.id
           FROM nexttransactionlinelink d
           JOIN transaction da ON da.id = d.nextdoc AND da.type = 'DepAppl'
           JOIN nexttransactionlinelink a ON a.nextdoc = da.id
           JOIN transaction inv ON inv.id = a.previousdoc AND inv.type = 'CustInvc'
          WHERE d.previousdoc = ?`,
        [depositId]
    ).map((r) => r.id);

    return { INVOICE_FIELD, syncInvoice, invoicesForDeposit };
});