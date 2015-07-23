define(function() {
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