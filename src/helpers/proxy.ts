import * as _ from 'lodash';
const Promise = require('bluebird');
const request = require('request');
import * as logger from 'winston';
const cheerio = require('cheerio');
const fs = require('fs');
import * as moment from 'moment';

Promise.promisifyAll(request);

/**
 * Helper class to deal with proxies
 */
export default class ProxyHelper {
    config: any;
    state: any;
    badProxies: any[];
    proxy: string;
    clearIp: string;

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
        if (this.config.proxy.url != 'auto') return Promise.resolve(this.config.proxy.url);

        let trToProxy = function($, tr) {
            return 'http://' + $(tr).find('td').eq(0).text() + ':' + $(tr).find('td').eq(1).text();
        };

        let badUrls = _.map(this.badProxies, p => p.proxy);

        let url = 'https://www.sslp' + 'roxies.org/';
        return request.getAsync(url).then(response => {
            let $ = cheerio.load(response.body);
            let proxylist = $('#proxylisttable tr');
            let proxy = _.find(proxylist, tr => {
                return $(tr).find('td').eq(6).text() == 'yes' && badUrls.indexOf(trToProxy($, tr)) < 0;
            }, 1);

            if (!proxy) return false;
            else return trToProxy($, proxy);
        });
    }

    /**
     * Check if proxy is working. To do this we compare real ip
     * with visible ip through proxy.
     * @return {Promise} with true or false
     */
    checkProxy() {
        if (!this.config.proxy.url) {
            return Promise.resolve(true);
        }

        return this.findProxy().then(proxy => {
            if (!proxy) return false;

            this.proxy = proxy;
            this.state.proxy = proxy;
            logger.info('Using proxy: %s', proxy);

            return request.getAsync('https://api.ipify.org/?format=json');

        }).then(response => {
            if (!response) return false;

            this.clearIp = JSON.parse(response.body).ip;
            logger.debug('Clear ip: ' + this.clearIp);
            return this.clearIp;

        }).then(ip => {
            if (!ip) return false;
            return request.getAsync('https://api.ipify.org/?format=json', {proxy: this.proxy, timeout: 5000});

        }).then(response => {
            if (!response) return false;

            let ip = JSON.parse(response.body).ip;
            logger.debug('Proxified ip: ' + ip);
            let valid = !this.config.proxy.check || (this.clearIp != ip);
            if (!valid) this.badProxy();
            return valid;

        }).catch(e => {
            debugger;
            return false;

        });
    }

    /**
     * Add the current proxy in our bad proxy database so we won't use it anymore.
     */
    badProxy() {
        if (!_.find(this.badProxies, p => p.proxy == this.proxy)) {
            if (this.config.proxy.url != 'auto') logger.warn('Configured proxy looks bad.');

            this.badProxies.push({
                proxy: this.proxy,
                date: Date.now(),
            });
            fs.writeFileSync('data/bad.proxies.json', JSON.stringify(this.badProxies, null, 4));
        }
    }
}
