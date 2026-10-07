// テスト共通: puppeteer-core と Chrome for Testing の場所（Windows / Mac 両対応）
//   puppeteer-core: ~/elearn-e2e-tmp/node_modules/puppeteer-core（npm i puppeteer-core で用意）
//   Chrome:         ~/.cache/puppeteer/chrome/<win64-*|mac_arm-*|mac-*>/…（npx @puppeteer/browsers install chrome@stable）
const fs = require('fs'); const path = require('path'); const os = require('os');
const puppeteer = require(path.join(os.homedir(), 'elearn-e2e-tmp', 'node_modules', 'puppeteer-core'));
function findChrome() {
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  const layouts = [
    ['win64-', ['chrome-win64', 'chrome.exe']],
    ['mac_arm-', ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing']],
    ['mac-', ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing']],
  ];
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : [];
  for (const [prefix, rel] of layouts) {
    for (const d of dirs.filter(x => x.startsWith(prefix))) {
      const p = path.join(base, d, ...rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Chrome for Testing が見つかりません: ' + base);
}
module.exports = { puppeteer, findChrome };
