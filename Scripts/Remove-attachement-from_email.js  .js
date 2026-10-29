/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @appliedtorecord message
 *
 * Forces "Include Transaction" OFF when:
 *   Rule 1 - the email uses a blocked template (e.g. Proforma Invoice).
 *   Rule 2 - the email is sent from a Dropship or Special Order PO whose
 *            Created From Sales Order has custbody_rb_custom_production checked.
 *   Rule 3 - the email is sent from a Sales Order that has
 *            custbody_rb_custom_production checked.
 * Rules 2 and 3 read the Sales Order live, so unchecking it restores normal behavior.
 *
 * beforeLoad   - shows a warning banner on the email form for Rules 2 and 3.
 * beforeSubmit - unchecks Include Transaction when the email is sent (all rules).
 */
define(['N/log', 'N/query', 'N/runtime', 'N/ui/message'], (log, query, runtime, message) => {
  'use strict';

  // Rule 1: templates that should never send with "Include Transaction" checked
  const TEMPLATE_IDS_BLOCK_INCLUDE = new Set([
    325, // Proforma Invoice
    // 412,
    // 587,
  ]);

  // Rule 2: Purchase Order Type (custbody6) values
  const PO_TYPE_BLOCK_INCLUDE = new Set([
    2, // Dropship
    3, // Special order
  ]);

  const BANNER_TITLE = 'Transaction PDF will not be attached';

  function beforeLoad(context) {
    try {
      if (context.type !== context.UserEventType.CREATE) return;
      if (runtime.executionContext !== runtime.ContextType.USER_INTERFACE) return;
      if (!context.form) return;

      const tranId = Number(context.newRecord.getValue({ fieldId: 'transaction' })) || 0;
      if (!tranId) return;

      const match = getCustomProductionMatch(tranId);
      if (!match) return;

      context.form.addPageInitMessage({
        type: message.Type.WARNING,
        title: BANNER_TITLE,
        message: `${match.banner} "Include Transaction" will be turned off automatically when you send.`
      });
    } catch (e) {
      // Never block the email form over a banner
      log.error({ title: 'UE beforeLoad failed', details: e });
    }
  }

  function beforeSubmit(context) {
    try {
      const rec = context.newRecord;

      const templateId = Number(rec.getValue({ fieldId: 'template' })) || 0;
      const tranId = Number(rec.getValue({ fieldId: 'transaction' })) || 0;

      // Temporary: confirms the script fires and what it sees. Remove once verified.
      log.debug({
        title: 'beforeSubmit',
        details: `type=${context.type} template=${templateId} transaction=${tranId} ` +
                 `includetransaction=${JSON.stringify(rec.getValue({ fieldId: 'includetransaction' }))}`
      });

      // ---- Rule 1: blocked templates (unchanged behavior) ----
      if (TEMPLATE_IDS_BLOCK_INCLUDE.has(templateId)) {
        rec.setValue({ fieldId: 'includetransaction', value: false });
        log.audit({
          title: 'Include Transaction disabled',
          details: `Template ${templateId}: includetransaction forced OFF`
        });
        return;
      }

      if (!tranId) return;

      // ---- Rules 2 and 3: Custom Production PO / Sales Order ----
      const match = getCustomProductionMatch(tranId);
      log.debug({ title: 'Custom Production check', details: `transaction=${tranId} rule=${match ? match.rule : 'none'}` });

      if (match) {
        rec.setValue({ fieldId: 'includetransaction', value: false });
        log.audit({
          title: 'Include Transaction disabled',
          details: `Transaction ${tranId}: ${match.rule}, includetransaction forced OFF`
        });
      }
    } catch (e) {
      log.error({ title: 'UE beforeSubmit failed', details: e });
    }
  }

  /**
   * Returns { rule, banner } when the transaction qualifies, otherwise null.
   *   Sales Order with custbody_rb_custom_production = T                  -> Rule 3
   *   Dropship/Special Order PO whose Created From SO has the field = T  -> Rule 2
   */
  function getCustomProductionMatch(tranId) {
    const rows = query.runSuiteQL({
      query: `
        SELECT t.type AS tran_type,
               t.custbody6 AS po_type,
               t.custbody_rb_custom_production AS own_custom_prod,
               so.custbody_rb_custom_production AS so_custom_prod
          FROM transaction t
          JOIN transactionline tl
            ON tl.transaction = t.id AND tl.mainline = 'T'
          LEFT JOIN transaction so
            ON so.id = tl.createdfrom AND so.type = 'SalesOrd'
         WHERE t.id = ?
           AND t.type IN ('SalesOrd', 'PurchOrd')`,
      params: [tranId]
    }).asMappedResults();

    if (!rows.length) return null;
    const r = rows[0];

    // Rule 3: email sent from the Sales Order itself
    if (r.tran_type === 'SalesOrd') {
      return r.own_custom_prod === 'T'
        ? {
            rule: 'Custom Production Sales Order',
            banner: 'This Sales Order is marked Custom Production.'
          }
        : null;
    }

    // Rule 2: email sent from a Dropship / Special Order PO
    const poType = Number(r.po_type) || 0;
    if (PO_TYPE_BLOCK_INCLUDE.has(poType) && r.so_custom_prod === 'T') {
      const poLabel = poType === 2 ? 'Dropship' : 'Special Order';
      return {
        rule: `${poLabel} PO from Custom Production SO`,
        banner: `This ${poLabel} PO was created from a Sales Order marked Custom Production.`
      };
    }
    return null;
  }

  return { beforeLoad, beforeSubmit };
});