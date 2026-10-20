'use strict';
// The browser build cannot read package.json, so its version is written in host.js.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const pkg = require('../package.json');
const host = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'host.js'), 'utf8');
const m = host.match(/const WEB_APP_VERSION = '([^']+)'/);
assert.ok(m, 'WEB_APP_VERSION found in renderer/js/host.js');
assert.equal(m[1], pkg.version, 'renderer/js/host.js WEB_APP_VERSION must match package.json version');
console.log(`  ✓ browser build version matches package.json (${pkg.version})`);
