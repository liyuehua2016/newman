var jsface = require('jsface'),
  _und = require('underscore'),
  vm = require('vm'),
  ErrorHandler = require('../utilities/ErrorHandler'),
  AbstractResponseHandler = require('./AbstractResponseHandler'),
  jsdom = require("jsdom"),
  _jq = null,
  _lod = require("lodash"),
  Helpers = require('../utilities/Helpers'),
  MysqlHelper = require('../utilities/MysqlHelper'),
  EventProxyHelper = require('../utilities/EventProxyHelper'),
  log = require('../utilities/Logger'),
  Backbone = require("backbone"),
  xmlToJson = require("xml2js"),
  CryptoJS = require('crypto-js'),
  Globals = require("../utilities/Globals"),
  HttpStatusCodes = require("../utilities/HttpStatusCodes"),
  ResponseExporter = require("../utilities/ResponseExporter"),
  btoa = require("btoa"),
  atob = require("atob"),
  tv4 = require("tv4");
require('sugar');
/**
 * @class TestResponseHandler
 * @classdesc
 */
var TestResponseHandler = jsface.Class(AbstractResponseHandler, {
  $singleton: true,
  throwErrorOnLog: false,
  main: function () {
    jsdom.env("<html><body></body></html>", function (err, window) {
      _jq = require('jquery')(window);
    });
  },


  // function called when the event "requestExecuted" is fired. Takes 4 self-explanatory parameters
  _onRequestExecuted: function (error, response, body, request, runner, delay) {
    var handler = this;
    this._runTestCases(error, response, body, request, function (results) {
      AbstractResponseHandler._onRequestExecuted.call(handler, error, response, body, request, results, runner.exporter);
      handler._logTestResults(results);

      if (handler.throwErrorOnLog !== false) {
        // var _options = this.getOptions();
        runner.exporter.exportResults(function (results) {

          // _options.results = results;
        });
        ErrorHandler.terminateWithError(handler.throwErrorOnLog);
      }
      runner.emit("requestHandlerExecuted", error, response, body, request, runner, delay);
    });
  },

  _runTestCases: function (error, response, body, request, callback) {
    if (this._hasTestCases(request)) {
      var tests = request.tests;
      var sandbox = this._createSandboxedEnvironment(error, response, body, request, callback);
      this._runAndGenerateTestResults(tests, sandbox, callback);
    }else{
      callback({});
    }
  },

  _hasTestCases: function (request) {
    return !!request.tests;
  },

  // run and generate test results. Also exit if any of the tests has failed
  // given the users passes the flag
  _runAndGenerateTestResults: function (testCases, sandbox, callback) {
    this._evaluateInSandboxedEnvironment(testCases, sandbox, function (testResults) {
      var testResultsToReturn = {};
      if (Globals.stopOnError) {
        for (var key in testResults) {
          if (testResults.hasOwnProperty(key)) {
            if (!testResults[key]) {
              testResultsToReturn[key] = false;
              this.throwErrorOnLog = "Test case failed: " + key;
              return testResultsToReturn;
            }
            else {
              testResultsToReturn[key] = true;
            }
          }
        }
      }
      else {
        testResultsToReturn = testResults;
      }
      callback(testResultsToReturn);
    });
  },

  // evaluates a list of testcases in a sandbox generated by _createSandboxedEnvironment
  // catches exceptions and throws a custom error message
  _evaluateInSandboxedEnvironment: function (testCases, sandbox) {
    var sweet = "var jsonData;";
    sweet += "for(p in sugar.object) {Object.prototype[p] = sugar.object[p];}";
    sweet += "for(p in sugar.array)  {if(p==='create'){Array.create=sugar.array.create} else{Array.prototype[p]= sugar.array[p];}}";
    sweet += "for(p in sugar.string) String.prototype[p]  = sugar.string[p];";
    sweet += "for(p in sugar.date)  {if(p==='create'){Date.create=sugar.date.create} else{Date.prototype[p]= sugar.date[p];}}";
    sweet += "for(p in sugar.number) Number.prototype[p]= sugar.number[p];";
    sweet += "for(p in sugar.funcs) {" +
      "Object.defineProperty(Function.prototype, p, sugar.funcs[p]);" +
      "}";

    var setEnvHack = "setEnvVar = function(key,val) {postman.setEnvironmentVariableReal(key,val);environment[key]=val;};";
    setEnvHack += "setGlobalVar = function(key,val) {postman.setGlobalVariableReal(key,val);globals[key]=val;};";
    setEnvHack += "clearGlobalVar = function(key) {postman.clearGlobalVariableReal(key);delete globals[key];};";
    setEnvHack += "clearEnvVar = function(key) {postman.clearEnvironmentVariableReal(key);delete environment[key];};";
    setEnvHack += "clearGlobalVars = function() {postman.clearGlobalVariablesReal();globals={};};";
    setEnvHack += "clearEnvVars = function() {postman.clearEnvironmentVariablesReal();environment={};};";
    setEnvHack += "checkJsonValue = function(key, value) {if(typeof(jsonData) == 'undefined') {jsonData = JSON.parse(responseBody);}tests['check '+key] = jsonData.key === value;}";
    setEnvHack += "responseBodyHas = function(key){tests['Body matches '+key] = responseBody.has(key);}";
    setEnvHack += "responseBodyEqualStr = function(value){tests['Body is correct'] = responseBody === value;}";

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

    var ep = 'if (ep.getLength() > 0) {                             \
          ep.after(ep.getLength(), function () {                    \
            callback(tests);                          \
          });                                                       \
        } else {                                                    \
          callback(tests);                            \
        }';

    testCases = sweet + 'String.prototype.has = function(value){ return this.indexOf(value) > -1};' + setEnvHack + testCases + ep;

    try {
      vm.runInNewContext(testCases, sandbox);
    } catch (err) {
      if (err.toString() === "SyntaxError: Unexpected token u") {
        ErrorHandler.exceptionError("No response from URL");
      }
      else {
        ErrorHandler.exceptionError(err);
      }
    }
    // return sandbox.tests;
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

  //sets env vars
  _setEnvironmentContext: function () {
    if (!Globals.envJson) {
      return {};
    }
    return Helpers.transformFromKeyValue(Globals.envJson.values);
  },

  // sets the global vars json as a key value pair
  _setGlobalContext: function () {
    if (!Globals.globalJson) {
      return {};
    }
    return Helpers.transformFromKeyValue(Globals.globalJson.values);
  },

  // sets the data vars json as a key value pair
  _setDataContext: function () {
    if (!Globals.dataJson) {
      return {};
    }
    return Helpers.transformFromKeyValue(Globals.dataJson.values);
  },

  _getResponseCodeObject: function (code) {
    var obj = {
      'code': code,
      'name': "",
      'detail': ""
    };
    code = code.toString();
    var statusCodes = HttpStatusCodes.getCodes();
    if (statusCodes.hasOwnProperty(code)) {
      obj.name = statusCodes[code].name;
      obj.detail = statusCodes[code].detail;
    }
    return obj;

  },

  _createSandboxedEnvironment: function (error, response, body, request, callback) {
    var responseCodeObject = this._getResponseCodeObject(response.statusCode);
    var sugar = {array: {}, object: {}, string: {}, funcs: {}, date: {}, number: {}};
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
    Object.getOwnPropertyNames(Function.prototype).each(function (p) {
      sugar.funcs[p] = Object.getOwnPropertyDescriptor(Function.prototype, p);
    });
    var _ep = EventProxyHelper.create();
    return {
      sugar: sugar,
      tests: {},
      responseHeaders: Helpers.createProperCasedHeaderObject(response.headers),
      responseBody: body,
      responseTime: response.stats.timeTaken,
      request: {
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
      responseCode: responseCodeObject,
      btoa: btoa,
      atob: atob,
      CryptoJS: CryptoJS,
      iteration: Globals.iterationNumber,
      environment: this._setEnvironmentContext(),
      globals: this._setGlobalContext(),
      data: this._setDataContext(),
      $: _jq,
      jQuery: _jq,
      _: _lod,
      Backbone: Backbone,
      xmlToJson: function (string) {
        var JSON = {};
        xmlToJson.parseString(string, {
          explicitArray: false,
          async: false
        }, function (err, result) {
          JSON = result;
        });
        return JSON;
      },

      xml2Json: function (string) {
        var JSON = {};
        xmlToJson.parseString(string, {
          explicitArray: false,
          async: false,
          trim: true,
          mergeAttrs: false
        }, function (err, result) {
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
        getResponseHeader: function (headerString) {
          return Helpers.getResponseHeader(headerString, response.headers);
        },
        setEnvironmentVariableReal: function (key, value) {
          var envVar = _und.find(Globals.envJson.values, function (envObject) {
            return envObject["key"] === key;
          });

          if (envVar) { // if the envVariable exists replace it
            envVar["value"] = value;
          } else { // else add a new envVariable
            Globals.envJson.values.push({
              key: key,
              value: value,
              type: "text",
              name: key
            });
          }
        },
        getEnvironmentVariable: function (key) {
          var envVar = _und.find(Globals.envJson.values, function (envObject) {
            return envObject["key"] === key;
          });
          if (envVar) {
            return envVar["value"];
          }
          return null;
        },
        clearEnvironmentVariablesReal: function () {
          Globals.envJson.values = [];
        },
        clearEnvironmentVariableReal: function (key) {
          var oldLength = Globals.envJson.values.length;
          _lod.remove(Globals.envJson.values, function (envObject) {
            return envObject["key"] === key;
          });
          if (oldLength === Globals.envJson.values.length) {
            return false;
          }
          else {
            return true;
          }
        },
        getGlobalVariable: function (key) {
          var envVar = _und.find(Globals.globalJson.values, function (envObject) {
            return envObject["key"] === key;
          });
          if (envVar) {
            return envVar["value"];
          }
          return null;
        },
        setGlobalVariableReal: function (key, value) {
          var envVar = _und.find(Globals.globalJson.values, function (envObject) {
            return envObject["key"] === key;
          });

          if (envVar) { // if the envVariable exists replace it
            envVar["value"] = value;
          } else { // else add a new envVariable
            Globals.globalJson.values.push({
              key: key,
              value: value,
              type: "text",
              name: key
            });
          }
          //globals["key"]=value;
        },
        clearGlobalVariablesReal: function () {
          Globals.globalJson.values = [];
        },
        clearGlobalVariableReal: function (key) {
          var oldLength = Globals.globalJson.values.length;
          _lod.remove(Globals.globalJson.values, function (envObject) {
            return envObject["key"] === key;
          });
          if (oldLength === Globals.globalJson.values.length) {
            return false;
          }
          else {
            return true;
          }
        },
        setNextRequest: function (requestName) {
          Globals.nextRequestName = requestName;
        }
      },
      callback: callback
    };
  },

  // logger for test case results
  _logTestResults: function (results) {
    _und.each(_und.keys(results), function (key) {
      if (results[key]) {
        log.testCaseSuccess(key);
      } else {
        ErrorHandler.testCaseError(key);
      }
    });
  }
});

module.exports = TestResponseHandler;
