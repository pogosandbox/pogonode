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

const ptr8msgs = {
    '5300': '',
    '5301': '',
    '5302': 'e40c3e64817d9c96d99d28f6488a2efc40b11046',
    '5500': '7bb2d74dec0d8c5e132ad6c5491f72c9f19b306c',
}
console.log(ptr8msgs[5501]);