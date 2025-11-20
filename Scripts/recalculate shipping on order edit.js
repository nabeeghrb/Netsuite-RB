/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
// Script to show dialog box on record save button when items on SO were edited, added or deleted
define(['N/ui/dialog'], function (dialog) {

    var itemsChanged = false;

    function markItemsChanged(context) {
        if (context.sublistId === 'item') {
            itemsChanged = true;
        }
    }

    function fieldChanged(context) {
        // Any change in the item sublist marks items as changed
        markItemsChanged(context);
    }

    function validateDelete(context) {
        // Deleting an item also counts as change
        markItemsChanged(context);
        return true; // always allow delete
    }

    function saveRecord(context) {
        if (itemsChanged) {
            // Just show the dialog; do NOT block saving
            dialog.alert({
                title: 'Recalculate Shipping',
                message: 'Items were added, modified, or removed. Please remember to recalculate shipping.'
            }).catch(function (e) {
                // ignore if the user just closes it
            });
        }

        // Always allow the record to save
        return true;
    }

    return {
        fieldChanged: fieldChanged,
        validateDelete: validateDelete,
        saveRecord: saveRecord
    };

});
