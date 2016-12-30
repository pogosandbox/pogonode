const pogobuf = require('../pogobuf/pogobuf/pogobuf');
const POGOProtos = require('node-pogo-protos');
const logger = require('winston');
const vercmp = require('semver-compare');
const _ = require('lodash');
const Promise = require('bluebird');
// const fs = require('fs');

/**
 * Throw that there is a challenge needed
 * @constructor
 * @param {string} url - Challenge url
 */
function ChallengeError(url) {
    this.name = 'ChallengeError';
    this.url = url;
    this.message = 'A challenged have been received: ' + url,
    this.stack = (new Error()).stack;
}
ChallengeError.prototype = Object.create(Error.prototype);
ChallengeError.prototype.constructor = ChallengeError;

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
                    this.state.inventory.eggs = _.filter(this.state.inventory.eggs, e => e.id != pkm.id);
                    this.state.inventory.eggs.push(pkm);
                } else {
                    this.state.inventory.pokemon = _.filter(this.state.inventory.pokemon, e => e.id != pkm.id);
                    this.state.inventory.pokemon.push(pkm);
                }
            });
        }
        if (split.items.length > 0) {
            // replace any modified item in inventory
            _.each(split.items, i => {
                let item = _.find(this.state.inventory.items, it => it.item_id == i.item_id);
                if (item) {
                    item.count = i.count;
                    item.unseen = i.unseen;
                } else {
                    this.state.inventory.items.push(i);
                }
            });
        }
        if (split.player) {
            let lvl = this.state.inventory.player.level;
            this.state.inventory.player = split.player;
            if (this.state.inventory.player.level != lvl) {
                // level up
                this.state.lvlUp = true;
            }
        }
        if (split.egg_incubators.length > 0) {
            this.state.inventory.egg_incubators = split.egg_incubators;
        }
    }

    /**
     * Complete tutorial if needed, setting a random avatar
     * @return {Promise} Promise
     */
    completeTutorial() {
        let tuto = this.state.player.tutorial_state || [];
        let client = this.state.client;
        if (_.difference([0, 1, 3, 4, 7], tuto).length == 0) {
            // tuto done, do a getPlayerProfile()
            // like the actual app (not used later)
            let batch = client.batchStart();
            batch.getPlayerProfile();
            return this.always(batch).batchCall()
            .then(responses => {
                this.parse(responses);
            });

        } else {
            logger.info('Completing tutorial...');
            return Promise.delay(_.random(2.0, 5.0))
            .then(() => {
                if (!_.includes(tuto, 0)) {
                    // complete tutorial
                    let batch = client.batchStart();
                    batch.markTutorialComplete(0, false, false);
                    return this.alwaysinit(batch).batchCall();
                }

            }).then(responses => {
                this.parse(responses);
                if (!_.includes(tuto, 1)) {
                    // set avatar
                    return Promise.delay(_.random(5.0, 10.5))
                            .then(() => {
                                let batch = client.batchStart();
                                batch.setAvatar(
                                    _.random(1, 3), // skin
                                    _.random(1, 5), // hair
                                    _.random(1, 3), // shirt
                                    _.random(1, 2), // pants
                                    _.random(0, 3), // hat
                                    _.random(1, 6), // shoes,
                                    0, // gender,
                                    _.random(1, 4), // eyes,
                                    _.random(1, 5) // backpack
                                );
                                return this.alwaysinit(batch).batchCall();

                            }).then(responses => {
                                this.parse(responses);
                                let batch = client.batchStart();
                                batch.markTutorialComplete(1, false, false);
                                return this.alwaysinit(batch).batchCall();

                            }).then(responses => {
                                this.parse(responses);

                            });
                }

            }).then(() => {
                let batch = client.batchStart();
                batch.getPlayerProfile();
                return this.always(batch).batchCall();

            }).then(responses => {
                // wait a bit
                this.parse(responses);
                return Promise.delay(_.random(6.0, 11.5));

            }).then(responses => {
                this.parse(responses);
                if (!_.includes(tuto, 3)) {
                    // encounter starter pokemon
                    return Promise.delay(_.random(6.0, 12.0))
                        .then(() => {
                            let batch = client.batchStart();
                            let pkmId = [1, 4, 7][_.random(3)];
                            batch.encounterTutorialComplete(pkmId);
                            return this.always(batch).batchCall();

                        }).then(responses => {
                            this.parse(responses);
                            let batch = client.batchStart();
                            batch.getPlayer(this.config.api.country, this.config.api.language, this.config.api.timezone);
                            return this.always(batch).batchCall();

                        });
                }

            }).then(responses => {
                // wait a bit
                this.parse(responses);
                return Promise.delay(_.random(5.0, 11.5));

            }).then(responses => {
                this.parse(responses);
                if (!_.includes(tuto, 4)) {
                    let batch = client.batchStart();
                    batch.markTutorialComplete(4, false, false);
                    return this.alwaysinit(batch).batchCall();
                }

            }).then(responses => {
                // wait a bit
                this.parse(responses);
                return Promise.delay(_.random(4.0, 9.0));

            }).then(responses => {
                this.parse(responses);
                if (!_.includes(tuto, 7)) {
                    let batch = client.batchStart();
                    batch.markTutorialComplete(7, false, false);
                    return this.always(batch).batchCall();
                }

            });
        }
    }

    /**
     * Parse reponse and update state accordingly
     * @param {object} responses - response from pogobuf.batchCall()
     * @return {object} information about api call (like status, depends of the call)
     */
    parse(responses) {
        if (!responses || responses.length == 0) return null;
        if (!(responses instanceof Array)) responses = [responses];

        let info = {};

        if (responses[0].pogoBufRequest == RequestType.LEVEL_UP_REWARDS) {
            if (responses[0].result == 1) {
                info = info;
                // check if new item are also in get_inventory
            }
        }

        responses.forEach(r => {
            // eslint-disable-next-line no-underscore-dangle
            switch(r._requestType) {

                case RequestType.GET_PLAYER:
                    this.state.player = r.player_data;
                    this.state.player.banned = r.banned;
                    this.state.player.warn = r.warn;
                    if (r.banned) throw new Error('Account Banned');
                    if (r.warn) logger.error('Ban warning.');
                    break;

                case RequestType.GET_INVENTORY:
                    this.state.api.inventory_timestamp = r.inventory_delta.new_timestamp_ms;
                    if (!this.state.hasOwnProperty('inventory')) {
                        // console.dir(r.inventory_delta.inventory_items, { depth: 6 });
                        this.state.inventory = pogobuf.Utils.splitInventory(r);
                        this.state.inventory.eggs = _.filter(this.state.inventory.pokemon, p => p.is_egg);
                        this.state.inventory.pokemon = _.filter(this.state.inventory.pokemon, p => !p.is_egg);

                    } else if (r.inventory_delta.inventory_items.length > 0) {
                        this.parseInventoryDelta(r);

                    }
                    break;

                case RequestType.DOWNLOAD_SETTINGS:
                    this.state.api.settings_hash = r.hash;
                    if (r.settings) {
                        let clientversion = this.versionToClientVersion(this.config.api.version);
                        if (vercmp(clientversion, r.settings.minimum_client_version) < 0) {
                            if (this.config.api.checkversion) {
                                throw new Error('Minimum client version=' + r.settings.minimum_client_version);
                            } else {
                                logger.warn('Minimum client version=' + r.settings.minimum_client_version);
                            }
                        }
                        this.state.download_settings = r.settings;
                        this.state.client.mapObjectsMinDelay = r.settings.map_settings.get_map_objects_min_refresh_seconds * 1000;
                    }
                    break;

                case RequestType.DOWNLOAD_ITEM_TEMPLATES:
                    if (r.item_templates.length > 0) {
                        this.state.api.item_templates = r.item_templates;
                        info.timestamp_ms = r.timestamp_ms;
                    }
                    break;

                case RequestType.DOWNLOAD_REMOTE_CONFIG_VERSION:
                    this.state.api.item_templates_timestamp = r.item_templates_timestamp_ms;
                    break;

                case RequestType.FORT_SEARCH:
                    if (r.result == 1) {
                        _.each(r.items_awarded, i => {
                            let item = _.find(this.state.inventory.items, it => it.item_id == i.item_id);
                            if (item) item.count += i.item_count;
                        });

                        if (r.pokemon_data_egg) {
                            this.state.inventory.eggs.push(r.pokemon_data_egg);
                        }

                        this.state.player.experience += r.experience_awarded;
                        info = {
                            status: r.status,
                            cooldown: r.cooldown_complete_timestamp_ms,
                        };

                    } else {
                        logger.warn('fortSearch() returned %s', r.result);
                    }
                    break;

                case RequestType.ENCOUNTER:
                    info.status = r.status;
                    if (r.wild_pokemon) {
                        info.pokemon = r.wild_pokemon.pokemon_data;
                        info.position = {lat: r.wild_pokemon.latitude, lng: r.wild_pokemon.longitude};
                    }
                    break;

                case RequestType.CATCH_POKEMON:
                    if (r.pokemon_data) {
                        // init capture
                        this.state.inventory.pokemon.push(r.pokemon_data);
                    }
                    info = {
                        caught: r.status == CatchPokemonResult.CATCH_SUCCESS,
                        status: r.status,
                        id: r.captured_pokemon_id,
                        capture_reason: r.capture_reason,
                        candy: _.sum(r.capture_award.candy),
                        xp: _.sum(r.capture_award.xp),
                    };
                    break;

                case RequestType.GET_MAP_OBJECTS:
                    let forts = r.map_cells.reduce((all, c) => all.concat(c.forts), []);
                    let pokestops = forts.filter(f => f.type == 1);
                    let gyms = forts.filter(f => f.type == 2);
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
                        // spawn_points: spawnPoints
                    };
                    break;

                case RequestType.GET_PLAYER_PROFILE:
                    // nothing
                    break;

                case RequestType.GET_HATCHED_EGGS:
                    if (r.egg_km_walked.length > 0 || r.stardust_awarded.length > 0 || r.candy_awarded.length > 0 ||
                        r.experience_awarded.length > 0 || r.pokemon_id.length > 0) {
                        logger.info('getHatchedEggs()');
                        console.dir(r, {depth: 4});
                    }
                    break;

                case RequestType.ENCOUNTER_TUTORIAL_COMPLETE:
                    // TODO: check if not already in getInventory()
                    this.state.inventory.pokemon.push(r.pokemon_data);
                    break;

                case RequestType.LEVEL_UP_REWARDS:
                    if (r.result == 1) {
                        logger.debug('levelUpRewards()');
                        logger.debug(' todo: see if also in inventory_delta?');
                        console.dir(r, {depth: 4});
                        _.each(r.items_awarded, i => {
                            let item = _.find(this.state.inventory.items, it => it.item_id == i.item_id);
                            if (item) item.count += i.item_count;
                            else this.state.inventory.items.push(item);
                        });
                    }
                    break;

                case RequestType.CHECK_AWARDED_BADGES:
                    // nothing
                    break;

                case RequestType.USE_ITEM_EGG_INCUBATOR:
                    info.result = r.result;
                    break;

                case RequestType.GET_BUDDY_WALKED:
                    if (r.family_candy_id || r.candy_earned_count) {
                        logger.info('getBuddyWalked()');
                        console.dir(r, {depth: 4});
                    }
                    break;

                case RequestType.GET_ASSET_DIGEST:
                    // nothing
                    break;

                case RequestType.CHECK_CHALLENGE:
                    if (r.show_challenge) {
                        logger.error('Challenge!', {challenge_url: r.challenge_url});
                        throw new ChallengeError(r.challenge_url);
                    }
                    break;

                default:
                    logger.warn('Unhandled request: %s', r.pogoBufRequest);
                    break;
            }

        });

        return info;
    }

    /**
     * Convert version string (like 5100) to iOS (like 1.21)
     * @param {string} version - version string (in the form of 5100)
     * @return {string} iOS version
     */
    versionToiOSVersion(version) {
        return '1.' + (+version-3000)/100;
    }

    /**
     * Convert version string (like 5100) to client version (like 0.51.0)
     * @param {string} version - version string (in the form of 5100)
     * @return {string} client version (like 0.51.0)
     */
    versionToClientVersion(version) {
        return '0.' + ((+version)/100).toFixed(1);
    }
}

module.exports = APIHelper;
