"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pogobuf = require("pogobuf-vnext");
const POGOProtos = require("node-pogo-protos-vnext");
const logger = require("winston");
const _ = require("lodash");
const Bluebird = require("bluebird");
const request = require("request-promise");
const fs = require("mz/fs");
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
     * Once init flow is done, each call come with some other calls
     * @param {Client} batch - pogobuf client
     * @return {Client} current client in order to chain call
     */
    always(batch, options) {
        if (!options)
            options = {};
        batch = batch.checkChallenge()
            .getHatchedEggs()
            .getInventory(this.state.api.inventory_timestamp)
            .checkAwardedBadges();
        if (options.settings)
            batch.downloadSettings(this.state.api.settings_hash);
        if (!options.nobuddy)
            batch.getBuddyWalked();
        if (!options.noinbox)
            batch.getInbox(true, false, 0);
        return batch;
    }
    /**
     * Internal function to parse delta inventory responses
     * @param {object} r - inventory responses
     */
    parseInventoryDelta(r) {
        const split = pogobuf.Utils.splitInventory(r);
        if (split.pokemon.length > 0) {
            _.each(split.pokemon, pkm => {
                // add new pokemon to inventory, removing it if already there (to be sure)
                if (pkm.is_egg) {
                    const eggs = this.state.inventory.eggs;
                    this.state.inventory.eggs = _.filter(eggs, e => e.id !== pkm.id);
                    this.state.inventory.eggs.push(pkm);
                }
                else {
                    const pokemons = this.state.inventory.pokemon;
                    this.state.inventory.pokemon = _.filter(pokemons, e => e.id !== pkm.id);
                    this.state.inventory.pokemon.push(pkm);
                }
            });
        }
        if (split.removed_pokemon.length > 0) {
            const pokemons = this.state.inventory.pokemon;
            this.state.inventory.pokemon = _.filter(pokemons, e => split.removed_pokemon.indexOf(e.id) < 0);
        }
        if (split.items.length > 0) {
            // replace any modified item in inventory
            _.each(split.items, i => {
                const items = this.state.inventory.items;
                const item = _.find(items, it => it.item_id === i.item_id);
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
            const lvl = this.state.inventory.player.level;
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
     * Generate a new avatar
     * @return {object} avatar to pass to setAvatar()
     */
    generateAvatar() {
        const hair = _.random(0, 5);
        const eyes = _.random(0, 4);
        return {
            avatar: 0,
            skin: _.random(0, 3),
            avatar_hair: `AVATAR_m_hair_default_${hair}`,
            avatar_shirt: 'AVATAR_m_shirt_default_2B',
            avatar_pants: 'AVATAR_m_pants_default_0',
            avatar_hat: 'AVATAR_m_hat_default_5',
            avatar_shoes: 'AVATAR_m_shoes_default_2',
            avatar_eyes: `AVATAR_m_eyes_${eyes}`,
            avatar_backpack: 'AVATAR_m_backpack_default_2',
            avatar_gloves: 'AVATAR_m_gloves_default_2',
            avatar_socks: 'AVATAR_m_socks_default_3',
            avatar_belt: '',
            avatar_glasses: 'AVATAR_m_glasses_empty',
            avatar_necklace: '',
        };
    }
    /**
     * Complete tutorial if needed, setting a random avatar
     * If not needed, do the minmum getPlayerProfile and registerBackgroundDevice
     * @return {Promise<void>} Promise
     */
    async completeTutorial() {
        const tuto = this.state.player.tutorial_state || [];
        const client = this.state.client;
        if (_.difference([0, 1, 3, 4, 7], tuto).length === 0)
            return false;
        logger.info('Completing tutorials...');
        if (!_.includes(tuto, 0)) {
            logger.debug('Legal screen tutorial (0)...');
            await Bluebird.delay(_.random(4, 7, true) * 1000);
            // complete tutorial
            let batch = client.batchStart();
            batch.markTutorialComplete(0, false, false);
            let responses = await this.always(batch, { nobuddy: true, noinbox: true }).batchCall();
            this.parse(responses);
            batch = client.batchStart();
            batch.getPlayer(this.config.api.country, this.config.api.language, this.config.api.timezone);
            responses = await this.always(batch, { nobuddy: true, noinbox: true }).batchCall();
            this.parse(responses);
        }
        if (!_.includes(tuto, 1)) {
            logger.debug('Avatar tutorial (1)...');
            // set avatar
            await Bluebird.delay(_.random(8000.0, 14500));
            let batch = client.batchStart();
            batch.setAvatar(this.generateAvatar());
            let responses = await this.always(batch, { nobuddy: true, noinbox: true }).batchCall();
            this.parse(responses);
            batch = client.batchStart();
            batch.listAvatarCustomizations(0, [], [2], 0, 0);
            responses = await this.always(batch, { nobuddy: true, noinbox: true }).batchCall();
            this.parse(responses);
            await Bluebird.delay(_.random(1000, 1700));
            batch = client.batchStart();
            batch.markTutorialComplete(1, false, false);
            responses = await this.always(batch, { nobuddy: true, noinbox: true }).batchCall();
            this.parse(responses);
            batch = client.batchStart();
            batch.getPlayerProfile();
            responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
        }
        if (!_.includes(tuto, 3)) {
            logger.debug('Encounter tutorial (3)...');
            // encounter starter pokemon
            let batch = client.batchStart();
            batch.getDownloadURLs([
                this.state.assets.getFullIdFromId('1a3c2816-65fa-4b97-90eb-0b301c064b7a'),
                this.state.assets.getFullIdFromId('aa8f7687-a022-4773-b900-3a8c170e9aea'),
                this.state.assets.getFullIdFromId('e89109b0-9a54-40fe-8431-12f7826c8194'),
            ]);
            let responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
            await Bluebird.delay(_.random(10000, 13000));
            batch = client.batchStart();
            const pkmId = [1, 4, 7][_.random(3)];
            batch.encounterTutorialComplete(pkmId);
            responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
            batch = client.batchStart();
            batch.getPlayer(this.config.api.country, this.config.api.language, this.config.api.timezone);
            responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
        }
        if (!_.includes(tuto, 4)) {
            logger.debug('Name tutorial (4)...');
            await Bluebird.delay(_.random(7000, 13500));
            let batch = client.batchStart();
            batch.claimCodename(this.config.credentials.user, false);
            let responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
            batch = client.batchStart();
            batch.getPlayer(this.config.api.country, this.config.api.language, this.config.api.timezone);
            responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
            batch = client.batchStart();
            batch.markTutorialComplete(4, false, false);
            responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
        }
        if (!_.includes(tuto, 7)) {
            logger.debug('First time experience tutorial (7)...');
            await Bluebird.delay(_.random(3500, 6000));
            const batch = client.batchStart();
            batch.markTutorialComplete(7, false, false);
            const responses = await this.always(batch, { noinbox: true }).batchCall();
            this.parse(responses);
        }
        return true;
    }
    /**
     * Verify client version
     */
    async verifyMinimumVersion(minimum) {
        const clientversion = this.versionToClientVersion(this.config.api.version);
        if (vercmp(minimum, clientversion) > 0) {
            if (this.config.api.checkversion) {
                throw new Error(`Minimum client version=${minimum}, ${clientversion} is too low.`);
            }
            else {
                logger.warn(`Minimum client version=${minimum}, ${clientversion} is too low.`);
            }
        }
    }
    /**
     * Check if item templates need to be downloaded, and do it if needed.
     * @return {Promise} when done
     */
    async getItemTemplates() {
        logger.debug('Checking if item_templates need a refresh...');
        let last = 0;
        if (fs.existsSync('data/item_templates.json')) {
            const json = fs.readFileSync('data/item_templates.json', { encoding: 'utf8' });
            const data = JSON.parse(json);
            this.state.api.item_templates = data.templates;
            last = data.timestamp_ms || 0;
        }
        if (!last || last < this.state.api.item_templates_timestamp) {
            logger.info('Game master updating...');
            const client = this.state.client;
            let batch = client.batchStart();
            batch.downloadItemTemplates(true);
            let responses = await this.always(batch, { settings: true, nobuddy: true, noinbox: true }).batchCall();
            let info = this.parse(responses);
            let item_templates = info.item_templates;
            while (info.page_offset !== 0) {
                batch = client.batchStart();
                batch.downloadItemTemplates(true, info.page_offset, info.timestamp_ms);
                responses = await this.always(batch, { settings: true, nobuddy: true, noinbox: true }).batchCall();
                info = this.parse(responses);
                item_templates = item_templates.concat(info.item_templates);
            }
            this.state.api.item_templates = item_templates;
            for (const template of item_templates) {
                for (const name in template) {
                    if (!template.hasOwnProperty(name))
                        continue;
                    if (!template[name])
                        delete template[name];
                }
            }
            const json = JSON.stringify({
                templates: item_templates,
                timestamp_ms: info.timestamp_ms,
            }, null, 2);
            await fs.writeFile('data/item_templates.json', json);
        }
    }
    /**
     * Check if asset digest need to be downloaded, and do it if needed.
     * @return {Promise} when done
     */
    async getAssetDigest() {
        logger.debug('Checking if asset_digest need a refresh...');
        let last = 0;
        if (fs.existsSync('data/asset_digest.json')) {
            const json = fs.readFileSync('data/asset_digest.json', { encoding: 'utf8' });
            const data = JSON.parse(json);
            this.state.api.asset_digest = data.digest;
            last = data.timestamp_ms || 0;
        }
        if (!last || last < this.state.api.asset_digest_timestamp) {
            logger.info('Asset digest updating...');
            const client = this.state.client;
            let batch = client.batchStart();
            batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', +this.config.api.version, true);
            let responses = await this.always(batch, { settings: true, nobuddy: true, noinbox: true }).batchCall();
            let info = this.parse(responses);
            let digest = info.digest;
            while (info.page_offset !== 0) {
                batch = client.batchStart();
                batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, '', '', '', +this.config.api.version, true, info.page_offset, info.timestamp_ms);
                responses = await this.always(batch, { settings: true, nobuddy: true, noinbox: true }).batchCall();
                info = this.parse(responses);
                digest = digest.concat(info.digest);
            }
            _.each(digest, d => {
                d.key = d.key.toString('base64');
            });
            this.state.api.asset_digest = digest;
            const json = JSON.stringify({
                digest,
                timestamp_ms: info.timestamp_ms,
            }, null, 2);
            await fs.writeFile('data/asset_digest.json', json);
        }
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
        // save ptr8 value for information
        this.state.api.ptr8 = this.state.client.ptr8;
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
                case RequestType.GET_HOLO_INVENTORY:
                    this.state.api.inventory_timestamp = r.inventory_delta.new_timestamp_ms;
                    if (!this.state.hasOwnProperty('inventory')) {
                        // console.dir(r.inventory_delta.inventory_items, { depth: 6 });
                        this.state.inventory = pogobuf.Utils.splitInventory(r);
                        const pokemons = this.state.inventory.pokemon;
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
                    this.state.api.asset_digest_timestamp = r.asset_digest_timestamp_ms;
                    break;
                case RequestType.FORT_SEARCH:
                    if (r.result === 1) {
                        _.each(r.items_awarded, i => {
                            const items = this.state.inventory.items;
                            const item = _.find(items, it => it.item_id === i.item_id);
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
                    const forts = r.map_cells.reduce((all, c) => all.concat(c.forts), []);
                    const pokestops = forts.filter(f => f.type === 1);
                    const gyms = forts.filter(f => f.type === 0);
                    const wildPokemons = r.map_cells.reduce((all, c) => all.concat(c.wild_pokemons), []);
                    const catchablePokemons = r.map_cells.reduce((all, c) => all.concat(c.catchable_pokemons), []);
                    const nearbyPokemons = r.map_cells.reduce((all, c) => all.concat(c.nearby_pokemons), []);
                    // let spawnPoints = r.map_cells.reduce((all, c) => all.concat(c.spawn_points), []);
                    this.state.map = {
                        pokestops,
                        gyms,
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
                        const pkm = r.hatched_pokemon[0];
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
                    info.download_urls = r.download_urls;
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
                    if (r.digest.length > 0) {
                        info.success = r.success;
                        info.digest = r.digest;
                        info.timestamp_ms = r.timestamp_ms;
                        info.page_offset = r.page_offset;
                    }
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
                case RequestType.RECYCLE_INVENTORY_ITEM:
                    info = {
                        result: r.result,
                        new_count: r.new_count,
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
                case RequestType.GET_INBOX:
                    if (r.inbox.notifications.length > 0) {
                        logger.debug(r.inbox.notifications);
                    }
                    break;
                default:
                    logger.warn('Unhandled request: %s', r._requestType);
                    logger.debug(r);
                    break;
            }
        });
        return info;
    }
    maybeShadowBanned() {
        const commonPokemons = [
            16, 19, 23, 27, 29, 32, 37, 41, 43, 46, 52, 54, 58, 60, 69,
            72, 74, 77, 81, 90, 98, 118, 120, 129, 155, 161, 165, 167,
            177, 183, 187, 191, 194, 198, 209, 218, 220, 228
        ];
        let pokemons = this.state.map.catchable_pokemons.map(p => p.pokemon_id);
        pokemons = _.concat(pokemons, this.state.map.nearby_pokemons.map(p => p.pokemon_id));
        return _.difference(pokemons, commonPokemons).length === 0;
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
    async getRpcVersion() {
        const options = {
            uri: 'https://pgorelease.nianticlabs.com/plfe/version',
            headers: {
                'accept': '*/*',
                'user-agent': 'pokemongo/1 CFNetwork/808.3 Darwin/16.3.0',
                'accept-language': 'en-us',
                'x-unity-version': '5.5.1f1'
            },
            gzip: true,
        };
        const version = await request.get(options);
        return version.replace(/[^(\d|\.)+]/g, '');
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
exports.default = APIHelper;
//# sourceMappingURL=api.js.map