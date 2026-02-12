/**
 * DEBUG: Split SO assembly lines based on location available qty (Linden),
 * copying units/price/rate to the shortage line, with verbose logging.
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

  // Script parameters
  const PARAM_LOCATION_ID = 'custscript_rb_linden_location_id';
  const PARAM_CUSTOMER_ID = 'custscript_rb_target_customer_id';
  const PARAM_SHIPMETHOD_ID = 'custscript_rb_target_shipmethod_id';

  function safeGetSublistValue(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({ sublistId, fieldId, line });
    } catch (e) {
      log.debug('safeGetSublistValue missing field', { fieldId, line, err: String(e) });
      return null;
    }
  }

  function safeSetSublistValue(rec, sublistId, fieldId, line, value) {
    try {
      if (value === null || value === '' || typeof value === 'undefined') return;
      rec.setSublistValue({ sublistId, fieldId, line, value });
    } catch (e) {
      log.debug('safeSetSublistValue missing field', { fieldId, line, value, err: String(e) });
    }
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
    return String(typeTxt).toLowerCase().includes('assembly');
  }

  function beforeSubmit(context) {
    log.debug('Auto Split DEBUG - Start', { type: context.type });

    if (context.type !== context.UserEventType.CREATE &&
        context.type !== context.UserEventType.EDIT) {
      log.debug('Exit: not create/edit', context.type);
      return;
    }

    const rec = context.newRecord;

    const script = runtime.getCurrentScript();
    const lindenLocationId = script.getParameter({ name: PARAM_LOCATION_ID });
    const targetCustomerId = script.getParameter({ name: PARAM_CUSTOMER_ID });
    const targetShipMethodId = script.getParameter({ name: PARAM_SHIPMETHOD_ID });

    log.debug('Params', { lindenLocationId, targetCustomerId, targetShipMethodId });

    if (!lindenLocationId || !targetCustomerId || !targetShipMethodId) {
      log.debug('Exit: missing params', {});
      return;
    }

    const customerId = rec.getValue({ fieldId: FLD_CUSTOMER });
    const shipMethodId = rec.getValue({ fieldId: FLD_SHIPMETHOD });

    log.debug('Header', { customerId, shipMethodId });

    if (String(customerId) !== String(targetCustomerId)) {
      log.debug('Exit: customer mismatch', { customerId, targetCustomerId });
      return;
    }
    if (String(shipMethodId) !== String(targetShipMethodId)) {
      log.debug('Exit: ship method mismatch', { shipMethodId, targetShipMethodId });
      return;
    }

    const lineCount = rec.getLineCount({ sublistId: SUBLIST });
    log.debug('LineCount', lineCount);

    for (let i = lineCount - 1; i >= 0; i--) {
      const itemId = safeGetSublistValue(rec, SUBLIST, COL_ITEM, i);
      const orderedQty = parseFloat(safeGetSublistValue(rec, SUBLIST, COL_QTY, i)) || 0;

      log.debug('Line Snapshot', { line: i, itemId, orderedQty });

      if (!itemId || orderedQty <= 0) {
        log.debug('Skip: missing item or qty', { line: i });
        continue;
      }

      const isAsm = isAssemblyItem(itemId);
      if (!isAsm) {
        log.debug('Skip: not assembly', { line: i, itemId });
        continue;
      }

      const available = getLocationQtyAvailable(itemId, lindenLocationId);
      log.debug('Availability', { line: i, itemId, available });

      if (available <= 0) {
        log.debug('No split: available <= 0', { line: i, itemId });
        continue;
      }
      if (available >= orderedQty) {
        log.debug('No split: enough available', { line: i, itemId, available, orderedQty });
        continue;
      }

      const shortage = orderedQty - available;

      const units = safeGetSublistValue(rec, SUBLIST, COL_UNITS, i);
      const price = safeGetSublistValue(rec, SUBLIST, COL_PRICE, i);
      const rate = safeGetSublistValue(rec, SUBLIST, COL_RATE, i);

      log.debug('Copy Fields', { line: i, units, price, rate, shortage });

      // Reduce original line to available qty
      safeSetSublistValue(rec, SUBLIST, COL_QTY, i, available);

      // Insert shortage line
      rec.insertLine({ sublistId: SUBLIST, line: i + 1 });

      safeSetSublistValue(rec, SUBLIST, COL_ITEM, i + 1, itemId);
      safeSetSublistValue(rec, SUBLIST, COL_QTY, i + 1, shortage);
      safeSetSublistValue(rec, SUBLIST, COL_UNITS, i + 1, units);
      safeSetSublistValue(rec, SUBLIST, COL_PRICE, i + 1, price);
      safeSetSublistValue(rec, SUBLIST, COL_RATE, i + 1, rate);

      log.debug('Split Complete', {
        originalLine: i,
        shortageLine: i + 1,
        itemId,
        available,
        orderedQty,
        shortage
      });
    }

    log.debug('Auto Split DEBUG - End', {});
  }

  return { beforeSubmit };
});