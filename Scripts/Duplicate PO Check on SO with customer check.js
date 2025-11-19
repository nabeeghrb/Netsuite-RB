/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
define(['N/search', 'N/ui/dialog', 'N/log'], function (search, dialog, log) {

    function saveRecord(context) {
        var rec = context.currentRecord;

        var poNum = rec.getValue({ fieldId: 'otherrefnum' });
        var customerId = rec.getValue({ fieldId: 'entity' });

        // Normalize PO
        if (poNum && typeof poNum === 'string') {
            poNum = poNum.trim();
        }

        // If no PO or no customer, skip check
        if (!poNum || !customerId) {
            return true;
        }

        var currentId = rec.id || null; // null on create

        log.debug({
            title: 'Duplicate PO Check - Input',
            details: {
                customerId: customerId,
                poNum: poNum,
                currentSalesOrderId: currentId
            }
        });

        // 1) Search broadly: same customer, PO not empty
        var filters = [
            ['mainline', 'is', 'T'], 'and',
            ['entity', 'anyof', customerId], 'and',
            ['otherrefnum', 'isnotempty', '']
        ];

        var soSearch = search.create({
            type: search.Type.SALES_ORDER,
            filters: filters,
            columns: [
                'internalid',
                'tranid',
                'otherrefnum'
            ]
        });

        var duplicateFound = false;
        var dupTranId = '';
        var dupInternalId = '';
        var dupPoValue = '';

        var targetPo = poNum.toLowerCase();

        soSearch.run().each(function (result) {
            var internalId = result.getValue({ name: 'internalid' });
            var tranid = result.getValue({ name: 'tranid' });
            var otherPo = result.getValue({ name: 'otherrefnum' });

            if (otherPo && typeof otherPo === 'string') {
                otherPo = otherPo.trim();
            }

            log.debug({
                title: 'PO Candidate',
                details: {
                    internalId: internalId,
                    tranid: tranid,
                    otherrefnum: otherPo
                }
            });

            // Skip current record when editing
            if (currentId && String(internalId) === String(currentId)) {
                return true; // keep searching
            }

            // 2) Exact comparison in JS
            if (otherPo && otherPo.toLowerCase() === targetPo) {
                duplicateFound = true;
                dupInternalId = internalId;
                dupTranId = tranid;
                dupPoValue = otherPo;
                return false; // stop after first real match
            }

            return true; // continue searching
        });

        if (duplicateFound) {
            log.debug({
                title: 'Duplicate PO Confirmed',
                details: {
                    duplicateSalesOrderId: dupInternalId,
                    tranid: dupTranId,
                    otherrefnum: dupPoValue
                }
            });

            var msg = 'The PO Number "' + poNum +
                '" is already used on Sales Order ' + dupTranId +
                ' for this customer.\n\n';

            dialog.alert({
                title: 'Duplicate PO Number for Customer',
                message: msg
            });

            // Block save (change to true if you only want a warning)
            return false;
        }

        return true;
    }

    return {
        saveRecord: saveRecord
    };
});