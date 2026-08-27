/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @appliedtorecord message
 *
 * Forces "Include Transaction" OFF when the quote being emailed contains
 * specific items.
 *
 *   beforeLoad   - renders the checkbox unchecked (and disabled) so the user
 *                  can see what will actually happen
 *   beforeSubmit - backstop that enforces it at send time
 */
define(['N/search', 'N/ui/serverWidget', 'N/ui/message', 'N/runtime', 'N/log'],
(search, serverWidget, message, runtime, log) => {
  'use strict';

  const ITEM_IDS_BLOCK_INCLUDE = ['38146'];
  const BANNER_TEXT = 'This quote contains an item that is not sent as a PDF. ' +
                      'The transaction will not be attached to this email.';

  // ------------------------------------------------------------------
  function beforeLoad(context) {
    try {
      if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
      if (context.type === context.UserEventType.DELETE) return;

      const txnId = resolveTxnId(context);
      log.debug({ title: 'beforeLoad txn', details: String(txnId) });
      if (!txnId) return;

      if (!quoteHasBlockedItem(txnId)) return;

      const form = context.form;

      // Uncheck it visually.
      try {
        const fld = form.getField({ id: 'includetransaction' });
        if (fld) {
          fld.defaultValue = 'F';
          // Grey it out so nobody re-checks it and expects an attachment.
          fld.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
        }
      } catch (e) {
        log.debug({ title: 'could not adjust field', details: e.message });
      }

      // Tell the user why.
      try {
        form.addPageInitMessage({
          type: message.Type.INFORMATION,
          title: 'No transaction attachment',
          message: BANNER_TEXT
        });
      } catch (e) {
        log.debug({ title: 'could not add banner', details: e.message });
      }

    } catch (e) {
      log.error({ title: 'beforeLoad failed', details: e });
    }
  }

  // ------------------------------------------------------------------
  function beforeSubmit(context) {
    try {
      const rec = context.newRecord;
      const txnId = rec.getValue({ fieldId: 'transaction' });
      if (!txnId) return;
      if (!quoteHasBlockedItem(txnId)) return;

      rec.setValue({ fieldId: 'includetransaction', value: false });
      log.audit({
        title: 'Include Transaction disabled',
        details: `Quote ${txnId}: includetransaction forced OFF`
      });
    } catch (e) {
      log.error({ title: 'beforeSubmit failed', details: e });
    }
  }

  // ------------------------------------------------------------------
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

  return { beforeLoad, beforeSubmit };
});
