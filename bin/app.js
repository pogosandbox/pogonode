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
require('dotenv').config({ silent: true });
const pogobuf = require("pogobuf");
const POGOProtos = require("node-pogo-protos");
const events_1 = require("events");
const logger = require("winston");
const Bluebird = require("bluebird");
const _ = require("lodash");
const moment = require("moment");
const fs = require("fs");
const api_1 = require("./helpers/api");
const proxy_1 = require("./helpers/proxy");
const walker_1 = require("./helpers/walker");
const player_1 = require("./helpers/player");
const socket_server_1 = require("./ui/socket.server");
const captcha_helper_1 = require("./captcha/captcha.helper");
const signaturehelper = require('./helpers/signature');
let config = require('./helpers/config').load();
if (!config.credentials.user) {
    logger.error('Invalid credentials. Please fill data/config.yaml.');
    logger.error('look at config.example.yaml or config.actual.yaml for example.');
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
    todo: [],
};
/** Global events */
class AppEvents extends events_1.EventEmitter {
}
const App = new AppEvents();
state.events = App;
let apihelper = new api_1.default(config, state);
let walker = new walker_1.default(config, state);
let player = new player_1.default(config, state);
let proxyhelper = new proxy_1.default(config, state);
let socket = new socket_server_1.default(config, state);
let client;
function loginFlow() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info('App starting...');
        if (config.ui.enabled) {
            logger.info('go to http://openui.nicontoso.eu/ for ui');
        }
        try {
            let valid = yield proxyhelper.checkProxy();
            // find a proxy if 'auto' is set in config
            // then test if to be sure it works
            // if ok, set proxy in api
            if (config.proxy.url && !valid) {
                throw new Error('Invalid proxy.');
            }
            yield socket.start();
            if (config.hashserver.active) {
                logger.info('Using hashserver...');
            }
            let token = null;
            // let login = (config.credentials.type === 'ptc') ? new pogobuf.PTCLogin() : new pogobuf.GoogleLogin();
            // if (proxyhelper.proxy && config.credentials.type === 'ptc') (<pogobuf.PTCLogin>login).setProxy(proxyhelper.proxy);
            // token = await login.login(config.credentials.user, config.credentials.password);
            client = new pogobuf.Client({
                deviceId: config.device.id,
                authType: 'ptc',
                authToken: token,
                username: config.credentials.user,
                password: config.credentials.password,
                version: config.api.version,
                useHashingServer: config.hashserver.active,
                hashingKey: config.hashserver.key,
                mapObjectsThrottling: false,
                includeRequestTypeInResponse: true,
                proxy: proxyhelper.proxy,
            });
            state.client = client;
            let altitude = yield walker.getAltitude(state.pos);
            let pos = walker.fuzzedLocation(state.pos);
            client.setPosition({
                latitude: pos.lat,
                longitude: pos.lng,
                altitude: altitude,
            });
            let version = yield apihelper.getRpcVersion();
            logger.info('Minimum app version: %s', version);
            apihelper.verifyMinimumVersion(version);
            logger.info('Init api...');
            // init api (false = don't call anything yet')
            yield client.init(false);
            // first empty request
            logger.debug('First empty request.');
            let responses = yield client.batchStart().batchCall();
            apihelper.parse(responses);
            logger.info('Logged In.');
            if (config.hashserver.active) {
                let rateInfos = client.getSignatureRateInfo();
                let hashExpiration = moment.unix(+rateInfos['expiration']);
                logger.debug('Hashing key expiration', hashExpiration.format('LLL'));
            }
            logger.info('Starting initial flow...');
            // initial player state
            logger.debug('Get player info...');
            let batch = client.batchStart();
            batch.getPlayer(config.api.country, config.api.language, config.api.timezone);
            responses = yield client.batchCall();
            apihelper.parse(responses);
            logger.debug('Download remote config...');
            batch = client.batchStart();
            batch.downloadRemoteConfigVersion(POGOProtos.Enums.Platform.IOS, '', '', '', +config.api.version);
            responses = yield apihelper.alwaysinit(batch).batchCall();
            apihelper.parse(responses);
            logger.debug('Get asset digest...');
            batch = client.batchStart();
            batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', +config.api.version);
            responses = yield apihelper.alwaysinit(batch).batchCall();
            apihelper.parse(responses);
            logger.debug('Checking if item_templates need a refresh...');
            let last = 0;
            if (fs.existsSync('data/item_templates.json')) {
                let json = fs.readFileSync('data/item_templates.json', { encoding: 'utf8' });
                let data = JSON.parse(json);
                state.api.item_templates = data.templates;
                last = data.timestamp_ms || 0;
            }
            if (!last || last < state.api.item_templates_timestamp) {
                logger.info('Game master updating...');
                batch = client.batchStart();
                batch.downloadItemTemplates(false);
                responses = yield apihelper.alwaysinit(batch).batchCall();
                let info = apihelper.parse(responses);
                let item_templates = info.item_templates;
                while (info.page_offset !== 0) {
                    batch = client.batchStart();
                    batch.downloadItemTemplates(false, info.page_offset, info.timestamp_ms);
                    responses = yield apihelper.alwaysinit(batch).batchCall();
                    item_templates = item_templates.concat(info.item_templates);
                }
                let json = JSON.stringify({
                    templates: item_templates,
                    timestamp_ms: info.timestamp_ms,
                }, null, 4);
                fs.writeFile('data/item_templates.json', json, (err) => { });
            }
            // complete tutorial if needed,
            // at minimum, getPlayerProfile() is called
            logger.debug('Checking tutorial state...');
            yield apihelper.completeTutorial();
            logger.debug('Level up rewards...');
            apihelper.parse(responses);
            batch = client.batchStart();
            batch.levelUpRewards(state.inventory.player.level);
            responses = yield apihelper.always(batch).batchCall();
            apihelper.parse(responses);
        }
        catch (e) {
            if (e.name === 'ChallengeError') {
                resolveChallenge(e.url)
                    .then(responses => {
                    logger.warn('Catcha response sent. Please restart.');
                    process.exit();
                });
            }
            else {
                logger.error(e);
                if (e.code === 'ECONNRESET')
                    proxyhelper.badProxy();
                else if (e.message === 'Invalid proxy.')
                    proxyhelper.badProxy();
                else if (e.message.indexOf('tunneling socket could not be established') >= 0)
                    proxyhelper.badProxy(); // no connection
                else if (e.message.indexOf('Unexpected response received from PTC login') >= 0)
                    proxyhelper.badProxy(); // proxy block?
                else if (e.message.indexOf('Status code 403') >= 0)
                    proxyhelper.badProxy(); // ip probably banned
                else if (e.message.indexOf('socket hang up') >= 0)
                    proxyhelper.badProxy(); // no connection
                else if (e.message.indexOf('ECONNRESET') >= 0)
                    proxyhelper.badProxy(); // connection reset
                else if (e.message.indexOf('ECONNREFUSED ') >= 0)
                    proxyhelper.badProxy(); // connection refused
                else {
                    debugger;
                }
                logger.error('Exiting.');
                process.exit();
            }
        }
    });
}
/**
 * Launch internal browser to solve captcha and pass result to api
 * @param {string} url - captcha url sent from checkChallenge
 * @return {Promise} result from verifyChallenge() call
 */
