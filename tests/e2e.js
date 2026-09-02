// hss-exam-video 実地テスト（puppeteer-core + Chrome for Testing）
// 実行: node tests/e2e.js
// 前提: ~/elearn-e2e-tmp/node_modules/puppeteer-core と ~/.cache/puppeteer/chrome/<ver>/chrome-win64/chrome.exe
// 静的サーバは本スクリプト内で起動する（ポート 8791）
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8791;
const PPT_DIR = path.join(os.homedir(), 'elearn-e2e-tmp', 'node_modules', 'puppeteer-core');
const puppeteer = require(PPT_DIR);
function findChrome(){
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  const vers = fs.readdirSync(base).filter(d => d.startsWith('win64-')).sort().reverse();
  for(const v of vers){ const p = path.join(base, v, 'chrome-win64', 'chrome.exe'); if(fs.existsSync(p)) return p; }
  throw new Error('Chrome for Testing が見つかりません: ' + base);
}
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.mp4':'video/mp4', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if(u.endsWith('/')) u += 'index.html';
      const fp = path.join(ROOT, u);
      if(!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()){ r.writeHead(404); r.end(); return; }
      const ext = path.extname(fp);
      const stat = fs.statSync(fp);
      const range = req.headers.range;
      if(range && ext === '.mp4'){   // <video> の Range 要求に応える（本番 GitHub Pages と同じ挙動）
        const m = /bytes=(\d+)-(\d*)/.exec(range); const s = +m[1]; const e = m[2] ? +m[2] : stat.size - 1;
        r.writeHead(206, { 'Content-Type': MIME[ext], 'Content-Range': `bytes ${s}-${e}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
        fs.createReadStream(fp, { start: s, end: e }).pipe(r); return;
      }
      r.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      fs.createReadStream(fp).pipe(r);
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

let pass = 0, failN = 0;
const results = [];
function check(name, cond, extra){ const okk = !!cond; if(okk) pass++; else failN++; results.push((okk ? 'OK  ' : 'NG  ') + name + (extra !== undefined && !okk ? '  <- ' + JSON.stringify(extra) : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sha256(page, s){ return page.evaluate(async s => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }, s); }
async function screen(page){ return page.evaluate(() => document.querySelector('.screen.active').id); }
async function gated(page){ return page.evaluate(() => ({ gated: document.getElementById('q-options').classList.contains('gated'), btns: document.querySelectorAll('.option-btn').length, note: !document.getElementById('video-gate-note').classList.contains('hidden'), playBtn: document.getElementById('video-play-btn').textContent, playDisabled: document.getElementById('video-play-btn').disabled, plays: document.getElementById('video-plays').textContent, src: (document.getElementById('q-video').currentSrc || '').slice(0, 5) })); }
async function playToEnd(page){
  await page.click('#video-play-btn');
  await page.evaluate(() => { const v = document.getElementById('q-video'); v.playbackRate = 16; });   // テスト短縮（ゲートは ended イベントで判定）
  await page.waitForFunction(() => document.getElementById('q-video').ended, { timeout: 15000 });
  await sleep(100);
}
async function enterAndStart(page, mode, pw, name){
  await page.click(mode === 'demo' ? '#entry-demo' : '#entry-exam');
  await page.waitForFunction(() => document.querySelector('.screen.active').id === 'password-screen');
  await page.type('#exam-password', pw);
  await page.click('#password-submit-btn');
  await page.waitForFunction(() => document.querySelector('.screen.active').id === 'exam-name-screen', { timeout: 5000 });
  await page.type('#exam-player-name', name);
  await page.click('#exam-start-btn');
  await page.waitForFunction(() => document.querySelector('.screen.active').id === 'quiz-screen', { timeout: 30000 });
  await sleep(200);
}

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 860, isMobile: true, hasTouch: true });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', async d => { results.push('DIALOG(' + d.type() + '): ' + d.message()); if(d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); });   // 試験中リロードの離脱警告は accept して進む
  const URL = `http://127.0.0.1:${PORT}/`;
  const demoQs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo-questions.json'), 'utf8'));
  const examQs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8'));

  try {
    // ---------- 1. ホーム ----------
    await page.goto(URL, { waitUntil: 'networkidle0' });
    check('タイトルが動画試験', (await page.title()).includes('HSS動画試験'));
    check('ホーム見出しが動画試験', (await page.$eval('#home-title', e => e.textContent)) === 'HSS動画試験');
    check('本試験カードに30問', (await page.$eval('#meta-q', e => e.textContent)).includes('30'));
    check('デモカードに3問', (await page.$eval('#meta-demo-q', e => e.textContent)).includes('3'));

    // ---------- 2. デモ: 動画ゲート ----------
    await enterAndStart(page, 'demo', '123', 'テスト 太郎');
    let g = await gated(page);
    check('開始直後: 選択肢は非表示(gated)', g.gated && g.btns === 0 && g.note, g);
    check('動画は事前読込の blob: を再生', g.src === 'blob:', g);
    check('デモは無制限表示', /何回でも/.test(g.plays), g);
    check('準備オーバーレイが消えている', !(await page.$eval('#loading-overlay', e => e.classList.contains('show'))));
    // ゲート中のキー操作で回答できないこと
    await page.keyboard.press('1');
    check('ゲート中に 1 キーで回答されない', (await page.evaluate(() => document.querySelectorAll('.option-btn.selected').length)) === 0);
    check('ゲート中は「次へ」無効', await page.$eval('#next-btn', b => b.disabled));
    await playToEnd(page);
    g = await gated(page);
    check('最後まで見たら選択肢4つが出る', !g.gated && g.btns === 4 && !g.note, g);
    check('見終わり後は「もう一度見る」', /もう一度/.test(g.playBtn) && !g.playDisabled, g);
    // 早送り封じ: seeking で先へ飛ばすと戻される（等速に戻してから再生開始）
    await page.evaluate(() => { document.getElementById('q-video').playbackRate = 1; });
    await page.click('#video-play-btn');
    await sleep(300);
    const seekBack = await page.evaluate(async () => { const v = document.getElementById('q-video'); const before = v.currentTime; v.currentTime = 4.5; await new Promise(r => setTimeout(r, 300)); return { before, after: v.currentTime }; });
    check('早送り(seek)は無効化される', seekBack.after < 3.0, seekBack);
    await page.evaluate(() => document.getElementById('q-video').pause());
    await sleep(100);
    g = await gated(page);
    check('一時停止中は「続きから再生」', /続き/.test(g.playBtn), g);
    // 正解を選ぶ（日本語テキスト照合）
    const pickCorrect = async (qs) => page.evaluate((qs) => {
      const qText = document.getElementById('q-label').textContent;
      const q = qs.find(x => x.question === qText);
      const btns = [...document.querySelectorAll('.option-btn')];
      const b = btns.find(b => b.querySelector('span:last-child').textContent === q.answer);
      b.click(); return !!b;
    }, qs);
    check('正解を選択できる', await pickCorrect(demoQs));
    check('回答後「次へ」有効', !(await page.$eval('#next-btn', b => b.disabled)));
    await page.click('#next-btn'); await sleep(300);
    g = await gated(page);
    check('2問目は再びゲート', g.gated && g.btns === 0, g);
    await page.click('#prev-btn'); await sleep(300);
    g = await gated(page);
    check('1問目に戻ると選択肢が残っている', !g.gated && g.btns === 4 && (await page.evaluate(() => document.querySelectorAll('.option-btn.selected').length)) === 1, g);
    await page.click('#next-btn'); await sleep(300);
    // 残り2問を解いて終了
    for(let i = 0; i < 2; i++){
      await playToEnd(page);
      await pickCorrect(demoQs);
      await sleep(100);
      await page.click('#next-btn'); await sleep(300);
    }
    check('最終問で終了確認が出る', await page.$eval('#finish-overlay', e => e.classList.contains('show')));
    await page.click('#finish-yes');
    await page.waitForFunction(() => document.querySelector('.screen.active').id === 'results-screen', { timeout: 5000 });
    const resTxt = await page.$eval('#results-card', e => e.textContent);
    check('デモ結果: 100%', resTxt.includes('100%'), resTxt.slice(0, 120));
    check('デモ結果: 動画再生回数が表示', resTxt.includes('動画再生'), resTxt.slice(0, 200));
    check('デモ結果: 解説が表示', resTxt.includes('解説'));

    // ---------- 3. 本試験: 再生上限・進行保存・復帰 ----------
    await page.goto(URL, { waitUntil: 'networkidle0' });
    // パスワード平文は持たないので、テスト内でハッシュを差し替える（config.js は変更しない）
    const h = await sha256(page, 'e2e-pass');
    await page.evaluate((h) => { CONFIG.passwordHash = h; }, h);
    await enterAndStart(page, 'exam', 'e2e-pass', '復帰 花子');
    check('本試験: 30問', (await page.$eval('#step-current', e => e.textContent)).trim() === '1 / 30');
    g = await gated(page);
    check('本試験: あと2回', /あと2回/.test(g.plays), g);
    await playToEnd(page);
    g = await gated(page);
    check('1回見た: あと1回', /あと1回/.test(g.plays) && !g.playDisabled, g);
    await playToEnd(page);
    g = await gated(page);
    check('2回見た: 上限・ボタン無効', /上限/.test(g.plays) && g.playDisabled, g);
    // 一時停止→続きから再生は回数に数えない（上限後でも途中再開なし＝再生不可のままで良い）
    await pickCorrect(examQs);
    await page.click('#next-btn'); await sleep(300);
    await playToEnd(page);          // 2問目: 1回だけ見て回答せずリロード
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hssv_progress_v1')));
    check('進行保存に vp/vw がある', saved && Array.isArray(saved.vp) && saved.vp[0] === 2 && saved.vw[0] === true && saved.vw[1] === true, saved && { vp: saved.vp.slice(0, 3), vw: saved.vw.slice(0, 3) });
    check('hss-exam の進行キーを汚さない', (await page.evaluate(() => localStorage.getItem('hss_progress_v1'))) === null);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.getElementById('resume-overlay').classList.contains('show'), { timeout: 5000 });
    check('リロードで復帰確認が出る', true);
    await page.click('#resume-btn');
    await page.waitForFunction(() => document.querySelector('.screen.active').id === 'quiz-screen', { timeout: 30000 });
    await sleep(300);
    check('復帰位置は2問目', (await page.$eval('#step-current', e => e.textContent)).trim() === '2 / 30');
    g = await gated(page);
    check('復帰後: 2問目は視聴済み→選択肢あり・あと1回', !g.gated && g.btns === 4 && /あと1回/.test(g.plays), g);
    await page.click('#prev-btn'); await sleep(300);
    g = await gated(page);
    check('復帰後: 1問目は回答保持・上限', (await page.evaluate(() => document.querySelectorAll('.option-btn.selected').length)) === 1 && g.playDisabled, g);
    // 後片付け（次回テストに進行を残さない）
    await page.evaluate(() => localStorage.removeItem('hssv_progress_v1'));

    // ---------- 4. 言語切替 ----------
    await page.goto(URL, { waitUntil: 'networkidle0' });
    await page.select('#lang-selector', 'vi');
    await sleep(200);
    check('vi: ホーム見出し', (await page.$eval('#home-title', e => e.textContent)).includes('video HSS'));
    await page.select('#lang-selector', 'ja');
  } catch (e) {
    failN++; results.push('EXCEPTION: ' + (e.stack || e));
    try { await page.screenshot({ path: path.join(ROOT, 'tests', 'out-error.png') }); } catch (_) {}
  }
  if(consoleErrors.length) results.push('CONSOLE ERRORS: ' + JSON.stringify(consoleErrors.slice(0, 5)));
  check('コンソール/ページエラーなし', consoleErrors.length === 0, consoleErrors.slice(0, 3));
  await browser.close(); srv.close();
  console.log(results.join('\n'));
  console.log(`\n=== e2e: OK ${pass} / NG ${failN} ===`);
  process.exit(failN ? 1 : 0);
})();
