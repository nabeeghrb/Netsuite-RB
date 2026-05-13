/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Script:   RB_UE_SalesOrder_ClearOnCopy.js
 * Record:   Sales Order
 * Trigger:  beforeLoad → Copy only
 *
 * Always clears:
 *   custbody_rb_web_id
 *   custbody_rb_deposits_total
 *
 * Clears only when custbody_rb_custom_production is checked:
 *   custbody_rb_custom_prod_status
 *   custbody_lead_time
 *   custbody_rb_prod_status_exp_date
 *   custbody_rb_prod_ready_date
 */

define(['N/record'], (record) => {

    const ALWAYS_CLEAR = [
        { fieldId: 'custbody_rb_web_id',         value: ''   },  // text
        { fieldId: 'custbody_rb_deposits_total',  value: null },  // currency
    ];

    const CONDITIONAL_CLEAR = [
        { fieldId: 'custbody_rb_custom_prod_status',  value: null },  // select
        { fieldId: 'custbody_lead_time',              value: null },  // integer/text
        { fieldId: 'custbody_rb_prod_status_exp_date',value: null },  // date
        { fieldId: 'custbody_rb_prod_ready_date',     value: null },  // date
    ];

    const beforeLoad = (context) => {
        if (context.type !== context.UserEventType.COPY) return;

        const rec = context.newRecord;

        // Always clear
        ALWAYS_CLEAR.forEach(({ fieldId, value }) => {
            rec.setValue({ fieldId, value });
        });

        // Conditionally clear — only if custom production is checked
        const isCustomProd = rec.getValue({ fieldId: 'custbody_rb_custom_production' });
        if (isCustomProd) {
            CONDITIONAL_CLEAR.forEach(({ fieldId, value }) => {
                rec.setValue({ fieldId, value });
            });
        }
    };

    return { beforeLoad };
});