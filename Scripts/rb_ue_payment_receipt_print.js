/**
 * Royal Bag - Payment Receipt print helper
 *
 * Deploy on: Customer Payment (customerpayment)
 * Event:     beforeLoad, fires only in PRINT mode
 *
 * Adds custpage_* fields that the Advanced PDF template
 * "RB Payment Receipt" reads:
 *   custpage_rb_custno     - customer number (entityid)
 *   custpage_rb_billto     - customer's default billing address (text)
 *   custpage_rb_lines      - JSON map { "<invoice #>": { so, po, bal: "$0.00", paid: "Y"|"N" } }
 *   custpage_rb_so_list    - comma list of all sales orders on applied invoices
 *   custpage_rb_po_list    - comma list of all customer POs on applied invoices
 *   custpage_rb_cardbrand  - Visa / Mastercard / Amex / Discover
 *   custpage_rb_cardlast4  - last four digits of the card
 *   custpage_rb_solaref    - Sola (Cardknox) xRefNum for the charge
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/ui/serverWidget', 'N/log'], (search, serverWidget, log) => {

    const PE_LOG_TYPE = 'customrecord_pe_payment_logs';

    const beforeLoad = (context) => {
        if (context.type !== context.UserEventType.PRINT) return;

        const rec = context.newRecord;
        const form = context.form;
        if (!rec.id) return;

        const out = {
            billto: '', custno: '', lines: '{}', so_list: '', po_list: '',
            cardbrand: '', cardlast4: '', solaref: ''
        };

        try {
            const customerId = rec.getValue('customer');

            // 1. Bill To --------------------------------------------------
            if (customerId) {
                const c = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['billaddress', 'companyname', 'altname', 'entityid']
                });
                out.billto = c.billaddress || c.companyname || c.altname || '';
                out.custno = c.entityid || '';
            }

            // 2. SO # and Customer PO # per applied invoice ---------------
            // Balance left on each invoice after this payment
            const docIds = [];
            const remainingByDoc = {};
            const lineCount = rec.getLineCount({ sublistId: 'apply' });
            for (let i = 0; i < lineCount; i++) {
                const applied = rec.getSublistValue({ sublistId: 'apply', fieldId: 'apply', line: i });
                if (applied === true || applied === 'T') {
                    const doc = rec.getSublistValue({ sublistId: 'apply', fieldId: 'doc', line: i });
                    if (!doc) continue;
                    docIds.push(doc);
                    const due = num(rec.getSublistValue({ sublistId: 'apply', fieldId: 'due', line: i }));
                    const amt = num(rec.getSublistValue({ sublistId: 'apply', fieldId: 'amount', line: i }));
                    const disc = num(rec.getSublistValue({ sublistId: 'apply', fieldId: 'disc', line: i }));
                    remainingByDoc[String(doc)] = Math.max(0, Math.round((due - amt - disc) * 100) / 100);
                }
            }

            if (docIds.length) {
                const lineMap = {};
                const soSet = new Set();
                const poSet = new Set();
                search.create({
                    type: search.Type.TRANSACTION,
                    filters: [
                        ['internalid', 'anyof', docIds], 'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: ['internalid', 'tranid', 'createdfrom', 'otherrefnum']
                }).run().each((r) => {
                    const rem = remainingByDoc[String(r.id)] || 0;
                    const tranid = r.getValue('tranid');
                    // createdfrom text looks like "Sales Order #SO34301"
                    const cfText = r.getText('createdfrom') || '';
                    const so = cfText.replace(/^.*#/, '').trim();
                    const po = r.getValue('otherrefnum') || '';
                    lineMap[tranid] = { so: so, po: po, bal: money(rem), paid: rem === 0 ? 'Y' : 'N' };
                    if (so) soSet.add(so);
                    if (po) poSet.add(po);
                    return true;
                });
                out.lines = JSON.stringify(lineMap);
                out.so_list = Array.from(soSet).join(', ');
                out.po_list = Array.from(poSet).join(', ');
            }

            // 3. Card brand / last 4 / Sola reference ---------------------
            const masked = rec.getValue('custbody_maskedcard_hidden') || '';
            const storedCardName = rec.getText('custbody_pe_stored_credit_card') || '';
            const bodyRef = rec.getValue('custbody_cardknox_tran_reference') || '';

            if (masked) {
                out.cardlast4 = masked.slice(-4);
                out.cardbrand = brandFromNumber(masked) || brandFromLabel(storedCardName);
            }
            out.solaref = bodyRef;

            // PE Payment Log is linked to this payment via custrecord_transaction
            if (!bodyRef) {
                const match = findPeLog(rec.id);
                if (match) {
                    out.solaref = match.refnum || out.solaref;
                    if (match.cardtype) out.cardbrand = normaliseBrand(match.cardtype);
                    if (!out.cardlast4 && match.masked) out.cardlast4 = match.masked.slice(-4);
                }
            }
        } catch (e) {
            log.error({ title: 'RB receipt print helper', details: e });
        }

        addField(form, 'custpage_rb_custno', serverWidget.FieldType.TEXT, out.custno);
        addField(form, 'custpage_rb_billto', serverWidget.FieldType.LONGTEXT, out.billto);
        addField(form, 'custpage_rb_lines', serverWidget.FieldType.LONGTEXT, out.lines);
        addField(form, 'custpage_rb_so_list', serverWidget.FieldType.TEXTAREA, out.so_list);
        addField(form, 'custpage_rb_po_list', serverWidget.FieldType.TEXTAREA, out.po_list);
        addField(form, 'custpage_rb_cardbrand', serverWidget.FieldType.TEXT, out.cardbrand);
        addField(form, 'custpage_rb_cardlast4', serverWidget.FieldType.TEXT, out.cardlast4);
        addField(form, 'custpage_rb_solaref', serverWidget.FieldType.TEXT, out.solaref);
    };

    // ---------------------------------------------------------------------

    const num = (v) => Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0;

    const money = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    const addField = (form, id, type, value) => {
        const f = form.addField({ id: id, type: type, label: id });
        f.defaultValue = value || '';
    };

    const findPeLog = (paymentId) => {
        let best = null;
        search.create({
            type: PE_LOG_TYPE,
            filters: [['custrecord_transaction', 'anyof', paymentId]],
            columns: [
                search.createColumn({ name: 'created', sort: search.Sort.DESC }),
                'custrecord_pelogs_xrefnum',
                'custrecord_pelogs_xcardtype',
                'custrecord_pelogs_xmaskedcardnumber',
                'custrecord_pelogs_xresult',
                'custrecord_pelogs_xstatus',
                'custrecord_pelogs_xerror'
            ]
        }).run().each((r) => {
            const result = String(r.getValue('custrecord_pelogs_xresult') || '').toUpperCase();
            const status = String(r.getValue('custrecord_pelogs_xstatus') || '').toUpperCase();
            const approved = result === 'A' || status.indexOf('APPROV') === 0;
            if (!approved || !r.getValue('custrecord_pelogs_xrefnum')) return true;
            best = {
                refnum: r.getValue('custrecord_pelogs_xrefnum'),
                cardtype: r.getValue('custrecord_pelogs_xcardtype'),
                masked: r.getValue('custrecord_pelogs_xmaskedcardnumber')
            };
            return false;   // newest approved log wins
        });
        return best;
    };

    const brandFromNumber = (masked) => {
        const n = String(masked);
        if (/^3[47]/.test(n) || /^3/.test(n)) return 'Amex';   // first digit 3 = Amex for our customers
        if (/^4/.test(n)) return 'Visa';
        if (/^(5[1-5]|2[2-7])/.test(n) || /^5/.test(n)) return 'Mastercard';
        if (/^6/.test(n)) return 'Discover';
        return '';
    };

    const brandFromLabel = (label) => {
        const l = String(label).trim().toUpperCase();
        if (l.startsWith('V')) return 'Visa';
        if (l.startsWith('M')) return 'Mastercard';
        if (l.startsWith('A')) return 'Amex';
        if (l.startsWith('D')) return 'Discover';
        return '';
    };

    const normaliseBrand = (t) => {
        const s = String(t).toLowerCase();
        if (s.indexOf('visa') > -1) return 'Visa';
        if (s.indexOf('master') > -1 || s === 'mc') return 'Mastercard';
        if (s.indexOf('amex') > -1 || s.indexOf('american') > -1) return 'Amex';
        if (s.indexOf('disc') > -1) return 'Discover';
        return t;
    };

    return { beforeLoad };
});