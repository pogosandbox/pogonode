import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as logger from 'winston';
import * as moment from 'moment';
import * as request from 'request-promise';
import { fs } from 'mz';

const cheerio = require('cheerio');

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
    }

    /**
     * Find a suitable proxy. If 'auto' is set in config,
     * find a proxy from www. ssl proxies .org/.
     * @return {Promise} with a proxy url as param.
     */
    async findProxy() {
        if (this.config.proxy.url !== 'auto') return this.config.proxy.url;

        const badUrls = _.map(this.badProxies, p => p.proxy);

        const url = 'https://www.sslp' + 'roxies.org/';
        const response = await request.get(url);
        const $ = cheerio.load(response);
        const proxies = _.filter($('#proxylisttable tr'), tr => {
            return $(tr).find('td').eq(6).text() === 'yes';
        }).map(tr => 'http://' + $(tr).find('td').eq(0).text() + ':' + $(tr).find('td').eq(1).text());

        for (const proxy of proxies) {
            logger.debug('checking proxy ' + proxy);
            if (await this.verify(proxy)) return proxy;
        }

        return null;
    }

    async verify(proxy) {
        const badUrls = _.map(this.badProxies, p => p.proxy);
        if (badUrls.indexOf(proxy) >= 0) return false;
        try {
            if (this.config.proxy.checkip) {
                let response = await request.get('https://api.ipify.org/?format=json');
                if (!response) return false;

                this.clearIp = JSON.parse(response).ip;
                if (!this.clearIp) return false;

                response = await request.get('https://api.ipify.org/?format=json', {proxy, timeout: 3000});
                if (!response) return false;

                const ip = JSON.parse(response).ip;
                if (this.clearIp === ip) {
                    this.badProxy();
                    return false;
                }
            }
            const version = await request({
                uri: 'https://pgorelease.nianticlabs.com/plfe/version',
                headers: {
                    'accept': '*/*',
                    'user-agent': 'pokemongo/1 CFNetwork/808.3 Darwin/16.3.0',
                    'accept-language': 'en-us',
                    'x-unity-version': '5.5.1f1'
                },
                timeout: 3000,
                gzip: true,
                proxy,
            });
            return true;
        } catch (e) {
            this.badProxy(proxy);
            return false;
        }
    }

    /**
     * Check if proxy is working. To do this we compare real ip
     * with visible ip through proxy.
     * @return {Promise} with true or false
     */
    async checkProxy() {
        if (fs.existsSync('data/bad.proxies.json')) {
            // we put all bad proxy in a file, and keep them for 5 days
            const loaded = await fs.readFile('data/bad.proxies.json', 'utf8');
            this.badProxies = JSON.parse(loaded);
            this.badProxies = _.filter(this.badProxies, p => moment(p.date).isAfter(moment().subtract(5, 'day')));
            await fs.writeFile('data/bad.proxies.json', JSON.stringify(this.badProxies, null, 2));
        }

        if (!this.config.proxy.url) {
            return true;
        }

        try {
            const proxy = await this.findProxy();
            if (!proxy) return false;

            this.proxy = proxy;
            this.state.proxy = proxy;
            logger.info('Using proxy: %s', proxy);
            return true;

        } catch (e) {
            logger.error(e);
            return false;

        }
    }

    /**
     * Add the current proxy in our bad proxy database so we won't use it anymore.
     */
    badProxy(proxy?: string): void {
        proxy = proxy || this.proxy;
        if (!_.find(this.badProxies, p => p.proxy === proxy)) {
            if (this.config.proxy.url !== 'auto') logger.warn('Configured proxy looks bad.');
            this.badProxies.push({
                proxy,
                date: Date.now(),
            });
            fs.writeFileSync('data/bad.proxies.json', JSON.stringify(this.badProxies, null, 4));
        }
    }
}
