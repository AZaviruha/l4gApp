/**
 * Менеджер для бэкэндов для подключения к приложение 4game.
 * Менеджер сам следит за тем, чтобы какой-нибудь бэкэнд был подключён
 * к приложениею, а также выбирает наиболее подходящий из доступных
 * (например, плагин приоритетнее, чем сокеты).
 */
define([
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