function resolveChallenge(url) {
    return __awaiter(this, void 0, void 0, function* () {
        // Manually solve challenge using embeded Browser.
        let helper = new captcha_helper_1.default(config, state);
        let token = yield helper.solveCaptchaManual(url);
        if (token) {
            let batch = client.batchStart();
            batch.verifyChallenge(token);
            let responses = yield apihelper.always(batch).batchCall();
            let info = apihelper.parse(responses);
            if (!info.success) {
                logger.error('Incorrect captcha token sent.');
            }
        }
        else {
            logger.error('Token is null');
        }
        return token;
    });
}
App.on('apiReady', () => __awaiter(this, void 0, void 0, function* () {
    logger.info('Initial flow done.');
    App.emit('saveState');
    socket.ready();
    // Wait a bit, call a getMapObjects() then start walking around
    yield Bluebird.delay(config.delay.walk * _.random(900, 1100));
    yield mapRefresh();
    yield Bluebird.delay(config.delay.walk * _.random(900, 1100));
    App.emit('updatePos');
}));
App.on('updatePos', () => __awaiter(this, void 0, void 0, function* () {
    let path = yield walker.checkPath();
    if (path)
        socket.sendRoute(path.waypoints);
    yield walker.walk();
    let altitude = yield walker.getAltitude(state.pos);
    let pos = walker.fuzzedLocation(state.pos);
    client.setPosition({
        latitude: pos.lat,
        longitude: pos.lng,
        altitude: altitude,
    });
    socket.sendPosition();
    // actions have been requested, but we only call them if
    // there is nothing going down at the same time
    if (state.todo.length > 0) {
        let todo = state.todo.shift();
        if (todo.call === 'level_up') {
            let batch = client.batchStart();
            batch.levelUpRewards(state.inventory.player.level);
            let responses = yield apihelper.always(batch).batchCall();
            apihelper.parse(responses);
            yield Bluebird.delay(config.delay.levelUp * _.random(900, 1100));
        }
        else if (todo.call === 'release_pokemon') {
            let batch = client.batchStart();
            batch.releasePokemon(todo.pokemons);
            let responses = yield apihelper.always(batch).batchCall();
            let info = apihelper.parse(responses);
            if (info.result === 1) {
                logger.info('Pokemon released', todo.pokemons, info);
            }
            else {
                logger.warn('Error releasing pokemon', info);
            }
            yield Bluebird.delay(config.delay.release * _.random(900, 1100));
        }
        else if (todo.call === 'evolve_pokemon') {
            let batch = client.batchStart();
            batch.evolvePokemon(todo.pokemon, 0);
            let responses = yield apihelper.always(batch).batchCall();
            let info = apihelper.parse(responses);
            if (info.result === 1) {
                logger.info('Pokemon evolved', todo.pokemon, info);
            }
            else {
                logger.warn('Error evolving pokemon', info);
            }
            yield Bluebird.delay(config.delay.evolve * _.random(900, 1100));
        }
        else {
            logger.warn('Unhandled todo: ' + todo.call);
        }
    }
    let min = +state.download_settings.map_settings.get_map_objects_min_refresh_seconds;
    let max = +state.download_settings.map_settings.get_map_objects_max_refresh_seconds;
    let mindist = +state.download_settings.map_settings.get_map_objects_min_distance_meters;
    if (!state.api.last_gmo || moment().subtract(max, 's').isAfter(state.api.last_gmo)) {
        // no previous call, fire a getMapObjects
        // or if it's been enough time since last getMapObjects
        yield mapRefresh();
    }
    else if (moment().subtract(min, 's').isAfter(state.api.last_gmo)) {
        // if we travelled enough distance, fire a getMapObjects
        if (walker.distance(state.api.last_pos) > mindist) {
            yield mapRefresh();
        }
    }
    yield Bluebird.delay(config.delay.walk * _.random(900, 1100));
    App.emit('updatePos');
}));
/**
 * Refresh map information based on current location
 * @return {Promise}
 */
