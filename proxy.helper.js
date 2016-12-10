const _ = require('lodash');
const Promise = require('bluebird');
const request = require('request');
const logger = require('winston');
const cheerio = require('cheerio');
const fs = require('fs');
const moment = require('moment');

Promise.promisifyAll(request);

class ProxyHelper {
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

    findProxy() {
        if (this.config.proxy != 'auto') return Promise.resolve(this.config.proxy);

        let badUrls = _.map(this.badProxies, p => p.proxy);

        let url = 'https://www.sslproxies.org/';
        return request.getAsync(url).then(response => {
            let $ = cheerio.load(response.body);
            let proxylist = $('#proxylisttable tr');
            let proxy = _.find(proxylist, tr => {
                let p = 'http://' + $(tr).find('td').eq(0).text() + ':' + $(tr).find('td').eq(1).text();
                return $(tr).find('td').eq(6).text() == 'yes' && badUrls.indexOf(p) < 0;
            }, 1);

            if (!proxy) return false;
            else return 'http://' + $(proxy).find('td').eq(0).text() + ':' + $(proxy).find('td').eq(1).text();
        });
    }

    checkProxy() {
        if (!this.config || !this.config.proxy) {
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
            return request.getAsync('https://api.ipify.org/?format=json', {proxy: this.proxy});

        }).then(response => {
            if (!response) return false;

            let ip = JSON.parse(response.body).ip;
            logger.debug('Proxified ip: ' + ip);
            let valid = this.clearIp != ip;
            if (!valid) this.badProxy();
            return valid;
        });
    }

    badProxy() {
        this.badProxies.push({
            proxy: this.proxy,
            date: Date.now(),
        });
        fs.writeFileSync('data/bad.proxies.json', JSON.stringify(this.badProxies, null, 4));
    }
}

module.exports = ProxyHelper;
