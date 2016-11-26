const GoogleMapsAPI = require('googlemaps');
const geolib        = require("geolib");
const _             = require('lodash');
const Promise       = require('bluebird');

Promise.promisifyAll(GoogleMapsAPI.prototype);

function Walker(config, state) {
    this.config = config;
    this.state = state;
}

Walker.prototype.findNextPokestop = function() {
    var pokestops = this.state.map.pokestops;
    
    // get pokestops not already visited
    pokestops = _.filter(pokestops, pk => !pk.done && pk.cooldown_complete_timestamp_ms == 0 && this.state.path.visited_pokestops.indexOf(pk.id) < 0);

    if (pokestops.length > 1) {
        // order by distance
        _.each(pokestops, pk => pk.distance = geolib.getDistance(this.state.pos, pk));
        pokestops = _.orderBy(pokestops, "distance");
    }

    return pokestops[0];
}

Walker.prototype.generatePath = function() {
    var state = this.state;
    var target = state.path.target = this.findNextPokestop(state);
    
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
}

Walker.prototype.checkPath = function() {
    var state = this.state;
    if (state.path.waypoints.length == 0) {
        if (state.path.target) {
            // we arrive at target
            state.path.target.done = true;
            // todo: spin pokestop
        }
        // get a new target and path to go there
        return walker.generatePath(state);
    }
    return Promise.resolve(state.path);
}

Walker.prototype.walk = function() {

}

Walker.prototype.distance = geolib.getDistance;

module.exports = Walker;