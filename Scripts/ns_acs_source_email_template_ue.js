/*
* Copyright (c) 2023, Oracle and/or its affiliates.
* 500 Oracle Parkway Redwood Shores, CA 94065
* All Rights Reserved.
*
* This software is the confidential and proprietary information of
* NetSuite, Inc. ("Confidential Information"). You shall not
* disclose such Confidential Information and shall use it only in
* accordance with the terms of the license agreement you entered into
* with NetSuite.
*
*  Version     Date            Author                               Remarks
*   1.0        01.30.25        chloe.gaskell@netsuite.com           Initial version - Case 6108282
*
*/
/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
 */
 define(['N/search', 'N/record', 'N/runtime'], function(search, record, runtime) {

    function beforeLoad(context) {

        try{
            var rec = context.newRecord;
            var email_temp = ''
            if (context.request.parameters.transaction){
            var transactionSearchObj = search.create({
            type: "transaction",
            filters:
            [
                ["internalid","is",context.request.parameters.transaction], 
                "AND", 
                ["mainline","is","T"]
            ],
            columns:
            [
                search.createColumn({name: "type", label: "Type"})
            ]
            });
            var searchResultCount = transactionSearchObj.runPaged().count;
            var type = ''
            log.debug("transactionSearchObj result count",searchResultCount);
            transactionSearchObj.run().each(function(result){
                type = result.getText('type')
                return true;
            });
            log.debug('type', type)
            var customrecord_acs_email_templateSearchObj = search.create({
                type: "customrecord_acs_email_template",
                filters:
                [
                   ["formulatext: {custrecord_acs_transaction_type}","is",type]
                ],
                columns:
                [
                   search.createColumn({name: "scriptid", label: "Script ID"}),
                   search.createColumn({name: "custrecord_acs_transaction_type", label: "Transaction Type"}),
                   search.createColumn({name: "custrecord_email_template", label: "Email Template"})
                ]
             });
             var searchResultCount = customrecord_acs_email_templateSearchObj.runPaged().count;
             log.debug("customrecord_acs_email_templateSearchObj result count",searchResultCount);
             customrecord_acs_email_templateSearchObj.run().each(function(result){
                email_temp = result.getValue('custrecord_email_template');
                log.debug('emailtemp', email_temp)
                return true;
             });
             rec.setValue('template', email_temp);
             }
             if (!email_temp){
               var currentUser = runtime.getCurrentUser().id;
               log.debug('currentUser', currentUser)
               var empLookup = search.lookupFields({
                type: search.Type.EMPLOYEE,
                id: currentUser,
                columns: ['custentity_signature']
               });

               var signature = empLookup.custentity_signature;
               rec.setValue('message', signature)
            }

        
        
 
        }catch(e){
            log.debug('e', e)
        }
    }
 
    return {
        beforeLoad: beforeLoad
    }
 });