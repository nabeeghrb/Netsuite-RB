/**
 * Plastpal Splitter (CSV ONLY) — Linden only, Assembly only (OPTIMIZED, NO APPROVAL)
 * - Runs ONLY on CSV Import (CREATE only)
 * - Plastpal => Shipmethod = Customer Pickup
 * - Forces ALL lines to Linden location
 * - Splits shortages into SO2 with Create WO = T
 * - Batch availability: ONE search total
 * - Handles duplicate items across multiple lines (allocates availability across lines)
 * - Copies otherrefnum to SO2
 * - Sets Ship Complete = TRUE on SO2 (and enforces via submitFields after save)
 * - Guard checkbox prevents looping
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/runtime', 'N/record', 'N/search', 'N/log'], (runtime, record, search, log) => {
  // ===== Script Params =====
  const PARAM_PLASTPAL_CUSTOMER_ID = 'custscript_rb_plastpal_customer_id';
  const PARAM_PICKUP_SHIPMETHOD_ID = 'custscript_rb_pickup_shipmethod_id';
  const PARAM_LINDEN_LOCATION_ID   = 'custscript_rb_linden_location';
  const PARAM_DEBUG               = 'custscript_rb_debug_split'; // optional checkbox param

  // ===== Guard field (create this on Sales Order) =====
  const FLD_PROCESSED = 'custbody_rb_split_processed';

  // ===== Header fields =====
  const FLD_ENTITY = 'entity';
  const FLD_SHIPMETHOD = 'shipmethod';
  const FLD_OTHERREFNUM = 'otherrefnum';
  const FLD_SHIPCOMPLETE = 'shipcomplete';

  const SUBLIST_ITEM = 'item';

  // ===== Line fields =====
  const COL_ITEM = 'item';
  const COL_QTY = 'quantity';
  const COL_LOCATION = 'location';
  const COL_CREATE_WO = 'createwo';
  const COL_QTY_COMMITTED = 'quantitycommitted';

  // Optional line fields to preserve on SO2
  const COL_UNITS = 'units';
  const COL_PRICE = 'price';
  const COL_RATE = 'rate';
  const COL_DESCRIPTION = 'description';
  const COL_TAXCODE = 'taxcode';

  function asInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  function asFloat(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function isCsvImport() {
    return runtime.executionContext === runtime.ContextType.CSV_IMPORT;
  }

  function isDebugOn() {
    const p = runtime.getCurrentScript().getParameter({ name: PARAM_DEBUG });
    return p === true || p === 'T';
  }
  function dbg(title, details) {
    if (!isDebugOn()) return;
    log.audit({ title, details: (typeof details === 'string' ? details : JSON.stringify(details)) });
  }

  function getParams() {
    return {
      plastpalId: asInt(runtime.getCurrentScript().getParameter({ name: PARAM_PLASTPAL_CUSTOMER_ID })),
      pickupShipMethodId: asInt(runtime.getCurrentScript().getParameter({ name: PARAM_PICKUP_SHIPMETHOD_ID })),
      lindenLocationId: asInt(runtime.getCurrentScript().getParameter({ name: PARAM_LINDEN_LOCATION_ID }))
    };
  }

  /**
   * ONE search to get locationquantityavailable for all items at Linden.
   * Returns map: { [itemId]: availableNow }
   */
  function getAvailableNowMap(itemIds, lindenLocationId) {
    const map = {};
    if (!itemIds || !itemIds.length || !lindenLocationId) return map;

    const s = search.create({
      type: search.Type.ITEM,
      filters: [
        ['internalid', 'anyof', itemIds],
        'AND',
        ['inventorylocation', 'anyof', lindenLocationId]
      ],
      columns: [
        search.createColumn({ name: 'internalid' }),
        search.createColumn({ name: 'locationquantityavailable' })
      ]
    });

    s.run().each(r => {
      const id = String(r.getValue({ name: 'internalid' }));
      map[id] = asFloat(r.getValue({ name: 'locationquantityavailable' })) || 0;
      return true;
    });

    dbg('Batch availability map', { count: Object.keys(map).length });
    return map;
  }

  function beforeSubmit(context) {
    try {
      // ✅ CSV ONLY
      if (!isCsvImport()) return;

      if (context.type !== context.UserEventType.CREATE) return;

      const rec = context.newRecord;
      if (!rec) return;
      if (rec.getValue({ fieldId: FLD_PROCESSED })) return;

      const { plastpalId, pickupShipMethodId, lindenLocationId } = getParams();
      if (!plastpalId || !pickupShipMethodId || !lindenLocationId) {
        log.error('Missing Params', 'Set Plastpal, Pickup shipmethod, Linden location script parameters.');
        return;
      }

      const entityId = asInt(rec.getValue({ fieldId: FLD_ENTITY }));
      if (entityId !== plastpalId) return;

      // Force shipmethod
      rec.setValue({ fieldId: FLD_SHIPMETHOD, value: pickupShipMethodId });

      // Force Linden on every line
      const lineCount = rec.getLineCount({ sublistId: SUBLIST_ITEM }) || 0;
      for (let i = 0; i < lineCount; i++) {
        rec.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_LOCATION, line: i, value: lindenLocationId });
      }
    } catch (e) {
      log.error('beforeSubmit error', e);
    }
  }

  function afterSubmit(context) {
    try {
      // ✅ CSV ONLY
      if (!isCsvImport()) return;

      if (context.type !== context.UserEventType.CREATE) return;

      const soId = context.newRecord && context.newRecord.id;
      if (!soId) return;

      const { plastpalId, lindenLocationId } = getParams();
      if (!plastpalId || !lindenLocationId) return;

      const so = record.load({ type: record.Type.SALES_ORDER, id: soId, isDynamic: false });
      if (so.getValue({ fieldId: FLD_PROCESSED })) return;

      const entityId = asInt(so.getValue({ fieldId: FLD_ENTITY }));
      if (entityId !== plastpalId) return;

      const otherRefNum = so.getValue({ fieldId: FLD_OTHERREFNUM });

      const lineCount = so.getLineCount({ sublistId: SUBLIST_ITEM }) || 0;
      if (!lineCount) {
        so.setValue({ fieldId: FLD_PROCESSED, value: true });
        so.save({ enableSourcing: true, ignoreMandatoryFields: true });
        return;
      }

      // 1) Collect item IDs + total committed per item; force Linden on lines
      const itemIdsSet = {};
      const totalCommittedByItem = {};

      for (let i = 0; i < lineCount; i++) {
        const itemId = asInt(so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_ITEM, line: i }));
        if (!itemId) continue;

        itemIdsSet[String(itemId)] = true;

        const committed = asFloat(so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_QTY_COMMITTED, line: i }));
        totalCommittedByItem[String(itemId)] = (totalCommittedByItem[String(itemId)] || 0) + committed;

        so.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_LOCATION, line: i, value: lindenLocationId });
      }

      const itemIds = Object.keys(itemIdsSet);
      const availableNowMap = getAvailableNowMap(itemIds, lindenLocationId);

      // 2) preCommit availability per item (availableNow + totalCommittedOnThisSO)
      const remainingAvailByItem = {};
      itemIds.forEach(id => {
        const now = availableNowMap[id] || 0;
        const committedTotal = totalCommittedByItem[id] || 0;
        remainingAvailByItem[id] = now + committedTotal;
      });

      // 3) Decide keep/move per line and merge shortages by item
      const fullMoveLines = [];
      let keptLineCount = 0;

      const shortageByItem = {}; // itemId -> merged shortage line

      for (let i = 0; i < lineCount; i++) {
        const itemIdNum = asInt(so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_ITEM, line: i }));
        const qtyOrdered = asFloat(so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_QTY, line: i }));
        if (!itemIdNum || qtyOrdered <= 0) continue;

        const itemId = String(itemIdNum);
        const remaining = asFloat(remainingAvailByItem[itemId]);

        const keepQty = Math.max(0, Math.min(qtyOrdered, remaining));
        const moveQty = Math.max(0, qtyOrdered - keepQty);

        remainingAvailByItem[itemId] = Math.max(0, remaining - keepQty);

        if (moveQty <= 0) {
          keptLineCount += 1;
          continue;
        }

        if (keepQty <= 0) {
          fullMoveLines.push(i);
        } else {
          keptLineCount += 1;
          so.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_QTY, line: i, value: keepQty });
        }

        if (!shortageByItem[itemId]) {
          shortageByItem[itemId] = {
            itemId: itemIdNum,
            locationId: lindenLocationId,
            moveQty: 0,
            units: so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_UNITS, line: i }),
            price: so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_PRICE, line: i }),
            rate: so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_RATE, line: i }),
            description: so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_DESCRIPTION, line: i }),
            taxcode: so.getSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_TAXCODE, line: i })
          };
        }
        shortageByItem[itemId].moveQty += moveQty;
      }

      const shortages = Object.values(shortageByItem).filter(x => x.moveQty > 0);

      // Nothing to move
      if (!shortages.length) {
        so.setValue({ fieldId: FLD_PROCESSED, value: true });
        so.save({ enableSourcing: true, ignoreMandatoryFields: true });
        return;
      }

      // If everything is shortage, do not split (avoid empty SO)
      if (keptLineCount === 0) {
        const lc = so.getLineCount({ sublistId: SUBLIST_ITEM }) || 0;
        for (let i = 0; i < lc; i++) {
          so.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_LOCATION, line: i, value: lindenLocationId });
          so.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_CREATE_WO, line: i, value: true });
        }
        so.setValue({ fieldId: FLD_PROCESSED, value: true });
        so.save({ enableSourcing: true, ignoreMandatoryFields: true });
        return;
      }

      // Remove full-move lines bottom-up
      fullMoveLines.sort((a, b) => b - a).forEach(lineIdx => {
        so.removeLine({ sublistId: SUBLIST_ITEM, line: lineIdx, ignoreRecalc: true });
      });

      // Save original
      so.setValue({ fieldId: FLD_PROCESSED, value: true });
      const originalId = so.save({ enableSourcing: true, ignoreMandatoryFields: true });

      // Create SO2
      const so2 = record.copy({ type: record.Type.SALES_ORDER, id: originalId, isDynamic: false });
      so2.setValue({ fieldId: FLD_PROCESSED, value: true });

      // Copy otherrefnum explicitly
      if (otherRefNum) so2.setValue({ fieldId: FLD_OTHERREFNUM, value: otherRefNum });

      // Set Ship Complete ON (and enforce after save)
      try { so2.setValue({ fieldId: FLD_SHIPCOMPLETE, value: true }); } catch (e) {}

      // Wipe lines
      const so2Count = so2.getLineCount({ sublistId: SUBLIST_ITEM }) || 0;
      for (let x = so2Count - 1; x >= 0; x--) {
        so2.removeLine({ sublistId: SUBLIST_ITEM, line: x, ignoreRecalc: true });
      }

      // Add merged shortage lines (Create WO checked)
      for (let j = 0; j < shortages.length; j++) {
        const ld = shortages[j];

        so2.insertLine({ sublistId: SUBLIST_ITEM, line: j });
        so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_ITEM, line: j, value: ld.itemId });
        so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_LOCATION, line: j, value: ld.locationId });
        so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_QTY, line: j, value: ld.moveQty });

        if (ld.units) so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_UNITS, line: j, value: ld.units });
        if (ld.price) so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_PRICE, line: j, value: ld.price });
        if (ld.rate) so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_RATE, line: j, value: ld.rate });
        if (ld.description) so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_DESCRIPTION, line: j, value: ld.description });
        if (ld.taxcode) so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_TAXCODE, line: j, value: ld.taxcode });

        so2.setSublistValue({ sublistId: SUBLIST_ITEM, fieldId: COL_CREATE_WO, line: j, value: true });
      }

      const so2Id = so2.save({ enableSourcing: true, ignoreMandatoryFields: true });

      // Enforce Ship Complete + otherrefnum after save (most reliable)
      try {
        const vals = {};
        vals[FLD_SHIPCOMPLETE] = true;
        if (otherRefNum) vals[FLD_OTHERREFNUM] = otherRefNum;

        record.submitFields({
          type: record.Type.SALES_ORDER,
          id: so2Id,
          values: vals,
          options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
      } catch (e) {
        log.error('Failed to enforce shipcomplete/otherrefnum on SO2', e);
      }

      log.audit('Split Complete', `CSV SO ${originalId} kept stock qty. SO ${so2Id} created for shortages (WO + Ship Complete ON).`);
    } catch (e) {
      log.error('afterSubmit error', e);
    }
  }

  return { beforeSubmit, afterSubmit };
});