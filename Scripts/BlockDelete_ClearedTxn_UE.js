/**
 * Block deleting bank-impacting transactions that are already cleared/matched for reconciliation.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/error', 'N/log'], (search, error, log) => {
  function beforeSubmit(context) {
    // Only act on DELETE
    if (context.type !== context.UserEventType.DELETE) return;

    const rec = context.newRecord;
    const txnId = rec.id;

    // Safety: some contexts may not provide an id (rare), so fail open instead of blocking everything
    if (!txnId) {
      log.debug({ title: 'Skip block (no id)', details: 'No internal id available in beforeSubmit DELETE.' });
      return;
    }

    // Check the TransactionSearch "cleared" flag for this transaction.
    // "cleared" is a standard TransactionSearch filter. :contentReference[oaicite:4]{index=4}
    const isCleared = isTransactionCleared(txnId);

    if (isCleared) {
      throw error.create({
        name: 'RB_TXN_RECONCILED_DELETE_BLOCKED',
        message:
          'This transaction is already cleared/matched for bank reconciliation and cannot be deleted. ' +
          'Please void/reverse per accounting policy (or unreconcile it properly) instead of deleting.',
        notifyOff: false
      });
    }
  }

  function isTransactionCleared(txnInternalId) {
    // Transaction search is the standard search record for nearly all transaction types. :contentReference[oaicite:5]{index=5}
    const s = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ['internalid', 'anyof', txnInternalId],
        'AND',
        ['mainline', 'is', 'T'],
        'AND',
        ['cleared', 'is', 'T']
      ],
      columns: ['internalid']
    });

    const r = s.run().getRange({ start: 0, end: 1 });
    return !!(r && r.length);
  }

  return { beforeSubmit };
});
