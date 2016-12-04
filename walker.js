const GoogleMapsAPI = require('googlemaps');
const geolib        = require("geolib");
const logger        = require('winston');
const _             = require('lodash');
const Promise       = require('bluebird');

Promise.promisifyAll(GoogleMapsAPI.prototype);

class Walker {

    constructor(config, state) {
        this.config = config;
        this.state = state;
    }

    findNextPokestop() {
        var pokestops = this.state.map.pokestops;
        
        // get pokestops not already visited
        pokestops = _.filter(pokestops, pk => !pk.done && pk.cooldown_complete_timestamp_ms == 0 && this.state.path.visited_pokestops.indexOf(pk.id) < 0);

        if (pokestops.length > 1) {
            // order by distance
            _.each(pokestops, pk => pk.distance = this.distance(pk));
            pokestops = _.orderBy(pokestops, "distance");
        }

        // take closest
        if (pokestops.length > 0) return pokestops[0];
        else return null;
    }

    findSpinnablePokestops() {
        var pokestops = this.state.map.pokestops;

        var range = this.state.download_settings.fort_settings.interaction_range_meters;
        
        // get pokestops not in cooldown that are close enough to spin it
        pokestops = _.filter(pokestops, pk => pk.cooldown_complete_timestamp_ms == 0 && this.distance(pk) < range);

        return pokestops;
    }

    generatePath() {
        //logger.debug("Get new path.");

        var state = this.state;
        var target = state.path.target = this.findNextPokestop(state);
        
        if (target) {
            var gmAPI = new GoogleMapsAPI({
                key: this.config.gmapKey
            });
            return gmAPI.directionsAsync({ origin: `${state.pos.lat},${state.pos.lng}`, destination: `${target.latitude},${target.longitude}`, mode: "walking" })
                        .then(result => {
                            if (result.error_message) throw new Error(result.error_message);
                            state.path.waypoints = [];
                            if (result.routes.length > 0 && result.routes[0].legs) {
                                var path = [];
                                _.each(result.routes[0].legs, l => {
                                    _.each(l.steps, s => state.path.waypoints.push(s.end_location));
                                });
                            }
                            state.path.waypoints.push({ lat: target.latitude, lng: target.longitude });
                            return state.path;
                        });
        } else {
            throw new Error("No more available stops.");
        }
    }

    checkPath() {
        var state = this.state;
        if (state.path.waypoints.length == 0) {
            if (state.path.target) {
                // we arrive at target
                state.path.target.done = true;
            }
            // get a new target and path to go there
            return this.generatePath(state);
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
        }
        this.state.pos = this.fuzzedLocation(newpos);

        // if we get close to the next point, remove it from the targets
        dist = this.distance(this.state.path.waypoints[0]);
        if (dist < 5) this.state.path.waypoints.shift();
    }

    distance(target) {
        return geolib.getDistance(this.state.pos, target);
    }

    randGPSFloatBetween(min, max) {
        return parseFloat((Math.random()*(max-min)+min).toFixed(10));
    }

    fuzzedLocation(latlng) {
        return {
            lat: parseFloat((latlng.lat + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(10)),
            lng: parseFloat((latlng.lng + this.randGPSFloatBetween(-0.0000009, 0.0000009)).toFixed(10))
        };
    }
}

module.exports = Walker;