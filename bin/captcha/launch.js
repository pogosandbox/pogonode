"use strict";
const fs = require("fs");
const captcha_helper_1 = require("./captcha.helper");
let config = require('./helpers/config').load();
let state = JSON.parse(fs.readFileSync('data/state.json', 'utf8'));
let url = 'https://pgorelease.nianticlabs.com/plfe/191/captcha/E83DBA71F8C4DBC68A62FBF208C9B046';
let helper = new captcha_helper_1.default(config, state);
helper
    .solveCaptchaManual(url)
    .then(token => {
    console.log('Token: ' + token);
    console.log('Done.');
});
//# sourceMappingURL=launch.js.map