function mapRefresh() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info('Map Refresh', { pos: state.pos });
        try {
            let cellIDs = pogobuf.Utils.getCellIDs(state.pos.lat, state.pos.lng);
            // save where and when, usefull to know when to call next getMapObjects
            state.api.last_gmo = moment();
            state.api.last_pos = { lat: state.pos.lat, lng: state.pos.lng };
            let batch = client.batchStart();
            batch.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
            let responses = yield apihelper.always(batch).batchCall();
            apihelper.parse(responses);
            App.emit('saveState');
            // send pokestop info to the ui
            socket.sendPokestops();
            // spin pokestop that are close enough
            let stops = player.findSpinnablePokestops();
            yield player.spinPokestops(stops);
            // encounter available pokemons
            yield player.encounterPokemons();
            if (Math.random() < 0.3) {
                logger.debug('Dispatch incubators...');
                yield player.dispatchIncubators();
            }
            App.emit('saveState');
        }
        catch (e) {
            if (e.name === 'ChallengeError') {
                yield resolveChallenge(e.url);
                logger.warn('Catcha response sent. Please restart.');
                process.exit();
            }
            logger.error(e);
            debugger;
        }
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
    fs.writeFile('data/state.json', JSON.stringify(lightstate, null, 4), (err) => { });
});
loginFlow().then(() => App.emit('apiReady'));
//# sourceMappingURL=app.js.map