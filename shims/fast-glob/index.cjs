"use strict";
// 이 파일은 fast-glob CommonJS 호환 shim이므로 require와 module.exports를 의도적으로 사용한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { glob, globSync } = require("tinyglobby");

const trimDirectories = (entries, options) => (options.onlyDirectories ? entries.map((entry) => entry.replace(/\/$/, "")) : entries);

function sync(patterns, options = {}) {
  return trimDirectories(globSync(patterns, { expandDirectories: false, ...options }), options);
}

async function fastGlob(patterns, options = {}) {
  return trimDirectories(await glob(patterns, { expandDirectories: false, ...options }), options);
}

fastGlob.sync = sync;
fastGlob.globSync = sync;
fastGlob.glob = fastGlob;
fastGlob.async = fastGlob;
fastGlob.default = fastGlob;
module.exports = fastGlob;
