"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('winston');
const nightmare = require('nightmare');
const request = require('request');
const Bluebird = require('bluebird');
const cheerio = require('cheerio');
Bluebird.promisifyAll(request);
const useragent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/29.0.1547.57 Safari/537.36';
/**
 * Class to help with captcha solving.
 * There is two mode, one using an embed browser,
 * the other one using 2captcha.com.
 */
class CaptchaHelper {
    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.options = {
            show: true,
            openDevTools: {
                mode: 'detach',
            },
            switches: {},
            waitTimeout: 5 * 60 * 1000,
            executionTimeout: 5 * 60 * 1000,
            webPreferences: {
                webSecurity: false,
            },
        };
        if (state.proxy)
            this.options.switches['proxy-server'] = state.proxy;
    }
    /**
     * Launch the browser to manually solve the captcha.
     * @param {string} url - url of the captcha to solve
     * @return {Promise} response token
     */
    solveCaptchaManual(url) {
        logger.info('Solving captcha', url);
        let browser = nightmare(this.options);
        return browser.useragent(useragent)
            .goto(url)
            .evaluate(function () {
            try {
                document.querySelector('.g-recaptcha').scrollIntoView(true);
            }
            catch (e) {
                console.log(e);
            }
        })
            .evaluate(function () {
            try {
                let client = window.___grecaptcha_cfg.clients[0];
                let first = client.T;
                let child = Object.keys(window.___grecaptcha_cfg.clients[0].T)[0];
                first[child].callback = function () { };
            }
            catch (e) {
                console.log(e);
            }
        })
            .wait(6000)
            .wait(function () {
            console.log('wait for captcha response');
            let input = document.querySelector('.g-recaptcha-response');
            return input && input.value.length > 0;
        })
            .wait('iframe[title="recaptcha challenge"]')
            .wait(function () {
            console.log('wait ' + window.grecaptcha.getResponse());
            return window.grecaptcha.getResponse() !== '';
        })
            .evaluate(function () {
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
    /**
     * Launch the browser to manually solve the captcha.
     * @param {string} url - url of the captcha to solve
     * @return {Promise} response token
     */
    solveCaptchaWith2Captcha(url) {
        return request.getAsync(url, { proxy: this.state.proxy }).then(response => {
            let $ = cheerio.load(response.body);
            let sitekey = $('.g-recaptcha').data('sitekey');
            return sitekey;
        }).then(sitekey => {
            let data = {
                key: this.config.twoCaptcha.key,
                method: 'userrecaptcha',
                googlekey: sitekey,
                proxy: this.state.proxy,
                proxytype: 'HTTP',
                pageurl: url,
                json: 1,
            };
            return request.postAsync('http://2captcha.com/in.php', data);
        }).then(response => {
            console.log(response);
            let data = JSON.parse(response.body);
            return data.CAPTCHA_ID;
        });
    }
}
exports.default = CaptchaHelper;
//# sourceMappingURL=captcha.helper.js.map