require('dotenv').config({silent: true});

const pogobuf       = require('./pogobuf/pogobuf/pogobuf');
const POGOProtos    = require('node-pogo-protos');
const EventEmitter  = require('events');
const logger        = require('winston');
const fs            = require("fs");
const yaml          = require('js-yaml');
const Promise       = require('bluebird');

const APIHelper = require("./apihelper");

var config = {
    credentials: {
        user: "",
        password: ""
    },
    pos: {
        lat: 48.8456222,
        lng: 2.3364526
    },
    device: { id: 0 },
    loglevel: "debug"
};

if (fs.existsSync("data/config.yaml")) {
    var loaded = yaml.safeLoad(fs.readFileSync("data/config.yaml", 'utf8'));
    config = Object.assign(config, loaded);
}
logger.level = config.loglevel;

if (!config.device.id) {
    config.device.id = (new Array(40)).fill(0).map(i => "0123456789abcdef"[Math.floor(Math.random()*16)]).join("");
}

fs.writeFileSync("data/config.yaml", yaml.dump(config));

if (!config.credentials.user) {
    logger.error("Invalid credentials. Please fill data/config.yaml.")
    process.exit();
}

var state = {
    pos: {
        lat: config.pos.lat,
        lng: config.pos.lng
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

client.setSignatureInfos(function() {
    return {
        device_info: new POGOProtos.Networking.Envelopes.Signature.DeviceInfo({
            device_id: config.device.id,
            device_brand: "Apple",
            device_model: "iPhone",
            device_model_boot: "iPhone8,2",
            hardware_manufacturer: "Apple",
            hardware_model: "N66AP",
            firmware_brand: "iPhone OS",
            firmware_type: "9.3.5"
        })
    };
});

logger.info("App starting...");

login.login(config.credentials.user, config.credentials.password).then(token => {
    client.setAuthInfo('ptc', token);
    client.setPosition(state.pos.lat, state.pos.lng);

    // client.on('request', console.log);
    // client.on('response', console.log);

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
    batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, "Apple", "iPhone", "en", +state.api.version);
    apihelper.always(batch);
    return batch.batchCall();

}).then(responses => {
    apihelper.parse(responses);

    // check if item_templates need download
    var last = 0;
    if (fs.existsSync("data/item_templates.json")) {
        var json = fs.readFileSync("data/item_templates.json", { encoding: "utf8" });
        state.item_templates = JSON.parse(json);
        last = state.item_templates.timestamp_ms;
    }

    if (last < state.api.item_templates_timestamp) {
        var batch = client.batchStart();
        batch.downloadItemTemplates();
        apihelper.always(batch);
        return batch.batchCall().then(resp => {
                   apihelper.parse(resp);
               }).then(() => {
                   fs.writeFile("data/item_templates.json", JSON.stringify(state.item_templates), (err) => {});
               });
    } else {
        return Promise.resolve();
    }

}).then(() => {
    App.emit("apiReady");

}).catch(e => {
    logger.error(e);

});

App.on("apiReady", () => {
    logger.info("App ready");
    App.emit("saveState");
    setInterval(() => App.emit("mapRefresh"), 10*1000);
});

App.on("mapRefresh", () => {
    logger.info("Map Refresh", { pos: state.pos });
    var cellIDs = pogobuf.Utils.getCellIDs(state.pos.lat, state.pos.lng);

    var batch = client.batchStart();
    batch.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
    apihelper.always(batch);
    batch.batchCall().then(responses => {
        apihelper.parse(responses);
        App.emit("saveState");
    });
});

App.on("saveState", () => {
    fs.writeFile("data/state.json", JSON.stringify(state, null, 4), (err) => {});
})