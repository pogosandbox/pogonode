require('dotenv').config({silent: true});

const pogobuf = require('./pogobuf/pogobuf/pogobuf');
// const pogobuf = require('pogobuf');
const POGOProtos = require('node-pogo-protos');
const EventEmitter = require('events');
const logger = require('winston');
const fs = require('fs');
const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');

const APIHelper = require('./helpers/api');
const ProxyHelper = require('./helpers/proxy');
const signaturehelper = require('./helpers/signature');
const Walker = require('./helpers/walker');
const Player = require('./helpers/player');
const SocketServer = require('./ui/socket.server');

let config = require('./helpers/config').load();

if (!config.credentials.user) {
    logger.error('Invalid credentials. Please fill data/config.yaml.').
    logger.errro('look at config.example.yaml or config.actual.yaml for example.');
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
let player = new Player(config, state);
let proxyhelper = new ProxyHelper(config, state);
let socket = new SocketServer(config, state);

let login = new pogobuf.PTCLogin();

let client = new pogobuf.Client();
state.client = client;

client.mapObjectsThrottlingEnabled = false;
client.setIncludeRequestTypeInResponse(true);
client.setVersion(config.api.version);
signaturehelper.register(config, client);

logger.info('App starting...');

if (config.hashserver && config.hashserver.active) {
    logger.info('Using hashserver');
    client.activateHashServer(config.hashserver.key);
}

proxyhelper.checkProxy().then(valid => {
    // find a proxy if 'auto' is set in config
    // then test if to be sure it works
    // if ok, set proxy in api
    if (config.proxy && config.proxy.url) {
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

    return walker.getAltitude(state.pos);

}).then(altitude => {
    let pos = walker.fuzzedLocation(state.pos);
    client.setPosition({
        latitude: pos.lat,
        longitude: pos.lng,
        altitude: altitude,
    });

}).then(() => {
    // init api (false = don't call anything yet')
    return client.init(false);

}).then(() => {
    // first empty request
    // return client.batchStart().batchCall();

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
    batch.downloadRemoteConfigVersion(POGOProtos.Enums.Platform.IOS, '', '', '', +config.api.version);
    return apihelper.alwaysinit(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);

    // get asset digest (never use, but do it like the app)
    let batch = client.batchStart();
    batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', +config.api.version);
    return apihelper.alwaysinit(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);
    // TODO: REGISTER_BACKGROUND_DEVICE

}).then(responses => {
    apihelper.parse(responses);

    // check if item_templates need to be downloaded based on current timestamp
    let last = 0;
    if (fs.existsSync('data/item_templates.json')) {
        let json = fs.readFileSync('data/item_templates.json', {encoding: 'utf8'});
        let data = JSON.parse(json);
        state.api.item_templates = data.templates;
        last = data.timestamp_ms || 0;
    }

    if (!last || last < state.api.item_templates_timestamp) {
        logger.info('Game master updating...');
        let batch = client.batchStart();
        // batch.downloadItemTemplates(false, 0, state.api.item_templates_timestamp);
        batch.downloadItemTemplates();
        return apihelper.alwaysinit(batch)
                .batchCall().then(resp => {
                    return apihelper.parse(resp);
                }).then(info => {
                    let json = JSON.stringify({
                        templates: state.api.item_templates,
                        timestamp_ms: info.timestamp_ms,
                    }, null, 4);
                    fs.writeFile('data/item_templates.json', json, (err) => {});
                });
    } else {
        return Promise.resolve();
    }

}).then(() => {
    // complete tutorial if needed
    return apihelper.completeTutorial();

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
    return true;

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
        else if (e.message.indexOf('socket hang up') >= 0) proxyhelper.badProxy(); // no connection
        else if (e.message.indexOf('ECONNRESET') >= 0) proxyhelper.badProxy(); // connection reset
        else if (e.message.indexOf('ECONNREFUSED ') >= 0) proxyhelper.badProxy(); // connection refused
        else {
            e = e;
        }

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
            .solveCaptchaManual(url)
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

    // Wait a bit, call a getMapObjects() then start walking around
    Promise.delay(config.delay.walk * _.random(900, 1100))
            .then(() => {
                return mapRefresh();
            })
            .delay(config.delay.walk * _.random(900, 1100))
            .then(() => {
                App.emit('updatePos');
            });
});

App.on('updatePos', () => {
    walker
        .checkPath()
        .then(path => {
            if (path) socket.sendRoute(path.waypoints);
        })
        .then(() => {
            walker.walk();
            return walker.getAltitude(state.pos);
        })
        .then(altitude => {
            let pos = walker.fuzzedLocation(state.pos);
            client.setPosition({
                latitude: pos.lat,
                longitude: pos.lng,
                altitude: altitude,
            });

            socket.sendPosition();

        })
        .then(() => {
            if (state.lvlUp) {
                let batch = client.batchStart();
                batch.levelUpRewards(state.inventory.player.level);
                return apihelper.always(batch).batchCall()
                        .then(responses => apihelper.parse(responses));
            }

        })
        .then(() => {
            let max = state.download_settings.map_settings.get_map_objects_min_refresh_seconds;
            let min = state.download_settings.map_settings.get_map_objects_max_refresh_seconds;
            let mindist = state.download_settings.map_settings.get_map_objects_min_distance_meters;

            if (!state.api.last_gmo || moment().subtract(max, 's').isAfter(state.api.last_gmo)) {
                // no previous call, fire a getMapObjects
                // or if it's been enough time since last getMapObjects
                return mapRefresh();

            } else if (moment().subtract(min, 's').isAfter(state.api.last_gmo)) {
                // if we travelled enough distance, fire a getMapObjects
                if (walker.distance(state.api.last_pos) > mindist) return mapRefresh();

            }

            return Promise.resolve();
        })
        .delay(config.delay.walk * _.random(900, 1100))
        .then(() => App.emit('updatePos'));
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
        let stops = player.findSpinnablePokestops();
        return player.spinPokestops(stops);

    }).then(done => {
        // encounter available pokemons
        return player.encounterPokemons(config.behavior.catch);

    }).then(() => {
        // if (Math.random() < 0.2) {
            return player.dispatchIncubators();
        // }

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

App.on('pokemon_caught', pokemon => {
    // send info to ui
    socket.sendPokemonCaught(pokemon);
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
