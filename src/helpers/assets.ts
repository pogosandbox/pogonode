import * as pogobuf from '../../pogobuf';
import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as logger from 'winston';
import * as fs from 'mz/fs';

import APIHelper from './api';

/**
 * Helper class to deal with our walker.
 */
export default class Assets {
    config: any;
    state: any;
    cache: any;
    apihelper: APIHelper;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.apihelper = new APIHelper(config, state);
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

    withoutVersion(id: string): string {
        const idx = id.indexOf('/');
        if (idx > 0) id = id.substring(0, idx);
        return id;
    }

    getFullIdFromId(id: string): string {
        const digest: any[] = this.state.api.asset_digest;
        const asset = _.find(digest, d => d.asset_id.startsWith(id));
        return asset.asset_id;
    }

    /**
     * If necessary, get download urls of tranlation assets
     */
    async getTranslationUrls() {
        const digest: any[] = this.state.api.asset_digest;
        const assets: string[] = [];
        let cached: any;

        const general = _.find(digest, d => d.bundle_name === 'i18n_general');
        cached = this.cache[this.withoutVersion(general.asset_id)];
        if (!cached || +cached !== general.version) assets.push(general.asset_id);

        const modes = _.find(digest, d => d.bundle_name === 'i18n_moves');
        cached = this.cache[this.withoutVersion(modes.asset_id)];
        if (!cached || +cached !== modes.version) assets.push(modes.asset_id);

        const items = _.find(digest, d => d.bundle_name === 'i18n_items');
        cached = this.cache[this.withoutVersion(items.asset_id)];
        if (!cached || +cached !== items.version) assets.push(items.asset_id);

        if (assets.length > 0) {
            logger.debug('Get translation urls...');
            await this.downloadAssets(assets, { settings: true, nobuddy: true, noinbox: true });
        }
    }

    async getAssetsForPokemons() {
        const digest: any[] = this.state.api.asset_digest;
        let pokemons: number[] = this.state.map.catchable_pokemons.map(p => p.pokemon_id);
        pokemons = _.uniq(pokemons);

        const assets: string[] = [];
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

    async downloadAssets(assets: string[], commons = {}) {
        if (assets.length > 0) {
            const client: pogobuf.Client = this.state.client;
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
