/**
 * Реализация бэкэнда для игровой панели через WebSockets
 */
define([
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
			host: ['localhost', '127.0.0.1'],
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
