/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @appliedtorecord message
 *
 * Forces "Include Transaction" OFF when the quote being emailed contains
 * specific items.
 */
define(['N/search', 'N/log'], (search, log) => {
  'use strict';

  // Item internal IDs that should never send with "Include Transaction" checked
  const ITEM_IDS_BLOCK_INCLUDE = ['38146'];

  function beforeSubmit(context) {
    try {
      const rec = context.newRecord;

      const txnId = rec.getValue({ fieldId: 'transaction' });
      if (!txnId) return;

      if (!quoteHasBlockedItem(txnId)) return;

      rec.setValue({ fieldId: 'includetransaction', value: false });

      log.audit({
        title: 'Include Transaction disabled',
        details: `Quote ${txnId}: contains blocked item, includetransaction forced OFF`
      });
    } catch (e) {
      log.error({ title: 'UE beforeSubmit failed', details: e });
    }
  }

  /**
   * Type is pinned to estimate, so emailing a sales order, invoice or anything
   * else returns zero rows and the checkbox is left alone.
   */
  function quoteHasBlockedItem(txnId) {
    const rows = search.create({
      type: search.Type.ESTIMATE,
      filters: [
        ['internalid', 'anyof', txnId], 'AND',
        ['mainline', 'is', 'F'], 'AND',
        ['taxline', 'is', 'F'], 'AND',
        ['shipping', 'is', 'F'], 'AND',
        ['item', 'anyof', ITEM_IDS_BLOCK_INCLUDE]
      ],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });

    return rows.length > 0;
  }

  return { beforeSubmit };
});
