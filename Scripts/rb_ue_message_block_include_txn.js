/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @appliedtorecord message
 *
 * Defaults "Include Transaction" to unchecked when the quote being emailed
 * contains specific items. The checkbox stays editable so a user can turn it
 * back on deliberately, and whatever they leave on screen is what sends.
 */
define(['N/search', 'N/ui/message', 'N/runtime', 'N/log'],
(search, message, runtime, log) => {
  'use strict';

  const ITEM_IDS_BLOCK_INCLUDE = ['38146'];
  const BANNER_TEXT = 'This quote contains an item that is not sent as a PDF. ' +
                      'The transaction will not be attached to this email.';

  function beforeLoad(context) {
    try {
      if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
      if (context.type === context.UserEventType.DELETE) return;

      const txnId = resolveTxnId(context);
      log.debug({ title: 'beforeLoad txn', details: String(txnId) });
      if (!txnId) return;

      if (!quoteHasBlockedItem(txnId)) return;

      const form = context.form;

      // Uncheck by default, but leave the field fully editable.
      try {
        const fld = form.getField({ id: 'includetransaction' });
        if (fld) fld.defaultValue = 'F';
      } catch (e) {
        log.debug({ title: 'could not set default', details: e.message });
      }

      // Explain why, and make clear it can be overridden.
      try {
        form.addPageInitMessage({
          type: message.Type.INFORMATION,
          title: 'Transaction not attached',
          message: BANNER_TEXT
        });
      } catch (e) {
        log.debug({ title: 'could not add banner', details: e.message });
      }

    } catch (e) {
      log.error({ title: 'beforeLoad failed', details: e });
    }
  }

  /**
   * At load time the record may not have the transaction populated yet,
   * so fall back to the URL parameters the email page was opened with.
   */
  function resolveTxnId(context) {
    try {
      const v = context.newRecord.getValue({ fieldId: 'transaction' });
      if (v) return String(v);
    } catch (e) { /* not present */ }

    const params = (context.request && context.request.parameters) || {};
    log.debug({ title: 'beforeLoad params', details: JSON.stringify(params) });

    const keys = ['transaction', 'transactionId', 'transactionid', 'trans', 'record', 'id'];
    for (const k of keys) {
      const v = params[k];
      if (v && /^\d+$/.test(String(v))) return String(v);
    }
    return null;
  }

  function quoteHasBlockedItem(txnId) {
    try {
      const rows = search.create({
        type: search.Type.ESTIMATE,
        filters: [
          ['internalid', 'anyof', txnId], 'AND',
          ['mainline', 'is', 'F'], 'AND',
          ['item', 'anyof', ITEM_IDS_BLOCK_INCLUDE]
        ],
        columns: ['internalid']
      }).run().getRange({ start: 0, end: 1 });
      return rows.length > 0;
    } catch (e) {
      log.error({ title: 'item search failed', details: e.message });
      return false;
    }
  }

  return { beforeLoad };
});