/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
define(['N/search', 'N/ui/dialog'], function (search, dialog) {

    function saveRecord(context) {
        var rec = context.currentRecord;

        // Get PO Number (Customer PO# field on Sales Order)
        var poNum = rec.getValue({ fieldId: 'otherrefnum' });

        // If no PO number entered, allow save
        if (!poNum) {
            return true;
        }

        var currentId = rec.id; // will be null/undefined on create

        // Build filters
        var filters = [
            ['type', 'anyof', 'SalesOrd'], 'and',
            ['mainline', 'is', 'T'], 'and',
            ['otherrefnum', 'is', poNum]
        ];

        // Exclude this record if we're editing an existing SO
        if (currentId) {
            filters.push('and');
            filters.push(['internalid', 'noneof', currentId]);
        }

        // Search for existing SO(s) with this PO number
        var soSearch = search.create({
            type: search.Type.SALES_ORDER,
            filters: filters,
            columns: ['internalid']
        });

        var duplicateFound = false;

        soSearch.run().each(function (result) {
            duplicateFound = true;
            return false; // stop after first match
        });

        if (duplicateFound) {
            dialog.alert({
                title: 'Duplicate PO Number',
                message: 'The PO Number "' + poNum + '" is already used on another Sales Order. Please use a unique PO Number.'
            });
            // Cancel save
            return false;
        }

        // No duplicates, allow save
        return true;
    }

    return {
        saveRecord: saveRecord
    };
});