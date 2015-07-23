/**
 * Модуль для общения с плагином браузера в качестве
 * бэкэнда
 */
define([
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