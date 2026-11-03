/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * RB | PO Shipping Account from Sales Order (UE)
 * Deploy on: Purchase Order
 *
 * Sets custbody_rb_shipping_acc on new DROP SHIP POs generated from a Sales Order,
 * based on the SO's shipping method:
 *   - SO ship method contains "UPS"   -> SO custbody_rb_default_ups_acc,   else 5R9E53
 *   - SO ship method contains "FedEx" -> SO custbody_rb_default_ferdex_acc, else 264596823
 *   - Any other ship method (or one naming both carriers) -> left blank
 *
 * Two paths:
 *   1. beforeLoad - user clicks "Drop Ship" on an SO line and the PO form opens:
 *      the account is pre-filled on the form so the user sees it before saving.
 *      Whatever the user leaves in the field (changed, or cleared) is what gets saved.
 *   2. afterSubmit - PO created without a form (e.g. automatically when the SO is saved):
 *      the account is filled after save.
 *
 * A hidden flag field marks POs that came through the form, so afterSubmit never
 * overrides a user's choice, including a deliberately blank field.
 * Special order and standard POs are ignored. Existing POs are not touched.
 *
 * Logging (deployment Log Level = Audit is enough):
 *   AUDIT "Shipping account pre-filled" - account shown on the form (beforeLoad)
 *   AUDIT "Shipping account set"        - account filled after save (afterSubmit)
 *   AUDIT "Skipped"                     - why a PO created from an SO was not updated
 *   ERROR "PO shipping account error"   - unexpected failure, with stack trace
 */
