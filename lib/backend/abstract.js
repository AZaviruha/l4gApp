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
define([
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