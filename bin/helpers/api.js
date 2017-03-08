"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const pogobuf = require("../../pogobuf");
const POGOProtos = require("node-pogo-protos");
const logger = require("winston");
const _ = require("lodash");
const Bluebird = require("bluebird");
const request = require("request-promise");
const vercmp = require('semver-compare');
const util = require('util');
/**
 * Throw that there is a challenge needed
 * @constructor
 * @param {string} url - Challenge url
 */
function ChallengeError(url) {
    Error.captureStackTrace(this, this.constructor);
    this.name = 'ChallengeError';
    this.url = url;
    this.message = 'A challenged have been received: ' + url;
}
util.inherits(ChallengeError, Error);
const RequestType = POGOProtos.Networking.Requests.RequestType;
const CatchPokemonResult = POGOProtos.Networking.Responses.CatchPokemonResponse.CatchStatus;
/**
 * Helper class to deal with api requests and reponses.
 * Responsible for keeping state up to date.
 */
class APIHelper {
    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
    }
    /**
     * During init flow, each call come with some other calls
     * @param {Client} batch - pogobuf client
     * @return {Client} current client in order to chain call
     */
    alwaysinit(batch) {
        return batch.checkChallenge()
            .getHatchedEggs()
            .getInventory(this.state.api.inventory_timestamp)
            .checkAwardedBadges()
            .downloadSettings(this.state.api.settings_hash);
    }
    /**
     * Once init flow is done, each call come with some other calls
     * @param {Client} batch - pogobuf client
     * @return {Client} current client in order to chain call
     */
    always(batch) {
        return this.alwaysinit(batch).getBuddyWalked();
    }
    /**
     * Internal function to parse delta inventory responses
     * @param {object} r - inventory responses
     */
    parseInventoryDelta(r) {
        let split = pogobuf.Utils.splitInventory(r);
        if (split.pokemon.length > 0) {
            _.each(split.pokemon, pkm => {
                // add new pokemon to inventory, removing it if already there (to be sure)
                if (pkm.is_egg) {
                    let eggs = this.state.inventory.eggs;
                    this.state.inventory.eggs = _.filter(eggs, e => e.id !== pkm.id);
                    this.state.inventory.eggs.push(pkm);
                }
                else {
                    let pokemons = this.state.inventory.pokemon;
                    this.state.inventory.pokemon = _.filter(pokemons, e => e.id !== pkm.id);
                    this.state.inventory.pokemon.push(pkm);
                }
            });
        }
        if (split.removed_pokemon.length > 0) {
            let pokemons = this.state.inventory.pokemon;
            this.state.inventory.pokemon = _.filter(pokemons, e => split.removed_pokemon.indexOf(e.id) < 0);
        }
        if (split.items.length > 0) {
            // replace any modified item in inventory
            _.each(split.items, i => {
                let items = this.state.inventory.items;
                let item = _.find(items, it => it.item_id === i.item_id);
                if (item) {
                    item.count = i.count;
                    item.unseen = i.unseen;
                }
                else {
                    this.state.inventory.items.push(i);
                }
            });
        }
        if (split.player) {
            let lvl = this.state.inventory.player.level;
            this.state.inventory.player = split.player;
            if (this.state.inventory.player.level !== lvl) {
                // level up
                this.state.todo.push({ call: 'level_up' });
            }
        }
        if (split.egg_incubators.length > 0) {
            this.state.inventory.egg_incubators = split.egg_incubators;
        }
    }
    /**
     * Complete tutorial if needed, setting a random avatar
     * If not needed, do the minmum getPlayerProfile and registerBackgroundDevice
     * @return {Promise<void>} Promise
     */
    completeTutorial() {
        return __awaiter(this, void 0, void 0, function* () {
            let tuto = this.state.player.tutorial_state || [];
            let client = this.state.client;
            if (_.difference([0, 1, 3, 4, 7], tuto).length === 0) {
                // tuto done, do a getPlayerProfile()
                // like the actual app (not used later)
                let batch = client.batchStart();
                batch.getPlayerProfile();
                let responses = yield this.always(batch).batchCall();
                this.parse(responses);
                batch = client.batchStart();
                batch.registerBackgroundDevice('apple_watch', '');
                responses = yield this.alwaysinit(batch).batchCall();
                this.parse(responses);
            }
            else {
                logger.info('Completing tutorial...');
                if (!_.includes(tuto, 0)) {
                    logger.debug('Tutorial 0');
                    yield Bluebird.delay(_.random(2000.0, 5000.0));
                    // complete tutorial
                    let batch = client.batchStart();
                    batch.markTutorialComplete(0, false, false);
                    let responses = yield this.alwaysinit(batch).batchCall();
                    this.parse(responses);
                }
                if (!_.includes(tuto, 1)) {
                    logger.debug('Tutorial 1');
                    // set avatar
                    yield Bluebird.delay(_.random(8000.0, 14500));
                    let batch = client.batchStart();
                    batch.setAvatar(_.random(0, 3), // skin
                    _.random(0, 5), // hair
                    _.random(0, 3), // shirt
                    _.random(0, 2), // pants
                    _.random(0, 4), // hat
                    _.random(0, 6), // shoes,
                    0, // gender,
                    _.random(0, 4), // eyes,
                    _.random(0, 5) // backpack
                    );
                    let responses = yield this.alwaysinit(batch).batchCall();
                    this.parse(responses);
                    yield Bluebird.delay(_.random(1000, 1700));
                    batch = client.batchStart();
                    batch.markTutorialComplete(1, false, false);
                    responses = yield this.alwaysinit(batch).batchCall();
                    this.parse(responses);
                    batch = client.batchStart();
                    batch.getPlayerProfile();
                    responses = yield this.always(batch).batchCall();
                    this.parse(responses);
                    batch = client.batchStart();
                    batch.registerBackgroundDevice('apple_watch', '');
                    responses = yield this.alwaysinit(batch).batchCall();
                    this.parse(responses);
                }
                if (!_.includes(tuto, 3)) {
                    logger.debug('Tutorial 3');
                    // encounter starter pokemon
                    let batch = client.batchStart();
                    batch.getDownloadURLs([
                        '1a3c2816-65fa-4b97-90eb-0b301c064b7a/1477084786906000',
                        'e89109b0-9a54-40fe-8431-12f7826c8194/1477084802881000',
                    ]);
                    let responses = yield this.always(batch).batchCall();
                    this.parse(responses);
                    yield Bluebird.delay(_.random(7000, 10000));
                    batch = client.batchStart();
                    let pkmId = [1, 4, 7][_.random(3)];
                    batch.encounterTutorialComplete(pkmId);
                    responses = yield this.always(batch).batchCall();
                    this.parse(responses);
                    batch = client.batchStart();
                    batch.getPlayer(this.config.api.country, this.config.api.language, this.config.api.timezone);
                    responses = yield this.always(batch).batchCall();
                    this.parse(responses);
                }
                if (!_.includes(tuto, 4)) {
                    logger.debug('Tutorial 4');
                    yield Bluebird.delay(_.random(5000, 11500));
                    let batch = client.batchStart();
                    batch.claimCodename(this.config.credentials.user);
                    let responses = yield this.always(batch).batchCall();
                    this.parse(responses);
                    batch = client.batchStart();
                    batch.markTutorialComplete(4, false, false);
                    responses = yield this.alwaysinit(batch).batchCall();
                    this.parse(responses);
                }
                if (!_.includes(tuto, 7)) {
                    logger.debug('Tutorial 7');
                    yield Bluebird.delay(_.random(3500, 6000));
                    let batch = client.batchStart();
                    batch.markTutorialComplete(7, false, false);
                    let responses = yield this.always(batch).batchCall();
                    this.parse(responses);
                }
            }
        });
    }
    /**
     * Verify client version
     */
    verifyMinimumVersion(minimum) {
        return __awaiter(this, void 0, void 0, function* () {
            let clientversion = this.versionToClientVersion(this.config.api.version);
            if (vercmp(minimum, clientversion) < 0) {
                if (this.config.api.checkversion) {
                    throw new Error(`Minimum client version=${minimum}, ${clientversion} is too low.`);
                }
                else {
                    logger.warn(`Minimum client version=${minimum}, ${clientversion} is too low.`);
                }
            }
        });
    }
    /**
     * Parse reponse and update state accordingly
     * @param {object} responses - response from pogobuf.batchCall()
     * @return {object} information about api call (like status, depends of the call)
     */
    parse(responses) {
        if (!responses || responses.length === 0 || responses === true)
            return null;
        if (!(responses instanceof Array))
            responses = [responses];
        let info = {};
        responses.forEach(r => {
            // eslint-disable-next-line no-underscore-dangle
            switch (r._requestType) {
                case RequestType.GET_PLAYER:
                    this.state.player = r.player_data;
                    this.state.player.banned = r.banned;
                    this.state.player.warn = r.warn;
                    if (r.banned)
                        throw new Error('Account Banned');
                    if (r.warn)
                        logger.error('Ban warning.');
                    break;
                case RequestType.GET_INVENTORY:
                    this.state.api.inventory_timestamp = r.inventory_delta.new_timestamp_ms;
                    if (!this.state.hasOwnProperty('inventory')) {
                        // console.dir(r.inventory_delta.inventory_items, { depth: 6 });
                        this.state.inventory = pogobuf.Utils.splitInventory(r);
                        let pokemons = this.state.inventory.pokemon;
                        this.state.inventory.eggs = _.filter(pokemons, p => p.is_egg);
                        this.state.inventory.pokemon = _.filter(pokemons, p => !p.is_egg);
                    }
                    else if (r.inventory_delta.inventory_items.length > 0) {
                        this.parseInventoryDelta(r);
                    }
                    _.map(this.state.inventory.pokemon, this.addIv);
                    break;
                case RequestType.DOWNLOAD_SETTINGS:
                    this.state.api.settings_hash = r.hash;
                    if (r.settings) {
                        this.verifyMinimumVersion(r.settings.minimum_client_version);
                        this.state.download_settings = r.settings;
                        this.state.client.mapObjectsMinDelay = r.settings.map_settings.get_map_objects_min_refresh_seconds * 1000;
                    }
                    break;
                case RequestType.DOWNLOAD_ITEM_TEMPLATES:
                    if (r.item_templates.length > 0) {
                        info.success = r.success;
                        info.item_templates = r.item_templates;
                        info.timestamp_ms = r.timestamp_ms;
                        info.page_offset = r.page_offset;
                    }
                    break;
                case RequestType.DOWNLOAD_REMOTE_CONFIG_VERSION:
                    this.state.api.item_templates_timestamp = r.item_templates_timestamp_ms;
                    break;
                case RequestType.FORT_SEARCH:
                    if (r.result === 1) {
                        _.each(r.items_awarded, i => {
                            let items = this.state.inventory.items;
                            let item = _.find(items, it => it.item_id === i.item_id);
                            if (item)
                                item.count += i.item_count;
                        });
                        if (r.pokemon_data_egg) {
                            this.state.inventory.eggs.push(r.pokemon_data_egg);
                        }
                        this.state.player.experience += r.experience_awarded;
                        info = {
                            status: r.status,
                            cooldown: r.cooldown_complete_timestamp_ms,
                        };
                    }
                    else {
                        logger.warn('fortSearch() returned %s', r.result);
                    }
                    break;
                case RequestType.ENCOUNTER:
                    info.status = r.status;
                    if (r.wild_pokemon) {
                        info.pokemon = r.wild_pokemon.pokemon_data;
                        info.position = { lat: r.wild_pokemon.latitude, lng: r.wild_pokemon.longitude };
                    }
                    break;
                case RequestType.CATCH_POKEMON:
                    if (r.pokemon_data) {
                        // init capture
                        this.addIv(r.pokemon_data);
                        this.state.inventory.pokemon.push(r.pokemon_data);
                    }
                    info = {
                        caught: r.status === CatchPokemonResult.CATCH_SUCCESS,
                        status: r.status,
                        id: r.captured_pokemon_id,
                        capture_reason: r.capture_reason,
                        candy: _.sum(r.capture_award.candy),
                        xp: _.sum(r.capture_award.xp),
                    };
                    break;
                case RequestType.GET_MAP_OBJECTS:
                    let forts = r.map_cells.reduce((all, c) => all.concat(c.forts), []);
                    let pokestops = forts.filter(f => f.type === 1);
                    let gyms = forts.filter(f => f.type === 0);
                    let wildPokemons = r.map_cells.reduce((all, c) => all.concat(c.wild_pokemons), []);
                    let catchablePokemons = r.map_cells.reduce((all, c) => all.concat(c.catchable_pokemons), []);
                    let nearbyPokemons = r.map_cells.reduce((all, c) => all.concat(c.nearby_pokemons), []);
                    // let spawnPoints = r.map_cells.reduce((all, c) => all.concat(c.spawn_points), []);
                    this.state.map = {
                        pokestops: pokestops,
                        gyms: gyms,
                        wild_pokemons: wildPokemons,
                        catchable_pokemons: catchablePokemons,
                        nearby_pokemons: nearbyPokemons,
                    };
                    break;
                case RequestType.GET_PLAYER_PROFILE:
                    // nothing
                    break;
                case RequestType.GET_HATCHED_EGGS:
                    if (r.hatched_pokemon && r.hatched_pokemon.length > 0) {
                        let pkm = r.hatched_pokemon[0];
                        logger.info('An egg has hatched, pokemon_id: %d.', pkm.pokemon_id);
                    }
                    break;
                case RequestType.MARK_TUTORIAL_COMPLETE:
                    info = {
                        success: r.success,
                    };
                    break;
                case RequestType.SET_AVATAR:
                    // nothing
                    break;
                case RequestType.GET_DOWNLOAD_URLS:
                    // nothing
                    break;
                case RequestType.CLAIM_CODENAME:
                    info = {
                        status: r.status,
                        codename: r.codename,
                    };
                    break;
                case RequestType.ENCOUNTER_TUTORIAL_COMPLETE:
                    // TODO: check if not already in getInventory()
                    this.addIv(r.pokemon_data);
                    this.state.inventory.pokemon.push(r.pokemon_data);
                    break;
                case RequestType.LEVEL_UP_REWARDS:
                    // if (r.result === 1) {
                    //     logger.debug('levelUpRewards()', r);
                    //     logger.debug(' todo: see if also in inventory_delta?');
                    //     _.each(r.items_awarded, i => {
                    //         let items:  any[] = this.state.inventory.items;
                    //         let item = _.find(items, it => it && it.item_id === i.item_id);
                    //         if (item) item.count += i.item_count;
                    //         else this.state.inventory.items.push(i);
                    //     });
                    // }
                    info.result = r.result;
                    break;
                case RequestType.CHECK_AWARDED_BADGES:
                    // nothing
                    break;
                case RequestType.USE_ITEM_EGG_INCUBATOR:
                    info.result = r.result;
                    break;
                case RequestType.GET_BUDDY_WALKED:
                    if (r.family_candy_id || r.candy_earned_count) {
                        logger.info('getBuddyWalked()', r);
                    }
                    break;
                case RequestType.GET_ASSET_DIGEST:
                    // nothing
                    break;
                case RequestType.CHECK_CHALLENGE:
                    if (r.show_challenge) {
                        logger.error('Challenge!', { challenge_url: r.challenge_url });
                        throw new ChallengeError(r.challenge_url);
                    }
                    break;
                case RequestType.RELEASE_POKEMON:
                    info = {
                        result: r.result,
                        candy_awarded: r.candy_awarded,
                    };
                    break;
                case RequestType.REGISTER_BACKGROUND_DEVICE:
                    // nothing
                    break;
                case RequestType.EVOLVE_POKEMON:
                    info = {
                        result: r.result,
                    };
                    break;
                case RequestType.VERIFY_CHALLENGE:
                    info = {
                        success: r.success,
                    };
                    break;
                default:
                    logger.warn('Unhandled request: %s', r._requestType);
                    logger.debug(r);
                    break;
            }
        });
        return info;
    }
    /**
     * Add an `iv` field to a pokemon
     * @param {object} pokemon - pokemon to add iv field to
     */
    addIv(pokemon) {
        pokemon.iv = 100 * (pokemon.individual_attack + pokemon.individual_defense + pokemon.individual_stamina) / 45.0;
        pokemon.iv = Math.round(pokemon.iv);
    }
    /**
     * Make a request to niantic /pfe/version to get minimum version
     * @return {Promise<string>} Minimum app version
     */
    getRpcVersion() {
        return __awaiter(this, void 0, void 0, function* () {
            let options = {
                uri: 'https://pgorelease.nianticlabs.com/plfe/version',
                headers: {
                    'accept': '*/*',
                    'user-agent': 'pokemongo/1 CFNetwork/808.3 Darwin/16.3.0',
                    'accept-language': 'en-us',
                    'x-unity-version': '5.5.1f1'
                },
                gzip: true,
            };
            let version = yield request.get(options);
            return version.replace(/[^(\d|\.)+]/g, '');
        });
    }
    /**
     * Convert version string (like 5100) to iOS (like 1.21)
     * @param {string} version - version string (in the form of 5100)
     * @return {string} iOS version
     */
    versionToiOSVersion(version) {
        let ver = '1.' + ((+version - 3000) / 100).toFixed(0);
        ver += '.' + (+version % 100);
        return ver;
    }
    /**
     * Convert version string (like 5100) to client version (like 0.51.0)
     * @param {string} version - version string (in the form of 5100)
     * @return {string} client version (like 0.51.0)
     */
    versionToClientVersion(version) {
        let ver = '0.' + ((+version) / 100).toFixed(0);
        ver += '.' + (+version % 100);
        return ver;
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = APIHelper;
//# sourceMappingURL=api.js.map