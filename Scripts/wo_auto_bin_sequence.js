/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime'], (record, search, log, runtime) => {

  const WO_SEQ_FIELD_ID = 'custbody_wo_bin_sequence_number';
  const WO_BIN_FIELD_ID = 'custbody_wo_bin_number';

  // Bin pick sequence field id on Bin record
  const BIN_PICK_SEQUENCE_FIELD_ID = 'sequencenumber';

  // From your logs: typeVal=PICKING
  const BIN_TYPE_PICKING_VALUE = 'PICKING';

  // Script parameter that controls which location to search bins in
  const PARAM_BIN_SEARCH_LOCATION = 'custscript_rb_bin_search_location';

  function afterSubmit(context) {
    try {
      if (context.type !== context.UserEventType.CREATE &&
          context.type !== context.UserEventType.EDIT) {
        return;
      }

      const woId = context.newRecord.id;

      const woRec = record.load({
        type: record.Type.WORK_ORDER,
        id: woId,
        isDynamic: false
      });

      // 1) Find the single inventory component
      const invItemId = getInventoryComponentItemId(woRec);
      if (!invItemId) {
        log.debug('WO Bin/Seq', `No inventory component found on WO ${woId}.`);
        return;
      }

      // 2) Get configurable location from script parameter
      // List/Record params return internal ID (string) when set
      const binSearchLocationId = runtime.getCurrentScript().getParameter({
        name: PARAM_BIN_SEARCH_LOCATION
      });

      // If you prefer to force it (must be set), uncomment this block:
      // if (!binSearchLocationId) {
      //   log.error('WO Bin/Seq', `Missing required script parameter: ${PARAM_BIN_SEARCH_LOCATION}`);
      //   return;
      // }

      // 3) Find best bin in that configured location (if provided)
      const bestBin = getBestPickingBin(invItemId, binSearchLocationId);

      if (!bestBin) {
        log.audit(
          'WO Bin/Seq',
          `No PICKING bins with qty > 0 found for item ${invItemId}` +
          (binSearchLocationId ? ` in location ${binSearchLocationId}` : ' (no location filter)') +
          ` (WO ${woId}).`
        );
        return;
      }

      // 4) Update WO fields
      record.submitFields({
        type: record.Type.WORK_ORDER,
        id: woId,
        values: {
          [WO_SEQ_FIELD_ID]: bestBin.pickSequence,
          [WO_BIN_FIELD_ID]: bestBin.binText
        },
        options: {
          enableSourcing: false,
          ignoreMandatoryFields: true
        }
      });

      log.audit('WO Bin/Seq Updated', {
        woId,
        invItemId,
        binSearchLocationId: binSearchLocationId || '(none)',
        pickSequence: bestBin.pickSequence,
        binId: bestBin.binId,
        binText: bestBin.binText,
        qtyUsed: bestBin.qty,
        onhand: bestBin.onhand,
        available: bestBin.available
      });

    } catch (e) {
      log.error('afterSubmit error', e);
    }
  }

  function getInventoryComponentItemId(woRec) {
    const lineCount = woRec.getLineCount({ sublistId: 'item' });

    for (let i = 0; i < lineCount; i++) {
      const itemId = woRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
      const itemType = woRec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
      const t = (itemType || '').toString().toLowerCase();

      const isInventory =
        t.includes('invt') || t.includes('inventory') || t.includes('invpart');

      if (isInventory) return itemId;
    }
    return null;
  }

  function getBestPickingBin(itemId, locationId) {
    const filters = [
      ['item', 'anyof', itemId],
      'AND',
      ['binnumber', 'noneof', '@NONE@'],
      'AND',
      [
        ['onhand', 'greaterthan', '0'],
        'OR',
        ['available', 'greaterthan', '0']
      ],
      'AND',
      ['binnumber.type', 'anyof', BIN_TYPE_PICKING_VALUE]
    ];

    // Apply configurable location filter only if parameter is set
    if (locationId) {
      filters.push('AND', ['location', 'anyof', String(locationId)]);
    }

    const s = search.create({
      type: 'inventorybalance',
      filters,
      columns: [
        search.createColumn({ name: 'binnumber' }),
        search.createColumn({ name: 'onhand' }),
        search.createColumn({ name: 'available' }),
        search.createColumn({ name: BIN_PICK_SEQUENCE_FIELD_ID, join: 'binnumber' })
      ]
    });

    const results = s.run().getRange({ start: 0, end: 1000 }) || [];
    if (!results.length) return null;

    const bins = results.map(r => {
      const binId = r.getValue({ name: 'binnumber' });
      const binText = r.getText({ name: 'binnumber' }) || String(binId);

      const onhand = Number(r.getValue({ name: 'onhand' }) || 0);
      const available = Number(r.getValue({ name: 'available' }) || 0);
      const qty = Math.max(onhand, available);

      const seqRaw = r.getValue({ name: BIN_PICK_SEQUENCE_FIELD_ID, join: 'binnumber' });
      const seqNum = Number(seqRaw);

      const pickSequence =
        (seqRaw === '' || seqRaw === null || seqRaw === undefined || Number.isNaN(seqNum))
          ? Number.POSITIVE_INFINITY
          : seqNum;

      return { binId, binText, qty, onhand, available, pickSequence };
    });

    // Sort by pickSequence asc, then qty desc, then bin name
    bins.sort((a, b) => {
      if (a.pickSequence !== b.pickSequence) return a.pickSequence - b.pickSequence;
      if (a.qty !== b.qty) return b.qty - a.qty;
      return (a.binText || '').localeCompare(b.binText || '');
    });

    return bins[0] || null;
  }

  return { afterSubmit };
});
