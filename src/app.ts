require('dotenv').config({silent: true});

import * as pogobuf from '../pogobuf';
import * as POGOProtos from 'node-pogo-protos';
import {EventEmitter} from 'events';
import * as logger from 'winston';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as fs from 'mz/fs';

import APIHelper from './helpers/api';
import ProxyHelper from './helpers/proxy';
import Walker from './helpers/walker';
import Player from './helpers/player';
import Assets from './helpers/assets';
import SocketServer from './ui/socket.server';
import CaptchaHelper from './captcha/captcha.helper';

// let memwatch = require('memwatch-next');
// memwatch.on('leak', function(info) {
//     logger.error('Leak detected', info);
// });

let config = require('./helpers/config').load();

if (!config.credentials.user) {
    logger.error('Invalid credentials. Please fill data/config.yaml.');
    logger.error('look at config.example.yaml or config.actual.yaml for example.');
    process.exit();
}

let state: any = {
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
class AppEvents extends EventEmitter {}
const App = new AppEvents();
state.events = App;

let apihelper = new APIHelper(config, state);
let walker = new Walker(config, state);
let player = new Player(config, state);
let proxyhelper = new ProxyHelper(config, state);
let socket = new SocketServer(config, state);
let assets = new Assets(config, state);

let client: pogobuf.Client;

async function loginFlow() {
    logger.info('App starting...');
    if (config.ui.enabled) {
        logger.info('go to http://openui.nicontoso.eu/ for ui');
    }
    try {
        await assets.loadFromDisk();

        let valid = await proxyhelper.checkProxy();

        // find a proxy if 'auto' is set in config
        // then test if to be sure it works
        // if ok, set proxy in api
        if (config.proxy.url && !valid) {
            throw new Error('Invalid proxy.');
        }
        await socket.start();

        if (config.hashserver.active) {
            logger.info('Using hashserver...');
            if (!config.hashserver.key) {
                throw new Error('Please enter a valid hashserver key in config.');
            }
        }

        client = new pogobuf.Client({
            deviceId: config.device.id,
            authType: config.credentials.type,
            username: config.credentials.user,
            password: config.credentials.password,
            version: config.api.version,
            useHashingServer: config.hashserver.active,
            hashingKey: config.hashserver.key,
            includeRequestTypeInResponse: true,
            proxy: proxyhelper.proxy,
            maxTries: 1,
        });

        state.client = client;

        let altitude = await walker.getAltitude(state.pos);

        let pos = walker.fuzzedLocation(state.pos);
        client.setPosition({
            latitude: pos.lat,
            longitude: pos.lng,
            altitude: altitude,
        });

        let version = await apihelper.getRpcVersion();
        logger.info('Minimum app version: %s', version);
        apihelper.verifyMinimumVersion(version);

        logger.info('Init api...');

        // init api (false = don't call anything yet')
        await client.init(false);

        // first empty request
        logger.debug('First empty request.');

        let responses = await client.batchStart().batchCall();
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
        responses = await client.batchCall();
        apihelper.parse(responses);

        logger.debug('Download remote config...');
        batch = client.batchStart();
        batch.downloadRemoteConfigVersion(POGOProtos.Enums.Platform.IOS, '', '', '', +config.api.version);
        responses = await apihelper.always(batch, {settings: true, nobuddy: true}).batchCall();
        apihelper.parse(responses);

        await apihelper.getAssetDigest();

        await apihelper.getItemTemplates();

        await assets.getTranslationUrls();

        // complete tutorial if needed,
        // at minimum, getPlayerProfile() is called
        logger.debug('Checking tutorial state...');
        if (!await apihelper.completeTutorial()) {
            // tutorial already done, let's do a getPlayerProfile
            let batch = client.batchStart();
            batch.getPlayerProfile('');
            let responses = await apihelper.always(batch, {settings: true}).batchCall();
            apihelper.parse(responses);
        }

        logger.debug('Level up rewards...');
        batch = client.batchStart();
        batch.levelUpRewards(state.inventory.player.level);
        responses = await apihelper.always(batch, {settings: true}).batchCall();
        apihelper.parse(responses);

        logger.debug('Get store...');
        batch = client.batchStart();
        batch.batchAddPlatformRequest(POGOProtos.Networking.Platform.PlatformRequestType.GET_STORE_ITEMS,
                                      new POGOProtos.Networking.Platform.Requests.GetStoreItemsRequest({}));
        responses = await batch.batchCall();

    } catch (e) {
        if (e.name === 'ChallengeError') {
            resolveChallenge(e.url)
            .then(responses => {
                logger.warn('Catcha response sent. Please restart.');
                process.exit();
            });
        } else {
            logger.error(e, e.message);

            if (e.code === 'ECONNRESET') proxyhelper.badProxy();
            else if (e.message === 'Invalid proxy.') proxyhelper.badProxy();
            else if (e.message.indexOf('tunneling socket could not be established') >= 0) proxyhelper.badProxy(); // no connection
            else if (e.message.indexOf('Unexpected response received from PTC login') >= 0) proxyhelper.badProxy(); // proxy block?
            else if (e.message.indexOf('Status code 403') >= 0) proxyhelper.badProxy(); // ip probably banned
            else if (e.message.indexOf('socket hang up') >= 0) proxyhelper.badProxy(); // no connection
            else if (e.message.indexOf('ECONNRESET') >= 0) proxyhelper.badProxy(); // connection reset
            else if (e.message.indexOf('ECONNREFUSED ') >= 0) proxyhelper.badProxy(); // connection refused

            logger.error('Exiting.');
            process.exit();
        }
    }
}

/**
 * Launch internal browser to solve captcha and pass result to api
 * @param {string} url - captcha url sent from checkChallenge
 * @return {Promise} result from verifyChallenge() call
 */
async function resolveChallenge(url) {
    // Manually solve challenge using embeded Browser.
    let helper = new CaptchaHelper(config, state);

    let token = await helper.solveCaptchaManual(url);
    if (token) {
        let batch = client.batchStart();
        batch.verifyChallenge(token);
        let responses = await apihelper.always(batch).batchCall();
        let info = apihelper.parse(responses);
        if (!info.success) {
            logger.error('Incorrect captcha token sent.');
        }
    } else {
        logger.error('Token is null');
    }

    return token;
}

App.on('apiReady', async () => {
    logger.info('Initial flow done.');
    App.emit('saveState');
    socket.ready();

    // Wait a bit, call a getMapObjects() then start walking around
    await Bluebird.delay(config.delay.walk * _.random(900, 1100));
    await mapRefresh();
    await Bluebird.delay(config.delay.walk * _.random(900, 1100));

    App.emit('updatePos');
});

App.on('updatePos', async () => {
    let path = await walker.checkPath();
    if (path) socket.sendRoute(path.waypoints);

    await walker.walk();
    let altitude = await walker.getAltitude(state.pos);

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
            let responses = await apihelper.always(batch).batchCall();
            apihelper.parse(responses);
            await Bluebird.delay(config.delay.levelUp * _.random(900, 1100));

        } else if (todo.call === 'release_pokemon') {
            let batch = client.batchStart();
            batch.releasePokemon(todo.pokemons);
            let responses = await apihelper.always(batch).batchCall();
            let info = apihelper.parse(responses);
            if (info.result === 1) {
                logger.info('Pokemon released', todo.pokemons, info);
            } else {
                logger.warn('Error releasing pokemon', info);
            }
            await Bluebird.delay(config.delay.release * _.random(900, 1100));

        } else if (todo.call === 'evolve_pokemon') {
            let batch = client.batchStart();
            batch.evolvePokemon(todo.pokemon, 0);
            let responses = await apihelper.always(batch).batchCall();
            let info = apihelper.parse(responses);
            if (info.result === 1) {
                logger.info('Pokemon evolved', todo.pokemon, info);
            } else {
                logger.warn('Error evolving pokemon', info);
            }
            await Bluebird.delay(config.delay.evolve * _.random(900, 1100));

        } else {
            logger.warn('Unhandled todo: ' + todo.call);
        }
    }

    let min: number = +state.download_settings.map_settings.get_map_objects_min_refresh_seconds;
    let max: number = +state.download_settings.map_settings.get_map_objects_max_refresh_seconds;
    let mindist: number = +state.download_settings.map_settings.get_map_objects_min_distance_meters;

    if (!state.api.last_gmo || moment().subtract(max, 's').isAfter(state.api.last_gmo)) {
        // no previous call, fire a getMapObjects
        // or if it's been enough time since last getMapObjects
        await mapRefresh();

    } else if (moment().subtract(min, 's').isAfter(state.api.last_gmo)) {
        // if we travelled enough distance, fire a getMapObjects
        if (walker.distance(state.api.last_pos) > mindist) {
            await mapRefresh();
        }
    }

    await Bluebird.delay(config.delay.walk * _.random(900, 1100));
    App.emit('updatePos');
});

