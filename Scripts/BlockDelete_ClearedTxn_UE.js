/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/log'], (search, log) => {

  function beforeSubmit(context) {

    if (context.type !== context.UserEventType.DELETE) return;

    const rec = context.newRecord;
    const txnId = rec.id;
    const txnNumber = rec.getValue({ fieldId: 'tranid' });

    if (!txnId) return;

    const isCleared = isTransactionCleared(txnId);

    if (isCleared) {

      throw new Error(
        'Delete Not Allowed\n\n' +
        'Transaction ' + txnNumber + ' has already been reconciled and cannot be deleted.\n\n' +
        'Please void the transaction or contact Accounting to unreconcile it first.'
      );

    }
  }

  function isTransactionCleared(txnInternalId) {

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

    return s.run().getRange({ start: 0, end: 1 }).length > 0;
  }

  return { beforeSubmit };

});