"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require("winston");
const fs = require("fs-promise");
const _ = require("lodash");
const moment = require("moment");
const POGOProtos = require("node-pogo-protos");
const pcrypt = require("pcrypt");
const api_1 = require("./helpers/api");
const walker_1 = require("./helpers/walker");
const pogobuf = require("../pogobuf");
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    'timestamp': function () {
        return moment().format('HH:mm:ss');
    },
    'colorize': true,
    'level': 'debug',
});
let config = require('./helpers/config').load();
let state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));
let apihelper = new api_1.default(config, state);
let walker = new walker_1.default(config, state);
function testVersion(version) {
    logger.info('Version', version);
    logger.info('Client Version', apihelper.versionToClientVersion(version));
    logger.info('iOS Version', apihelper.versionToiOSVersion(version));
}
function testRequestIds() {
    let client = new pogobuf.Client();
    for (let i = 0; i < 10; i++) {
        let id = client.getRequestID();
        logger.info('%s', id.toString(16));
    }
}
function testDecrypt() {
    return __awaiter(this, void 0, void 0, function* () {
        let data = yield fs.readFile('1491321098799.req.raw.bin');
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
    });
}
testDecrypt();
//# sourceMappingURL=debug.js.map