const pogobuf = require('./pogobuf/pogobuf/pogobuf');
const logger = require('winston');

function APIHelper(state) {
    this.state = state;
}

APIHelper.prototype.always = function(batch) {
    return batch.checkChallenge()
                .getHatchedEggs()
                .getInventory(this.state.api.inventory_timestamp)
                .checkAwardedBadges()
                .downloadSettings(this.state.api.settings_hash);
}

APIHelper.prototype.parse = function(responses) {
    responses.forEach(r => {
        if (r.player_data) {
            // getPlayer()
            this.state.player = r.player_data;
            this.state.player.banned = r.banned;
            this.state.player.warn = r.warn;

        } else if (r.egg_km_walked) {
            // getHatchedEggs()
            console.dir(r, { depth: 4 });
            for(var stardust in r.stardust_awarded) {
                //this.state.inventory.player.
            }
            for (var xp in r.experience_awarded) {
                this.state.inventory.player.experience += xp;
            }
            for (var candy in r.candy_awarded) {
                
            }

        } else if (r.inventory_delta) {
            // getInventory()
            this.state.api.inventory_timestamp = r.inventory_delta.new_timestamp_ms;
            if (!this.state.hasOwnProperty("inventory")) {
                this.state.inventory = pogobuf.Utils.splitInventory(r);
            } else if (r.inventory_delta.inventory_items.length > 0) {
                console.log("---");
                console.dir(r.inventory_delta, { depth: 4 });
                var inventory = pogobuf.Utils.splitInventory(r);
                console.dir(inventory, { depth: 4 });
                console.log("---");
            }
            // inventory = pogobuf.Utils.splitInventory(r);
            // for (var k in inventory) {
            //     if (!this.state.inventory.hasOwnProperty(k)) {
            //         this.state.inventory[k] = inventory[k];
            //     } else {

            //     }
            // }
            // this.state.inventory = inventory;
            // console.dir(inventory, { depth: 4 });

        } else if (r.awarded_badges) {
            // checkAwardedBadges()
            console.dir(r, { depth: 4 });

        } else if (r.hash) {
            // downloadSettings()
            this.state.api.settings_hash = r.hash;

        } else if (r.item_templates_timestamp_ms) {
            // downloadRemoteConfigVersion()
            this.state.api.item_templates_timestamp = r.item_templates_timestamp_ms;

        } else if (r.hasOwnProperty("show_challenge")) {
            // checkChallenge()
            if (r.show_challenge) logger.error("Challenge!", { challenge_url: r.challenge_url });

        } else if (r.hasOwnProperty("digest")) {
            // getAssetDigest()

        } else if (r.item_templates) {
            // downloadItemTemplates()
            this.state.item_templates = r.item_templates;

        } else {
            logger.warn("unhandled");
            logger.warn(r);
            
        }
    });
}

module.exports = APIHelper;
