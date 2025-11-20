/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
// Script to show dialog box right after when items on SO were edited, added or deleted.
define(['N/ui/dialog'], function (dialog) {

    var messageShown = false;

    function showShippingDialog() {
        if (!messageShown) {
            messageShown = true;

            return dialog.alert({
                title: 'Recalculate Shipping',
                message: 'You added, modified, or removed an item. Please remember to recalculate shipping.'
            }).catch(function (e) {
                // ignore if user closes the dialog
            });
        }
    }

    function fieldChanged(context) {
        if (context.sublistId === 'item') {
            showShippingDialog();
        }
    }

    function validateDelete(context) {
        if (context.sublistId === 'item') {
            showShippingDialog();
        }
        return true; // allow deletion
    }

    return {
        fieldChanged: fieldChanged,
        validateDelete: validateDelete
    };

});
