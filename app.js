require('dotenv').config({silent: true});

const pogobuf = require('./pogobuf/pogobuf/pogobuf');
// const pogobuf         = require('pogobuf');
const POGOProtos = require('node-pogo-protos');
const EventEmitter = require('events');
const logger = require('winston');
const fs = require('fs');
const yaml = require('js-yaml');
const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');

const APIHelper = require('./api.helper');
const Walker = require('./walker');
const ProxyHelper = require('./proxy.helper');
const signaturehelper = require('./signature.helper');
const SocketServer = require('./socket.server');

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
    delay: {
        walk: 1,
        spin: 2,
        encounter: 1.5,
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

if (!config.credentials.user) {
    logger.error('Invalid credentials. Please fill data/config.yaml, config.example.yaml or config.actual.yaml.');
    process.exit();
}

let state = {
    pos: {
        lat: config.pos.lat,
        lng: config.pos.lng,
    },
    api: {},
    player: {},
    path: {
        visited_pokestops: [],
        waypoints: [],
    },
    encountered: [],
};

/** Global events */
class AppEvents extends EventEmitter {}
const App = new AppEvents();
state.events = App;

let apihelper = new APIHelper(config, state);
let walker = new Walker(config, state);
let proxyhelper = new ProxyHelper(config, state);
let socket = new SocketServer(config, state);

let login = new pogobuf.PTCLogin();
let client = new pogobuf.Client();
state.client = client;

signaturehelper.register(config, client);

logger.info('App starting...');

proxyhelper.checkProxy().then(valid => {
    // find a proxy if 'auto' is set in config
    // then test if to be sure it works
    // if ok, set proxy in api
    if (config.proxy) {
        if (valid) {
            login.setProxy(proxyhelper.proxy);
            client.setProxy(proxyhelper.proxy);
        } else {
            throw new Error('Invalid proxy. Exiting.');
        }
    }
    return socket.start();

}).then(() => {
    // try login using PTC
    logger.info('Login...');
    return login.login(config.credentials.user, config.credentials.password);

}).then(token => {
    // yeah we have a token, set api and initial position
    logger.debug('Token: %s', token);
    client.setAuthInfo('ptc', token);
    client.setPosition(state.pos.lat, state.pos.lng);

}).then(() => {
    // init api (false = don't call anything yet')
    return client.init(false);

}).then(() => {
    // initial player state
    return client.batchStart()
                 .getPlayer(config.api.country, config.api.language, config.api.timezone)
                 .batchCall();

}).then(responses => {
    apihelper.parse(responses);

    logger.info('Logged In.');
    logger.info('Starting initial flow...');

    // download config version like the real app
    let batch = client.batchStart();
    batch.downloadRemoteConfigVersion('IOS', config.api.version);
    return apihelper.alwaysinit(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);

    // get asset digest (never use, but do it like the app)
    let batch = client.batchStart();
    batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, undefined, undefined, undefined, +config.api.version);
    return apihelper.alwaysinit(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);

    // check if item_templates need to be downloaded based on current timestamp
    let last = 0;
    if (fs.existsSync('data/item_templates.json')) {
        let json = fs.readFileSync('data/item_templates.json', {encoding: 'utf8'});
        state.api.item_templates = JSON.parse(json);
        last = state.api.item_templates.timestamp_ms;
    }

    if (last < state.api.item_templates_timestamp) {
        let batch = client.batchStart();
        batch.downloadItemTemplates();
        return apihelper.alwaysinit(batch)
                .batchCall().then(resp => {
                    apihelper.parse(resp);
                }).then(() => {
                    fs.writeFile('data/item_templates.json', JSON.stringify(state.api.item_templates), (err) => {});
                });
    } else {
        return Promise.resolve();
    }

}).then(() => {
    // like the actual app (not used later)
    let batch = client.batchStart();
    batch.getPlayerProfile();
    return apihelper.always(batch).batchCall();

}).then(responses => {
    // get any rewards if available
    apihelper.parse(responses);
    let batch = client.batchStart();
    batch.levelUpRewards(state.inventory.player.level);
    return apihelper.always(batch).batchCall();

}).then(responses => {
    // ok api is ready to go
    apihelper.parse(responses);
    App.emit('apiReady');

}).catch(e => {
    if (e.name == 'ChallengeError') {
        resolveChallenge(e.url)
        .then(responses => {
            apihelper.parse(responses);
            logger.warn('Catcha send. Please restart.');
            process.exit();
        });
    } else {
        logger.error(e);

        if (e.message.indexOf('tunneling socket could not be established') >= 0) proxyhelper.badProxy(); // no connection
        else if (e.message.indexOf('Unexpected response received from PTC login') >= 0) proxyhelper.badProxy(); // proxy block?
        else if (e.message.indexOf('Status code 403') >= 0) proxyhelper.badProxy(); // ip probably banned

        logger.error('Exiting.');
        process.exit();
    }
});

