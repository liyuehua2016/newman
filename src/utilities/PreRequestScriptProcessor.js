var jsface = require('jsface'),
    _und = require('underscore'),
    vm = require('vm'),
    ErrorHandler = require('./ErrorHandler'),
    jsdom = require("jsdom"),
    _jq = null,
    _lod = require("lodash"),
    Helpers = require('./Helpers'),
    MysqlHelper = require('./MysqlHelper'),
    EventProxyHelper = require('./EventProxyHelper'),
    Backbone = require("backbone"),
    CryptoJS = require('crypto-js'),
    xmlToJson = require("xml2js"),
    Globals = require("./Globals"),
    btoa = require("btoa"),
    atob = require("atob"),
    tv4 = require("tv4");
require('sugar');


/**
 * @class PreRequestScriptProcessor
 * @classdesc Class Used for exporting the generated responses.
 */
var PreRequestScriptProcessor = jsface.Class({
    $singleton: true,
    _results: [],


    main: function () {
        jsdom.env("<html><body></body></html>", function (err, window) {
            _jq = require('jquery')(window);
        });
    },

    /**
     * Execute the preRequestScript for this request, and add to the global env vars
     * It's the responsibility of the CALLER to save and restore the original global state
     * @param {Object} request: the request object
     */
    runPreRequestScript: function (runner, request, callback) {
        var requestScript = this._getScriptForRequest(request);
        if (requestScript) {
            var sandbox = this._createSandboxedEnvironment(runner, request, callback);
            return this._runScript(request.preRequestScript, sandbox);
        }else{
          callback(runner, request);
        }
    },

    _getScriptForRequest: function (request) {
        return !!request.preRequestScript;
    },

    // run the preRequestScript in a sandbox. Add to the global env vars
    _runScript: function (requestScript, sandbox) {
        this._evaluateInSandboxedEnvironment(requestScript, sandbox);
        //do we return here??
        //env vars are already set - no Impact on test results or anything
        return;
    },

    _evaluateInSandboxedEnvironment: function (requestScript, sandbox) {
        var sweet = "for(p in sugar.object) Object.prototype[p]  = sugar.object[p];";
        sweet += "for(p in sugar.array)  {if(p==='create'){Array.create=sugar.array.create} else{Array.prototype[p]= sugar.array[p];}}";
        sweet += "for(p in sugar.string) String.prototype[p]  = sugar.string[p];";
        sweet += "for(p in sugar.date)  {if(p==='create'){Date.create=sugar.date.create} else{Date.prototype[p]= sugar.date[p];}}";
        sweet += "for(p in sugar.number) Number.prototype[p]= sugar.number[p];";
        sweet += "for(p in sugar.funcs) {" +
                     "Object.defineProperty(Function.prototype, p, sugar.funcs[p]);" +
                 "}";

        //to ensure that environment. and global. references are updated
        var setEnvHack = "setEnvVar = function(key,val) {postman.setEnvironmentVariableReal(key,val);environment[key]=val;};";
        setEnvHack += "setGlobalVar = function(key,val) {postman.setGlobalVariableReal(key,val);globals[key]=val;};";
        setEnvHack += "clearGlobalVar = function(key) {postman.clearGlobalVariableReal(key);delete globals[key];};";
        setEnvHack += "clearEnvVar = function(key) {postman.clearEnvironmentVariableReal(key);delete environment[key];};";
        setEnvHack += "clearGlobalVars = function() {postman.clearGlobalVariablesReal();globals={};};";
        setEnvHack += "clearEnvVars = function() {postman.clearEnvironmentVariablesReal();environment={};};";

        //to ensure that JSON.parse throws the right error
        setEnvHack += '(function () {                               \
        var nativeJSONParser = JSON.parse;                          \
        JSON.parse = function () {                                  \
        try {                                                       \
                return nativeJSONParser.apply(JSON, arguments);     \
            } catch (e) {                                           \
                e && (e.message = "Encountered an error during JSON.parse(): " + e.message);\
                throw e;                                            \
            }                                                       \
        };                                                          \
        }());';

        var ep = 'if (ep.getLength() > 0) {                         \
          ep.after(ep.getLength(), function () {                      \
            callback(runner, originalReq, error);                                     \
          });                                                         \
        } else {                                                      \
          callback(runner, originalReq, error);                                       \
        }';
        if(!requestScript.endWith(";"))requestScript = requestScript + ";";
        requestScript = sweet + 'String.prototype.has = function(value){ return this.indexOf(value) > -1};' + setEnvHack + requestScript + ep;

        try {
            vm.runInNewContext(requestScript, sandbox);
        } catch (err) {
            sandbox.error = err;
            ErrorHandler.exceptionError(err);
            sandbox.callback(sandbox.runner, sandbox.originalReq, sandbox.error);
        }
        //what do we return??
        //return sandbox.tests;
    },

    // sets the env vars json as a key value pair
    _setEnvironmentContext: function (globals) {
        return Helpers.transformFromKeyValue(globals.envJson.values);
    },

    // sets the global vars json as a key value pair
    _setGlobalContext: function (globals) {
        return Helpers.transformFromKeyValue(globals.globalJson.values);
    },

    // sets the data vars json as a key value pair
    _setDataContext: function (globals) {
        return Helpers.transformFromKeyValue(globals.dataJson.values);
    },

    _getTransformedRequestData: function (request) {
        var transformedData;

        if (request.transformed.data === "") {
            return {};
        }
        if (request.dataMode === "raw") {
            transformedData = request.transformed.data;
        } else {
            transformedData = Helpers.transformFromKeyValueForRequestData(request.transformed.data);
        }
        return transformedData;
    },

    _createSandboxedEnvironment: function (runner, request, callback) {
        var sugar = { array: {}, object: {}, string: {}, funcs: {}, date: {}, number: {} };
        Object.extend();
        Object.getOwnPropertyNames(Array.prototype).each(function (p) {
            sugar.array[p] = Array.prototype[p];
        });
        sugar.array["create"] = Array.create;
        Object.getOwnPropertyNames(Object.prototype).each(function (p) {
            sugar.object[p] = Object.prototype[p];
        });
        sugar.object["extended"] = Object.extended;

        Object.getOwnPropertyNames(String.prototype).each(function (p) {
            sugar.string[p] = String.prototype[p];
        });
        Object.getOwnPropertyNames(Number.prototype).each(function (p) {
            sugar.number[p] = Number.prototype[p];
        });
        Object.getOwnPropertyNames(Date.prototype).each(function (p) {
            sugar.date[p] = Date.prototype[p];
        });
        sugar.date["create"] = Date.create;
        Object.getOwnPropertyNames(Function.prototype).each(function(p) {
            sugar.funcs[p] = Object.getOwnPropertyDescriptor(Function.prototype, p);
        });
        var _ep = EventProxyHelper.create();
        return {
            sugar: sugar,
            error: null,
            request: {
                id: request.id,
                url: request.transformed.url,
                method: request.method,
                headers: Helpers.generateHeaderObj(request.transformed.headers),
                data: this._getTransformedRequestData(request),
                dataMode: request.dataMode,
                name: request.name,
                description: request.description
            },
            ep: _ep,
            mysql: MysqlHelper.create(_ep),
            iteration: runner.globals.iterationNumber,
            environment: this._setEnvironmentContext(runner.globals),
            globals: this._setGlobalContext(runner.globals),
            data: this._setDataContext(runner.globals),
            $: _jq,
            jQuery: _jq,
            _: _lod,
            btoa: btoa,
            atob: atob,
            CryptoJS: CryptoJS,
            Backbone: Backbone,
            xmlToJson: function (string) {
                var JSON = {};
                xmlToJson.parseString(string, { explicitArray: false, async: false }, function (err, result) {
                    JSON = result;
                });
                return JSON;
            },
            tv4: tv4,
            console: {
                log: function () {
                    console.log.apply(console, arguments);
                },
                error: function () {
                    console.error.apply(console, arguments);
                },
                warn: function () {
                    console.warn.apply(console, arguments);
                }
            },
            postman: {
                setEnvironmentVariableReal: function (key, value) {
                    var envVar = _und.find(runner.globals.envJson.values, function (envObject) {
                        return envObject["key"] === key;
                    });

                    if (envVar) { // if the envVariable exists replace it
                        envVar["value"] = value;
                    } else { // else add a new envVariable
                        runner.globals.envJson.values.push({
                            key: key,
                            value: value,
                            type: "text",
                            name: key
                        });
                    }
                },
                getEnvironmentVariable: function (key) {
                    var envVar = _und.find(runner.globals.envJson.values, function (envObject) {
                        return envObject["key"] === key;
                    });
                    if (envVar) {
                        return envVar["value"];
                    }
                    return null;
                },
                clearEnvironmentVariablesReal: function () {
                    runner.globals.envJson.values = [];
                },
                clearEnvironmentVariableReal: function (key) {
                    var oldLength = runner.globals.envJson.values.length;
                    _lod.remove(runner.globals.envJson.values, function (envObject) {
                        return envObject["key"] === key;
                    });
                    if (oldLength === runner.globals.envJson.values.length) {
                        return false;
                    }
                    else {
                        return true;
                    }
                },
                setGlobalVariableReal: function (key, value) {
                    var envVar = _und.find(runner.globals.globalJson.values, function (envObject) {
                        return envObject["key"] === key;
                    });

                    if (envVar) { // if the envVariable exists replace it
                        envVar["value"] = value;
                    } else { // else add a new envVariable
                        runner.globals.globalJson.values.push({
                            key: key,
                            value: value,
                            type: "text",
                            name: key
                        });
                    }
                },
                getGlobalVariable: function (key) {
                    var envVar = _und.find(runner.globals.globalJson.values, function (envObject) {
                        return envObject["key"] === key;
                    });
                    if (envVar) {
                        return envVar["value"];
                    }
                    return null;
                },
                clearGlobalVariablesReal: function () {
                    runner.globals.globalJson.values = [];
                },
                clearGlobalVariableReal: function (key) {
                    var oldLength = runner.globals.globalJson.values.length;
                    _lod.remove(runner.globals.globalJson.values, function (envObject) {
                        return envObject["key"] === key;
                    });
                    if (oldLength === runner.globals.globalJson.values.length) {
                        return false;
                    }
                    else {
                        return true;
                    }
                },
                setNextRequest: function (requestName) {
                    runner.globals.nextRequestName = requestName;
                }
            },
            runner: runner,
            originalReq: request,
            callback: callback
        };
    }
});

module.exports = PreRequestScriptProcessor;
