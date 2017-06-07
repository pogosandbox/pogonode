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
const _ = require("lodash");
const logger = require("winston");
const fs = require("mz/fs");
const api_1 = require("./api");
/**
 * Helper class to deal with our walker.
 */
class Assets {
    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new api_1.default(config, state);
        this.cache = {};
    }
    loadFromDisk() {
        return __awaiter(this, void 0, void 0, function* () {
            if (fs.existsSync('data/assets.json')) {
                let content = yield fs.readFile('data/assets.json', 'utf8');
                this.cache = JSON.parse(content);
            }
        });
    }
    saveToDisk() {
        return __awaiter(this, void 0, void 0, function* () {
            yield fs.writeFile('data/assets.json', JSON.stringify(this.cache, null, 4), 'utf8');
        });
    }
    withoutVersion(id) {
        let idx = id.indexOf('/');
        if (idx > 0)
            id = id.substring(0, idx);
        return id;
    }
    /**
     * If necessary, get download urls of tranlation assets
     */
    getTranslationUrls() {
        return __awaiter(this, void 0, void 0, function* () {
            let digest = this.state.api.asset_digest;
            let assets = [];
            let cached;
            let general = _.find(digest, d => d.bundle_name === 'i18n_general');
            cached = this.cache[this.withoutVersion(general.asset_id)];
            if (!cached || cached !== general.version)
                assets.push(general.asset_id);
            let modes = _.find(digest, d => d.bundle_name === 'i18n_moves');
            cached = this.cache[this.withoutVersion(modes.asset_id)];
            if (!cached || cached !== modes.version)
                assets.push(modes.asset_id);
            let items = _.find(digest, d => d.bundle_name === 'i18n_items');
            cached = this.cache[this.withoutVersion(items.asset_id)];
            if (!cached || cached !== items.version)
                assets.push(items.asset_id);
            if (assets.length > 0) {
                logger.debug('Get translation urls...');
                yield this.downloadAssets(assets);
            }
        });
    }
    getAssetsForPokemons() {
        return __awaiter(this, void 0, void 0, function* () {
            let digest = this.state.api.asset_digest;
            let pokemons = this.state.map.catchable_pokemons.map(p => p.pokemon_id);
            pokemons = _.uniq(pokemons);
            let assets = [];
            for (let pokemon of pokemons) {
                let asset = _.find(digest, d => d.bundle_name.startsWith('pm' + _.padStart(pokemon, 4, '0')));
                let cached = this.cache[this.withoutVersion(asset.asset_id)];
                if (!cached || cached !== asset.version)
                    assets.push(asset.asset_id);
            }
            if (assets.length > 0) {
                logger.debug('Download assets...');
                yield this.downloadAssets(assets);
            }
        });
    }
    downloadAssets(assets) {
        return __awaiter(this, void 0, void 0, function* () {
            if (assets.length > 0) {
                let client = this.state.client;
                let batch = client.batchStart();
                batch.getDownloadURLs(assets);
                this.apihelper.always(batch, { settings: true, nobuddy: true });
                let response = yield batch.batchCall();
                let info = this.apihelper.parse(response);
                let urls = info.download_urls;
                _.each(urls, url => {
                    this.cache[this.withoutVersion(url.asset_id)] = url.asset_id.substring(url.asset_id.indexOf('/') + 1);
                });
                yield this.saveToDisk();
            }
        });
    }
}
exports.default = Assets;
//# sourceMappingURL=assets.js.map