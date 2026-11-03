/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * RB | PO Shipping Account from Sales Order (UE)
 * Deploy on: Purchase Order
 *
 * On creation of a DROP SHIP PO generated from a Sales Order, sets
 * custbody_rb_shipping_acc based on the SO's shipping method:
 *   - SO ship method contains "UPS"   -> SO custbody_rb_default_ups_acc,   else 5R9E53
 *   - SO ship method contains "FedEx" -> SO custbody_rb_default_ferdex_acc, else 264596823
 *   - Any other ship method (or one naming both carriers) -> left blank
 * Special order and standard POs are ignored. Existing POs are not touched.
 * If the user already entered a value on the PO at creation, it is kept.
 * The field stays editable after creation (script runs on create only).
 *
 * Logging (deployment Log Level = Audit is enough):
 *   AUDIT "Shipping account set"  - success, with carrier and source (customer default / fallback)
 *   AUDIT "Skipped"               - why a create/drop ship PO was not updated
 *   ERROR "PO shipping account error" - unexpected failure, with stack trace
 */
define(['N/record', 'N/log', 'N/runtime'], (record, log, runtime) => {

    const PO_FIELD = 'custbody_rb_shipping_acc';

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

    const afterSubmit = (context) => {
        const T = context.UserEventType;
        if (context.type !== T.CREATE && context.type !== T.DROPSHIP) return;

        const poRec = context.newRecord;
        const poId = poRec.id;
        const ctx = `event ${context.type}, context ${runtime.executionContext}`;

        try {
            const soId = poRec.getValue({ fieldId: 'createdfrom' });
            if (!soId) return; // standalone PO, nothing to do

            // Respect a value the user entered on the PO at creation
            if (String(poRec.getValue({ fieldId: PO_FIELD }) || '').trim()) {
                log.audit('Skipped', `PO ${poId} (SO ${soId}): user-entered shipping account kept`);
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
                `PO ${poId} (SO ${soId}): ${shipMethod} -> ${carrier.name} ` +
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
     * Decides whether the new PO is a drop ship. Returns { result, detail }.
     * - Created from the SO line "Drop Ship" link -> event type DROPSHIP.
     * - Created from the SO line "Special Order" link -> event type SPECIALORDER.
     * - Created automatically when the SO is saved -> event type CREATE. At that moment
     *   the SO line's "createdpo" link may not be committed yet, so we match on SO lines
     *   marked Drop Shipment whose item is on this PO and that are unlinked or linked to it.
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

    return { afterSubmit };
});