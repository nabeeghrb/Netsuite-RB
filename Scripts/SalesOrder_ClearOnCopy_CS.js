/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Script:   RB_UE_SalesOrder_ClearOnCopy.js
 * Record:   Sales Order
 * Trigger:  beforeLoad → copy only
 */
define([], function () {

    function beforeLoad(context) {
        if (context.type !== 'copy') return;

        var form = context.form;
        var rec  = context.newRecord;

        // Always clear — override copied value before form renders
        form.getField({ id: 'custbody_rb_web_id'        }).defaultValue = '';
        form.getField({ id: 'custbody_rb_deposits_total' }).defaultValue = '';

        // Conditional clear — only when custom production is checked
        var isCustomProd = rec.getValue({ fieldId: 'custbody_rb_custom_production' });

        if (isCustomProd) {
            form.getField({ id: 'custbody_rb_custom_prod_status'   }).defaultValue = '';
            form.getField({ id: 'custbody_lead_time'               }).defaultValue = '';
            form.getField({ id: 'custbody_rb_prod_status_exp_date' }).defaultValue = '';
            form.getField({ id: 'custbody_rb_prod_ready_date'      }).defaultValue = '';
        }
    }

    return { beforeLoad: beforeLoad };
});