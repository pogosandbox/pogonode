"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const logger = require("winston");
const _ = require("lodash");
const moment = require("moment");
const yaml = require('js-yaml');
const winstonCommon = require('winston/lib/winston/common');
module.exports.load = function () {
    let config = {
        credentials: {
            type: 'ptc',
            user: '',
            password: '',
        },
        pos: {
            lat: 48.8456222,
            lng: 2.3364526,
        },
        speed: 5,
        gmapKey: '',
        device: { id: 0 },
        ui: {
            enabled: false,
        },
        api: {
            version: '5901',
            checkversion: true,
            country: 'US',
            language: 'en',
        },
        behavior: {
            walk: true,
            catch: false,
            autorelease: true,
        },
        inventory: {},
        delay: {
            walk: 1,
            spin: 2,
            encounter: 1.5,
            catch: 3,
            incubator: 3,
            levelUp: 2,
            release: 0.1,
            evolve: 3,
            recycle: 0.5,
        },
        hashserver: {
            active: true,
        },
        proxy: {
            check: true,
            url: null,
        },
        loglevel: 'info',
    };
    try {
        fs.mkdirSync('data');
    }
    catch (e) { }
    if (fs.existsSync('data/config.yaml')) {
        let loaded = yaml.safeLoad(fs.readFileSync('data/config.yaml', 'utf8'));
        config = _.defaultsDeep(loaded, config);
    }
    logger.transports.Console.prototype.log = function (level, message, meta, callback) {
        const output = winstonCommon.log(Object.assign({}, this, {
            level,
            message,
            meta,
        }));
        console[level in console ? level : 'log'](output);
        setImmediate(callback, null, true);
    };
    logger.remove(logger.transports.Console);
    logger.add(logger.transports.Console, {
        'timestamp': function () {
            return moment().format('HH:mm:ss');
        },
        'colorize': true,
        'level': config.loglevel,
    });
    logger.add(logger.transports.File, {
        'timestamp': function () {
            return moment().format('HH:mm:ss');
        },
        'filename': 'data/pogonode.log',
        'json': false,
        'level': config.loglevel,
    });
    if (!config.device.id) {
        config.device.id = _.times(32, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    }
    fs.writeFileSync('data/config.actual.yaml', yaml.dump(config));
    return config;
};
//# sourceMappingURL=config.js.map