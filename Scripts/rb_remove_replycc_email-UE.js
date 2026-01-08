/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * 
 * @author RoyalBag
 * @description Removes company email addresses from Additional Recipients 
 *              when composing a Reply All to prevent sending to ourselves
 */
define(['N/log'], function(log) {

    const EMAILS_TO_REMOVE = [
        'CustomerService@royalbag.com','cs@royalbag.com','orders@royalabg.com'
    ].map(e => e.trim().toLowerCase());

    /**
     * Removes company email addresses from the Additional Recipients sublist
     * when composing a reply to prevent sending to ourselves
     * @param {Object} context
     */
    function beforeLoad(context) {
        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        try {
            const newRecord = context.newRecord;
            const compose = newRecord.getValue('compose');

            // Only run for Reply All scenarios
            if (compose !== 'REPLY_TO_ALL') {
                return;
            }

            const lineCount = newRecord.getLineCount({ sublistId: 'otherrecipientslist' });

            // Find lines to remove (iterate backwards to avoid index issues)
            for (let i = lineCount - 1; i >= 0; i--) {
                const email = newRecord.getSublistValue({
                    sublistId: 'otherrecipientslist',
                    fieldId: 'email',
                    line: i
                });

                if (email && EMAILS_TO_REMOVE.includes(email.toLowerCase())) {
                    newRecord.removeLine({
                        sublistId: 'otherrecipientslist',
                        line: i
                    });
                    log.debug('Removed Recipient', `Removed ${email} from Additional Recipients`);
                }
            }

        } catch (error) {
            log.error('Error in beforeLoad - Remove Recipients', error);
        }
    }

    return {
        beforeLoad: beforeLoad
    };
});