/**
 * Refresh map information based on current location
 * @return {Promise}
 */
async function mapRefresh(): Promise<void> {
    logger.info('Map Refresh', {pos: state.pos});
    try {
        let cellIDs = pogobuf.Utils.getCellIDs(state.pos.lat, state.pos.lng);

        // save where and when, usefull to know when to call next getMapObjects
        state.api.last_gmo = moment();
        state.api.last_pos = {lat: state.pos.lat, lng: state.pos.lng};

        let batch = client.batchStart();
        batch.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
        let responses = await apihelper.always(batch).batchCall();
        apihelper.parse(responses);
        App.emit('saveState');

        // send pokestop info to the ui
        socket.sendPokestops();

        // spin pokestop that are close enough
        let stops = player.findSpinnablePokestops();
        await player.spinPokestops(stops);

        // encounter available pokemons
        await player.encounterPokemons();

        if (Math.random() < 0.3) {
            logger.debug('Dispatch incubators...');
            await player.dispatchIncubators();
        }

        App.emit('saveState');

    } catch (e) {
        if (e.name === 'ChallengeError') {
            await resolveChallenge(e.url);
            logger.warn('Catcha response sent. Please restart.');
            process.exit();
        }

        logger.error(e);
        debugger;
    }
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
    lightstate.api.asset_digest = [];
    lightstate.events = {};
    fs.writeFile('data/state.json', JSON.stringify(lightstate, null, 4), (err) => {});
});

loginFlow().then(() => App.emit('apiReady'));
