'use strict';
const path = require('node:path');
const { inspectPackage } = require('../scripts/package-resources.cjs');
const packed = process.argv[2] || path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
console.log('P0_PACKAGE_PASS: ' + JSON.stringify(inspectPackage(path.resolve(packed), process.argv[3] || 'release')));
