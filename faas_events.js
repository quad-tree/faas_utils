/**
 * OpenFaas function helper for nodejs
 * Author: Enrique Motilla
 * e [at] quad-tree.com
 * 2021-02-23 13:15
 * License: MIT
 * 
 */
const DEBUG = false;
// const EVENTS_URL = 'https://faasd.sys.erpcloud.mx/async-function/events'; 
const EVENTS_URL = 'https://faasd.sys.erpcloud.mx/function/events'; //todo pasar a un secret
var events_autosave = true;

var faa = require("./faas_secrets");

const axios = require('axios');
const nunjucks = require('nunjucks'); // templating
const env = nunjucks.configure('views', {
    autoescape: false
});


/**
 * 
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

var event_save = async function (data) {
    try {
        var config = {
            method: 'post',
            url: EVENTS_URL,
            headers: {
                // 'Auth-Token': "",
                'Content-Type': 'application/json'
            },
            data: data
        };
        var event_result = await axios(config);
        console.log(event_result)
        return event_result.data
    } catch (error) {
        return {
            "status": "error",
            "message": error
        }
    }
}

/**
 * 
 * @param {*} servicename   VAULT secret with a config
 * @param {*} template      template object to sustitute on the servicename
 * @param {*} data          data to be injected on the config
 */
var call_service = async function (servicename, template_data) {
    try {
        let config = await faa.getVaultSecret(servicename); // todo: sustituir por un graphql que defina que funcion se llama dependiedo del trigger
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
    jsonApplyTemplate: jsonApplyTemplate,
    call_service: call_service,
    event_save: event_save
}