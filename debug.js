const fs     = require("fs");
const Random = require("simjs-random");
const geolib = require("geolib");
const _      = require('lodash');
const logger = require('winston');

logger.level = "debug";

var state = JSON.parse(fs.readFileSync("data/state.json", 'utf8'));

function Map() {
    var cells = state.map_cells;

    var forts = cells.reduce((all, c) => { return all.concat(c.forts); }, []);
    var pokestops = forts.filter(f => f.type == 1);
    var gyms = forts.filter(f => f.type == 2);
    var wild_pokemons = cells.reduce((all, c) => { return all.concat(c.wild_pokemons); }, []);
    var catchable_pokemons = cells.reduce((all, c) => { return all.concat(c.catchable_pokemons); }, []);
    var nearby_pokemons = cells.reduce((all, c) => { return all.concat(c.nearby_pokemons); }, []);
    var spawn_points = cells.reduce((all, c) => { return all.concat(c.spawn_points); }, []);

    var map = {
        pokestops: pokestops,
        gyms: gyms,
        wild_pokemons: wild_pokemons,
        catchable_pokemons: catchable_pokemons,
        nearby_pokemons: nearby_pokemons,
        spawn_points: spawn_points
    }

    fs.writeFileSync("data/map.json", JSON.stringify(map));
}

var pokestops = state.map.pokestops;
logger.debug(pokestops.length);

// pokestops = _.uniqBy(pokestops, pk => pk.id);
// logger.debug(pokestops.length);

var visited = state.visited_pokestops || [];

// get pokestops not already visited
pokestops = _.filter(pokestops, pk => !pk.done && pk.cooldown_complete_timestamp_ms > 0);

// order by distance
_.each(pokestops, pk => pk.distance = geolib.getDistance(state.pos, pk));
pokestops = _.orderBy(pokestops, "distance");

fs.writeFileSync("data/pokestops.json", JSON.stringify(pokestops, null, 4));