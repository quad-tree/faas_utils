/**
 * OpenFaas function helper for nodejs
 * Author: Enrique Motilla
 * e [at] quad-tree.com
 * 2021-02-23 13:15
 * License: MIT
 * 
 */

// REQUIREMENT TO SAVE EVENTS: 
// OPENFAAS SECRET: events-save-url

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


class ParamTester {
    constructor(params) {
        this.params = params; // params to test
        this.cb = function () {
            return null
        }; // callback on true
        this.ef; // expand function (usually getVaultSecret)
        this.missing = []; // missing params
    }

    setcallback(cb) {
        this.cb = cb; // callback on true
    }

    addparam(key, val) {
        this.params[key] = val
    }

    check_has_keys(req_list, obj) {
        let result = true;
        this.missing = [];
        req_list.forEach(element => {
            if (element.indexOf(".") !== -1) {
                let subobj = obj[element.split(".")[0]];
                let subelement = [element.split(".")[1]];
                result = result && this.check_has_keys(subelement, subobj)
            } else {
                result = result && obj.hasOwnProperty(element);
                if (!obj.hasOwnProperty(element)) {
                    this.missing.push(element)
                }
            }
        });
        return result
    }

    async check_and_eval(req_strlist, cb) {
        if (cb) {
            this.cb = cb
        }
        var req_list = req_strlist.split(",");
        if (this.check_has_keys(req_list, this.params)) {
            return await this.cb(this.params)
        } else {
            return {
                "status": "error",
                "message": `missing parameter(s): ${JSON.stringify(this.missing)}`
            }
        }
    }

    set_expandfunction(ef) {
        this.ef = ef
    }

    // https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop/37576787#37576787
    async expand(exp_strlist) {
        if (this.ef) {
            var exp_list = exp_strlist.split(",");
            if (this.check_has_keys(exp_list, this.params)) {
                await Promise.all(exp_list.map(async (element) => {
                    this.params[element] = await this.ef(this.params[element])
                    //console.log(this.params[element])
                }))
            } else {
                this.params["error"] = `expand error: ${exp_strlist}`;
            }
        } else {
            this.params["error"] = "set_expandfunction first before call expand";
        }
    }

    getparams() {
        return this.params
    }

    async evaluate() {
        return await this.cb(this.params)
    }
}


// source: https://www.freecodecamp.org/news/javascript-typeof-how-to-check-the-type-of-a-variable-or-object-in-js/
var typeCheck = function (value) {
    const return_value = Object.prototype.toString.call(value);
    // we can also use regex to do this...
    const type = return_value.substring(
        return_value.indexOf(" ") + 1,
        return_value.indexOf("]"));

    return type.toLowerCase();
}

var getAction = function (params) {
    return (params.hasOwnProperty("action") ? params.action : (params.hasOwnProperty("hasura") ? params.hasura.action : undefined))
}

module.exports = {
    getSecret,
    getVaultSecret,
    getHasuraParams,
    jsonApplyTemplate,
    call_service,
    event_save,
    ParamTester,
    typeCheck,
    getAction
}