/**
 * Launch internal browser to solve captcha and pass result to api
 * @param {string} url - captcha url sent from checkChallenge
 * @return {Promise} result from verifyChallenge() call
 */
function resolveChallenge(url) {
    // Manually solve challenge using embeded Browser.
    const CaptchaHelper = require('./captcha/captcha.helper');
    let helper = new CaptchaHelper(config, state);
    return helper
            .solveCaptcha(url)
            .then(token => {
                let batch = client.batchStart();
                batch.verifyChallenge(token);
                return apihelper.always(batch).batchCall();
            });
}

App.on('apiReady', () => {
    logger.info('Initial flow done.');
    App.emit('saveState');
    socket.ready();
    setTimeout(() => App.emit('updatePos'), config.delay.walk);
});

App.on('updatePos', () => {
    if (state.map) {
        walker
            .checkPath()
            .then(path => {
                if (path) socket.sendRoute(path.waypoints);
            })
            .then(() => {
                walker.walk();
            })
            .then(() => {
                client.setPosition(state.pos.lat, state.pos.lng);
                socket.sendPosition();

                let max = state.download_settings.map_settings.get_map_objects_min_refresh_seconds;
                let min = state.download_settings.map_settings.get_map_objects_max_refresh_seconds;
                let mindist = state.download_settings.map_settings.get_map_objects_min_distance_meters;

                if (!state.api.last_gmo) {
                    // no previous call, fire a getMapObjects
                   return mapRefresh();
                } else if (moment().subtract(max, 's').isAfter(state.api.last_gmo)) {
                    // it's been enough time since last getMapObjects
                    return mapRefresh();
                } else if (moment().subtract(min, 's').isAfter(state.api.last_gmo)) {
                    // if we travelled enough distance, fire a getMapObjects
                    if (walker.distance(state.api.last_pos) > mindist) return mapRefresh();
                }

                return Promise.resolve();
            })
            .delay(config.delay.walk)
            .then(() => App.emit('updatePos'));
    } else {
        // we need a first getMapObjects to get some info about what is around us
        return mapRefresh().delay(config.delay.walk).then(() => App.emit('updatePos'));
    }
});

/**
 * Refresh map information based on current location
 * @return {Promise}
 */
function mapRefresh() {
    logger.info('Map Refresh', {pos: state.pos});
    let cellIDs = pogobuf.Utils.getCellIDs(state.pos.lat, state.pos.lng);

    // save where and when, usefull to know when to call next getMapObjects
    state.api.last_gmo = moment();
    state.api.last_pos = {lat: state.pos.lat, lng: state.pos.lng};

    let batch = client.batchStart();
    batch.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
    return apihelper.always(batch).batchCall().then(responses => {
        apihelper.parse(responses);

    }).then(() => {
        // send pokestop info to the ui
        socket.sendPokestops();

    }).then(() => {
        // spin pokestop that are close enough
        let stops = walker.findSpinnablePokestops();
        return walker.spinPokestops(stops);

    }).then(done => {
        // encounter available pokemon
        return walker.encounterPokemons();

    }).then(() => {
        App.emit('saveState');

    }).catch(e => {
        if (e.name == 'ChallengeError') {
            return resolveChallenge(e.url);
        }

        logger.error(e);
        // e.status_code == 102
        // detect token expiration
    });
}

App.on('spinned', stop => {
    // send info to ui
    socket.sendVisitedPokestop(stop);
});

App.on('encounter', pokemon => {
    // send info to ui
    // socket.sendVisitedPokestop(stop);
});

App.on('saveState', () => {
    // save current state to file (useful for debugging)
    // clean up a little and remove non useful data
    let lightstate = _.cloneDeep(state);
    lightstate.client = {};
    lightstate.api.item_templates = [];
    lightstate.events = {};
    fs.writeFile('data/state.json', JSON.stringify(lightstate, null, 4), (err) => {});
});
