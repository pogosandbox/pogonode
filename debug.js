const fs = require('fs');
const logger = require('winston');
// const pogobuf = require('./pogobuf/pogobuf/pogobuf');

logger.level = 'debug';

let config = require('./helpers/config').load();
let state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));

state.map.pokestops.splice(2);

const APIHelper = require('./helpers/api');
let apihelper = new APIHelper(config, state);

const Walker = require('./helpers/walker');
let walker = new Walker(config, state);

// const ProxyHelper = require('./proxy.helper');
// let proxyhelper = new ProxyHelper(config, state);

// function testProxies() {
//     proxyhelper.testProxy().then(valid => {
//         logger.info(valid);
//     });
// }

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

config.api.version = '4910';
logger.info('Version', config.api.version);
logger.info('iOS Version', apihelper.versionToHashVersion(config.api.version));
