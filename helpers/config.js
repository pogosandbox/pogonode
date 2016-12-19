const fs = require('fs');
const logger = require('winston');
const yaml = require('js-yaml');
const _ = require('lodash');

module.exports.load = function() {

    let config = {
        credentials: {
            user: '',
            password: '',
        },
        pos: {
            lat: 48.8456222,
            lng: 2.3364526,
        },
        speed: 5,
        gmapKey: '',
        device: {id: 0},
        api: {
            version: '4500',
            clientversion: '0.45.0',
            checkversion: true,
            country: 'US',
            language: 'en',
        },
        behavior: {
            catch: true,
        },
        delay: {
            walk: 1,
            spin: 2,
            encounter: 1.5,
            catch: 3,
        },
        loglevel: 'info',
    };

    if (fs.existsSync('data/config.yaml')) {
        let loaded = yaml.safeLoad(fs.readFileSync('data/config.yaml', 'utf8'));
        config = _.defaultsDeep(loaded, config);
    }

    logger.level = config.loglevel;
    logger.add(logger.transports.File, {filename: 'pogonode.log', json: false});

    if (!config.device.id) {
        config.device.id = _.times(32, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
    }

    fs.writeFileSync('data/config.actual.yaml', yaml.dump(config));

    return config;
};
