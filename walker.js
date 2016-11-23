const GoogleMapsAPI = require('googlemaps');
const geolib        = require("geolib");
const _             = require('lodash');

function findNextPokestop(state) {
    var pokestops = state.map.pokestops;
    
    // get pokestops not already visited
    pokestops = _.filter(pokestops, pk => !pk.done && pk.cooldown_complete_timestamp_ms > 0 && state.path.visited_pokestops.indexOf(pk.id) < 0);

    if (pokestops.length > 1) {
        // order by distance
        _.each(pokestops, pk => pk.distance = geolib.getDistance(state.pos, pk));
        pokestops = _.orderBy(pokestops, "distance");
    }

    return pokestops[0];
}

function generatePath(state) {
    state.path.target = findNextPokestop(state);
    state.path.waypoints = [ target ];

    var gmAPI = new GoogleMapsAPI({
        key: state.api.gmapkey
    });
    gmAPI.directions({ origin: "", destination: "", mode: walking })
}

module.exports = {
    distance: geolib.getDistance,
    findNextPokestop: findNextPokestop,
    generatePath: generatePath
}