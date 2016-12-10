const POGOProtos = require('node-pogo-protos');
const GoogleMapsAPI = require('googlemaps');
const geolib = require('geolib');
const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('winston');

Promise.promisifyAll(GoogleMapsAPI.prototype);
const FortSearchResult = POGOProtos.Networking.Responses.FortSearchResponse.Result;
const EncounterResult = POGOProtos.Networking.Responses.EncounterResponse.Status;

const APIHelper = require('./api.helper');

class Walker {

    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new APIHelper(config, state);
    }

    findNextPokestop() {
        let pokestops = this.state.map.pokestops;

        // get pokestops not already visited
        pokestops = _.filter(pokestops, pk => !pk.done && pk.cooldown_complete_timestamp_ms == 0 &&
                                              this.state.path.visited_pokestops.indexOf(pk.id) < 0);

        if (pokestops.length > 1) {
            // order by distance
            _.each(pokestops, pk => pk.distance = this.distance(pk));
            pokestops = _.orderBy(pokestops, 'distance');
        }

        // take closest
        if (pokestops.length > 0) return pokestops[0];
        else return null;
    }

    findSpinnablePokestops() {
        let pokestops = this.state.map.pokestops;
        let range = this.state.download_settings.fort_settings.interaction_range_meters * 0.9;

        // get pokestops not in cooldown that are close enough to spin it
        pokestops = _.filter(pokestops, pk => pk.cooldown_complete_timestamp_ms == 0 && this.distance(pk) < range);

        return pokestops;
    }

    spinPokestops(pokestops) {
        if (pokestops.length == 0) return Promise.resolve(0);

        logger.debug('Start pokestops spinning...');
        let client = this.state.client;
        return Promise.map(stops, ps => {
                    logger.debug('  spin %s', ps.id);
                    let batch = client.batchStart();
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
                }, {concurrency: 1})
            .then(done => {
                if (done) logger.debug('Spins done.');
            });
    }

    encounterPokemons() {
        let pokemons = this.state.map.catchable_pokemons;
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
                        }
                    }).delay(this.config.delay.encounter * 1000);
                }, {concurrency: 1})
            .then(done => {
                if (done) logger.debug('Encounter done.');
            });

    }

    generatePath() {
        // logger.debug("Get new path.");

        let state = this.state;
        let target = state.path.target = this.findNextPokestop(state);

        if (target) {
            let gmAPI = new GoogleMapsAPI({
                key: this.config.gmapKey,
            });
            return gmAPI.directionsAsync({origin: `${state.pos.lat},${state.pos.lng}`, destination: `${target.latitude},${target.longitude}`, mode: 'walking'})
                        .then(result => {
                            if (result.error_message) throw new Error(result.error_message);
                            state.path.waypoints = [];
                            if (result.routes.length > 0 && result.routes[0].legs) {
                                _.each(result.routes[0].legs, l => {
                                    _.each(l.steps, s => state.path.waypoints.push(s.end_location));
                                });
                            }
                            state.path.waypoints.push({lat: target.latitude, lng: target.longitude});
                            return state.path;
                        });
        } else {
            throw new Error('No more available stops.');
        }
    }

    checkPath() {
        if (this.state.path.waypoints.length == 0) {
            if (this.state.path.target) {
                // we arrive at target
                this.state.path.target.done = true;
            }
            // get a new target and path to go there
            return this.generatePath(this.state);
        }
        return Promise.resolve(false);
    }

    walk() {
        // move towards next target
        let dest = this.state.path.waypoints[0];
        let speed = this.config.speed;
        speed += (Math.random() - 0.5) * speed * 0.1;
        let speedms = speed / 3.6;
        let dist = this.distance(dest);
        let step = dist/speedms;

        let newpos = {
            lat: this.state.pos.lat + (dest.lat - this.state.pos.lat)/step,
            lng: this.state.pos.lng + (dest.lng - this.state.pos.lng)/step,
        };
        this.state.pos = this.fuzzedLocation(newpos);

        // if we get close to the next point, remove it from the targets
        dist = this.distance(this.state.path.waypoints[0]);
        if (dist < 5) this.state.path.waypoints.shift();
    }

    distance(target) {
        return geolib.getDistance(this.state.pos, target, 1, 1);
    }

    randGPSFloatBetween(min, max) {
        return parseFloat((Math.random()*(max-min)+min).toFixed(10));
    }

    fuzzedLocation(latlng) {
        return {
            lat: parseFloat((latlng.lat + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(10)),
            lng: parseFloat((latlng.lng + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(10)),
        };
    }
}

module.exports = Walker;
