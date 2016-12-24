const express = require('express');
const http = require('http');
const Promise = require('bluebird');
const logger = require('winston');
const _ = require('lodash');

Promise.promisifyAll(http);

/**
 * Socket server to communicate to the web ui through socket.io
 */
class SocketServer {

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.io = {};
        this.initialized = false;
    }

    /**
     * Start a socket.io server.
     * @return {Promise}
     */
    start() {
        let app = express();
        let httpserver = http.createServer(app);
        Promise.promisifyAll(httpserver);
        this.io = require('socket.io')(httpserver);

        this.io.on('connection', socket => {
            logger.debug('UI connected.');
            if (this.initialized) this.ready(socket);

            socket.on('inventory_list', msg => this.sendInventory(socket));
            socket.on('pokemon_list', msg => this.sendPokemons(socket));
            socket.on('eggs_list', msg => this.sendEggs(socket));
        });

        return httpserver.listenAsync(process.env.PORT || 8000, '0.0.0.0').then(() => {
            let addr = httpserver.address();
            logger.info('Socket server listening at ', addr.address + ':' + addr.port);
            return true;
        });
    }

    /**
     * Send a ready event to the client to say we are ready to go.
     * @param {object} client - optional socket client to send into to
     */
    ready(client) {
        logger.debug('Send ready message to the ui.');
        let data = {
            username: this.state.player.username,
            player: this.state.inventory.player,
            storage: {
                max_pokemon_storage: this.state.player.max_pokemon_storage,
                max_item_storage: this.state.player.max_item_storage,
            },
            pos: this.state.pos,
        };
        if (client) {
            // send initialized event to the newly connect client
            client.emit('initialized', data);
        } else {
            // broadcast that we are ready
            this.initialized = true;
            this.io.emit('initialized', data);
        }
    }

    /**
     * Send position to connected clients
     */
    sendPosition() {
        this.io.emit('position', this.state.pos);
    }

    /**
     * Send route to connected clients
     * @param {object} route - route info
     */
    sendRoute(route) {
        this.io.emit('route', _.concat([this.state.pos], route));
    }

    /**
     * Send available pokestops to connected clients
     */
    sendPokestops() {
        this.io.emit('pokestops', this.state.map.pokestops);
    }

    /**
     * Send a pokemon caught event to connected clients
     * @param {object} pokemon - the pokemon we've just caught
     */
    sendPokemonCaught(pokemon) {
        this.io.emit('pokemon_caught', {
            pokemon: pokemon,
            position: this.state.pos,
        });
    }

    /**
     * Send a pokestop visited event to connected clients
     * @param {object} pokestop - the pokestop we've just visited
     */
    sendVisitedPokestop(pokestop) {
        this.io.emit('pokestop_visited', pokestop);
    }


    /**
     * Send the inventory to a client after it request it
     * @param {object} client - the socket client to send info to
     */
    sendInventory(client) {
        client.emit('inventory_list', this.state.inventory.items);
    }

    /**
     * Send our pokemon list to the client after it request it
     * @param {object} client - the socket client to send info to
     */
    sendPokemons(client) {
        client.emit('pokemon_list', {
            pokemon: this.state.inventory.pokemon,
            candy: this.state.inventory.candies,
        });
    }

    /**
     * Send our egg list to a client after it request it
     * @param {object} client - the socket client to send info to
     */
    sendEggs(client) {
        client.emit('eggs_list', {
            km_walked: this.state.inventory.player.km_walked,
            egg_incubators: this.state.inventory.egg_incubators,
            eggs: this.state.inventory.eggs,
        });
    }
}

module.exports = SocketServer;
