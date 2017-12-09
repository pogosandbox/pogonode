"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require("winston");
const fs = require("mz/fs");
const moment = require("moment");
const POGOProtos = require("node-pogo-protos-vnext");
const long = require("long");
const pogobuf = require("pogobuf-vnext");
const api_1 = require("./helpers/api");
const walker_1 = require("./helpers/walker");
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': () => moment().format('HH:mm:ss'),
    'colorize': true,
    'level': 'debug',
});
const config = require('./helpers/config').load();
const state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));
const apihelper = new api_1.default(config, state);
const walker = new walker_1.default(config, state);
function testVersion(version) {
    logger.info('Version', version);
    logger.info('Client Version', apihelper.versionToClientVersion(version));
    logger.info('iOS Version', apihelper.versionToiOSVersion(version));
}
function testRequestIds() {
    const client = new pogobuf.Client();
    for (let i = 0; i < 10; i++) {
        const id = client.getRequestID();
        logger.info('%s', id.toString(16));
    }
}
function testUK25() {
    const uk25 = long.fromString('11fdf018c941ef22', false, 16);
    console.log(uk25.toString());
}
async function testDecode() {
    try {
        const content = await fs.readFile('error_body.bin');
        const response = POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(content);
    }
    catch (e) {
        console.error(e);
    }
}
testUK25();
//# sourceMappingURL=debug.js.map