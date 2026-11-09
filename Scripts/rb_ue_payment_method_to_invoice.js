/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Royal Bag - Stamp how an invoice was paid onto the invoice (custbody_rb_paid_by),
 * taken from the Customer Payment(s) applied to it. Printed on the invoice PDF as "Paid by: ...".
 *
 *   Card    -> "Visa ending in 1234"
 *   Check   -> "Check #10452"
 *   Other   -> payment method name, e.g. "ACH", "Wire", "Cash"
 *
 * Deploy on: Customer Payment | Events: Create, Edit | Execute as: Administrator
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

    const INVOICE_FIELD = 'custbody_rb_paid_by';

    const safeText = (rec, fieldId) => {
        try { return String(rec.getText({ fieldId }) || ''); } catch (e) { return ''; }
    };
    const safeValue = (rec, fieldId) => {
        try { return String(rec.getValue({ fieldId }) || ''); } catch (e) { return ''; }
    };

    /** Builds the "Paid by" label for one payment. */
    const getPaymentLabel = (pmt) => {
        const method   = safeText(pmt, 'paymentmethod').trim();   // legacy payment method, e.g. "Visa", "Check", "ACH"
        const option   = safeText(pmt, 'paymentoption').trim();   // payment instrument, e.g. "Visa ************1234"
        const ccMasked = safeValue(pmt, 'ccnumber');              // legacy masked card
        const checkNum = safeValue(pmt, 'checknum').trim();

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
        return method || option || 'Payment';
    };

    const afterSubmit = (ctx) => {
        const { UserEventType } = ctx;
        if (![UserEventType.CREATE, UserEventType.EDIT].includes(ctx.type)) return;

        const pmt = record.load({ type: record.Type.CUSTOMER_PAYMENT, id: ctx.newRecord.id });
        const label = getPaymentLabel(pmt);

        const lines = pmt.getLineCount({ sublistId: 'apply' });
        for (let i = 0; i < lines; i++) {
            if (!pmt.getSublistValue({ sublistId: 'apply', fieldId: 'apply', line: i })) continue;

            const tranType = String(pmt.getSublistValue({ sublistId: 'apply', fieldId: 'type', line: i }) || '');
            if (!/inv/i.test(tranType)) continue;

            const invoiceId = pmt.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i })
                || pmt.getSublistValue({ sublistId: 'apply', fieldId: 'doc', line: i });
            if (!invoiceId) continue;

            try {
                // Paid with more than one payment? List each method once.
                const current = search.lookupFields({
                    type: search.Type.INVOICE, id: invoiceId, columns: [INVOICE_FIELD]
                })[INVOICE_FIELD] || '';

                if (current.split(', ').includes(label)) continue;

                record.submitFields({
                    type: record.Type.INVOICE,
                    id: invoiceId,
                    values: { [INVOICE_FIELD]: current ? `${current}, ${label}` : label },
                    options: { enableSourcing: false, ignoreMandatoryFields: true }
                });
            } catch (e) {
                log.error({ title: `Could not stamp invoice ${invoiceId}`, details: e });
            }
        }
    };

    return { afterSubmit };
});