define(['N/record', 'N/log', 'N/runtime', 'N/ui/serverWidget'], (record, log, runtime, serverWidget) => {

    const PO_FIELD = 'custbody_rb_shipping_acc';
    const FORM_FLAG = 'custpage_rb_shipacc_form'; // 'T' when the PO was created through the drop ship form

    const CARRIERS = {
        UPS: {
            name: 'UPS',
            pattern: /\bUPS\b/i,
            soField: 'custbody_rb_default_ups_acc',
            fallback: '5R9E53'
        },
        FEDEX: {
            name: 'FedEx',
            pattern: /FEDEX/i,
            soField: 'custbody_rb_default_ferdex_acc',
            fallback: '264596823'
        }
    };

    // ---------------------------------------------------------------------------
    // beforeLoad: pre-fill the account when the drop ship PO form opens
    // ---------------------------------------------------------------------------
    const beforeLoad = (context) => {
        const T = context.UserEventType;
        if (context.type !== T.CREATE && context.type !== T.DROPSHIP) return;
        if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;

        const params = (context.request && context.request.parameters) || {};
        const poRec = context.newRecord;
        let soId = '';

        try {
            const isDropShipForm = context.type === T.DROPSHIP || params.dropship === 'T';
            if (!isDropShipForm || params.specord === 'T') return;

            soId = params.soid || poRec.getValue({ fieldId: 'createdfrom' });
            if (!soId) return;

            // Mark this PO as created through the form. afterSubmit leaves these alone,
            // so whatever the user saves (including blank) is final.
            const flag = context.form.addField({
                id: FORM_FLAG,
                type: serverWidget.FieldType.CHECKBOX,
                label: 'RB Shipping Account set on form'
            });
            flag.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
            flag.defaultValue = 'T';

            if (String(poRec.getValue({ fieldId: PO_FIELD }) || '').trim()) return;

            const so = record.load({ type: record.Type.SALES_ORDER, id: soId });
            const shipMethod = so.getText({ fieldId: 'shipmethod' }) || '';
            const carrier = getCarrier(shipMethod);
            if (!carrier) {
                log.audit('Skipped', `New drop ship PO form (SO ${soId}): ship method "${shipMethod}" is not UPS or FedEx`);
                return;
            }

            const soAccount = String(so.getValue({ fieldId: carrier.soField }) || '').trim();
            const account = soAccount || carrier.fallback;
            poRec.setValue({ fieldId: PO_FIELD, value: account });

            log.audit('Shipping account pre-filled',
                `New drop ship PO form (SO ${soId}): ${shipMethod} -> ${carrier.name} ` +
                `${soAccount ? 'customer default from SO' : 'house fallback'} (${account})`);
        } catch (e) {
            // Never block the form from opening; afterSubmit still covers the PO if the flag wasn't added
            log.error('PO shipping account error',
                `beforeLoad (SO ${soId}, event ${context.type}): ${e.name} - ${e.message}` +
                (e.stack ? ` | ${String(e.stack).substring(0, 1500)}` : ''));
        }
    };

    // ---------------------------------------------------------------------------
    // afterSubmit: fill the account on drop ship POs created without the form
    // ---------------------------------------------------------------------------
    const afterSubmit = (context) => {
        const T = context.UserEventType;
        if (context.type !== T.CREATE && context.type !== T.DROPSHIP) return;

        const poRec = context.newRecord;
        const poId = poRec.id;
        const ctx = `event ${context.type}, context ${runtime.executionContext}`;

        try {
            const soId = poRec.getValue({ fieldId: 'createdfrom' });
            if (!soId) return; // standalone PO, nothing to do

            // Created through the drop ship form: the user already saw (and could change) the value
            const formFlag = poRec.getValue({ fieldId: FORM_FLAG });
            if (formFlag === true || formFlag === 'T') return;

            // Respect a value the user entered on the PO at creation
            if (String(poRec.getValue({ fieldId: PO_FIELD }) || '').trim()) {
                log.audit('Skipped', `PO ${poId} (SO ${soId}): shipping account already entered, kept`);
                return;
            }

            const so = record.load({ type: record.Type.SALES_ORDER, id: soId });

            const dropShip = isDropShip(context, so, poId);
            if (!dropShip.result) {
                log.audit('Skipped', `PO ${poId} (SO ${soId}, ${ctx}): not a drop ship PO. ${dropShip.detail}`);
                return;
            }

            const shipMethod = so.getText({ fieldId: 'shipmethod' }) || '';
            const carrier = getCarrier(shipMethod);
            if (!carrier) {
                log.audit('Skipped', `PO ${poId} (SO ${soId}): ship method "${shipMethod}" is not UPS or FedEx`);
                return;
            }

            const soAccount = String(so.getValue({ fieldId: carrier.soField }) || '').trim();
            const account = soAccount || carrier.fallback;

            record.submitFields({
                type: record.Type.PURCHASE_ORDER,
                id: poId,
                values: { [PO_FIELD]: account },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });

            log.audit('Shipping account set',
                `PO ${poId} (SO ${soId}, ${ctx}): ${shipMethod} -> ${carrier.name} ` +
                `${soAccount ? 'customer default from SO' : 'house fallback'} (${account})`);
        } catch (e) {
            log.error('PO shipping account error',
                `PO ${poId} (${ctx}): ${e.name} - ${e.message}` +
                (e.stack ? ` | ${String(e.stack).substring(0, 1500)}` : ''));
        }
    };

    /** Returns the carrier config, or null if neither / both carriers match. */
    const getCarrier = (shipMethod) => {
        const isUps = CARRIERS.UPS.pattern.test(shipMethod);
        const isFedex = CARRIERS.FEDEX.pattern.test(shipMethod);
        if (isUps && !isFedex) return CARRIERS.UPS;
        if (isFedex && !isUps) return CARRIERS.FEDEX;
        return null; // e.g. "UPS / FedEx", USPS, Truck, Pickup
    };

    /**
     * Decides whether a PO saved without the form is a drop ship. Returns { result, detail }.
     * - Event type DROPSHIP -> true; SPECIALORDER -> false.
     * - Event type CREATE (e.g. auto-created when the SO is saved): the SO line's "createdpo"
     *   link may not be committed yet, so we match on SO lines marked Drop Shipment whose
     *   item is on this PO and that are unlinked or linked to it.
     * "detail" summarises the SO lines so a skipped PO can be investigated from the log.
     */
    const isDropShip = (context, so, poId) => {
        const T = context.UserEventType;
        if (context.type === T.DROPSHIP) return { result: true, detail: '' };
        if (context.type === T.SPECIALORDER) return { result: false, detail: 'Created as special order.' };

        const po = context.newRecord;
        const poItems = new Set();
        for (let i = 0; i < po.getLineCount({ sublistId: 'item' }); i++) {
            poItems.add(String(po.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })));
        }

        const lines = [];
        for (let i = 0; i < so.getLineCount({ sublistId: 'item' }); i++) {
            const createPo = so.getSublistValue({ sublistId: 'item', fieldId: 'createpo', line: i });
            const createdPo = so.getSublistValue({ sublistId: 'item', fieldId: 'createdpo', line: i });
            const item = String(so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            if (createPo === 'DropShip' && poItems.has(item)
                && (!createdPo || String(createdPo) === String(poId))) {
                return { result: true, detail: '' };
            }
            lines.push(`L${i} item ${item} createpo=${createPo || '-'} createdpo=${createdPo || '-'}`);
        }

        const detail = `PO items [${Array.from(poItems).join(', ')}]; SO lines: ${lines.join('; ')}`;
        return { result: false, detail: detail.substring(0, 3000) };
    };

    return { beforeLoad, afterSubmit };
});
