import * as logger from 'winston';
import * as fs from 'fs-promise';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as POGOProtos from 'node-pogo-protos';
import * as pcrypt from 'pcrypt';

import APIHelper from './helpers/api';
import Walker from './helpers/walker';

import * as pogobuf from '../pogobuf';

logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': function() {
        return moment().format('HH:mm:ss');
    },
    'colorize': true,
    'level': 'debug',
});

let config = require('./helpers/config').load();
let state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));

let apihelper = new APIHelper(config, state);
let walker = new Walker(config, state);

function testVersion(version) {
    logger.info('Version', version);
    logger.info('Client Version', apihelper.versionToClientVersion(version));
    logger.info('iOS Version', apihelper.versionToiOSVersion(version));
}

function testRequestIds() {
    let client = new pogobuf.Client();
    for (let i = 0; i < 10; i++) {
        let id = (<any>client).getRequestID();
        logger.info('%s', id.toString(16));
    }
}

async function testDecrypt() {
    let data = await fs.readFile('1491321098799.req.raw.bin');
    let request = POGOProtos.Networking.Envelopes.RequestEnvelope.decode(data);
    _.each(request.platform_requests, req => {
        let reqname = _.findKey(POGOProtos.Networking.Platform.PlatformRequestType, r => r === req.type);
        if (reqname) {
            logger.info('Request', reqname);
            reqname = _.upperFirst(_.camelCase(reqname)) + 'Request';
            let requestType = POGOProtos.Networking.Platform.Requests[reqname];
            if (requestType) {
                let decoded = requestType.decode(req.request_message);
                if (req.type === POGOProtos.Networking.Platform.PlatformRequestType.SEND_ENCRYPTED_SIGNATURE) {
                    // decrypt signature
                    let buffer = decoded.encrypted_signature.toBuffer();
                    let decrypted = pcrypt.decrypt(buffer);
                    let signature = POGOProtos.Networking.Envelopes.Signature.decode(decrypted);
                }
            }
        }
    });
}

testDecrypt();