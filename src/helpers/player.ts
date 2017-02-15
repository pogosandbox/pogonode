import * as POGOProtos from 'node-pogo-protos';
import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as logger from 'winston';

const GoogleMapsAPI = require('googlemaps');
const geolib = require('geolib');
Bluebird.promisifyAll(GoogleMapsAPI.prototype);

let EncounterResult = POGOProtos.Networking.Responses.EncounterResponse.Status;
let FortSearchResult = POGOProtos.Networking.Responses.FortSearchResponse.Result;
let UseIncubatorResult = POGOProtos.Networking.Responses.UseItemEggIncubatorResponse.Result;

import APIHelper from './api';

const POKE_BALLS = [1, 2, 3, 4];

/**
 * Helper class to deal with our walker.
 */
export default class Player {
    config: any;
    state: any;
    apihelper: APIHelper;

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
    findSpinnablePokestops(): any[] {
        let pokestops: any[] = this.state.map.pokestops;
        let range = this.state.download_settings.fort_settings.interaction_range_meters * 0.9;

        // get pokestops not in cooldown that are close enough to spin it
        pokestops = _.filter(pokestops, pk => pk.cooldown_complete_timestamp_ms === 0 && this.distance(pk) < range);

        return pokestops;
    }

    /**
     * Spin all pokestops in an array
     * @param {object[]} pokestops - Array of pokestops
     * @return {Promise}
     */
    async spinPokestops(pokestops: any[]): Promise<void> {
        if (pokestops.length === 0) return;

        await Bluebird.map(pokestops, async ps => {
            logger.debug('Spin %s', ps.id);

            let batch = this.state.client.batchStart();
            batch.fortSearch(ps.id, ps.latitude, ps.longitude);
            let responses = await this.apihelper.always(batch).batchCall();
            let info = this.apihelper.parse(responses);

            if (info.status === FortSearchResult.SUCCESS) {
                let stops: any[] = this.state.map.pokestops;
                let stop = _.find(stops, p => p.id === ps.id);
                stop.cooldown_complete_timestamp_ms = info.cooldown;
                this.state.events.emit('spinned', stop);
            }

            await Bluebird.delay(this.config.delay.spin * 1000);
        }, {concurrency: 1});
    }

    /**
     * Encounter all pokemons in range (based on current state)
     * @param {bool} catchPokemon true to catch pokemons, by default only encounter them
     * @return {Promise}
     */
    async encounterPokemons(catchPokemon) {
        let pokemons: any[] = this.state.map.catchable_pokemons;
        pokemons = _.uniqBy(pokemons, pk => pk.encounter_id);
        pokemons = _.filter(pokemons, pk => this.state.encountered.indexOf(pk.encounter_id) < 0);
        pokemons = _.filter(pokemons, pk => this.distance(pk) <= this.state.download_settings.map_settings.pokemon_visible_range);

        if (pokemons.length === 0) return 0;

        // take the first 3 only so we don't spend to much time in here
        pokemons = _.take(pokemons, 3);

        logger.debug('Start encounters...');
        let client = this.state.client;
        let result = await Bluebird.map(pokemons, async pk => {

            await Bluebird.delay(this.config.delay.encounter * _.random(900, 1100));

            logger.debug('Encounter %s', pk.pokemon_id);
            let batch = client.batchStart();
            batch.encounter(pk.encounter_id, pk.spawn_point_id);
            let responses = await this.apihelper.always(batch).batchCall();
            let info = this.apihelper.parse(responses);

            if (info.status === EncounterResult.POKEMON_INVENTORY_FULL) {
                logger.warn('Pokemon bag full.');
                return null;

            } else if (info.status !== EncounterResult.ENCOUNTER_SUCCESS) {
                logger.warn('Error while encountering pokemon: %d', info.status);
                return null;

            } else {
                // encounter success
                this.state.encountered.push(pk.encounter_id);
                this.state.events.emit('encounter', info.pokemon);

                let encounter = {
                    encounter_id: pk.encounter_id,
                    spawn_point_id: pk.spawn_point_id,
                    pokemon_id: pk.pokemon_id,
                };

                if (catchPokemon) {
                    await Bluebird.delay(this.config.delay.catch * 1000);
                    let pokemon = await this.catchPokemon(encounter);
                    await this.releaseIfNotGoodEnough(pokemon);
                }

                return encounter;
            }

        }, {concurrency: 1});

        return result;
    }

