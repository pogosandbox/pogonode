const fs            = require("fs");

var state = JSON.parse(fs.readFileSync("data/state.json", 'utf8'));
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
