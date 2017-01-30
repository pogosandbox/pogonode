const fs = require('fs');
const logger = require('winston');
const _ = require('lodash');
const pogobuf = require('./pogobuf/pogobuf/pogobuf');

logger.level = 'debug';

let config = require('./helpers/config').load();
let state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));

const APIHelper = require('./helpers/api');
let apihelper = new APIHelper(config, state);

const Walker = require('./helpers/walker');
let walker = new Walker(config, state);

function walk(socket) {
    return walker
        .checkPath()
        .then(path => {
            if (path) socket.sendRoute(path.waypoints);
        })
        .then(() => {
            walker.walk();
        })
        .then(() => {
            socket.sendPosition();
        })
        .then(() => {
            setTimeout(() => {
                walk(socket);
            }, 1000);
        });
}
function testSocket() {
    const SocketServer = require('./socket.server');
    let socket = new SocketServer(config, state);
    socket.start().then(() => {
        socket.ready();

        setTimeout(() => {
            walk(socket);
        }, 1000);
    });
}

function testVersion() {
    config.api.version = '5102';
    logger.info('Version', config.api.version);
    logger.info('Client Version', apihelper.versionToClientVersion(config.api.version));
    logger.info('iOS Version', apihelper.versionToiOSVersion(config.api.version));
}

function testReqId() {
    let client = new pogobuf.Client();
    for(let i = 0; i < 10; i++) {
        console.log('0x' + client.getRequestID().toString(16));
    }
}
