/**
 * faas_utils
 * Author: enrique motilla
 * e @ quad-tree.com
 * 2021-02-05 22:12
 * helper functions for OpenFaas, secrets (faasd), params (hasura) and vault (hashicorp)
 */

const axios = require('axios');
const fs = require('fs').promises;


var getSecret = async function (name) {
    try {
        var secretval = ""
        secretval = await fs.readFile("/var/openfaas/secrets/" + name, "utf8")
        return secretval;
    } catch (error) {
        return "ERROR: on getting secret " + name
    }
}

var getVaultSecret = async function (name) {
    try {
        let vault_uri = await getSecret("vault-uri"); // http justo antes del secret y CON / al final
        let vault_token = await getSecret("vault-token");
        let config = {
            method: 'get',
            url: vault_uri + name, // http://vault_server_ip:8200/v1/secret/data/erp-token
            headers: {
                'X-Vault-Token': vault_token, //
                'X-Vault-Request': 'true',
                'Content-Type': 'application/json'
            }
        };
        if ((vault_uri.indexOf("ERROR") == -1) && (vault_token.indexOf("ERROR") == -1)) {
            const credentials = await axios(config);
            return credentials.data.data.data;
        } else {
            return "VAULT credentials not set"
        }
    } catch (error) {
        return "ERROR: on getting VAULT secret " + name
    }
}


/**
 * getHasuraParams  checks if the parameters for the function comes from a HASURA action endpoint
 *            Hasura sends the parameters thru "body.input" also "body.session_variables" and "body.action" 
 *            parameters are sent from "body" directly if called normally. 
 * @param {*} paramArr 
 * @param {*} bodyObj 
 */
var getHasuraParams = function ( bodyObj ) {
    /**
     * HASURA Actions uses body.input:{params} as the place to get the parameters
     */
    let paramObj = {};
    if (bodyObj.hasOwnProperty("input") && bodyObj.hasOwnProperty("session_variables") && bodyObj.hasOwnProperty("action")) {
        paramObj = bodyObj.input;
        paramObj["hasura"] = {
            "action": bodyObj["action"]["name"],
            "session_variables": bodyObj["session_variables"]
        }
    } else {
        paramObj = bodyObj
    }
    return paramObj
}


module.exports = {
    getSecret: getSecret,
    getVaultSecret: getVaultSecret,
    getHasuraParams: getHasuraParams
}