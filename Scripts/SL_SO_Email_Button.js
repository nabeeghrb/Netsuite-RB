/**
 *@NApiVersion 2.x
 *@NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/file', 'N/search', 'N/redirect', 'N/email', 'N/render', 'N/record', 'N/config', 'N/url'],
    function (serverWidget, runtime, file, search, redirect, email, render, record, config, url) {
        function onRequest(context) {
            try {
                var parameters = context.request.parameters                     //get parameters
                log.debug({ title: 'parameters', details: parameters })
                var salesordId = parameters.soid || '123';
                log.debug({ title: 'salesordId', details: salesordId })
                var SOId = parseInt(salesordId)
                log.debug({ title: typeof (SOId), details: SOId })
                var Parameters = runtime.getCurrentScript();
                var Template_Id = Parameters.getParameter({ name: 'custscript_email_link_template' })
                log.debug({ title: 'Template_Id', details: Template_Id })
                var mergeResult = render.mergeEmail({                          //get template for email
                    templateId: Template_Id,
                    transactionId: SOId,
                });

                //get the deposit amount captured in client script
                var depAmount = parameters.depAmount || 0;
                log.debug({ title: 'depAmount', details: depAmount })

                var so_load = record.load({                                //load so
                    type: record.Type.SALES_ORDER,
                    id: SOId,
                });
                var get_tranid = so_load.getValue({ fieldId: 'tranid' });
                var get_entity = so_load.getValue({ fieldId: 'entity' });
                var get_customer_name = so_load.getText({ fieldId: 'entity' });
                //var get_form = so_load.getValue({ fieldId: 'customform' });
                var get_date = so_load.getValue({ fieldId: 'trandate' });

                //added condition to check if deposit amount is greater than 0 then add that amount to payment link else add full SO amount
                var get_amount = 0;
                if (parseFloat(depAmount) == 0)
                    get_amount = so_load.getValue({ fieldId: 'total' });   // CHANGED: getValue returns a plain number (getText could return "1,234.56")
                else
                    get_amount = depAmount;

                var companyObj = config.load({ type: config.Type.COMPANY_INFORMATION });     //get company information
                var reqstrDBA = companyObj.getValue({ fieldId: 'companyname' })
                var customerFieldLookUp = search.lookupFields({                 //lookup customer fields
                    type: search.Type.CUSTOMER,
                    id: get_entity,
                    columns: ['email', 'companyname','firstname','lastname']
                });
                var customerName = customerFieldLookUp.companyname == "" ? customerFieldLookUp.firstname +" "+customerFieldLookUp.lastname : customerFieldLookUp.companyname
                var merchantPaymentURL = search.lookupFields({
                    type: 'customrecord_pe_account',
                    id: 1,
                    columns: ['custrecord_merchant_payment_url']
                });
                log.debug('merchantPaymentURL', merchantPaymentURL.custrecord_merchant_payment_url);

                //get the currency name
                var currencyId = so_load.getValue("currency");
                var xCurrency;
                if (currencyId) {
                    var fieldLookUp = search.lookupFields({
                        type: 'currency',
                        id: currencyId,
                        columns: ['symbol']
                    });
                    xCurrency = fieldLookUp.symbol;
                    log.debug("Salesorder currency", xCurrency);
                }

                var billingCity;
                var billingPhone;
                var billingState;
                var billingAdd;
                var billingzip;
                var customerSearchObj = search.create({
                    type: "customer",
                    filters: [
                        ["internalid", "anyof", get_entity]
                    ],
                    columns: [
                        search.createColumn({
                            name: "billcity",
                            label: "Billing City"
                        }),
                        search.createColumn({
                            name: "billphone",
                            label: "Billing Phone"
                        }),
                        search.createColumn({
                            name: "billstate",
                            label: "Billing State/Province"
                        }),
                        search.createColumn({
                            name: "address1",
                            label: "Billing Address"
                        }),
                        search.createColumn({
                            name: "billzipcode",
                            label: "Billing Zip"
                        }),
                    ]
                });
                var searchResultCount = customerSearchObj.runPaged()
                    .count;
                customerSearchObj.run()
                    .each(function (result) {
                        billingCity = result.getValue({
                            name: "billcity"
                        });
                        billingPhone = result.getValue({
                            name: "billphone"
                        });
                        billingState = result.getValue({
                            name: "billstate"
                        });
                        billingAdd = result.getValue({
                            name: "address1"
                        });
                        billingzip = result.getValue({
                            name: "billzip"
                        });
                        return true;
                    });

                var redirectURL = url.resolveScript({
                    scriptId: 'customscript_sl_so_email_cstmrdpst',            //redirect to customer deposit script
                    deploymentId: 'customdeploy1',
                    returnExternalUrl: true,
                    params: {
                        recordInternalId: SOId,
                        CustmId: get_entity
                    }
                });

                log.debug({ title: 'redirectURL', details: redirectURL });

                var paymentGatewayUrlStr = merchantPaymentURL.custrecord_merchant_payment_url + '?xName=' + encodeURIComponent(customerFieldLookUp.companyname) + '&xCurrency=' + encodeURIComponent(xCurrency)+'&xInvoice=' + encodeURIComponent(get_tranid) + '&xAmount=' + encodeURIComponent(get_amount) + '&xEmail=' + encodeURIComponent(customerFieldLookUp.email) + '&xZip=' + encodeURIComponent(billingzip) + '&xbillcity=' + encodeURIComponent(billingCity) + '&xBillState=' + encodeURIComponent(billingState) + '&xBillPhone=' + encodeURIComponent(billingPhone) + '&xStreet=' + encodeURIComponent(billingAdd) + '&xRedirectURL=' + encodeURIComponent(redirectURL);
                log.debug({ title: 'paymentGatewayUrlStr', details: paymentGatewayUrlStr });                //set value for email template
                var emailSubject = mergeResult.subject;
                var emailBody = mergeResult.body;

                emailSubject = emailSubject.replace(/{{reqstrDBA}}/g, reqstrDBA);
                emailBody = emailBody.replace(/{{customerName}}/g, customerName);
                emailBody = emailBody.replace(/{{order_number}}/g, get_tranid);
                emailBody = emailBody.replace(/{{Date}}/g, get_date);
                emailBody = emailBody.replace(/{{paymentGatewayUrl}}/g, paymentGatewayUrlStr);
                emailBody = emailBody.replace(/{{reqstrDBA}}/g, reqstrDBA);

                // ADDED: format the deposit amount (e.g. $1,250.00) and fill the {{depositAmount}} placeholder
                var formattedAmount = (xCurrency || '$') +
                    Number(get_amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                log.debug({ title: 'formattedAmount', details: formattedAmount });
                emailSubject = emailSubject.replace(/{{depositAmount}}/g, formattedAmount);
                emailBody = emailBody.replace(/{{depositAmount}}/g, formattedAmount);

                var xmlTmplFile = file.load('./Invoice_receipt.xml');
                var myFile = render.create();
                myFile.templateContent = xmlTmplFile.getContents();
                myFile.addRecord('record', record.load({
                    type: record.Type.SALES_ORDER,
                    id: SOId,
                }));
                var salesOrderPdf = myFile.renderAsPdf();
                salesOrderPdf.name = get_tranid + '.pdf'
                var userId = runtime.getCurrentUser()
                    .id;
                email.send({                              //send email and attach with salesorder
                    author: userId,
                    recipients: customerFieldLookUp.email,
                    subject: emailSubject,
                    body: emailBody,
                    attachments: [salesOrderPdf],
                    relatedRecords: {
                        transactionId: SOId
                    }
                });
                redirect.toRecord({
                    id: salesordId,
                    type: record.Type.SALES_ORDER,
                })


            }
            catch (error) {
                log.debug({ title: 'error', details: error })
            }
        }
        return {
            onRequest: onRequest
        }
    })