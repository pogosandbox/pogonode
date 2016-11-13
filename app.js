require('dotenv').config({silent: true});

const pogobuf       = require('./pogobuf/pogobuf/pogobuf');
const POGOProtos    = require('node-pogo-protos');
const EventEmitter  = require('events');
const logger        = require('winston');
const fs            = require("fs");

const APIHelper = require("./apihelper");

logger.level = "debug";

var config = {
    credentials: {
        user: process.env.PTC_LOGIN,
        password: process.env.PTC_PASSWORD
    }
};

var state = {
    pos: {
        lat: 48.8456222,
        lng: 2.3364526
    },
    player: {},
    api: {
        version: "4500"
    }
};

class AppEvents extends EventEmitter {}
const App = new AppEvents();

var apihelper = new APIHelper(state);

var login = new pogobuf.PTCLogin();
var client = new pogobuf.Client();
client.setSignatureInfos({
    device_info: new POGOProtos.Networking.Envelopes.Signature.DeviceInfo({
        device_id: "3d65919ca1c2ec3a8e2bd7cc3f975c34",
        device_brand: "Apple",
        device_model: "iPhone",
        device_model_boot: "iPhone8,2",
        hardware_manufacturer: "Apple",
        hardware_model: "N66AP",
        firmware_brand: "iPhone OS",
        firmware_type: "9.3.5"
    })
});

logger.info("App starting...");

// logRequests = function(obj) {
//     if (obj.hasOwnProperty("requests")) {
//         var req = obj.requests.filter(r => r.name != "");
//         req.forEach(logger.debug);
//     } else if (obj.hasOwnProperty("responses")) {
//         var res = obj.responses.filter(r => r.name != "Get Asset Digest" && r.name != "Get Item Templates");
//         res.forEach(logger.debug);
//     }
// }

login.login(config.credentials.user, config.credentials.password).then(token => {
    client.setAuthInfo('ptc', token);
    client.setPosition(state.pos.lat, state.pos.lng);

    // client.on('request', logRequests);
    // client.on('response', logRequests);

    return client.init();
}).then(responses => {
    apihelper.parse(responses);

    logger.info("Logged In");
    
    // download config version like the real app
    var batch = client.batchStart();
    batch.downloadRemoteConfigVersion("IOS", state.api.version);
    apihelper.always(batch);
    return batch.batchCall();
}).then(responses => {
    apihelper.parse(responses);

    var batch = client.batchStart();
    batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, "Apple", "iPhone", "en", +state.api.version)
    apihelper.always(batch);
    return batch.batchCall();
}).then(responses => {
    apihelper.parse(responses);

    // check if item_templates need download

    App.emit("apiReady");
});

App.on("apiReady", () => {
    logger.info("App ready");

    fs.writeFile("data/state.json", JSON.stringify(state), (err) => {});
});
