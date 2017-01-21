const POGOProtos = require('node-pogo-protos');
const GoogleMapsAPI = require('googlemaps');
const geolib = require('geolib');
const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('winston');

Promise.promisifyAll(GoogleMapsAPI.prototype);

const EncounterResult = POGOProtos.Networking.Responses.EncounterResponse.Status;
const FortSearchResult = POGOProtos.Networking.Responses.FortSearchResponse.Result;
const UseIncubatorResult = POGOProtos.Networking.Responses.UseItemEggIncubatorResponse.Result;

const APIHelper = require('./api');

const POKE_BALLS = [1, 2, 3, 4];

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
     * Find pokestop we can spin. Get only reachable one that are not in cooldown.
     * @return {object} array of pokestop we can spin
     */
    findSpinnablePokestops() {
        let pokestops = this.state.map.pokestops;
        let range = this.state.download_settings.fort_settings.interaction_range_meters * 0.9;

        // get pokestops not in cooldown that are close enough to spin it
        pokestops = _.filter(pokestops, pk => pk.cooldown_complete_timestamp_ms == 0 && this.distance(pk) < range);

        return pokestops;
    }

    /**
     * Spin all pokestops in an array
     * @param {object[]} pokestops - Array of pokestops
     * @return {Promise}
     */
    spinPokestops(pokestops) {
        if (pokestops.length == 0) return Promise.resolve(0);

        return Promise.map(pokestops, ps => {
                    logger.debug('Spin %s', ps.id);
                    let batch = this.state.client.batchStart();
                    batch.fortSearch(ps.id, ps.latitude, ps.longitude);
                    this.apihelper.always(batch);
                    return batch.batchCall().then(responses => {
                        let info = this.apihelper.parse(responses);
                        if (info.status == FortSearchResult.SUCCESS) {
                            let stop = _.find(state.map.pokestops, p => p.id == ps.id);
                            stop.cooldown_complete_timestamp_ms = info.cooldown;
                            this.state.events.emit('spinned', stop);
                        }
                        return Promise.resolve();
                    }).delay(this.config.delay.spin * 1000);
                }, {concurrency: 1});
    }

    /**
     * Encounter all pokemons in range (based on current state)
     * @param {bool} catchPokemon true to catch pokemons, by default only encounter them
     * @return {Promise}
     */
    encounterPokemons(catchPokemon) {
        let pokemons = this.state.map.catchable_pokemons;
        pokemons = _.uniqBy(pokemons, pk => pk.encounter_id);
        pokemons = _.filter(pokemons, pk => this.state.encountered.indexOf(pk.encounter_id) < 0);
        pokemons = _.filter(pokemons, pk => this.distance(pk) <= this.state.download_settings.map_settings.pokemon_visible_range);

        if (pokemons.length == 0) return Promise.resolve(0);

        logger.debug('Start encounters...');
        let client = this.state.client;
        return Promise.map(pokemons, pk => {
                    return Promise.delay(this.config.delay.encounter * _.random(900, 1100))
                    .then(() => {
                        logger.debug('Encounter %s', pk.pokemon_id);
                        let batch = client.batchStart();
                        batch.encounter(pk.encounter_id, pk.spawn_point_id);
                        this.apihelper.always(batch);
                        return batch.batchCall();

                    }).then(responses => {
                        let info = this.apihelper.parse(responses);
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

                    })
                    .then(encounter => {
                        if (catchPokemon) {
                            return Promise.delay(this.config.delay.catch * 1000)
                                            .then(() => this.catchPokemon(encounter))
                                            .then(pokemon => this.releaseIfNotGoodEnough(pokemon))
                                            .then(() => encounter);
                        } else {
                            return encounter;
                        }
                    });
                }, {concurrency: 1})
            .then(done => {
                if (done) logger.debug('Encounter done.');
                return done;
            });
    }

    /**
     * Get throw parameter.
     * Ball has some effect but is not curved.
     * Player is not a bad thrower but not a good one either.
     * @param {int} pokemonId Pokemon Id
     * @return {object} throw parameters
     */
    getThrowParameter(pokemonId) {
        let ball = this.getPokeBallForPokemon(pokemonId);
        let lancer = {
            ball: ball,
            reticleSize: 1.25 + 0.70 * Math.random(),
            hit: true,
            spinModifier: 0.3 * Math.random(),
            normalizedHitPosition: 0,
        };

        if (Math.random() > 0.9) {
            // excellent throw
            lancer.reticleSize = 1.70 + 0.25 * Math.random();
            lancer.normalizedHitPosition = 1;
        } else if (Math.random() > 0.8) {
            // great throw
            lancer.reticleSize = 1.30 + 0.399 * Math.random();
            lancer.normalizedHitPosition = 1;
        } else if (Math.random() > 0.7) {
            // nice throw
            lancer.reticleSize = 1.00 + 0.299 * Math.random();
            lancer.normalizedHitPosition = 1;
        }

        return lancer;
    }

    /**
     * Catch pokemon passed in parameters.
     * @param {object} encounter - Encounter result
     * @return {Promise}
     */
    catchPokemon(encounter) {
        if (!encounter) return Promise.resolve();

        let lancer = this.getThrowParameter(encounter.pokemon_id);
        if (lancer.ball < 0) {
            logger.warn('No pokéball found for catching.');
            return;
        }

        let batch = this.state.client.batchStart();
        batch.catchPokemon(
            encounter.encounter_id,
            lancer.ball,
            lancer.reticleSize,
            encounter.spawn_point_id,
            lancer.hit,
            lancer.spinModifier,
            lancer.normalizedHitPosition
        );

        return this.apihelper.always(batch).batchCall()
                .then(responses => {
                    let info = this.apihelper.parse(responses);
                    if (info.caught) {
                        let pokemon = _.find(this.state.inventory.pokemon, pk => pk.id == info.id);
                        logger.info('Pokemon caught.', {pokemon_id: pokemon.pokemon_id});
                        this.state.events.emit('pokemon_caught', pokemon);
                        return pokemon;
                    } else {
                        logger.info('Pokemon missed.', info);
                        return null;
                    }
                });
    }

    /**
     * Release pokemon if its not good enough.
     * i.e. we have another one better already
     * @param {object} pokemon - pokemon to check
     * @return {Promise}
     */
    releaseIfNotGoodEnough(pokemon) {
        if (!pokemon || !this.config.behavior.autorelease) return;
        // find same pokemons, with better iv and better cp
        let better = _.find(this.state.inventory.pokemon, pkm => {
            return pkm.pokemon_id == pokemon.pokemon_id &&
                    pkm.iv > pokemon.iv * 1.1 &&
                    pkm.cp > pokemon.cp * 1.1;
        });
        if (better) {
            return Promise.delay(this.config.delay * _.random(900, 1100))
                .then(() => {
                    // release pokemon
                    logger.info('Release pokemon', pokemon.pokemon_id);
                    let batch = this.state.client.batchStart();
                    batch.releasePokemon(pokemon.id);
                    return this.apihelper.always(batch).batchCall();

                }).then(responses => {
                    this.apihelper.parse(responses);

                });
        }
    }

    /**
     * Get a Pokéball from inventory for pokemon passed in params.
     * @param {int} pokemondId pokemon id to get a ball for
     * @return {int} id of pokemon
     */
    getPokeBallForPokemon(pokemondId) {
        let balls = _.filter(this.state.inventory.items, i => i.count > 0 && _.includes(POKE_BALLS, i.item_id));
        if (balls.length) {
            let ball = _.head(balls);
            ball.count--;
            return ball.item_id;
        } else {
            return -1;
        }
    }

    /**
     * Clean inventory based on config
     * @return {Promise} Promise
     */
    cleanInventory() {
        return Promise.resolve();
    }

    /**
     * Dipatch available incubators to eggs in order to hatch.
     * We use short eggs with unlimited incubator if available,
     * and use long eggs with limited one if available.
     * @return {Promise} Promise
     */
    dispatchIncubators() {
        let freeIncubators = _.filter(this.state.inventory.egg_incubators, i => i.pokemon_id == 0);
        let freeEggs = _.filter(this.state.inventory.eggs, e => e.egg_incubator_id == '');
        if (freeIncubators.length > 0 && freeEggs.length > 0) {
            // we have some free eggs and some free incubators

            freeEggs = _.sortBy(freeEggs, e => e.egg_km_walked_target);
            let infiniteOnes = _.filter(freeIncubators, i => i.item_id == 901);
            let others = _.filter(freeIncubators, i => i.item_id != 901);

            let association = [];

            _.each(_.take(freeEggs, infiniteOnes.length), (e, i) => {
                // eggs to associate with infinite incubators
                association.push({egg: e.id, incubator: infiniteOnes[i].id});
            });

            _.each(_.takeRight(freeEggs, _.min([others.length, freeEggs.length - infiniteOnes.length])), (e, i) => {
                // eggs to associate with disposable incubators
                association.push({egg: e.id, incubator: others[i].id});
            });

            return Promise.map(association, a => {
                        let batch = this.state.client.batchStart();
                        batch.useItemEggIncubator(a.incubator, a.egg);
                        this.apihelper.always(batch);
                        return batch.batchCall().then(responses => {
                            let info = this.apihelper.parse(responses);
                            if (info.result != UseIncubatorResult.SUCCESS) {
                                logger.warn('Error using incubator.', {
                                    result: info.result,
                                    incubator: a.incubator,
                                    egg: a.egg,
                                });
                            }

                        }).delay(this.config.delay.incubator * 1000);
                    }, {concurrency: 1});
        }
    }

    /**
     * Calculte distance from current pos to a target.
     * @param {object} target position
     * @return {int} distance to target
     */
    distance(target) {
        return geolib.getDistance(this.state.pos, target, 1, 1);
    }
}

module.exports = Player;
