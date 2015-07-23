define(["packages/underscore", "packages/jquery", "packages/backbone"], function(_, $, Backbone) {
/**
 * @license almond 0.3.0 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../node_modules/almond/almond", function(){});

define('backend/utils',[],function() {
	return {
		signatures: {
			OPERA: 'opera', // version < 13
			OPERA_NEXT: 'opr', // version >= 15
			FIREFOX: 'mozilla',
			GOOGLE_CHROME: 'chrome',
			YANDEX_BROWSER: 'yabrowser',
			INTERNET_EXPLORER: 'msie',
		},

		getBrowserUASignature: function() {
			var ua = window.navigator.userAgent.toLowerCase();
			var match = /(edge)\/([\w.]+)/.exec(ua) ||
				/(opr)[\/]([\w.]+)/.exec(ua) ||
				/(yabrowser)[ \/]([\w.]+)/.exec(ua) ||
				/(chrome)[ \/]([\w.]+)/.exec(ua) ||
				/(version)(applewebkit)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(ua) ||
				/(webkit)[ \/]([\w.]+).*(version)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(ua) ||
				/(webkit)[ \/]([\w.]+)/.exec(ua) ||
				/(opera)(?:.*version|)[ \/]([\w.]+)/.exec(ua) ||
				/(msie) ([\w.]+)/.exec(ua) ||
				ua.indexOf('trident') >= 0 && /(rv)(?::| )([\w.]+)/.test(ua) && ['trident', 'msie'] ||
				ua.indexOf('compatible') < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec(ua) ||
				[];

			return match[5] || match[3] || match[1] || '';
		}
	};
});
/**
 * Абстрактная реализация модуля бэкэнда для L4G.
 * Реализация позволяет включать/выключать модуль, а также
 * работать с событиями
 * В качестве системы сообщений использует Backbone.Events
 *
 * Общая логика работы всех модулей, созданных на основе
 * текущей абстрактной реализации следующая.
 * После успешного подключения бэкэнда вызывается событие
 * `connect`. Текущее состояние подключения можно проверить
 * методом `state()`. Для закрытия подключения можно вызвать метод
 * `disconnect()`, однако по умолчанию модуль будет пытаться
 * заново подключиться к серверу. Чтобы этого не происходило,
 * нужно отключить модуль, вызвав метод `enabled(false)`.
 * В этом случае модуль автоматически отключится от сервера,
 * а все попытки подключиться (даже с явным вызовом `connect()`)
 * будут игнорироваться. Это нужно для того, чтобы сама игровая панель
 * могла выбрать единственный подходящий бэкэнд для работы, а в случае
 * потери связи с ним (например, во время обновления) попытаться
 * восстановить подключение через другие бэкэнды.
 */
define('backend/abstract',[
	'packages/underscore',
	'packages/jquery',
	'packages/backbone'
], function(_, $, Backbone) {
	return _.extend({

		/** Неактивное состояние: модуль ничего не делает, но работает */
		STATE_IDLE: 'idle',

		/** Модуль пытается подключиться к серверу */
		STATE_CONNECTING: 'connecting',

		/** Модуль подключён к серверу и получает от него сообщения */
		STATE_OPEN: 'open',

		/** 
		 * Возникла ошибка в процессе работы модуля, которая не позволяет
		 * работать дальше
		 */
		STATE_ERROR: 'error',

		_enabled: true,
		_accel: false,
		_state: 'idle',
		_config: {},
		_errorMessage: null,

		/**
		 * Переводит модуль в состояние ошибки
		 * @param  {String} message Дополнительная информация о причине ошибки
		 */
		_error: function(message) {
			this._state = this.STATE_ERROR;
			this._errorMessage = message;
			if (typeof console != 'undefined' && console.error) {
				console.error(message);
			}
			this.trigger('error', message);
		},

		/**
		 * Включает/выключает текущий модуль (если передано значение `val`).
		 * Отключённый модуль не будет пытаться подключаться к серверу.
		 * @param  {Boolean} val Новое значение активности модуля
		 * @return {Boolean} Текущее значение активности
		 */
		enabled: function(val) {
			if (arguments.length) {
				val = !!val;
				if (val !== this._enabled) {
					this._enabled = val;
					this.trigger(this._enabled ? 'enable' : 'disable');
				}
			}

			return this._enabled;
		},

		enable: function() {
			this.enabled(true);
			return this;
		},

		disable: function() {
			this.enabled(false);
			return this;
		},

		/**
		 * Возвращает текущее состояние подключения
		 * @return {String}
		 */
		state: function() {
			return this._state;
		},

		/**
		 * Запускает процесс подключение к бэкэнд-серверу.
		 */
		connect: function() {
			console.error('Not implemented!');
		},

		/**
		 * Принудительно отключает модуль от бэкэнд-сервера.
		 * В зависимости от реализации, модуль может инициировать
		 * автоматическое переподключение к серверу. Чтобы этого
		 * не происходило, нужно вызывать метод `enabled(false)`,
		 * то есть отключить модуль
		 */
		disconnect: function() {
			console.error('Not implemented!');
		},

		/**
		 * В зависимости от переданного состояния, ускоряет
		 * восстанавливает время между попытками подключения к
		 * бэкэнду.
		 * Ускорение, в первую очередь, означает, что из конфига
		 * будут возвращаться значения с префиксом `accel`
		 * @param  {Boolean} state Состояние ускорения: включено/отключено
		 */
		accelerate: function(state) {
			state = !!state;
			if (state !== this._accel) {
				this._accel = state;
				this.trigger('accelerate', state);
			}
		},

		/**
		 * Шлёт сообщение с названием `name`и данными `data`
		 * текущему бэкэнд-серверу
		 * @param  {String} name Название сообщение
		 * @param  {String} data JSON-строка с данными. Может быть объектом:
		 * он автоматически будет сериализован в строку
		 */
		send: function(name, data) {
			data = data || {};
			this.trigger('send', {
				name: name,
				data: data
			});

			if (_.isObject(data)) {
				data = JSON.stringify(data);
			}

			if (this.state() === this.STATE_OPEN) {
				this._send(name, data);
			}
		},

		/**
		 * Проводим тестирование может ли работать текущий бэкэнд в данном
		 * браузере.
		 * По умолчанию каждый бекэнд возвращает `true`.
		 */
		available: function() {
			return $.Deferred().resolve(this);
		},

		/**
		 * Внутренняя реализация логики отправки сообщения на бэкэнд.
		 * В этот метод данные приходят уже чистыми, то есть преобразованными
		 * в строку и готовыми к отправке
		 * @param  {String} name Название сообщения
		 * @param  {String} data Данные в виде JSON-строки
		 */
		_send: function(name, data) {
			console.error('Not implemented!');
		},

		/**
		 * Получает или записывает значение конфигурационного параметра
		 * @param  {String|Object} name  Название параметра или хэш с параметрами
		 * @param  {Object} value Значение параметра
		 * @return {Object}       Текущее значение указанного параметра
		 */
		config: function(name, value) {
			if (typeof name == 'object') {
				_.each(name, function(v, k) {
					this._config[k] = v;
				}, this);
				return;
			}
			if (arguments.length > 1) {
				this._config[name] = value;
			}

			if (this._accel) {
				// проверим, есть ли «ускоренное» значение для ускоренного режима
				// вида `accelKeyName` (для `keyName`)
				var keyName = 'accel' + name.charAt(0).toUpperCase() + name.substr(1);
				if (keyName in this._config) {
					return this._config[keyName];
				}
			}

			return this._config[name];
		},

		/**
		 * Начальная настройка модуля. Этот метод нужно вызывать
		 * перед использованием любого бэкэнда, созданного на основе
		 * текущей абстрактной реализации
		 * @param {Object} config Данные для конфига (не обязательно)
		 * @return {Object}
		 */
		setup: function(config) {
			// подписываемся на стандартные события, чтобы обозначить статус
			// подключения модуля к бэкэнду
			if (config) {
				this.config(config);
			}

			return this
				.on('connect', function() {
					this._state = this.STATE_OPEN;
				})
				.on('disconnect', function() {
					this._state = this.STATE_IDLE;
				})
				.on('disable', function() {
					this.enabled(false);
					this.disconnect();
				});
		},

		/**
		 * Простой логгер событий плагина. Сам по себе он ничего
		 * не выводит в консоль, но бросает событие, которое можно
		 * слушать и обрабатывать во внешнем контроллере
		 * @param  {String} message
		 */
		log: function(message) {
			this.trigger('log', this.id, message);
		}
	}, Backbone.Events);
});
/**
 * Модуль для общения с плагином браузера в качестве
 * бэкэнда
 */
define('backend/plugin',[
	'packages/underscore',
	'packages/jquery',
	'./abstract'
], function(_, $, abstractBackend) {
	var PLUGIN_NAME = 'plugin4game';
	var PLUGIN_MIME = 'application/x-4game-plugin';
	var PLUGIN_DESCRIPTION = '4game browser plugin';
	var PROG_ID = '4game.plugin.1';
	var INCOMING_EVENT_NAME = 'message';

	var reconnectTimer;
	var pluginInstance;

	function refreshPlugins() {
		if (navigator.plugins) {
			navigator.plugins.refresh(false);
		}
	}

	function reconnectPlugin() {
		var timeout = module.config('reconnectTimeout');

		module.log('init reconnect');
		if (timeout) {
			reconnectTimer = setTimeout(function() {
				module.connect();
			}, timeout);
		}
	}

	var module = _.defaults({
				id: 'plugin',

				connect: function() {
					if (reconnectTimer) {
						clearTimeout(reconnectTimer);
						reconnectTimer = null;
					}

					// смотрим, можем ли вообще использовать этот бэкэнд
					// для подключения
					if (!this.enabled() || this.state() !== this.STATE_IDLE) {
						return;
					}

					this._state = this.STATE_CONNECTING;
					this.log('trying to connect');

					this.available()
						.then(function() {
							// В случае если l4g модуль подключен в head
							// то необходимо дождаться загрузки документа
							// иначе во время инициализации плагина
							// возникает runtime ошибка "document.body is null"
							// Баг может возникнуть если:
							// - в качестве транспорта используется только плагин, WebSocket транспорт не доступен
							// - транспорт через WebSocket сфейлился и идет попытка коннекта через плагин
							// Данный фикс исправляет описанную проблему в Opera 12, поскольку в других браузерах
							// в качестве транспорта используется WebSocket
							if (document.readyState !== 'interactive' && document.readyState !== 'complete') {
								document.addEventListener('DOMContentLoaded', ready);
							} else {
								ready();
							}

							function ready() {
								pluginInstance = createPluginInstance();

								if (!pluginInstance || !pluginInstance.valid) {
									module._state = module.STATE_IDLE;
									module.trigger('failed');
									reconnectPlugin();
								} else {
									window.__nativePluginOnload();
								}
							};

						}.bind(this))
						.fail(function() {
							this.log('not available');
							this._state = this.STATE_IDLE;
							this.trigger('failed');
						}.bind(this));
				},

				disconnect: function() {
					if (pluginInstance) {
						pluginInstance = null;
					}
					this.trigger('disconnect');
					this.connect();
				},

				available: function() {
					if (pluginAvailable()) {
						return $.Deferred().resolve(this);
					} else {
						return $.Deferred().reject();
					}
				},

				refresh: function() {
					refreshPlugins();
				},

				_send: function(name, data) {
					pluginInstance.send(name, data);
				}
			},
			abstractBackend)
		.setup({
			reconnectTimeout: 5000,
			accelReconnectTimeout: 1000
		});

	/**
	 * Выносим в глобальную область видимости коллбэк,
	 * который должен быть вызван после инициализации плагина
	 */
	window.__nativePluginOnload = function() {
		if (module.enabled()) {
			if (module.state() != module.STATE_OPEN) {
				addEvent('message', function() {
					module.trigger.apply(module, arguments);
				});
				module.trigger('connect');
			} else {
				module.log('already connected');
			}

			$(document).trigger('pluginInited', {
				'plugin': pluginInstance
			});
		}
	};

	function addEvent(type, listener) {
		if (pluginInstance.addEventListener) {
			pluginInstance.addEventListener(type, listener, false);
		} else if (pluginInstance.attachEvent) {
			pluginInstance.attachEvent('on' + type, listener);
		}

		$(pluginInstance).on('fakeMessage', function(evt, name, data) {
			listener.call(this, name, data);
		});
	}

	/**
	 * Проверяет, доступен ли плагин 4game в браузере
	 * пользователя
	 * @return {Boolean}
	 */
	function pluginAvailable() {
		if (window.ActiveXObject) {
			return !!createIEPluginInstance();
		}

		if (!navigator.plugins) {
			return false;
		}

		return !!_.find(navigator.mimeTypes, function(mime) {
			return mime.type == PLUGIN_MIME && mime.enabledPlugin;
		});
	}

	function createIEPluginInstance() {
		try {
			return new ActiveXObject(PROG_ID);
		} catch (e) {
			return false;
		}
	}

	function createPluginInstance() {
		if (window.ActiveXObject) {
			return createIEPluginInstance();
		}

		var pluginHere = document.getElementById('PluginHere');
		if (!pluginHere) {
			pluginHere = document.createElement('div');
			pluginHere.id = 'PluginHere';
			document.body.appendChild(pluginHere);
		}

		pluginHere.innerHTML =
			'<object id="' + PLUGIN_NAME + '" type="' + PLUGIN_MIME + '" width="1" height="1">' +
			'<param name="onload" value="__nativePluginOnload" />' +
			'</object>';

		return document.getElementById(PLUGIN_NAME);
	};

	return module;
});
/**
 * Реализация бэкэнда для игровой панели через WebSockets
 */
define('backend/websocket',[
	'packages/underscore',
	'./abstract'
], function(_, abstractBackend) {
	/** @type {WebSocket} */
	var ws,
		urlPool = [],
		reconnectTimer,
		wsConnectionTimer,
		connectionAttemptTimeout = 2 * 1000;

	var module = _.defaults({
				id: 'ws',

				// Время ожидания соединения истекло.
				STATUS_CONNECTION_TIMEOUT: 4000,

				// Соединение было завершено в ручную пользователем.
				STATUS_CLOSED_BY_PEER: 4001,

				// Одно из соединений уже было установлено больше соединений не требуется.
				STATUS_CONNECTION_ESTABLISHED: 4002,

				desctiptions: {
					4000: 'connection timeout',
					4001: 'connection closed by peer',
					4002: 'another connection already established'
				},

				connect: function() {
					if (reconnectTimer) {
						clearTimeout(reconnectTimer);
						reconnectTimer = null;
					}

					// смотрим, можем ли вообще использовать этот бэкэнд
					// для подключения
					if (!this.enabled() || this.state() !== this.STATE_IDLE) {
						return;
					}

					this.available()
						.then(function() {
							this._state = this.STATE_CONNECTING;
							urlPool = createURLPool();
							tryToConnect();
						}.bind(this))
						.fail(function() {
							this._error('WebSockets are not available for this browser');
						}.bind(this));

				},

				disconnect: function() {
					if (ws && ws.readyState == ws.OPEN) {
						ws.close(this.STATUS_CLOSED_BY_PEER, JSON.stringify({
							name: 'status',
							data: {
								desc: this.desctiptions[this.STATUS_CLOSED_BY_PEER]
							}
						}));
					}
					ws = null;
					clearConnectionTimer();
					this.trigger('disconnect');
					this.connect();
				},

				available: function() {
					if (window.WebSocket != null) {
						return $.Deferred().resolve(this);
					} else {
						return $.Deferred().reject();
					}
				},

				_send: function(name, data) {
					if (ws && ws.readyState == ws.OPEN) {
						ws.send(JSON.stringify({
							name: name,
							data: data
						}));
					}
				}
			},
			abstractBackend)
		.setup({
			url: 'wss://<%= host %>:<%= port %>/ws',
			host: ['localhost','127.0.0.1'],
			port: [853, 9443, 9444, 9445, 16853],
			reconnectTimeout: 10000,
			accelReconnectTimeout: 1000,
			resetTimeout: 3000
		});

	module.on('disable', function() {
		this.disconnect();
	});

	/**
	 * Создаёт пулл адресов, по которым нужно попытаться
	 * подключиться к сокет-серверу
	 * @return {Array}
	 */
	function createURLPool() {
		var hosts = module.config('host'),
			ports = module.config('port'),
			template = _.template(module.config('url')),
			urlPool = [];

		if (!_.isArray(hosts)) {
			hosts = [hosts];
		}

		if (!_.isArray(ports)) {
			ports = [ports];
		}

		_.each(hosts, function(host) {
			_.each(ports, function(port) {
				urlPool.push(template({
					host: host,
					port: port
				}));
			});
		});
		return urlPool;
	}

	function tryToConnect() {
		if (!urlPool || !urlPool.length) {
			// закончился пулл адресов, заново инициируем
			// попытку подключения
			module._state = module.STATE_IDLE;
			module.log('init reconnect');
			module.trigger('failed');

			reconnectTimer = setTimeout(function() {
				module.connect();
			}, module.config('reconnectTimeout'));
			return;
		}

		if (!module.enabled()) {
			// модуль отключён: не пытаемся подключиться
			// и сбрасываем пул адресов
			return urlPool.length = 0;
		}

		var availableAttempts = urlPool.length,
			connectionSucceed = function(wsInstance, event) {
				module.log('connection success (' + availableAttempts + ')', wsInstance, ws);

				if (ws) {
					wsInstance.close(module.STATUS_CONNECTION_ESTABLISHED, JSON.stringify({
						name: 'status',
						data: {
							desc: module.desctiptions[module.STATUS_CONNECTION_ESTABLISHED]
						}
					}));
				} else {
					ws = wsInstance;

					// Подписываем все необходимые обработчики.
					ws.onopen = onOpen;
					ws.onmessage = onMessage;
					ws.onclose = onClose;
					ws.onerror = onError;

					// Так как сокет уже открыт, то просто проксируем его событие в метод.
					onOpen(event);
				}
			},
			connectionFailed = function(wsInstance) {
				module.log('connection error (' + availableAttempts + ')', wsInstance);
				if (!ws && !(--availableAttempts - 1)) {
					module._state = module.STATE_IDLE;
					clearConnectionTimer();
					wsConnectionTimer = setTimeout(resetOnTimeout, module.config('resetTimeout'));
				}
			};

		for (var i = 0, length = urlPool.length; i < length; i++) {
			createConnection(urlPool[i], connectionSucceed, connectionFailed);
		}
	}

	function createConnection(url, successHandler, errorHandler) {
		var ws,
			timer,
			success = function() {
				if (timer) {
					clearTimeout(timer);
				}

				if (ws) {
					ws.onopen = ws.onclose = ws.onerror = null;
				}

				if (typeof(successHandler) === 'function') {
					successHandler.apply(this, arguments);
				}
			},
			error = function(ws, event) {
				if (timer) {
					clearTimeout(timer);
				}

				if (ws) {
					ws.onopen = ws.onclose = ws.onerror = null;

					if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
						if (event) {
							ws.close(module.STATUS_CLOSED_BY_PEER, JSON.stringify({
								name: 'status',
								data: {
									desc: module.desctiptions[module.STATUS_CLOSED_BY_PEER]
								}
							}));
						} else {
							ws.close(module.STATUS_CONNECTION_TIMEOUT, JSON.stringify({
								name: 'status',
								data: {
									desc: module.desctiptions[module.STATUS_CONNECTION_TIMEOUT]
								}
							}));
						}
					}
				}

				if (typeof(errorHandler) === 'function') {
					errorHandler.apply(this, arguments);
				}
			};

		try {
			module.log('trying ', url);
			ws = new WebSocket(url);

			ws.onopen = function(event) {
				success(ws, event);
			};

			ws.onclose = ws.onerror = function(event) {
				error(ws, event);
			};

			timer = setTimeout(function() {
				error(ws);
			}, connectionAttemptTimeout);
		} catch (e) {
			// не удалось инициировать подключение:
			// полностью отключаем модуль
			module._error(e);
			error(ws, e);
		}
	}

	/**
	 * Сбрасывает подключение к сокет-серверу после превышения
	 * определённого таймаута
	 */
	function resetOnTimeout() {
		if (ws && ws.readyState != WebSocket.CONNECTING) {
			return;
		}

		module.log('reset on timeout');

		if (ws) {
			ws.close(module.STATUS_CONNECTION_TIMEOUT, JSON.stringify({
				name: 'status',
				data: {
					desc: module.desctiptions[module.STATUS_CONNECTION_TIMEOUT]
				}
			}));
			ws = null;
		}
		module.trigger('failed');
		module.connect();
	}

	/**
	 * Отключает таймер, который следит за длительностью
	 * попытки подключения и сбрасывает соединение, если оно превышено
	 */
	function clearConnectionTimer() {
		if (wsConnectionTimer) {
			clearTimeout(wsConnectionTimer);
			wsConnectionTimer = null;
		}
	}

	function onOpen(evt) {
		clearConnectionTimer();

		module.log('connected to', ws.url);

		if (module.enabled()) {
			module.trigger('connect');
		} else {
			module.disconnect();
		}
	}

	function onMessage(evt) {
		if (module.enabled() && evt.data) {
			module.trigger('message', evt.data);
		}
	}

	function onClose(evt) {
		var wsInstance = ws || evt.target;

		module.log('before closing status', wsInstance.readyState);

		if (wsInstance.readyState === WebSocket.OPEN) {
			return module.log('crazy browser! tries to close opened connection! aborting...');
		}

		module.log('closing connection');
		wsInstance.onopen = wsInstance.onmessage = wsInstance.onclose = wsInstance.onerror = null;

		if (module.state() === module.STATE_OPEN) {
			// подключение было, но потерялось
			module.disconnect();
		} else {
			clearConnectionTimer();
			tryToConnect();
		}
	}

	function onError(evt) {
		clearConnectionTimer();
		module.log('connection error', evt);
	}

	return module;
});
/**
 * Модуль для общения с экстеншеном браузера в качестве
 * бэкэнда
 */
define('backend/extension',[
	'packages/underscore',
	'packages/jquery',
	'./abstract'
], function(_, $, abstractBackend) {
	var isChrome = navigator.userAgent.toLowerCase().indexOf("chrome") >= 0 && navigator.vendor.toLowerCase().indexOf("google") >= 0,
		responseCallbacks = {},
		reconnectTimer;

	window.addEventListener('message', onReceive);

	var module = _.defaults({
			id: 'chrome-extension',

			connect: function() {
				if (reconnectTimer) {
					clearTimeout(reconnectTimer);
					reconnectTimer = null;
				}

				// смотрим, можем ли вообще использовать этот бэкэнд
				// для подключения
				if (!this.enabled() || this.state() !== this.STATE_IDLE) {
					return;
				}

				this._state = this.STATE_CONNECTING;
				this.log('trying to connect');

				this.available().then(module.onInited.bind(this), module.onFailed.bind(this));
			},

			available: function() {
				return extensionAvailable();
			},

			onInited: function() {
				module.trigger('connect');
			},

			onFailed: function() {
				module._state = module.STATE_IDLE;
				module.trigger('failed', this.id);
				reconnectExtension();
			},

			disconnect: function() {
				this.trigger('disconnect');
				this.connect();
			},

			_send: function(name, data) {
				postCommand('send', {
					name: name,
					data: data
				});
			},
		}, abstractBackend)
		.setup({
			reconnectTimeout: 5000,
			accelReconnectTimeout: 1000,
			extensionTimeout: 2000
		});

	return module;

	function reconnectExtension() {
		var timeout = module.config('reconnectTimeout');
		module.log('init reconnect');
		if (timeout) {
			reconnectTimer = setTimeout(function() {
				module.connect();
			}, timeout);
		}
	}

	function extensionAvailable() {
		var defer = $.Deferred();

		if (!isChrome) {
			defer.reject();
		} else {
			postCommand('getAvailabilityStatus', function(error, ok) {
				if (error) {
					defer.reject();
				} else {
					defer.resolve(module);
				}

			});
		}

		return defer.promise();
	}

	function postCommand(commandName, data, callback) {
		var responseTimeout,
			id;

		var envelop = {
			name: 'forgame-site-message',
			command: commandName
		};

		if (typeof data === 'function') {
			callback = data;
			data = null;
		}

		if (data) {
			envelop.data = data;
		}

		if (typeof callback === 'function') {
			id = Date.now();
			envelop.id = id;

			responseTimeout = setTimeout(function() {
				delete responseCallbacks[id];
				callback('Timeout');
			}, module.config('extensionTimeout')); //две секунды

			responseCallbacks[id] = function(data) {
				clearTimeout(responseTimeout);
				delete responseCallbacks[id];
				callback(null, data);
			};
		}

		window.postMessage(JSON.stringify(envelop), window.location.origin);
	};

	function onReceive(evt) {
		if (typeof evt.data !== 'string') {
			return;
		}

		try {
			var data = JSON.parse(evt.data || '{}'),
				messageData;

			if (evt.source === window && data.name === 'forgame-extension-message') {
				var id = data.id;
				if (id && responseCallbacks[id]) {
					responseCallbacks[id](data.data);
				} else if (module.state() === module.STATE_OPEN) {
					messageData = data.data || {};
					messageData = typeof messageData !== 'string' ? JSON.stringify(messageData) : messageData;
					module.trigger('message', messageData);
				}
			}
		} catch (ex) {
			module.log(ex.message);
		}
	}

});
define('backend/fake',[
	'packages/underscore',
	'./abstract'
], function(_, abstractBackend) {
	return _.defaults({
		id: 'fake',

		connect: function() {
			// смотрим, можем ли вообще использовать этот бэкэнд
			// для подключения
			if (!this.enabled() || this.state() !== this.STATE_IDLE) {
				return;
			}

			this._state = this.STATE_CONNECTING;
			this.log('trying to connect');

			if (window.FOURGE && window.FOURGE.fakePluginAvailable) {
				this.trigger('connect');
			} else {
				this.log('not available');
				this._state = this.STATE_IDLE;
			}
		},

		disconnect: function() {
			this.trigger('disconnect');
			this.connect();
		},

		_send: function(name, data) {
			if (typeof(data) === 'string') {
				try {
					data = JSON.parse(data);
				} catch(e) {}
			}

			this.trigger('message', JSON.stringify({
				name: name,
				data: data
			}));
		}
	}, abstractBackend)
	.setup();
});

/**
 * Менеджер для бэкэндов для подключения к приложение 4game.
 * Менеджер сам следит за тем, чтобы какой-нибудь бэкэнд был подключён
 * к приложениею, а также выбирает наиболее подходящий из доступных
 * (например, плагин приоритетнее, чем сокеты).
 */
define('backend/manager',[
	'packages/underscore',
	'packages/backbone',
	'packages/jquery',
	'./utils',
	'./plugin',
	'./websocket',
	'./extension',
	'./fake',
], function(_, Backbone, $, utils, plugin, ws, extension, fake) {
	/** Все доступные бэкэнды */
	var allBackends = [];
	var topPriority;

	var browserSignature = utils.getBrowserUASignature();
	var hasNoNPAPISupport = [
		utils.signatures.GOOGLE_CHROME,

		// Браузеры ниже все еще имеют поддержку NPAPI.
		// utils.signatures.INTERNET_EXPLORER,
		// utils.signatures.YANDEX_BROWSER,
		// utils.signatures.OPERA_NEXT,
		// utils.signatures.FIREFOX,
	].indexOf(browserSignature) >= 0;

	/** 
	 * Определяем является ли текущий браузер Opera 12 или ниже, так как для них из-за проблем с
	 * сокетами и автообновлением плагина предусмотренно кастомное поведение.
	 */
	var isOldOpera = browserSignature === utils.signatures.OPERA;

	/** 
	 * В зависимости от доступности бэкэндов в конкретном браузере формируем свою
	 * стратегию работы.
	 *
	 * Если мы работаем с Opera 12 и ниже, то изначально в ней блокируем работу с сокетами, так
	 * как есть проблемы с сертификатами.
	 */
	var available = function(backend) {
		var defer = $.Deferred();
		if (backend) {
			backend.available().always(defer.resolve);
		} else {
			defer.resolve(false);
		}
		return defer.promise();
	}

	var backendsAvailablePromise = $.Deferred();
	var backends = [!isOldOpera && ws, !hasNoNPAPISupport && plugin, extension, fake];

	$.when.apply(null, backends.map(available)).then(function(ws, plugin, extension) {
		Array.prototype.slice.call(arguments, 0).forEach(function(backend) {
			if (backend) {
				allBackends.push(backend);
			}
		});

		if (ws) {
			setAsBroken(plugin);
			setAsBroken(extension);
		}

		topPriority = allBackends[0].id;
		backendsAvailablePromise.resolve(allBackends);
	})

	/** Идентификаторы подключённых на данный момент бэкэндов */
	var connectedBackends = [];

	/** Список зарегистрированных фильтров */
	var filters = [];

	/** 
	 * Бэкэнд с наивысшим приоритетом. Если он подключён,
	 * то все остальные бэкэнды будут автоматически отключаться
	 * @type {String}
	 */


	/** Остальные переменные */
	var reconnectionTimeout = 1000,
		attempts = {
			'ws': 0,
			'plugin': 0
		},
		delayTimer,
		unlimitedReconnect = false,
		retryCount = 2;

	function dispatchLog(backendId, message) {
		module.trigger('backend-log', backendId, message);
	}

	/**
	 * Находит бэкэнд по указанному идентификатору
	 * @param  {String} id
	 * @return {Object}
	 */
	function findBackend(id) {
		if (_.isString(id)) {
			return _.find(allBackends, function(back) {
				return back.id === id;
			});
		}
		return id;
	}

	/**
	 * Обработка события подключения бэкэнда
	 */
	function handleConnect() {
		if (hasNoNPAPISupport && this.id == plugin.id) {
			this.trigger('unsupported');
			return;
		}

		if (!_.include(connectedBackends, this.id)) {
			connectedBackends.push(this.id);
		}

		if (unlimitedReconnect) {
			module.resetUnlimitedReconnections();
		}

		// если появилось подключение, то принудительно
		// замедляем все бэкэнды
		_.invoke(allBackends, 'accelerate', false);

		module.trigger('connect', this.id);
		attempts[this.id] = 0;

		if (this.id !== fake.id) {
			sendStat(this.id + '-is-connected');
		}

		if (_.include(connectedBackends, topPriority)) {
			_.each(allBackends, function(backend) {
				if (backend.id !== topPriority) {
					backend.disable();
				}
			});
		}
	}

	/**
	 * Обработка события отключения бэкэнда
	 */
	function handleDisconnect() {
		connectedBackends = _.without(connectedBackends, this.id);
		module.trigger('disconnect', this.id);

		if (!connectedBackends.length) {
			// вырубились все бэкэнды, выжидаем 1 секунду и попытаемся подключиться
			// к любому из них
			cancelTimer();
			delayTimer = setTimeout(function() {
				module.connect();
			}, reconnectionTimeout);
		}
	}

	function messageProxy() {
		if (_.include(connectedBackends, this.id) && findBackend(this.id).enabled()) {
			var args = ['message'].concat(_.toArray(arguments));
			module.trigger.apply(module, args);
		}
	}

	function sendMessage(payload) {
		var backend = findBackend(module.getActiveBackend());

		if (backend) {
			backend.send(payload.name, payload.data);
		}
	}

	function handleUnsupportedBackend() {
		switch (this.id) {
			case 'chrome-extension':
				plugin
					.available()
					.then(function() {
						module.trigger('unsupported', this.id);
					}.bind(this))
					.always(function() {
						setAsBroken(this);
						module.connect();
					}.bind(this));
				break;
		}
	}

	function handleFail() {
		var attempt = ++attempts[this.id];

		switch (this.id) {
			case 'ws':
				if (!unlimitedReconnect) {
					if (attempt === retryCount) {
						sendStat('ws-failed-to-connect-first-round');

						var reserveBackend = hasNoNPAPISupport ? extension : plugin;

						if (!_.include(allBackends, reserveBackend)) {
							this.disable();
							allBackends = _.without(allBackends, this);

							setAsFixed(reserveBackend);
							module.connect();
						}
					} else if (attempt > retryCount * 2) {
						setAsBroken(this);
						sendStat('ws-failed-to-connect-second-round');
					}
				}
				break;
			case 'plugin':
				if (!unlimitedReconnect) {
					if (attempt === retryCount) {
						sendStat('plugin-failed-to-connect');

						this.available()
							.then(function() {
								module.trigger('unable-to-connect-to-available-plugin');
								module.reconnectUntilSucceed();
							}.bind(this))
							.fail(function() {
								setAsBroken(this);
								sendStat('user-does-not-have-l4g-app');
							}.bind(this));
					}
				} else if (!module.getActiveBackend()) {
					// Для всех браузеров, которые пытаются подключится по плагину при каждом 
					// фейле делаем рефреш списка установленных плагинов, чтоб установленный 
					// плагин смог подхватиться.
					this.refresh();
				}
				break;

			case 'chrome-extension':
				sendStat('extension-failed-to-connect');
				this.available()
					.then(function() {
						module.trigger('unable-to-connect-to-available-chrome-extension');
						module.reconnectUntilSucceed();
					}.bind(this))
					.fail(function() {
						this.trigger('unsupported');
						setAsBroken(this);
					}.bind(this))
				break;
		}

		this.log('attempt #' + attempt + ' has failed.');
	}

	function cancelTimer() {
		delayTimer && clearTimeout(delayTimer);
	}

	/**
	 * Возможно по каким-то причинам транспорт отказывается подключаться, тогда мы можем его
	 * пометить как сломанный и не использовать его больше никогда.
	 */
	function setAsBroken(backend) {
		if (backend) {
			removeListeners(backend).disable();
			allBackends = _.without(allBackends, backend);
		}
	}

	function setAsFixed(backend) {
		if (backend) {
			if (isOldOpera && backend.id == 'ws') {
				return;
			}
			setListeners(removeListeners(backend));

			if (isBroken(backend)) {
				allBackends.unshift(backend);
			}
		}
	}

	function isBroken(backend) {
		return !_.include(allBackends, backend);
	}

	function sendStat(action) {
		module.trigger('stat', action);
	}

	/**
	 * Фильтрация сообщения до того, как оно будет отправлено на
	 * бэкэнд. Суть фильтрации заключается в том, чтобы изменить или
	 * вообще заблокировать сообщение, посылаемое бэкэнду.
	 * Каждый фильтр получает два аргумента: `payload` (посылаемые данные)
	 * и `next` (функция передачи управления). В `payload` есть два значения:
	 * `payload.name` (имя сообщения) и `payload.data`.
	 *
	 * Если нужно изменить сообщение, то фильтр должен менять их прямо в `payload`.
	 * После завершения операции нужно вызвать метод `next()` для передачи
	 * управления следующему методу.
	 *
	 * Если нужно заблокировать отправку сообщения, то в `next()` нужно передать
	 * первым параметром значение `true`.
	 *
	 * Функция `next()` нужна для асинхронных фильтров. Если фильтр синхронный,
	 * то эту функцию можно не получать (то есть не указывать в определении функции):
	 * в этом случае передача управления произойдёт сразу после завершения выполнения
	 * функции. Если нужно заблокировать отправку сообщения, то синхронный фильтр должен
	 * вернуть `null`.
	 * @param  {Object} payload Данные о сообщении
	 */
	function filterMessage(payload) {
		if (!filters.length) {
			return sendMessage(payload);
		}

		var _filters = filters.slice(0);
		var next = function(block) {
			if (block) {
				// фильтр заблокировал отправку сообщения
				return;
			}

			if (!_filters.length) {
				// закончились фильтры, шлём сообщение
				return sendMessage(payload);
			}

			var f = _filters.shift();
			if (f.length > 1) {
				// асинхронный вызов, передаём функцию next
				f(payload, next);
			} else {
				// синхронный вызов, просто выполняем функцию
				// и сразу передаём управление следующей
				next(f(payload) === null);
			}
		};

		next();
	}

	function setListeners(backend) {
		if (backend) {
			backend
				.on('connect', handleConnect)
				.on('disconnect', handleDisconnect)
				.on('failed', handleFail)
				.on('message', messageProxy)
				.on('log', dispatchLog)
				.on('unsupported', handleUnsupportedBackend);
		}
		return backend;
	}

	function removeListeners(backend) {
		if (backend) {
			backend
				.off('connect', handleConnect)
				.off('disconnect', handleDisconnect)
				.off('failed', handleFail)
				.off('message', messageProxy)
				.off('log', dispatchLog)
				.off('unsupported', handleUnsupportedBackend);
		}
		return backend;
	}

	var module = _.extend({
		/**
		 * Проверяет, есть ли подключение к бэкэндам
		 * в данный момент
		 * @return {[type]} [description]
		 */
		connected: function() {
			return !!connectedBackends.length;
		},

		/**
		 * Запуск подключения ко всем бэкэндам
		 */
		connect: function(id) {
			backendsAvailablePromise.then(function() {
				cancelTimer();

				if (id != null && findBackend(id)) {
					topPriority = id;
				}

				if (this.getActiveBackend() != topPriority) {
					// если есть подключённые бэкэнды — отключим их
					this.disconnect();

					// Сначала всё включаем, а потом пытаемся подключиться.
					// В этом случае при наличии плагина подключение
					// к бэкэнду произойдёт быстро, а сокет даже не будет 
					// пытаться подключиться, так как будет отключён в handleConnect()
					_.invoke(allBackends, 'enable');
					_.invoke(allBackends, 'connect');
				}
			}.bind(this))
		},

		/**
		 * Отключает все подключённые бэкэнды
		 */
		disconnect: function() {
			var backend;

			_.each(connectedBackends, function(id) {
				backend = findBackend(id);

				if (backend) {
					backend.disconnect();
				}
			});
		},

		/**
		 * Отправка сообщения всем подключённым бэкэндам
		 * @param  {String} name Название сообщения
		 * @param  {String} data JSON-строка с данными. Может быть объектом
		 */
		send: function(name, data) {
			filterMessage({
				name: name,
				data: data
			});
			this.trigger('send', name, data);
		},

		/**
		 * Ускоряем попытки подключения к бэкэндам.
		 * Это полезно в том случае, если мы знаем, что скоро может появится
		 * подключение к бэкэнду (например, когда начали скачивать приложение)
		 */
		accelerate: function() {
			var hasActiveBackend = !!this.getActiveBackend();

			if (!hasActiveBackend) {
				this.reconnectUntilSucceed();
				setAsFixed(ws);
				setAsFixed(plugin);
			}
			_.invoke(allBackends, 'accelerate', true);

			if (!hasActiveBackend) {
				this.connect();
			}
		},

		getActiveBackend: function() {
			return connectedBackends[0];
		},

		/**
		 * Добавляет фильтра для обработки сообщений
		 * @param {Function} fn
		 */
		addFilter: function(fn) {
			if (!_.include(filters, fn)) {
				filters.push(fn);
			}
		},

		/**
		 * Удаляет указанный фильтр для обработки сообщений
		 * @param  {Function} fn
		 */
		removeFilter: function(fn) {
			filters = _.without(filters, fn);
		},

		/**
		 * Если запросили опциональное обновление бэкэндов, то менеджер пытается вызвать
		 * метод `refresh` у каждого подключенного бэкэнда.
		 */
		refresh: function() {
			var backendId = this.getActiveBackend(),
				backend = this.getBackend(backendId);

			if (backendId) {
				switch (backendId) {
					case 'plugin':
						// Для старых опер не делаем рефреш плагина + "ломаем" бэкэнд плагина, чтоб им 
						// нельзя было пользоваться до перезагрузки страницы.
						if (isOldOpera) {
							this.disconnect();
							setAsBroken(backend);
							module.trigger('broken', backend.id);
							return;
						}
					default:
						if (typeof(backend.refresh) === 'function') {
							backend.refresh();
						}
				}
			}

			this.trigger('refresh', backendId, backend);
		},

		/**
		 * Для правильной работы приложения во время автоапдейта, нам нужно делать постоянные
		 * попытки установить соединение до того как автообновление закончится.
		 */
		reconnectUntilSucceed: function() {
			if (!unlimitedReconnect) {
				unlimitedReconnect = true;
			}
		},

		resetUnlimitedReconnections: function() {
			if (unlimitedReconnect) {
				unlimitedReconnect = false;
			}
		},

		/**
		 * На случай если нам потребуется изменить настройки модулей в рантайме можно
		 * использовать этот метод.
		 * @param  {String} backendId Название бэкэнда. Может быть: `ws`, `plugin`, `fake`
		 * @param  {Object} config JSON-объект с данными.
		 */
		updateConfig: function(backendId, config) {
			var backend = this.getBackend(backendId);

			if (backend) {
				backend.config(config);
				attempts[backend.id] = 0;
				backend.disconnect();
			}
		},

		getBackend: findBackend
	}, Backbone.Events);

	// проксируем сообщения от бэкэнда.
	// Для пущей надёжности проксировать будем только те
	// сообщения, которые приходят от подключённых бэкэндов
	backendsAvailablePromise.then(function() {
		_.each(allBackends, setListeners);
	});

	return module;
});
define('application',['packages/underscore', './backend/manager'], function(_, manager) {
	var WORKING_MODE = {
		FAKE: 'FAKE',
		NORMAL: 'NORMAL',
		SAFE: 'SAFE',
		FAULT: 'FAULT',
		NEED_UPDATE: 'NEED_UPDATE'
	};
	var currentWorkingMode = WORKING_MODE.FAULT;

	var setWorkingMode = (function() {
		// Так как у нас может быть одновременно запущено много бекэндов и они могут в зависимости от 
		// условий отключаться и включаться, то может образоваться большое кол-во не нужных 
		// переключений режимов. 
		// Чтоб это избежать переключаем режим только на последнюю попытку выставляя временой фильтр 
		// в 500мс.
		var switcher = _.throttle(function() {
			manager.trigger('working-mode', currentWorkingMode);

			// При смене режима работы, смотрим если он NORMAL, то обязательно запрашиваем информацию 
			// по версии приложения и сервисам.
			if (currentWorkingMode == WORKING_MODE.NORMAL) {
				manager.send('getVersions');
				manager.send('getStatus');
			}
		}, 500);

		return function(name) {
			if (!WORKING_MODE[name]) {
				throw 'Not correct working mode: ' + name;
			}
			currentWorkingMode = WORKING_MODE[name];
			switcher();
		}
	})();

	function connectHandler() {
		var mode = WORKING_MODE.FAULT,
			backendId = manager.getActiveBackend();

		switch (backendId) {
			case 'plugin':
			case 'ws':
			case 'chrome-extension':
				mode = WORKING_MODE.NORMAL;
				break;
			case 'fake':
				mode = WORKING_MODE.FAKE;
				break;
		}
		setWorkingMode(mode);
	};

	return {
		// Версии необходимы для правильной работы условий в Фогейме, которые завязаны на 
		// определенную версию l4g-application.
		// Версия выставляется равная той, что указывается в названии папки без префикса `v`.
		version: 3,
		backend: manager,
		WORKING_MODE: WORKING_MODE,
		setWorkingMode: setWorkingMode,
		getWorkingMode: function() {
			return currentWorkingMode;
		},

		init: function() {
			// Инициализируем приложение с дефолтным режимом – FAULT.
			setWorkingMode(currentWorkingMode);

			manager
			// Начинаем подключение к бекэндам.
				.on('connect', connectHandler)
				.on('disconnect', function(backendId) {
					if (this.connected()) {
						connectHandler.call(this);
					} else {
						setWorkingMode(WORKING_MODE.FAULT);
					}
				})
				// Сообщаем всем о том, что приложение готово.
				.trigger('started', 'L4G: Module Plugin')
				.connect();
		}
	};
});;define("packages/underscore", function(){ return _;});define("packages/jquery", function(){ return $;});define("packages/backbone", function(){ return Backbone;});return require("application");});
