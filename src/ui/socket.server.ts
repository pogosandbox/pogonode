import * as Bluebird from 'bluebird';
import * as logger from 'winston';
import * as _ from 'lodash';

const express = require('express');
const http = require('http');

Bluebird.promisifyAll(http);

/**
 * Socket server to communicate to the web ui through socket.io
 */
export default class SocketServer {
    config: any;
    state: any;
    io: any;
    initialized: boolean = false;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.io = {};
    }

    /**
     * Start a socket.io server.
     * @return {Promise}
     */
    start() {
        if (!this.config.ui.enabled) return;

        let app = express();
        let httpserver = http.createServer(app);
        Bluebird.promisifyAll(httpserver);
        this.io = require('socket.io')(httpserver);

        this.io.on('connection', socket => {
            logger.debug('UI connected.');
            if (this.initialized) this.ready(socket);

            socket.on('pokemon_settings', msg => this.sendPokemonSettings(socket));
            socket.on('inventory_list', msg => this.sendInventory(socket));
            socket.on('pokemon_list', msg => this.sendPokemons(socket));
            socket.on('eggs_list', msg => this.sendEggs(socket));
            socket.on('player_stats', msg => this.sendPlayerStats(socket));
            socket.on('transfer_pokemon', msg => this.transferPokemon(socket, msg));
            socket.on('evolve_pokemon', msg => this.evolvePokemon(socket, msg));
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
    ready(client?) {
        if (!this.config.ui.enabled) return;
        if (!this.state.inventory) return;

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
        if (!this.config.ui.enabled) return;

        this.io.emit('position', this.state.pos);
    }

    /**
     * Send route to connected clients
     * @param {object} route - route info
     */
    sendRoute(route) {
        if (!this.config.ui.enabled) return;

        this.io.emit('route', _.concat([this.state.pos], route));
    }

    /**
     * Send available pokestops to connected clients
     */
    sendPokestops() {
        if (!this.config.ui.enabled) return;

        this.io.emit('pokestops', this.state.map.pokestops);
    }

    /**
     * Send a pokemon caught event to connected clients
     * @param {object} pokemon - the pokemon we've just caught
     */
    sendPokemonCaught(pokemon) {
        if (!this.config.ui.enabled) return;

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
        if (!this.config.ui.enabled) return;

        this.io.emit('pokestop_visited', pokestop);
    }

    /**
     * Send pokemon settings (part of item_templates)
     * @param {object} client - the socket client to send info to
     */
    sendPokemonSettings(client) {
        let item_templates: any[] = this.state.api.item_templates;
        let pkmSettings = _.filter(item_templates, i => i.pokemon_settings != null);
        client.emit('pokemon_settings', _.map(pkmSettings, s => s.pokemon_settings));
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
            candy: _.keyBy(this.state.inventory.candies, 'family_id'),
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

    /**
     * Send player stats  to a client after it request it
     * @param {object} client - the socket client to send info to
     */
    sendPlayerStats(client) {
        if (this.state.inventory) {
            client.emit('player_stats', this.state.inventory.player);
        }
    }

    /**
     * Transfer a pokemon after the client request it
     * @param {object} client - the socket client to send info to if needed
     * @param {object} msg - message send from the ui
     */
    transferPokemon(client, msg) {
        let todos: any[] = this.state.todo;
        let release = _.find(todos, todo => todo.call === 'release_pokemon');
        if (release) {
            release.pokemons.push(msg.id);
        } else {
            this.state.todo.push({
                call: 'release_pokemon',
                pokemons: [msg.id],
            });
        }
    }

    /**
     * Evolve a pokemon after the client request it
     * @param {object} client - the socket client to send info to if needed
     * @param {object} msg - message send from the ui
     */
    evolvePokemon(client, msg) {
        this.state.todo.push({
            call: 'evolve_pokemon',
            pokemon: msg.id,
        });
    }
}
