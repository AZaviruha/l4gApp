define([
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
