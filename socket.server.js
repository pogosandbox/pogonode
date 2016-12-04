const express   = require('express');
const http      = require('http');
const Promise   = require('bluebird');
const logger    = require('winston');
const _         = require('lodash');

Promise.promisifyAll(http);

class SocketServer {

    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.io = {};
        this.initialized = false;
    }

    start() {
        var app = express();

        var httpserver = http.createServer(app);
        Promise.promisifyAll(httpserver);
        this.io = require('socket.io')(httpserver);

        this.io.on('connection', socket => {
            logger.debug('UI connected.');
            if (this.initialized) this.ready(socket);
        });

        return httpserver.listenAsync(process.env.PORT || 8000, "0.0.0.0").then(() => {
            var addr = httpserver.address();
            logger.info("Socket server listening at ", addr.address + ":" + addr.port);
            return true;
        });
    }

    ready(client) {
        logger.debug("Send ready message to the ui.");
        let data = {
            username: this.state.player.username,
            player: this.state.inventory.player,
            storage: { 
                max_pokemon_storage: this.state.player.max_pokemon_storage, 
                max_item_storage: this.state.player.max_item_storage 
            },
            pos: this.state.pos
        };
        if (client) {
            // send initialized event to the newly connect client
            client.emit("initialized", data);
        } else {
            // broadcast that we are ready
            this.initialized = true;
            this.io.emit("initialized", data);
        }
    }

    sendPosition() {
        this.io.emit("position", this.state.pos);
    }

    sendRoute(route) {
        this.io.emit("route", _.concat([ this.state.pos ], route));
    }

    sendPokestops() {
        this.io.emit("pokestops", this.state.map.pokestops);
    }

    sendVisitedPokestop(pokestop) {
        this.io.emit("pokestop_visited", pokestop);
    }

}

module.exports = SocketServer;