const fs = require('fs');
const yaml = require('js-yaml');
const logger = require('winston');
const pogobuf = require('./pogobuf/pogobuf/pogobuf');

logger.level = 'debug';

let config = yaml.safeLoad(fs.readFileSync('data/config.yaml', 'utf8'));
let state = JSON.parse(fs.readFileSync('data/state.old.1.json', 'utf8'));

state.map.pokestops.splice(2);

const Walker = require('./walker');
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
