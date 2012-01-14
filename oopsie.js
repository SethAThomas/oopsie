/*
oopsie.js - an exception handling/reporting library
Written by: Seth Thomas

Dependencies:
    jQuery
    javascript-stacktrace: https://github.com/eriwen/javascript-stacktrace
    json2.js: http://www.JSON.org/json2.js
*/

(function ($, window, document, undefined) {
    'use strict';

    var VERSION = '0.1';

    //{{{ internal helpers

    function hasOwn(context, name) {
        return Object.prototype.hasOwnProperty.call(context, name);
    }

    function toArray() {
        // converts an arguments object to an actual array
        return Array.prototype.slice.apply(arguments);
    }

    var canStackTrace = $.isFunction(window.printStackTrace);

    function getStackTrace() {
        return window.printStackTrace().join('\n');
    }

    //}}}

    //{{{ error lookup

    // TODO: consider using the generic Error object, but distinguish using a .type property
    // https://github.com/joyent/node/issues/1454
    // error classes would then be factory methods that would return an Error instance with the
    // appropriate .type property
    // it would be cool if the createErrorClass() method took a config object, but Error instances
    // could also be called with a config to override those settings
    // possible settings:
    //     - report immediately or propagate
    //     - ???
    // include an .oopsie version property similar to jQuery; allows detection if the error
    // was an oopsie error

    var errors = [], // a reference to each oopsie error is stored here
        errorIdRegExp = /__oopsieID_(\d+)__/,
        errorFactories = {};

    function registerError(err) {
        // adds the error to the error lookup, so that it can be retrieved later
        var pos = errors.length;
        err.message = ('__oopsieID_' + pos + '__') + err.message;
        errors[pos] = err;
        return pos;
    }

    function retrieveError(msg) {
        // searches an error message for an oopsie error ID
        // returns the oopsie error object,
        // if one was found, otherwise returns null
        var m = msg.match(errorIdRegExp),
            pos;
        if (m) {
            pos = parseInt(m[1], 10);
            if (errors.length <= pos) {
                return errors[pos]; // lookup the oopsie error object
            };
        }
        return null;
    }

    function filterOutOopsieId(msg) {
        var m = msg.match(errorIdRegExp);
        if (m) {
            return msg.replace(m[0], ''); // remove the oopsie ID
        } else {
            return msg;
        }
    }

    //}}} end of error lookup

    //{{{ exception creation

    function makeError(type, msg, opts) {
        var factory = errorFactories[type];
        if (factory) {
            return factory(msg, opts);
        } else {
            msg = '[oopsie.makeError] unknown error type\ntype = "' + type + '"\n' + msg;
            return errorFactories['oopsieError'](msg, opts);
        }
    }

    function errorFactory(type, options) {
        assert(!hasOwn(errorFactories, type), 'error factory already exists', type, options);

        var factoryOptions = $.extend({
            reportImmediately: false
        }, options || {});

        var factory = function (msg, opts) {
            var _opts = $.extend(factoryOptions, opts || {});

            var err = new Error(msg);
            err.type = type;
            err.oopsie = VERSION;

            if (canStackTrace) {
                err.stackTrace = getStackTrace();
            }

            if (_opts.reportImmediately) {
                // TODO: report
            }

            registerError(err);
        };

        errorFactories[type] = factory;

        return factory;
    }

    // TODO: deprecate
    function createErrorClass(name) {
        if (hasOwn(window, name)) {
            return; // something by this name already exists
        }

        window[name] = function (message) {
            this.message = message;
            if (canStackTrace) {
                // FF uses .stack
                // Opera uses .stacktrace
                // avoid stepping on a used term
                this.stackTrace = getStackTrace();
            }

            // TODO:
            // register the error with a global lookup and inject a specific string
            // into the error message to help with lookup later
            // __ERROR_ID__123__
            // which could be extracted using something like:
            // /__ERROR_ID__(\d+)__/
        };
        window[name].prototype = new window.Error();
        window[name].prototype.constructor = window[name];
        window[name].prototype.name = name;
    }

    //}}} end of exception creation

    //{{{ stringify methods

    function getFunctionName(fn) {
        // uses the 'name' property, which is a non-standard property only supported by
        // a limited set of browsers (Mozilla, Webkit-browsers, etc.)
        // IE doesn't support this property

        var name = '';
        if (hasOwn(fn, 'name')) {
            name = fn.name;
            if (name === '') {
                name = 'anonymous';
            }
        }
        return name;
    }

    var jQueryToString = function () {
        var getXML = (function () {
            try {
                // Gecko - and Webkit-based browsers (Firefox, Chrome), Opera
                var serializer = new XMLSerializer();
                return function (xml) {
                    return serializer.serializeToString(xml);
                };
            } catch (e) {
                // IE supported method
                return function (xml) {
                    return xml.xml;
                };
            }
        })();

        function outerHTML($o) {
            return $('<p>').append($o.clone()).html();
        };

        return function ($o) {
            try {
                // HTML DOM parser content can use .innerHTML ($.fn.html); try
                // that first, since it provides cleaner strings
                return outerHTML($o);
            } catch (e) {
                // XML DOM parser content does not have an .innerHTML property, so
                // can't use .html(); strings aren't as nice, since they can include
                // xmlns attributes
                return $.map($o, function (n) {
                    return getXML(n);
                }).join('\n');
            }
        };
    }();

    function isReallyNaN(value) {
        // check if the value is really a NaN object, not just something that
        // evaluates to NaN
        //
        // TODO: determine if this alternative works:
        // return value !== value;
        return typeof(value) === 'number' && isNaN(value);
    }

    function isInfinite(value) {
        return value === Infinity || value === -Infinity;
    }

    function isJQuery(obj) {
        return obj && obj.jquery;
    }

    // extendable version
    function circularRefSafeTranslate() {
        var seen = [];

        return function (key, value) {
            try {
                if (typeof(value) === 'object') {
                    var seenAt = $.inArray(value, seen);
                    if (seenAt === -1) {
                        seen.push(value);
                    } else {
                        return 'JSON.circularRef_' + seenAt;
                    }
                }
                for (var k in translators) {
                    // we can by-pass using the .hasOwnProperty() check, since
                    // we control the object and know that it is a plain object
                    var translator = translators[k];
                    if (translator[0](value)) {
                        return translator[1](value);
                    }
                }
                return value;
            } catch (err) {
                // this is intended to be used during error reporting, so it
                // doesn't make a lot of sense to have it raise an error
                // during a failure
                return '[translation error]: ' + err.message;
        };
    }

    /*function circularRefSafeTranslate() {
        var seen = [];

        return function (key, value) {
            try {
                if (value === undefined) {
                    return 'undefined';
                }
                if ($.isFunction(value)) {
                    return '[function: ' + getFunctionName(value) + ']';
                }
                if (typeof(value) === 'object') {
                    // prevent circular references by replacing circular reference
                    // instances with a placeholder tag
                    var seenAt = $.inArray(value, seen);
                    if (seenAt === -1) {
                        seen.push(value);
                        if (isJQuery(value)) {
                            return '[jQuery: ' + jQueryToString(value) + ']';
                        }
                    } else {
                        return 'JSON.circularRef_' + seenAt;
                    }
                }
                if (value instanceof RegExp) {
                    return value.toString();
                }
                if (isReallyNaN(value)) {
                    return 'NaN';
                }
                if (isInfinite(value)) {
                    return value.toString();
                }
                return value;
            } catch (err) {
                return '[translation error]: ' + err.message;
            }
        };
    }*/

    var translators = {}; // collection of translators to use when stringifying

    // TODO: see if performance is improved by converting the translator to an Array
    function addTranslator(name, evaluator, translator) {
        assert(name && $.isFunction(evaluator) && $.isFunction(translator), '[oopsie.addTranslator] requires a name, an evaluator function and a translator function');
        translators[name] = [evaluator, translator];
    }

    // pre-populate with some default translators
    addTranslator('undefined', function (value) { return value === undefined; }, function () { return 'undefined'; });
    addTranslator('function', function (value) { return $.isFunction(value); }, function (value) {
        var fnName = getFunctionName(value);
        if (fnName) {
            return '[function: ' + fnName + ']';
        } else {
            return '[function]';
        }
    });
    addTranslator('RegExp', function (value) { return value instanceof RegExp; }, function (value) { return value.toString(); });
    addTranslator('NaN', function (value) { return isReallyNaN(value); }, function () { return 'NaN'; });
    addTranslator('infinite', function (value) { return isInfinite(value); }, function (value) { return value.toString(); });
    addTranslator('jQuery', function (value) { return isJQuery(value); }, function (value) { return '[jQuery: ' + jQueryToString(value) + ']'; });

    function stringify(o) {
        try {
            return JSON.stringify(o, circularRefSafeTranslate(), '');
        } catch (err) {
            return 'stringify error: ' + err.message;
        }
    }

    //}}} end of stringify methods

    //{{{ introspection functions

    var privateRegEx = /^(_)+/; // a name starting with an underscore indicates "private"

    function filterObject(obj, filter) {
        // returns a key/value object of all of the k/v from the obj that are true for the filter
        var filtered = {};

        $.each(instance, function (k, v) {
            if (filter(k, v)) {
                filtered[k] = v;
            }
        });

        return filtered;
    }

    var getPublicMethods = (function () {
        function filter(key, value) {
            return $.isFunction(value) && !privateRegExp.test(key);
        }

        return function getPublicMethods(obj) {
            return filterObj(obj, filter);
        };
    });

    var getPrivateMethods = (function () {
        function filter(key, value) {
            return $.isFunction(value) && privateRegExp.test(key);
        }

        return function getPrivateMethods(obj) {
            return filterObj(obj, filter);
        };
    });

    var getAllMethods = (function () {
        function filter(key, value) {
            return $.isFunction(value);
        }

        return function getAllMethods(obj) {
            return filterObj(obj, filter);
        };
    });

    var getPublicProperties = (function () {
        function filter(key, value) {
            return !$.isFunction(value) && !privateRegExp.test(key);
        }

        return function getPublicProperties(obj) {
            return filterObj(obj, filter);
        };
    });

    var getPrivateProperties = (function () {
        function filter(key, value) {
            return !$.isFunction(value) && privateRegExp.test(key);
        }

        return function getPrivateProperties(obj) {
            return filterObj(obj, filter);
        };
    });

    var getAllProperties = (function () {
        function filter(key, value) {
            return !$.isFunction(value);
        }

        return function getAllProperties(obj) {
            return filterObj(obj, filter);
        };
    });

    //}}} end of introspection functions

    //{{{ audit wrappers

    function audit(name, fn, context) {
        // wraps a function with a try/catch layer that will add information to the error message in the
        // event of an error being thrown
        // added information:
        //   arguments
        //   toString() of the context object

        context = context || {};

        return function () {
            try {
                return fn.apply(context, arguments);
            } catch (err) {
                try {
                    var newError = err, // jshint doesn't like modifying the error object, so we get around it like this
                        msg;

                    if (typeof(newError) !== 'object') {
                        // it's possible to throw non-Error objects
                        // convert to a proper Error object
                        newError = makeError('oopsieError', msg);
                    }

                    msg = [
                        newError.message,
                        '[' + name + ']',
                        'Arguments:',
                        stringify(arguments),
                        'toString:',
                        (context).toString()
                    ].join('\n');
                    newError.message = message;
                    throw newError;
                } catch (err2) {
                    // under no circumstances should we allow the error reporting to break things; better to lose some
                    // debugging information than to throw a different exception
                    throw err; // throw the original error
                }
            }
        };
    }

    function auditMethods(obj, prefix, filter) {
        // wraps methods with handlers that will add verbose error messages
        // in the event of an error
        // prefix - (optional) allows a prefix to be included before the name;
        //   ex: prefix = "Archive"
        //     verbose messages would then print the function name as: "Archive.log", "Archive.add", etc;
        //     if no prefix was provided, the names would just be "log", "add", etc.
        prefix = prefix || '';
        filter = filter || getAllMethods;
        var methods = filter(obj);

        if (prefix) {
            // only want one '.' at the end
            prefix = prefix.replace(/(\.)+$/, ''); // remove all trailing '.'
            prefix += '.';
        }

        $.each(methods, function (name, fn) {
            obj[name] = audit(prefix + name, fn, obj);
        });
    }

    function auditPublicMethods(obj, prefix) {
        auditMethods(obj, prefix, getPublicMethods);
    }

    function auditPrivateMethods(obj, prefix) {
        auditMethods(obj, prefix, getPrivateMethods);
    }

    //}}} end of audit wrappers

    //{{{ asserting

    function assert(bool) {
        // it's recommended that a message is included in the assert
        // ex: assert(bool, 'some message')
        // all arguments after "bool" will be treated as message arguments; they
        // will only be evaluated and included if the assertion fails
        if (!bool) {
            var msgArgs = Array.prototype.slice.call(arguments, 1),
                msg = [],
                err;

            for (var i = 0, len = msgArgs.length; i < len; i++) {
                msg[msg.length] = stringify(msgArgs[i]);
            }

            msg = msg.join('\n');

            if (oopsie.dev.alertOnAssertFailure) {
                oopsie.dev.alert(msg);
            }

            if (oopsie.dev.debugOnAssertFailure) {
                oopsie.dev.debug();
            }

            throw makeError('assertionError', msg);
        }
    }

    function fail() {
        // same as assert(false, msg)
        assert.apply(this, [false].concat(Array.prototype.slice.call(arguments)));
    }

    //}}} end of asserting

    //{{{ dev utilities

    // generally, these are helpers to native functionality that is difficult to mock out
    // during unit tests; the helpers make it much easier to mock out or spy on

    function alert(msg) {
        window.alert(msg);
    }

    function debug() {
        debugger; // intentional; not a forgotten debugger statement :)
    }

    function reload() {
        window.location.reload();
    }

    //}}} end of dev utilities

    //{{{ throttling

    // it generally isn't very helpful to report the same (or similar) error multiple times, such as
    // a loop that throws the same error on every iteration; throttling tries to reduce this duplicate
    // error notification

    // TODO: potential throttling strategies
    // 1) cooldown
    // 2) unique message string
    //   a) check x number of characters OR up to a delimiter (ex: ':' or '\n')
    //   b) try to calculate a similarity value, which would ignore noise from variables in the message
    // 3) max # of errors allowed (can combine with a cooldown strategy)
    // 4) use file/line# to identify unique errors; re-throwing errors may mess this up; LACK OF CROSS-BROWSER SUPPORT

    // http://help.dottoro.com/ljfhismo.php

    function getLineNo(err) {
        // lineNumber is only supported by FF
        return hasOwn(err, 'lineNumber') ? err.lineNumber : undefined;
    }

    function getFileName(err) {
        // fileName is only supported by FF
        return hasOwn(err, 'fileName') ? err.fileName : undefined;
    }


    //}}} end of throttling

    //{{{ error reporting

    var reportHandlers = {}, // allows special handling for specific errors
        defaultHandler = {
            before: function (defer) {
                // does nothing but resolve the defer
                defer.resolve();
            },
            after: $.noop
        };

    // TODO: make handler names act as Regular Expressions, plus support an '*' (all)
    function addHandler(name, o) {
        // adds a handler for a particular type of exception
        var handler = $.extend({}, defaultHandler, o || {});
        reportHandlers[name] = handler;
    }

    function isOopsieError(err) {
        return $.type(err) === 'object' && err.oopsie;
    }

    function reportError(err) {
        var handler,
            defer;

        try {
            handler = reportHandlers[err.type];
        } catch (e) {
            null;
        } finally {
            handler = $.extend({}, defaultHandler, handler || {});
        }

        defer = new $.Deferred();

        // allow the option for an asynchronous action to be taken before the
        // error is passed to the reporter
        // a rejected defer will be assumed to cancel the error report; this provides
        // an easy mechanism for cancelation

        defer.done(function () {
            var extraArgs = toArray.apply({}, arguments);
            oopsie.report.apply(oopsie, [err].concat(extraArgs));
            // TODO: might want to make the "after" fire after the reporter has finished;
            // don't want an "after" action reloading the browser while the error report
            // is still sitting in a client side AJAX queue
            if ($.isFunction(handler['after'])) {
                handler['after']();
            }
        });

        if ($.isFunction(handler['before'])) {
            handler['before'](defer);
        } else {
            defer.resolve();
        }
    }

    window.onerror = function (msg, url, line) {
        // check to see if it's an error oopsie knows about
        var err = retrieveError(msg);
        if (!isOopsieError(err)) {
            // did not find an oopsie error, so create one
            err = makeError('javascriptError', [msg, url, line].join('\n'));
        }
        reportError(err);
    }

    //}}}

    //{{{ set up configurable settings

    var defaultConfig = {
        app: 'unknown',
        project: '',
        xml: ''
    };

    //}}}

    //{{{ initialization

    errorFactory('assertionError');
    errorFactory('javascriptError');
    errorFactory('oopsieError'); // generic oopsie error object

    //}}} end of initialization

    window.oopsie = {};
    oopsie.version = VERSION;

    // some functions are considered so common that for convenience they can be accessed from the root of the namespace
    // these functions can also be found in their appropriate namespaces
    oopsie.stringify = stringify;
    oopsie.assert = assert;
    oopsie.fail = fail;

    // namespaced functionality
    oopsie.exception = {
        errorFactory: errorFactory,
        createErrorClass: createErrorClass,
        audit: audit,
        auditMethods: auditMethods,
        auditPublicMethods: auditPublicMethods,
        auditPrivateMethods: auditPrivateMethods
    };
    oopsie.tostring = {
        stringify: stringify,
        addTranslator: addTranslator
    },
    oopsie.assertions = {
        assert: assert,
        fail: fail
    };
    oopsie.dev = {
        debug: debug,
        alert: alert,
        reload: reload,

        // RECOMMEND YOU ONLY USE IN DEVELOPMENT
        alertOnAssertFailure: false, // if true, assertion failures will trigger an alert popup
        debugOnAssertFailure: false  // if true, assertion failures will trigger a debugger breakpoint
    };
    oopsie.introspection = {
        getPublicMethods: getPublicMethods,
        getPrivateMethods: getPrivateMethods,
        getAllMethods: getAllMethods,
        getPublicProperties: getPublicProperties,
        getPrivateProperties: getPrivateProperties,
        getAllProperties: getAllProperties
    };
    oopsie.report = {
        reporter: null, // the mechanism for reporting to an external source; must provide this piece yourself
        addHandler: addHandler
    };
})(jQuery, window, document);
