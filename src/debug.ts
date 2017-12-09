import * as logger from 'winston';
import * as fs from 'mz/fs';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as POGOProtos from 'node-pogo-protos-vnext';
import * as long from 'long';
import * as pogobuf from 'pogobuf-vnext';

import APIHelper from './helpers/api';
import Walker from './helpers/walker';

logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': () => moment().format('HH:mm:ss'),
    'colorize': true,
    'level': 'debug',
});

const config = require('./helpers/config').load();
const state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));

const apihelper = new APIHelper(config, state);
const walker = new Walker(config, state);

function testVersion(version) {
    logger.info('Version', version);
    logger.info('Client Version', apihelper.versionToClientVersion(version));
    logger.info('iOS Version', apihelper.versionToiOSVersion(version));
}

function testRequestIds() {
    const client = new pogobuf.Client();
    for (let i = 0; i < 10; i++) {
        const id = (<any>client).getRequestID();
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
    } catch (e) {
        console.error(e);
    }
}

testUK25();