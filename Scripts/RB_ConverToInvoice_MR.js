/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/render', 'N/email', 'N/runtime'], function (record, search, render, email, runtime) {

    function getInputData() {
        
        // SalesOrd:E - some lines shipped and not invoiced (Pending Billing / Partially Fulfilled)
        // SalesOrd:F - all lines shipped and not invoiced (Pending Billing)
       return search.create({
          type: "salesorder",
          filters:
             [
                ["type", "anyof", "SalesOrd"],
                "AND",
                ["status", "anyof", ["SalesOrd:E", "SalesOrd:F"]],
                //"AND",
                //["custbody_rb_invoice_email_sent", "is", "F"],
                "AND",
                ["customer.custentity_rb_do_not_email", "is", "F"],
                "AND",
                ["mainline", "is", "T"]
 
             ],
          columns: ['internalid', 'entity']
       });
    }
 
    function map(context) {
       const result = JSON.parse(context.value);
       const salesOrderId = result.id;
       const customerId = result.values.entity.value;
       const customerTermsPrepaid = runtime.getCurrentScript().getParameter('custscript_rb_customer_terms_prepaid');
 
       log.debug('salesOrderId', salesOrderId);
       log.debug('customerId', customerId);
 
       try {
          const invoiceRecord = record.transform({
             fromType: record.Type.SALES_ORDER,
             fromId: salesOrderId,
             toType: record.Type.INVOICE
          });
 
          const customerLookup = search.lookupFields({
             type: record.Type.CUSTOMER,
             id: customerId,
             columns: ['custentity_invoice_emails', 'email', 'terms', 'custentity_rb_auto_email_inv']
          });
 
          const customerEmail = customerLookup.custentity_invoice_emails || customerLookup.email;
          log.debug('customerEmail', customerEmail);
 
          invoiceRecord.setValue({
             fieldId: 'email',
             value: customerEmail
          });
 
          const invoiceId = invoiceRecord.save();
 
          const customerTerms = customerLookup.terms[0]?.value;
          const autoEmailInv = customerLookup.custentity_rb_auto_email_inv;
 
          log.debug('customerTerms', customerTerms);
          log.debug('customerTermsPrepaid', customerTermsPrepaid);
          log.debug('autoEmailInv', autoEmailInv);
 
          if (customerEmail && ((customerTerms && customerTerms !== customerTermsPrepaid) || autoEmailInv)) {
 
             const invoiceRec = record.load({
                type: record.Type.INVOICE,
                id: invoiceId
             });
 
             const pdfFile = generatePDF(invoiceRec);
 
             const subject = `Your Invoice #${invoiceRec.getValue('tranid')} from RoyalBag`;
             const body = generateEmailBody(invoiceRec);
 
             const emailSender = runtime.getCurrentScript().getParameter('custscript_rb_email_sender_inv');
 
 
             email.send({
                author: emailSender,
                recipients: [customerEmail],
                subject: subject,
                body: body,
                attachments: [pdfFile],
                relatedRecords: {
                   transactionId: invoiceId
                }
             });
             log.debug('email sent');
             record.submitFields({
                type: record.Type.SALES_ORDER,
                id: salesOrderId,
                values: {
                   custbody_rb_invoice_email_sent: true
                }
             });
          } else {
             log.debug('No email sent due to some of these reasons:', {
                'customerEmail': customerEmail,
                'customerTerms': customerTerms,
                'customerTermsPrepaid': customerTermsPrepaid,
                'autoEmailInv': autoEmailInv
             });
          }
 
       } catch (error) {
          log.error('Error Processing Sales Order', error);
       }
    }
 
    function generateEmailBody(invoiceRec) {
       try {
          const renderer = render.create();
          const emailTemplate = runtime.getCurrentScript().getParameter('custscript_rb_email_template');
          renderer.setTemplateByScriptId(emailTemplate);
 
          renderer.addRecord({
             templateName: 'record',
             record: invoiceRec
          });
 
          const entityId = invoiceRec.getValue('entity');
          const entity = record.load({
             type: record.Type.CUSTOMER,
             id: entityId
          });
 
          renderer.addRecord({
             templateName: 'entity',
             record: entity
          });
 
          return renderer.renderAsString();
       } catch (error) {
          log.debug('Error generating email body', error);
       }
       
   }
 
    function generatePDF(invoiceRec) {
       try {
          const renderer = render.create();
          const invoiceTemplatePDF = runtime.getCurrentScript().getParameter('custscript_rb_invoice_pdf_template');
          renderer.setTemplateById(invoiceTemplatePDF);
 
          renderer.addRecord({
             templateName: 'record',
             record: invoiceRec
          });
 
          const pdfContent = renderer.renderAsString();
 
          const pdfFile = render.xmlToPdf({
             xmlString: pdfContent
          });
 
          const tranId = invoiceRec.getValue({ fieldId: 'tranid' });
          pdfFile.name = 'Invoice_' + tranId + '.pdf';
 
          return pdfFile;
       } catch (error) {
          log.debug('Error generating PDF', error);
       }
    }
 
    function summarize(summary) {
       summary.mapSummary.errors.iterator().each((key, error) => {
          log.error(`Error processing Sales Order ID ${key}`, error);
          return true;
       });
    }
 
    return {
       getInputData: getInputData,
       map: map,
       summarize: summarize
    };
 });
