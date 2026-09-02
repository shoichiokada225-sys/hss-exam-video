// 本番URLの実地スモーク（実ブラウザ。動画ゲート・再生上限・SW登録・GAS疎通まで）
// 実行: node tests/prod-smoke.js [URL]
const fs = require('fs'); const path = require('path'); const os = require('os');
const URL_BASE = process.argv[2] || 'https://shoichiokada225-sys.github.io/hss-exam-video/';
const puppeteer = require(path.join(os.homedir(), 'elearn-e2e-tmp', 'node_modules', 'puppeteer-core'));
const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
const ver = fs.readdirSync(base).filter(d => d.startsWith('win64-')).sort().reverse()[0];
const CHROME = path.join(base, ver, 'chrome-win64', 'chrome.exe');
let ok = 0, ng = 0; const log = [];
const check = (n, c, x) => { if (c) ok++; else ng++; log.push((c ? 'OK  ' : 'NG  ') + n + (c || x === undefined ? '' : '  <- ' + JSON.stringify(x))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 420, height: 860, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', async d => { log.push('DIALOG: ' + d.message()); await d.accept(); });
  try {
    await p.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
    check('タイトル', (await p.title()).includes('HSS動画試験'));
    check('本試験カード 30問', (await p.$eval('#meta-q', e => e.textContent)).includes('30'));
    check('webhookUrl 設定済み', await p.evaluate(() => !!CONFIG.email.webhookUrl));
    // Service Worker 登録
    await p.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistrations().then(r => r.length), { timeout: 20000 }).catch(() => {});
    const swOk = await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length > 0);
    check('Service Worker 登録', swOk);
    // GAS の verify プローブ（JSONP）が通るか＝本番から記録先へ到達できる
    const gas = await p.evaluate(async () => {
      const url = CONFIG.email.webhookUrl + '?action=verify&id=__probe__&callback=cbTest';
      return await new Promise(res => {
        window.cbTest = v => res(JSON.stringify(v));
        const s = document.createElement('script'); s.src = url;
        s.onerror = () => res('ERROR'); document.head.appendChild(s);
        setTimeout(() => res('TIMEOUT'), 15000);
      });
    });
    check('GAS verify(JSONP) 疎通', /"recorded"/.test(gas), gas);
    // デモを1問だけ通す
    await p.click('#entry-demo'); await p.waitForFunction(() => document.querySelector('.screen.active').id === 'password-screen');
    await p.type('#exam-password', '123'); await p.click('#password-submit-btn');
    await p.waitForFunction(() => document.querySelector('.screen.active').id === 'exam-name-screen', { timeout: 10000 });
    await p.type('#exam-player-name', '本番スモーク');
    const t0 = Date.now();
    await p.click('#exam-start-btn');
    await p.waitForFunction(() => document.querySelector('.screen.active').id === 'quiz-screen', { timeout: 90000 });
    log.push(`  (動画3本の事前読込 ${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
    await sleep(300);
    let g = await p.evaluate(() => ({ gated: document.getElementById('q-options').classList.contains('gated'), btns: document.querySelectorAll('.option-btn').length, src: (document.getElementById('q-video').currentSrc || '').slice(0, 5), plays: document.getElementById('video-plays').textContent }));
    check('開始直後は選択肢なし(ゲート)', g.gated && g.btns === 0, g);
    check('動画はblob(事前読込)で再生', g.src === 'blob:', g);
    await p.click('#video-play-btn');
    await p.evaluate(() => { document.getElementById('q-video').playbackRate = 16; });
    await p.waitForFunction(() => document.getElementById('q-video').ended, { timeout: 30000 });
    await sleep(200);
    g = await p.evaluate(() => ({ gated: document.getElementById('q-options').classList.contains('gated'), btns: document.querySelectorAll('.option-btn').length }));
    check('見終わると選択肢4つ', !g.gated && g.btns === 4, g);
    // 多言語（vi）
    await p.select('#lang-selector', 'vi'); await sleep(300);
    check('vi 表示', /video|heo/i.test(await p.$eval('#q-label', e => e.textContent)));
    await p.select('#lang-selector', 'ja');
  } catch (e) { ng++; log.push('EXCEPTION: ' + (e.stack || e)); }
  check('コンソール/ページエラーなし', errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(log.join('\n')); console.log(`\n=== prod-smoke: OK ${ok} / NG ${ng} ===  ${URL_BASE}`);
  process.exit(ng ? 1 : 0);
})();
