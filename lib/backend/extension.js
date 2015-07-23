/**
 * Модуль для общения с экстеншеном браузера в качестве
 * бэкэнда
 */
define([
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