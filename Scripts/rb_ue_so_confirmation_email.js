/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Royal Bag - Sales Order Confirmation Email (from cs@royalbag.com)
 *
 * Sends the "Sales order confirmation" email (template custemailtmpl_rb_so_confirmation)
 * with the sales order PDF attached, FROM the Customer Service employee record,
 * for sales orders CREATED BY CELIGO that are NOT website orders.
 *
 * Skipped:
 *   - Orders created in the UI, CSV import, other scripts, etc. (context is not RESTLET)
 *   - Website orders synced by Celigo (custbody_rb_web_id has a value)
 *   - Edits (only runs on CREATE)
 *
 * Recipients: the sales order's Email field (the same address NetSuite's
 * "To Be Emailed" uses). If that is blank, falls back to the customer's email.
 *
 * Script parameters (set on the deployment):
 *   custscript_rb_soconf_author    (List/Record: Employee) - the Customer Service employee (cs@royalbag.com)
 *   custscript_rb_soconf_template  (Integer, optional)     - email template internal ID, default 218
 *
 * IMPORTANT: the Celigo flows must map "tobeemailed" = false, or the customer
 * gets two emails (one from NetSuite as Izzy, one from this script as CS).
 */
define(['N/runtime', 'N/render', 'N/email', 'N/search', 'N/log'],
    (runtime, render, email, search, log) => {

        const DEFAULT_TEMPLATE_ID = 218; // Sales order confirmation (custemailtmpl_rb_so_confirmation)

        const afterSubmit = (context) => {
            if (context.type !== context.UserEventType.CREATE) return;

            // Only orders saved by Celigo (Celigo's SuiteApp saves records through a RESTlet)
            if (runtime.executionContext !== runtime.ContextType.RESTLET) return;

            const so = context.newRecord;
            const soId = so.id;

            // Website orders synced by Celigo carry a web ID: skip them
            const webId = so.getValue({ fieldId: 'custbody_rb_web_id' });
            if (webId) {
                log.debug('Skipped - website order', `SO ${soId}, web id ${webId}`);
                return;
            }

            const script = runtime.getCurrentScript();
            const authorId = script.getParameter({ name: 'custscript_rb_soconf_author' });
            const templateId = Number(script.getParameter({ name: 'custscript_rb_soconf_template' })) || DEFAULT_TEMPLATE_ID;

            if (!authorId) {
                log.error('Missing author', 'Set custscript_rb_soconf_author on the deployment to the Customer Service employee.');
                return;
            }

            try {
                const customerId = so.getValue({ fieldId: 'entity' });
                const recipients = getRecipients(so, customerId);
                if (!recipients.length) {
                    log.audit('Skipped - no recipient email', `SO ${soId}`);
                    return;
                }

                // Subject + body from the same template NetSuite uses today
                const merged = render.mergeEmail({
                    templateId: templateId,
                    transactionId: Number(soId),
                    entity: { type: 'customer', id: Number(customerId) }
                });

                // Same PDF NetSuite attaches (the order's own print form)
                const pdf = render.transaction({
                    entityId: Number(soId),
                    printMode: render.PrintMode.PDF
                });
                const tranId = search.lookupFields({ type: search.Type.SALES_ORDER, id: soId, columns: ['tranid'] }).tranid;
                pdf.name = `Sales Order_${tranId}.pdf`;

                email.send({
                    author: Number(authorId),
                    recipients: recipients,
                    subject: merged.subject,
                    body: merged.body,
                    attachments: [pdf],
                    relatedRecords: {
                        transactionId: Number(soId),   // shows on the order's Communication tab
                        entityId: Number(customerId)
                    }
                });

                log.audit('Order confirmation sent', `SO ${tranId} -> ${recipients.length} recipient(s)`);
            } catch (e) {
                // Never block the order save; log and move on
                log.error('Order confirmation failed', `SO ${soId}: ${e.name} - ${e.message}`);
            }
        };

        /**
         * The SO's Email field, else the customer's email. Splits on comma/semicolon,
         * de-duplicates, and caps at NetSuite's 10-recipient limit.
         */
        const getRecipients = (so, customerId) => {
            let raw = so.getValue({ fieldId: 'email' }) || '';
            if (!raw && customerId) {
                const c = search.lookupFields({ type: search.Type.CUSTOMER, id: customerId, columns: ['email'] });
                raw = c.email || '';
            }
            const list = String(raw)
                .split(/[;,]/)
                .map(s => s.trim())
                .filter(s => s && s.indexOf('@') > 0);
            return [...new Set(list)].slice(0, 10);
        };

        return { afterSubmit };
    });