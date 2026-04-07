/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/log'], function(search, record, log) {

    // Maximum residual balance allowed for adjustment
    var TOLERANCE = 0.03;

    // Internal ID of the Rounding Adjustment Discount Item
    var ROUNDING_ITEM_ID = 56072;

    function execute(context) {

        log.audit('Rounding Adjustment', 'Script execution started');

        var invoiceSearch = search.load({
            id: 'customsearch4269' 
        });

        invoiceSearch.run().each(function(result) {

            var invoiceId = result.id;

            try {

                // Use the engine field, not UI box fields
                var amountDue = parseFloat(result.getValue({
                    name: 'amountremaining'
                })) || 0;

                // Only process small positive residual balances
                if (amountDue <= 0 || amountDue > TOLERANCE) {
                    return true;
                }

                var invoice = record.load({
                    type: record.Type.INVOICE,
                    id: invoiceId,
                    isDynamic: false
                });

                var lineCount = invoice.getLineCount({ sublistId: 'item' });
                var discountLine = -1;

                // Search for any existing Discount Item line
                for (var i = 0; i < lineCount; i++) {

                    var itemType = invoice.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemtype',
                        line: i
                    });

                    if (itemType === 'Discount') {
                        discountLine = i;
                        break;
                    }
                }

                if (discountLine >= 0) {

                    // Adjust existing Discount Item via rate
                    var currentRate = parseFloat(invoice.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        line: discountLine
                    })) || 0;

                    var newRate = currentRate - amountDue;

                    invoice.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        line: discountLine,
                        value: newRate
                    });

                    log.audit('Discount Adjusted', {
                        invoiceId: invoiceId,
                        previousRate: currentRate,
                        newRate: newRate
                    });

                } else {

                    // Insert rounding adjustment Discount Item
                    invoice.insertLine({
                        sublistId: 'item',
                        line: lineCount
                    });

                    invoice.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: lineCount,
                        value: ROUNDING_ITEM_ID
                    });

                    invoice.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        line: lineCount,
                        value: -amountDue
                    });

                    log.audit('Rounding Adjustment Inserted', {
                        invoiceId: invoiceId,
                        rate: -amountDue
                    });
                }

                var savedId = invoice.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                log.audit('Invoice Saved', savedId);

            } catch (e) {

                log.error('Invoice Processing Error', {
                    invoiceId: invoiceId,
                    message: e.message,
                    stack: e.stack
                });
            }

            return true;
        });

        log.audit('Rounding Adjustment', 'Script execution finished');
    }

    return {
        execute: execute
    };
});