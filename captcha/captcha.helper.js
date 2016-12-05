const logger = require('winston');
const nightmare = require('nightmare');

let useragent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/29.0.1547.57 Safari/537.36';

class CaptchaHelper {

    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.options = {
            show: true,
            openDevTools: {
                mode: 'detach',
            },
            switches: {},
            waitTimeout: 60 * 1000, // 1 min
            executionTimeout: 120 * 1000, // 2 min
            webPreferences: {
                webSecurity: false,
            },
        };
        if (state.proxy) this.options.switches['proxy-server'] = state.proxy;
    }

    solveCaptcha(url) {
        let browser = nightmare(this.options);
        return browser.useragent(useragent)
            .goto(url)
            .evaluate(function() {
                document.querySelector('.g-recaptcha').scrollIntoView(true);
                return true;
            })
            .evaluate(function() {
                try {
                    window.___grecaptcha_cfg.clients[0].W.tk.callback = function() {};
                } catch (e) {}
            })
            .wait(4000)
            .wait(function() {
                let input = document.querySelector('.g-recaptcha-response');
                return input && input.value.length > 0;
            })
            .wait('iframe[title="recaptcha challenge"]')
            .wait(function() {
                return window.grecaptcha.getResponse() != '';
            })
            .evaluate(function() {
                return window.grecaptcha.getResponse();
            })
            .then(token => {
                logger.debug('Done. Token is %s', token);
                return token;
            })
            .catch(error => {
                logger.error(error);
                return null;
            });
    }

}

module.exports = CaptchaHelper;
