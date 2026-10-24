"use strict";
const { glob, globSync } = require("tinyglobby");
const { isAbsolute } = require("node:path");

const trimDirectories = (entries, options) => (options.onlyDirectories ? entries.map((entry) => entry.replace(/\/$/, "")) : entries);

function sync(patterns, options = {}) {
  return trimDirectories(globSync(patterns, { expandDirectories: false, absolute: [patterns].flat().every(isAbsolute), ...options }), options);
}

async function fastGlob(patterns, options = {}) {
  return trimDirectories(await glob(patterns, { expandDirectories: false, absolute: [patterns].flat().every(isAbsolute), ...options }), options);
}

fastGlob.sync = sync;
fastGlob.globSync = sync;
fastGlob.glob = fastGlob;
fastGlob.async = fastGlob;
fastGlob.default = fastGlob;
module.exports = fastGlob;
