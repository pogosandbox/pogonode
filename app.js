require('dotenv').config({silent: true});

//const pogobuf         = require('./pogobuf/pogobuf/pogobuf');
const pogobuf         = require('pogobuf');
const POGOProtos      = require('node-pogo-protos');
const EventEmitter    = require('events');
const logger          = require('winston');
const fs              = require("fs");
const yaml            = require('js-yaml');
const Promise         = require('bluebird');
const _               = require('lodash');

const APIHelper       = require("./api.helper");
const Walker          = require("./walker");
const ProxyHelper     = require("./proxy.helper");
const signaturehelper = require("./signature.helper");

var config = {
    credentials: {
        user: "",
        password: ""
    },
    pos: {
        lat: 48.8456222,
        lng: 2.3364526
    },
    speed: 5,
    gmapKey: "",
    device: { id: 0 },
    api: {
        version: "4500",
        clientversion: "0.45.0",
        checkversion: true,
        country: "US",
        language: "en"
    },
    loglevel: "info"
};

if (fs.existsSync("data/config.yaml")) {
    var loaded = yaml.safeLoad(fs.readFileSync("data/config.yaml", 'utf8'));
    config = _.defaultsDeep(loaded, config);
}
logger.level = config.loglevel;

if (!config.device.id) {
    config.device.id = _.times(32, () => "0123456789abcdef"[Math.floor(Math.random()*16)]).join("")
}

fs.writeFileSync("data/config.actual.yaml", yaml.dump(config));

if (!config.credentials.user) {
    logger.error("Invalid credentials. Please fill data/config.yaml.")
    process.exit();
}

var state = {
    pos: {
        lat: config.pos.lat,
        lng: config.pos.lng
    },
    api: {},
    player: {},
    path: {
        visited_pokestops: [],
        waypoints: []
    }
};

class AppEvents extends EventEmitter {}
const App = new AppEvents();

var apihelper = new APIHelper(config, state);
var walker = new Walker(config, state);
var proxyhelper = new ProxyHelper(config, state);

var login = new pogobuf.PTCLogin();
var client = new pogobuf.Client();
state.client = client;

signaturehelper.register(config, client);

logger.info("App starting...");

proxyhelper.checkProxy().then(valid => {
    if (config.proxy) {
        if (valid) {
            login.setProxy(proxyhelper.proxy);
            client.setProxy(proxyhelper.proxy);
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = 1;
        } else {
            throw new Error("Invalid proxy. Exiting.")
        }
    }
    logger.info("Login...");
    return login.login(config.credentials.user, config.credentials.password);

}).then(token => {
    logger.debug("Token: %s", token);
    client.setAuthInfo('ptc', token);
    client.setPosition(state.pos.lat, state.pos.lng);

    // client.on('request', console.log);
    // client.on('response', console.log);

}).then(() => {
    return client.init(false);

}).then(() => {
    return client.batchStart()
                 .getPlayer(config.api.country, config.api.language, config.api.timezone)
                 .batchCall();

}).then(responses => {
    apihelper.parse(responses);

    logger.info("Logged In.");
    logger.info("Starting initial flow...");
    
    // download config version like the real app
    var batch = client.batchStart();
    batch.downloadRemoteConfigVersion("IOS", config.api.version);
    return apihelper.alwaysinit(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);

    var batch = client.batchStart();
    batch.getAssetDigest(POGOProtos.Enums.Platform.IOS, undefined, undefined, undefined, +config.api.version);
    return apihelper.alwaysinit(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);

    // check if item_templates need download
    var last = 0;
    if (fs.existsSync("data/item_templates.json")) {
        var json = fs.readFileSync("data/item_templates.json", { encoding: "utf8" });
        state.api.item_templates = JSON.parse(json);
        last = state.api.item_templates.timestamp_ms;
    }

    if (last < state.api.item_templates_timestamp) {
        var batch = client.batchStart();
        batch.downloadItemTemplates();
        return apihelper.alwaysinit(batch)
                .batchCall().then(resp => {
                    apihelper.parse(resp);
                }).then(() => {
                    fs.writeFile("data/item_templates.json", JSON.stringify(state.api.item_templates), (err) => {});
                });
    } else {
        return Promise.resolve();
    }

}).then(() => {
    var batch = client.batchStart();
    batch.getPlayerProfile();
    return apihelper.always(batch).batchCall();

}).then(responses => {
    apihelper.parse(responses);
    var batch = client.batchStart();
    batch.levelUpRewards(state.inventory.player.level);
    return apihelper.always(batch).batchCall();
 
}).then(responses => {
    apihelper.parse(responses);
    App.emit("saveState");
    App.emit("apiReady");

}).catch(e => {
    logger.error(e);
    if (e.message.indexOf("tunneling socket could not be established") > 0) proxyhelper.badProxy();

});

App.on("apiReady", () => {
    logger.info("Initial flow done.");
    App.emit("saveState");
    setInterval(() => App.emit("updatePos"), 1000);
    setTimeout(() => App.emit("mapRefresh"), Math.random()*2*1000);
});

App.on("updatePos", () => {
    if (state.map) {
        walker
            .checkPath()
            .then(walker.walk)
            .then(() => {
                //
            });
    }
});

App.on("mapRefresh", () => {
    logger.info("Map Refresh", { pos: state.pos });
    var cellIDs = pogobuf.Utils.getCellIDs(state.pos.lat, state.pos.lng);

    var batch = client.batchStart();
    batch.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
    apihelper.always(batch).batchCall().then(responses => {
        apihelper.parse(responses);

    }).then(() => {
        // spin pokestop that are close enough
        var stops = walker.findSpinnablePokestops();
        if (stops.length > 0) {
            logger.debug("begin spin");
            return Promise.map(stops, ps => {
                batch = client.batchStart();
                batch.fortSearch(ps.id, ps.latitude, ps.longitude);
                return batch.batchCall().then(responses => {
                    logger.debug("after spin");
                    apihelper.parse(responses);
                    return Promise.resolve();
                }).delay(1500);
            },  {concurrency: 1});
        } else {
            return Promise.resolve(0);
        }

    }).then(done => {
        // catch available pokemon
        if (done) logger.debug("after all spin");

    }).then(() => {
        App.emit("saveState");

    }).catch(e => {
        logger.error(e);
        // e.status_code == 102
        // detect token expiration

    }).finally(() => {
        var timeout = (state.download_settings.map_settings.get_map_objects_min_refresh_seconds + Math.random()*2)*1000
        setTimeout(() => {
            App.emit("mapRefresh");
        }, timeout); // 10s when moving, 30s if static

    });
});

App.on("saveState", () => {
    fs.writeFile("data/state.json", JSON.stringify(state, null, 4), (err) => {});
});
