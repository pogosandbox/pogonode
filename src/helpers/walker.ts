import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as logger from 'winston';

const GoogleMapsAPI = require('googlemaps');
const geolib = require('geolib');

Bluebird.promisifyAll(GoogleMapsAPI.prototype);

import APIHelper from './api';

/**
 * Helper class to deal with our walker.
 */
export default class Walker {
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
     * Find our next pokestop to go to. We take the nearest we did not visited yet.
     * @return {object} next pokestop to go to
     */
    findNextPokestop(): any {
        let pokestops: any[] = this.state.map.pokestops;

        // get pokestops not already visited
        pokestops = _.filter(pokestops, pk => !pk.done && pk.cooldown_complete_timestamp_ms === 0 &&
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

    /**
     * Use Google Map API to get a path to nearest pokestop.
     * Update state with path.
     * @return {Promise<void>}
     */
    async generatePath(): Promise<any> {
        // logger.debug("Get new path.");

        const state = this.state;
        const target = state.path.target = this.findNextPokestop();

        if (target) {
            const gmAPI = new GoogleMapsAPI({
                key: this.config.gmapKey,
            });
            return gmAPI.directionsAsync({origin: `${state.pos.lat},${state.pos.lng}`, destination: `${target.latitude},${target.longitude}`, mode: 'walking'})
                        .then(result => {
                            if (result.error_message) throw new Error(result.error_message);
                            state.path.waypoints = [];
                            if (result.routes.length > 0 && result.routes[0].legs) {
                                _.each(<any[]>result.routes[0].legs, l => {
                                    _.each(<any[]>l.steps, s => state.path.waypoints.push(s.end_location));
                                });
                            }
                            state.path.waypoints.push({lat: target.latitude, lng: target.longitude});
                            return state.path;
                        });
        } else {
            logger.warn('No stop to go to, stand still.');
            return null;
        }
    }

    /**
     * Check is current path is still valid, generate a new path if not.
     * Update state if needed.
     * @return {Promise<any>}
     */
    async checkPath() {
        if (this.state.path.waypoints.length === 0) {
            if (this.state.path.target) {
                // we arrive at target
                this.state.path.target.done = true;
            }
            // get a new target and path to go there
            return await this.generatePath();
        }
        return null;
    }

    /**
     * Move toward target, get call each second or so.
     * Update state.
     */
    walk(): void {
        if (!this.state.path || this.state.path.waypoints.length === 0) return;

        // move towards next target
        const dest = this.state.path.waypoints[0];
        let speed = this.config.speed;
        speed += (Math.random() - 0.5) * speed * 0.1;
        const speedms = speed / 3.6;
        let dist = this.distance(dest);
        const step = dist / speedms;

        const newpos = {
            lat: this.state.pos.lat + (dest.lat - this.state.pos.lat) / step,
            lng: this.state.pos.lng + (dest.lng - this.state.pos.lng) / step,
        };
        this.state.pos = this.fuzzedLocation(newpos);

        // if we get close to the next point, remove it from the targets
        dist = this.distance(this.state.path.waypoints[0]);
        if (dist < 5) this.state.path.waypoints.shift();
    }

    /**
     * Calculte distance from current pos to a target.
     * @param {object} target position
     * @return {int} distance to target
     */
    distance(target): number {
        return geolib.getDistance(this.state.pos, target, 1, 1);
    }

    /**
     * Return a random float number between 2 numbers
     * @param {float} min minimum value
     * @param {float} max maximum value
     * @return {float} random value
     */
    randGPSFloatBetween(min: number, max: number): number {
        return parseFloat((Math.random() * (max - min) + min).toFixed(14));
    }

    /**
     * Fuzz a gps location in order to make walking path real
     * @param {object} latlng location
     * @return {object} fuzzed location
     */
    fuzzedLocation(latlng) {
        return {
            lat: parseFloat((latlng.lat + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(14)),
            lng: parseFloat((latlng.lng + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(14)),
        };
    }

    /**
     * Get altitude from locaztion
     * @param {object} latlng location
     * @return {Promise<altitude>} Promise returning altitude
     */
    async getAltitude(latlng): Promise<number> {
        try {
            const gmAPI = new GoogleMapsAPI({
                key: this.config.gmapKey,
            });
            const data = await gmAPI.elevationFromLocationsAsync({
                locations: `${latlng.lat},${latlng.lng}`,
            });
            if (data && data.results.length > 0) {
                return data.results[0].elevation;
            } else {
                return 0;
            }
        } catch (e) {
            logger.warn('Unable to get altitude.', e);
            return 0;
        }
    }
}
