// Drop-in replacement for the deprecated lodash.isequal, used only via package.json's
// "overrides" to satisfy electron-updater's `require("lodash.isequal")` — see the plan/CHANGELOG
// for why this is safe for that specific call site (plain JSON-like update-manifest comparisons).
module.exports = require('node:util').isDeepStrictEqual;
