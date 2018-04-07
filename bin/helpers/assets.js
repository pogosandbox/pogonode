"use strict";
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
    async loadFromDisk() {
        if (fs.existsSync('data/assets.json')) {
            const content = await fs.readFile('data/assets.json', 'utf8');
            this.cache = JSON.parse(content);
        }
    }
    async saveToDisk() {
        await fs.writeFile('data/assets.json', JSON.stringify(this.cache, null, 4), 'utf8');
    }
    withoutVersion(id) {
        const idx = id.indexOf('/');
        if (idx > 0)
            id = id.substring(0, idx);
        return id;
    }
    getFullIdFromId(id) {
        const digest = this.state.api.asset_digest;
        const asset = _.find(digest, d => d.asset_id.startsWith(id));
        return asset.asset_id;
    }
    /**
     * If necessary, get download urls of tranlation assets
     */
    async getTranslationUrls() {
        const digest = this.state.api.asset_digest;
        const assets = [];
        let cached;
        const general = _.find(digest, d => d.bundle_name === 'i18n_general');
        cached = this.cache[this.withoutVersion(general.asset_id)];
        if (!cached || +cached !== general.version)
            assets.push(general.asset_id);
        const modes = _.find(digest, d => d.bundle_name === 'i18n_moves');
        cached = this.cache[this.withoutVersion(modes.asset_id)];
        if (!cached || +cached !== modes.version)
            assets.push(modes.asset_id);
        const items = _.find(digest, d => d.bundle_name === 'i18n_items');
        cached = this.cache[this.withoutVersion(items.asset_id)];
        if (!cached || +cached !== items.version)
            assets.push(items.asset_id);
        if (assets.length > 0) {
            logger.debug('Get translation urls...');
            await this.downloadAssets(assets, { nobuddy: true, noinbox: true, noquest: true });
        }
    }
    async getAssetsForPokemons() {
        const digest = this.state.api.asset_digest;
        let pokemons = this.state.map.catchable_pokemons.map(p => p.pokemon_id);
        pokemons = _.uniq(pokemons);
        const assets = [];
        for (const pokemon of pokemons) {
            const asset = _.find(digest, d => d.bundle_name.startsWith('pm' + _.padStart(pokemon.toString(), 4, '0')));
            const cached = this.cache[this.withoutVersion(asset.asset_id)];
            if (!cached || +cached !== asset.version) {
                assets.push(asset.asset_id);
            }
        }
        if (assets.length > 0) {
            logger.debug('Download assets...');
            await this.downloadAssets(assets);
        }
    }
    async downloadAssets(assets, commons = {}) {
        if (assets.length > 0) {
            const client = this.state.client;
            const batch = client.batchStart();
            batch.getDownloadURLs(assets);
            this.apihelper.always(batch, commons);
            const response = await batch.batchCall();
            const info = this.apihelper.parse(response);
            const urls = info.download_urls;
            _.each(urls, url => {
                this.cache[this.withoutVersion(url.asset_id)] = url.asset_id.substring(url.asset_id.indexOf('/') + 1);
            });
            await this.saveToDisk();
        }
    }
}
exports.default = Assets;
//# sourceMappingURL=assets.js.map