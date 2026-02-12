/**
 * DEBUG: Split for partial availability + set Create WO only for shortage.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/runtime', 'N/search', 'N/log'], (runtime, search, log) => {
  const SUBLIST = 'item';

  // Header fields
  const FLD_CUSTOMER = 'entity';
  const FLD_SHIPMETHOD = 'shipmethod';

  // Line fields
  const COL_ITEM = 'item';
  const COL_QTY = 'quantity';
  const COL_UNITS = 'units';
  const COL_PRICE = 'price';
  const COL_RATE = 'rate';
  const COL_CREATE_WO = 'createwo'; // confirm internal id on your line

  // Script parameters
  const PARAM_LOCATION_ID = 'custscript_rb_linden_location_id';
  const PARAM_CUSTOMER_ID = 'custscript_rb_target_customer_id';
  const PARAM_SHIPMETHOD_ID = 'custscript_rb_target_shipmethod_id';

  function safeGet(rec, sublistId, fieldId, line) {
    try { return rec.getSublistValue({ sublistId, fieldId, line }); }
    catch (e) { log.debug('safeGet failed', { fieldId, line, err: String(e) }); return null; }
  }

  function safeSet(rec, sublistId, fieldId, line, value) {
    try { rec.setSublistValue({ sublistId, fieldId, line, value }); }
    catch (e) { log.debug('safeSet failed', { fieldId, line, value, err: String(e) }); }
  }

  function getLocationQtyAvailable(itemId, locationId) {
    let qty = 0;
    search.create({
      type: search.Type.ITEM,
      filters: [
        ['internalid', 'anyof', itemId],
        'AND',
        ['inventorylocation', 'anyof', locationId]
      ],
      columns: ['locationquantityavailable']
    }).run().each(r => {
      qty = parseFloat(r.getValue('locationquantityavailable')) || 0;
      return false;
    });
    return qty;
  }

  function isAssemblyItem(itemId) {
    let typeTxt = '';
    search.create({
      type: search.Type.ITEM,
      filters: [['internalid', 'anyof', itemId]],
      columns: ['type']
    }).run().each(r => {
      typeTxt = r.getText('type') || '';
      return false;
    });
    const isAsm = String(typeTxt).toLowerCase().includes('assembly');
    return isAsm;
  }

  function beforeSubmit(context) {
    log.debug('START', { type: context.type, execContext: runtime.executionContext });

    if (context.type !== context.UserEventType.CREATE &&
        context.type !== context.UserEventType.EDIT) {
      log.debug('EXIT not create/edit', context.type);
      return;
    }

    const rec = context.newRecord;
    const script = runtime.getCurrentScript();

    const lindenLocationId = script.getParameter({ name: PARAM_LOCATION_ID });
    const targetCustomerId = script.getParameter({ name: PARAM_CUSTOMER_ID });
    const targetShipMethodId = script.getParameter({ name: PARAM_SHIPMETHOD_ID });

    log.debug('PARAMS', { lindenLocationId, targetCustomerId, targetShipMethodId });

    if (!lindenLocationId || !targetCustomerId || !targetShipMethodId) {
      log.debug('EXIT missing params', {});
      return;
    }

    const customerId = rec.getValue({ fieldId: FLD_CUSTOMER });
    const shipMethodId = rec.getValue({ fieldId: FLD_SHIPMETHOD });

    log.debug('HEADER', { customerId, shipMethodId });

    if (String(customerId) !== String(targetCustomerId)) {
      log.debug('EXIT customer mismatch', { customerId, targetCustomerId });
      return;
    }
    if (String(shipMethodId) !== String(targetShipMethodId)) {
      log.debug('EXIT shipmethod mismatch', { shipMethodId, targetShipMethodId });
      return;
    }

    const lineCount = rec.getLineCount({ sublistId: SUBLIST });
    log.debug('LINECOUNT', lineCount);
    if (!lineCount) return;

    // Bottom-up so insertLine doesn’t mess indexes
    for (let i = lineCount - 1; i >= 0; i--) {
      const itemId = safeGet(rec, SUBLIST, COL_ITEM, i);
      const orderedQty = parseFloat(safeGet(rec, SUBLIST, COL_QTY, i)) || 0;

      log.debug('LINE', { i, itemId, orderedQty });

      if (!itemId || orderedQty <= 0) continue;

      const asm = isAssemblyItem(itemId);
      if (!asm) {
        log.debug('SKIP not assembly', { i, itemId });
        continue;
      }

      const available = getLocationQtyAvailable(itemId, lindenLocationId);
      log.debug('AVAIL', { i, itemId, available, orderedQty });

      // enough inventory => ensure WO is off
      if (available >= orderedQty) {
        safeSet(rec, SUBLIST, COL_CREATE_WO, i, false);
        log.debug('DECISION', { i, action: 'no split, WO=false' });
        continue;
      }

      // zero inventory => no split, WO=true
      if (available <= 0) {
        safeSet(rec, SUBLIST, COL_CREATE_WO, i, true);
        log.debug('DECISION', { i, action: 'no split, WO=true (zero available)' });
        continue;
      }

      // partial => split + WO only on shortage line
      const shortage = orderedQty - available;

      const units = safeGet(rec, SUBLIST, COL_UNITS, i);
      const price = safeGet(rec, SUBLIST, COL_PRICE, i);
      const rate  = safeGet(rec, SUBLIST, COL_RATE, i);

      // Reduce original line to available qty and WO=false
      safeSet(rec, SUBLIST, COL_QTY, i, available);
      safeSet(rec, SUBLIST, COL_CREATE_WO, i, false);

      // Insert shortage line after current
      rec.insertLine({ sublistId: SUBLIST, line: i + 1 });

      safeSet(rec, SUBLIST, COL_ITEM, i + 1, itemId);
      safeSet(rec, SUBLIST, COL_QTY, i + 1, shortage);

      // Copy fields
      if (units != null && units !== '') safeSet(rec, SUBLIST, COL_UNITS, i + 1, units);
      if (price != null && price !== '') safeSet(rec, SUBLIST, COL_PRICE, i + 1, price);
      if (rate  != null && rate  !== '') safeSet(rec, SUBLIST, COL_RATE,  i + 1, rate);

      // shortage line => WO=true
      safeSet(rec, SUBLIST, COL_CREATE_WO, i + 1, true);

      log.debug('DECISION', {
        i,
        action: 'split',
        available,
        shortage,
        woOriginal: false,
        woShortage: true
      });
    }

    log.debug('END', {});
  }

  return { beforeSubmit };
});