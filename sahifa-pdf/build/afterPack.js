'use strict';
// Ad-hoc signs the macOS app before it is zipped or put into a DMG.
//
// Apple Silicon Macs refuse to run apps without a valid signature ("damaged and
// can't be opened"), and electron-builder only signs when a paid Apple Developer
// certificate is configured. An ad-hoc signature is free and makes the app run;
// Gatekeeper still asks the user to confirm the first launch because the app is
// not notarized.
//
// On a Mac this uses Apple's `codesign`. On Linux set RCODESIGN to the path of
// rcodesign (https://github.com/indygreg/apple-platform-rs) to do the same.

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return; // a real certificate will be used instead
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  } else if (process.env.RCODESIGN) {
    execFileSync(process.env.RCODESIGN, ['sign', app], { stdio: 'pipe' });
  } else {
    console.warn('  • macOS app NOT signed: build on a Mac, or set RCODESIGN to the rcodesign binary');
    return;
  }
  console.log(`  • ad-hoc signed  ${path.basename(app)}`);
};