    /**
     * Get throw parameter.
     * Ball has some effect but is not curved.
     * Player is not a bad thrower but not a good one either.
     * @param {int} pokemonId Pokemon Id
     * @return {object} throw parameters
     */
    getThrowParameter(pokemonId: string) {
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
                        let pokemons: any[] = this.state.inventory.pokemon;
                        let pokemon = _.find(pokemons, pk => pk.id === info.id);
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
    async releaseIfNotGoodEnough(pokemon) {
        if (!pokemon || !this.config.behavior.autorelease) return;

        // find same pokemons, with better iv and better cp
        let pokemons: any[] = this.state.inventory.pokemon;
        let better = _.find(pokemons, pkm => {
            return pkm.pokemon_id === pokemon.pokemon_id &&
                    pkm.iv > pokemon.iv * 1.1 &&
                    pkm.cp > pokemon.cp * 0.8;
        });
        if (better) {
            await Bluebird.delay(this.config.delay * _.random(900, 1100));

            // release pokemon
            logger.info('Release pokemon', pokemon.pokemon_id);
            let batch = this.state.client.batchStart();
            batch.releasePokemon(pokemon.id);
            let responses = await this.apihelper.always(batch).batchCall();

            this.apihelper.parse(responses);
        }
    }

    /**
     * Get a Pokéball from inventory for pokemon passed in params.
     * @param {int} pokemondId pokemon id to get a ball for
     * @return {int} id of pokemon
     */
    getPokeBallForPokemon(pokemondId: string): number {
        let items: any[] = this.state.inventory.items;
        let balls = _.filter(items, i => i.count > 0 && _.includes(POKE_BALLS, i.item_id));
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
    async dispatchIncubators(): Promise<void> {
        let incubators: any[] = this.state.inventory.egg_incubators;
        let eggs: any[] = this.state.inventory.eggs;

        let freeIncubators = _.filter(incubators, i => i.pokemon_id === 0);
        let freeEggs = _.filter(eggs, e => e.egg_incubator_id === '');

        if (freeIncubators.length > 0 && freeEggs.length > 0) {
            // we have some free eggs and some free incubators

            freeEggs = _.sortBy(freeEggs, e => e.egg_km_walked_target);
            let infiniteOnes = _.filter(freeIncubators, i => i.item_id === 901);
            let others = _.filter(freeIncubators, i => i.item_id !== 901);

            let association = [];

            _.each(_.take(freeEggs, infiniteOnes.length), (e, i) => {
                // eggs to associate with infinite incubators
                association.push({egg: e.id, incubator: infiniteOnes[i].id});
            });

            _.each(_.takeRight(freeEggs, _.min([others.length, freeEggs.length - infiniteOnes.length])), (e, i) => {
                // eggs to associate with disposable incubators
                association.push({egg: e.id, incubator: others[i].id});
            });

            await Bluebird.map(association, async a => {
                let batch = this.state.client.batchStart();
                batch.useItemEggIncubator(a.incubator, a.egg);
                let responses = await this.apihelper.always(batch).batchCall();
                let info = this.apihelper.parse(responses);
                if (info.result !== UseIncubatorResult.SUCCESS) {
                    logger.warn('Error using incubator.', {
                        result: info.result,
                        incubator: a.incubator,
                        egg: a.egg,
                    });
                }
                await Bluebird.delay(this.config.delay.incubator * _.random(900, 1100));
            }, {concurrency: 1});
        }
    }

    /**
     * Calculte distance from current pos to a target.
     * @param {object} target position
     * @return {int} distance to target
     */
    distance(target): number {
        return geolib.getDistance(this.state.pos, target, 1, 1);
    }
}
