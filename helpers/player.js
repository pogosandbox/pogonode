const POGOProtos = require('node-pogo-protos');
const GoogleMapsAPI = require('googlemaps');
const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('winston');

Promise.promisifyAll(GoogleMapsAPI.prototype);
const EncounterResult = POGOProtos.Networking.Responses.EncounterResponse.Status;

const APIHelper = require('./api');

const POKE_BALLS = [1, 2, 3, 4];
const INCUBATORS = [901, 902];

/**
 * Helper class to deal with our walker.
 */
class Player {

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new APIHelper(config, state);
    }

    /**
     * Encounter all pokemons in range (based on current state)
     * @return {Promise}
     */
    encounterPokemons() {
        let pokemons = this.state.map.catchable_pokemons;
        pokemons = _.uniqBy(pokemons, pk => pk.encounter_id);
        pokemons = _.filter(pokemons, pk => this.state.encountered.indexOf(pk.encounter_id) < 0);

        if (pokemons.length == 0) return Promise.resolve(0);

        logger.debug('Start encounters...');
        let client = this.state.client;
        return Promise.map(pokemons, pk => {
                    logger.debug('  encounter %s', pk.pokemon_id);
                    let batch = client.batchStart();
                    batch.encounter(pk.encounter_id, pk.spawn_point_id);
                    this.apihelper.always(batch);
                    return batch.batchCall().then(responses => {
                        return this.apihelper.parse(responses);

                    }).then(info => {
                        if (info.status == EncounterResult.POKEMON_INVENTORY_FULL) {
                            logger.warn('Pokemon bag full.');
                        } else if (info.status != EncounterResult.ENCOUNTER_SUCCESS) {
                            logger.warn('Error while encountering pokemon: %d', info.status);
                        } else {
                            // encounter success
                            this.state.encountered.push(pk.encounter_id);
                            this.state.events.emit('encounter', info.pokemon);

                            return {
                                encounter_id: pk.encounter_id,
                                spawn_point_id: pk.spawn_point_id,
                                pokemon_id: pk.pokemon_id,
                            };
                        }

                    }).delay(this.config.delay.encounter * 1000);
                }, {concurrency: 1})
            .then(done => {
                if (done) logger.debug('Encounter done.');
                return done;
            });

    }

    /**
     * Catch all encounters passed in parameters.
     * @param {object[]} encounters Array of encounteres results
     * @return {Promise}
     */
    catchPokemons(encounters) {
        if (!encounters || encounters.length == 0) return Promise.resolve();
        logger.debug('Start catching...');
        return Promise.map(encounters, enc => {
                    if (!enc) return;
                    let ball = this.getPokeBallForPokemon(enc.pokemon_id);
                    let batch = client.batchStart();
                    batch.catchPokemon(
                        pk.encounter_id,
                        ball,
                        1.950 - Math.random() / 200, // reticle size
                        pk.spawn_point_id,
                        true, // hit
                        1, // spin modified
                        1 // normalized hit position
                    );
                    this.apihelper.always(batch);
                    return batch.batchCall().then(responses => {
                        return this.apihelper.parse(responses);
                    });
                }, {concurrency: 1})
            .then(done => {
                if (done) logger.debug('Catch done.');
                return done;
            });
    }

    /**
     * Get a Pokéball from inventory for pokemon passed in params.
     * @param {int} pokemondId pokemon id to get a ball for
     * @return {int} id of pokemon
     */
    getPokeBallForPokemon(pokemondId) {
        let balls = _.filter(this.state.inventory.items, i => i.count > 0 && _.includes(POKE_BALLS, i));
        if (balls.length) {
            return _.head(balls).item_id;
        } else {
            return -1;
        }
    }
}

module.exports = Player;
