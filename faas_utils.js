/**
 * OpenFaas function helper for nodejs
 * Author: Enrique Motilla
 * e [at] quad-tree.com
 * 2021-02-23 13:15
 * License: MIT
 * 
 */
const DEBUG = false;

const fs = require('fs').promises;
const axios = require('axios');
const nunjucks = require('nunjucks'); // templating
const env = nunjucks.configure('views', {
    autoescape: false
});


/**
 * getSecret        retrieves a secret from a localfile defined from the faas-cli (OpenFaas)
 * @param {*} name  name of the secret t
 */
var getSecret = async function (name) {
    try {
        var secretval = ""
        secretval = await fs.readFile("/var/openfaas/secrets/" + name, "utf8")
        return secretval;
    } catch (error) {
        return "ERROR: on getting secret " + name
    }
}

/**
 * getVaultSecret      get a Secret from a Vault from hashicorp, requieres secrets: "vault-uri" and "vault-token" to be defined previously in openfaas
 * @param {*} name     name of the Vault secret
 */
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
var getHasuraParams = function (bodyObj) {
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


/**
 * jsonApplyTemplate    applies data to a string template using JINJA formatting
 * @param {*} template  a String with JINJA variables like {{ foo }} {{ var }} 
 * @param {*} data      an onject with data to be injected { "foo": "bar", "var":"newvalue" }
 */
var jsonApplyTemplate = async function (template, data) {
    return new Promise((resolve, reject) => {
        env.renderString(template, data, function (err, res) {
            if (err) {
                reject(err)
            } else {
                resolve(res);
            }
        });
    });
}


/**
 * event_save: a call to an event function that saves data, can be a webhook or an openfaas 
 * @param {*} data   
 */
var event_save = async function (data) {
    try {
        var events_url = await getSecret("events-save-url");
        var config = {
            method: 'post',
            url: events_url,
            headers: {
                // 'Auth-Token': "",
                'Content-Type': 'application/json'
            },
            data: data
        };
        var event_result = await axios(config);
        // console.log(event_result)
        return event_result.data
    } catch (error) {
        return {
            "status": "error",
            "message": error
        }
    }
}


/**
 * call_service             makes a request to a url and options defined in a VAULT as a "servicename"
 * @param {*} servicename   VAULT secret with a config
 * @param {*} template      template object to sustitute on the servicename
 * @param {*} data          data to be injected on the config
 */
var call_service = async function (servicename, template_data) {
    try {
        let config = await getVaultSecret(servicename); // todo: sustituir por un graphql que defina que funcion se llama dependiedo del trigger
        //   {
        //     "method": "post",
        //     "url": "https://myserver.com/function/myawesomefunction",
        //     "headers": {
        //         "Content-Type": "application/json"
        //     },
        //     "data": {
        //         "hasura": {
        //             "action": "send_sms"
        //         },
        //         "from": "{{ from }}",
        //         "msg": "{{ msg }}",
        //         "to": "{{ to }}"
        //     }
        // }
        var dataStr = JSON.stringify(config.data);
        config.data = JSON.parse(await jsonApplyTemplate(dataStr, template_data));
        if (DEBUG) {
            return config
        } else {
            return await axios(config).data;
        }
    } catch (error) {
        return {
            "error": "invalid http call"
        }
    }
}


module.exports = {
    getSecret: getSecret,
    getVaultSecret: getVaultSecret,
    getHasuraParams: getHasuraParams,
    jsonApplyTemplate: jsonApplyTemplate,
    call_service: call_service,
    event_save: event_save
}