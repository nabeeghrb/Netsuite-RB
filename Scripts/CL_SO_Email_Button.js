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
    function so_email_details(form_id) {
        try {
            var template = 630
            var SO_Obj = currentRecord.get()
            var SO_Id = SO_Obj.id;
            //display the prompt message to capture the deposit amount
            var depAmount = prompt("Please enter deposit amount that you would like to send", "");

            var isAmount = isNumber(depAmount);

            if (isAmount && depAmount != 0) {

                if (depAmount == "" || depAmount == 0 || depAmount == "0" || depAmount == "null") depAmount = 0;

                var suiturl1 = url.resolveScript({                                 //passing parameter
                    deploymentId: 'customdeploy1',
                    scriptId: 'customscript_sl_so_email_button',
                    params: {
                        'soid': form_id,
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