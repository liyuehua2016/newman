var jsface = require('jsface'),
    AbstractResponseHandler = require('./AbstractResponseHandler');

/**
 * @class DefaultResponseHandler
 * @classdesc
 * @extends AbstractResponseHandler
 */
var DefaultResponseHandler = jsface.Class(AbstractResponseHandler, {
    $singleton: true,
    _options : {},
    setOptions: function(options) {
        this._options = options;
    },
    getOptions: function(){
        return this._options;
    },
    // function called when the event "requestExecuted" is fired. Takes 4 self-explanatory parameters
    _onRequestExecuted: function (error, response, body, request) {
        AbstractResponseHandler._onRequestExecuted.call(this, error, response, body, request);
    }
});

module.exports = DefaultResponseHandler;
