/**
 *@NApiVersion 2.x
 *@NScriptType ClientScript
 */
define(['N/currentRecord', 'N/url', 'N/record', 'N/runtime'], function (currentRecord, url, record, runtime) {

    function pageInit(context) {

    }

    function saveRecord(context) {

    }

    function validateField(context) {

    }

    function fieldChanged(context) {

    }

    function postSourcing(context) {

    }

    function lineInit(context) {

    }

    function validateDelete(context) {

    }

    function validateInsert(context) {

    }

    function validateLine(context) {

    }

    function sublistChanged(context) {

    }
    function isNumber(n) {
        return !isNaN(parseFloat(n)) && isFinite(n);
    }

    // ADDED: returns the amount to pre-fill in the prompt
    // Custom order     -> Deposit Amount Due, falling back to SO Amount Remaining if empty/0
    // Not custom order -> SO Amount Remaining
    // NOTE: the two amount fields are non-stored formula fields, so search.lookupFields
    // returns them blank. Loading the record makes NetSuite calculate them.
    function getDefaultDepositAmount(soId) {
        var soRec = record.load({
            type: record.Type.SALES_ORDER,
            id: soId
        });

        var customFlag = soRec.getValue({ fieldId: 'custbody_rb_custom_production' });
        var isCustom = customFlag === true || customFlag === 'T';
        var depositDue = parseFloat(soRec.getValue({ fieldId: 'custbody_rb_depositamountdue' })) || 0;
        var amountRemaining = parseFloat(soRec.getValue({ fieldId: 'custbody_rb_soamountremaining' })) || 0;

        var amount = (isCustom && depositDue > 0) ? depositDue : amountRemaining;
        return amount > 0 ? amount.toFixed(2) : '';
    }

    function so_email_details(form_id) {
        try {
            var template = 630
            var SO_Obj = currentRecord.get()
            var SO_Id = form_id || SO_Obj.id;

            // ADDED: pre-fill the prompt based on custom / non-custom order
            var defaultAmount = getDefaultDepositAmount(SO_Id);

            //display the prompt message to capture the deposit amount
            var depAmount = prompt("Please enter deposit amount that you would like to send", defaultAmount);

            // ADDED: user clicked Cancel - stop quietly instead of showing an error
            if (depAmount === null) return false;

            // ADDED: allow amounts typed with commas, e.g. 1,250.00
            depAmount = String(depAmount).replace(/,/g, '').trim();

            var isAmount = isNumber(depAmount);

            if (isAmount && parseFloat(depAmount) > 0) {

                var suiturl1 = url.resolveScript({                                 //passing parameter
                    deploymentId: 'customdeploy1',
                    scriptId: 'customscript_sl_so_email_button',
                    params: {
                        'soid': SO_Id,
                        'template_id': template,
                        "depAmount": depAmount
                    }
                })
                window.open(suiturl1, '_self'); //open page
            }
            else {
                alert("Please enter correct amount");
                return false;
            }

        } catch (error) { alert(error) }
    }
    return {
        pageInit: pageInit,
        //saveRecord: saveRecord,
        // validateField: validateField,
        //fieldChanged: fieldChanged,
        //postSourcing: postSourcing,
        // lineInit: lineInit,
        // validateDelete: validateDelete,
        // validateInsert: validateInsert,
        // validateLine: validateLine,
        // sublistChanged: sublistChanged
        so_email_details: so_email_details,
    }
});