/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @appliedtorecord message
 *
 * Forces "Include Transaction" OFF for specific email templates.
 */
define(['N/log'], (log) => {
  'use strict';
  
  // Templates that should never send with "Include Transaction" checked
  const TEMPLATE_IDS_BLOCK_INCLUDE = new Set([
    325, // Proforma Invoice
    // 412,
    // 587,
  ]);

  function beforeSubmit(context) {
    try {
      const rec = context.newRecord;

      const templateId = Number(rec.getValue({ fieldId: 'template' })) || 0;
      if (!TEMPLATE_IDS_BLOCK_INCLUDE.has(templateId)) return;

      // Exact fieldId confirmed in your account
      rec.setValue({ fieldId: 'includetransaction', value: false });

      log.audit({
        title: 'Include Transaction disabled',
        details: `Template ${templateId}: includetransaction forced OFF`
      });
    } catch (e) {
      log.error({ title: 'UE beforeSubmit failed', details: e });
    }
  }

  return { beforeSubmit };
});