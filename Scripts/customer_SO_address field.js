/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], (record, log) => {
  // Customer Address custom fields (Address subrecord)
  const ADDR_LIFTGATE = 'custrecord_rb_liftgate';
  const ADDR_RESIDENTIAL = 'custrecord_rb_residential';
  const ADDR_INSIDE_DELIVERY = 'custrecord_rb_inside_delivery';
  const ADDR_LIMITED_ACCESS = 'custrecord_rb_limited_access';
  const ADDR_APPOINTMENT_DELIVERY = 'custrecord_rb_appointment_delivery';

  // Sales Order body fields
  const SO_LIFTGATE = 'custbody_rb_liftgate';
  const SO_RESIDENTIAL = 'custbody_rb_residential';
  const SO_INSIDE_DELIVERY = 'custbody_rb_inside_delivery';
  const SO_LIMITED_ACCESS = 'custbody_rb_limited_access';
  const SO_APPOINTMENT_DELIVERY = 'custbody_rb_appointment_delivery';

  const SO_SHIP_ADDRESS_LIST = 'shipaddresslist';

  function toBool(v) {
    return v === true || v === 'T';
  }

  function beforeSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;

    const soRec = context.newRecord;

    const customerId = soRec.getValue({ fieldId: 'entity' });
    const shipAddressId = soRec.getValue({ fieldId: SO_SHIP_ADDRESS_LIST });

    // If no customer or no selected address, don't force anything.
    // Let user / Celigo set the checkboxes.
    if (!customerId || !shipAddressId) return;

    try {
      const custRec = record.load({
        type: record.Type.CUSTOMER,
        id: customerId,
        isDynamic: false
      });

      // Find matching addressbook line
      let line = custRec.findSublistLineWithValue({
        sublistId: 'addressbook',
        fieldId: 'addressid',
        value: shipAddressId
      });

      // Fallbacks (varies by account)
      if (line === -1) {
        line = custRec.findSublistLineWithValue({
          sublistId: 'addressbook',
          fieldId: 'internalid',
          value: shipAddressId
        });
      }
      if (line === -1) {
        line = custRec.findSublistLineWithValue({
          sublistId: 'addressbook',
          fieldId: 'id',
          value: shipAddressId
        });
      }

      // IMPORTANT CHANGE:
      // If "- Custom -" or no match, DO NOTHING so user can check/uncheck manually.
      if (line === -1) return;

      const addrSubrec = custRec.getSublistSubrecord({
        sublistId: 'addressbook',
        fieldId: 'addressbookaddress',
        line: line
      });

      // Pull flags from customer address subrecord
      const liftgateVal = toBool(addrSubrec.getValue({ fieldId: ADDR_LIFTGATE }));
      const residentialVal = toBool(addrSubrec.getValue({ fieldId: ADDR_RESIDENTIAL }));
      const insideDeliveryVal = toBool(addrSubrec.getValue({ fieldId: ADDR_INSIDE_DELIVERY }));
      const limitedAccessVal = toBool(addrSubrec.getValue({ fieldId: ADDR_LIMITED_ACCESS }));
      const appointmentDeliveryVal = toBool(addrSubrec.getValue({ fieldId: ADDR_APPOINTMENT_DELIVERY }));

      // Set on Sales Order (only when using a saved customer address)
      soRec.setValue({ fieldId: SO_LIFTGATE, value: liftgateVal });
      soRec.setValue({ fieldId: SO_RESIDENTIAL, value: residentialVal });
      soRec.setValue({ fieldId: SO_INSIDE_DELIVERY, value: insideDeliveryVal });
      soRec.setValue({ fieldId: SO_LIMITED_ACCESS, value: limitedAccessVal });
      soRec.setValue({ fieldId: SO_APPOINTMENT_DELIVERY, value: appointmentDeliveryVal });

    } catch (e) {
      log.error({ title: 'RB Ship Address -> Delivery flags sourcing failed', details: e });
      // On error, also do nothing (don't override user values).
    }
  }

  return { beforeSubmit };
});