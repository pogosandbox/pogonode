"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const logger = require("winston");
const moment = require("moment");
const request = require("request-promise");
const cheerio = require('cheerio');
const fs = require('fs');
/**
 * Helper class to deal with proxies
 */
class ProxyHelper {
    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.badProxies = [];
        if (fs.existsSync('data/bad.proxies.json')) {
            // we put all bad proxy in a file, and keep them for 5 days
            let loaded = fs.readFileSync('data/bad.proxies.json', 'utf8');
            this.badProxies = JSON.parse(loaded);
            this.badProxies = _.filter(this.badProxies, p => {
                return moment(p.date).isAfter(moment().subtract(5, 'day'));
            });
            fs.writeFileSync('data/bad.proxies.json', JSON.stringify(this.badProxies, null, 4));
        }
    }
    /**
     * Find a suitable proxy. If 'auto' is set in config,
     * find a proxy from www. ssl proxies .org/.
     * @return {Promise} with a proxy url as param.
     */
    findProxy() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.config.proxy.url !== 'auto')
                return Promise.resolve(this.config.proxy.url);
            let trToProxy = function ($, tr) {
                return 'http://' + $(tr).find('td').eq(0).text() + ':' + $(tr).find('td').eq(1).text();
            };
            let badUrls = _.map(this.badProxies, p => p.proxy);
            let url = 'https://www.sslp' + 'roxies.org/';
            let response = yield request.get(url);
            let $ = cheerio.load(response.body);
            let proxylist = $('#proxylisttable tr');
            let proxy = _.find(proxylist, tr => {
                return $(tr).find('td').eq(6).text() === 'yes' && badUrls.indexOf(trToProxy($, tr)) < 0;
            }, 1);
            if (!proxy)
                return null;
            else
                return trToProxy($, proxy);
        });
    }
    /**
     * Check if proxy is working. To do this we compare real ip
     * with visible ip through proxy.
     * @return {Promise} with true or false
     */
    checkProxy() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.proxy.url) {
                return true;
            }
            try {
                let proxy = yield this.findProxy();
                if (!proxy)
                    return false;
                this.proxy = proxy;
                this.state.proxy = proxy;
                logger.info('Using proxy: %s', proxy);
                let response = yield request.get('https://api.ipify.org/?format=json');
                if (!response)
                    return false;
                this.clearIp = JSON.parse(response).ip;
                logger.debug('Clear ip: ' + this.clearIp);
                if (!this.clearIp)
                    return false;
                response = yield request.get('https://api.ipify.org/?format=json', { proxy: this.proxy, timeout: 5000 });
                if (!response)
                    return false;
                let ip = JSON.parse(response).ip;
                logger.debug('Proxified ip: ' + ip);
                let valid = !this.config.proxy.check || (this.clearIp !== ip);
                if (!valid)
                    this.badProxy();
                return valid;
            }
            catch (e) {
                logger.error(e);
                return false;
            }
        });
    }
    /**
     * Add the current proxy in our bad proxy database so we won't use it anymore.
     */
    badProxy() {
        if (!_.find(this.badProxies, p => p.proxy === this.proxy)) {
            if (this.config.proxy.url !== 'auto')
                logger.warn('Configured proxy looks bad.');
            this.badProxies.push({
                proxy: this.proxy,
                date: Date.now(),
            });
            fs.writeFileSync('data/bad.proxies.json', JSON.stringify(this.badProxies, null, 4));
        }
    }
}
exports.default = ProxyHelper;
//# sourceMappingURL=proxy.js.map