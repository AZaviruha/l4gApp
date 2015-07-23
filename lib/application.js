define(['packages/underscore', './backend/manager'], function(_, manager) {
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
});