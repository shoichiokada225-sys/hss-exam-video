// review.html（監修ページ）の実地テスト: 描画・判定保存・JSON出力 → apply_review.py --dry-run まで
// 実行: node tests/review-e2e.js
const fs = require('fs'); const path = require('path'); const http = require('http'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const puppeteer = require(path.join(os.homedir(), 'elearn-e2e-tmp', 'node_modules', 'puppeteer-core'));
const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
const ver = fs.readdirSync(base).filter(d => d.startsWith('win64-')).sort().reverse()[0];
const CHROME = path.join(base, ver, 'chrome-win64', 'chrome.exe');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4' };
const srv = http.createServer((req, r) => {
  let u = decodeURIComponent(req.url.split('?')[0]); const fp = path.join(ROOT, u);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); r.end(); return; }
  const ext = path.extname(fp); const stat = fs.statSync(fp); const range = req.headers.range;
  if (range && ext === '.mp4') {   // Range 対応（本番と同じ挙動。無いと <video> が固まる）
    const m = /bytes=(\d+)-(\d*)/.exec(range); const s = +m[1]; const e = m[2] ? +m[2] : stat.size - 1;
    r.writeHead(206, { 'Content-Type': MIME[ext], 'Content-Range': `bytes ${s}-${e}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
    fs.createReadStream(fp, { start: s, end: e }).pipe(r); return;
  }
  r.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(fp).pipe(r);
});
let ok = 0, ng = 0; const log = [];
const check = (n, c, x) => { if (c) ok++; else ng++; log.push((c ? 'OK  ' : 'NG  ') + n + (c || x === undefined ? '' : '  <- ' + JSON.stringify(x))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => srv.listen(8793, '127.0.0.1', r));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
  const p = await b.newPage(); await p.setViewport({ width: 1100, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const dl = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(dl, { recursive: true });
  const client = await p.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  try {
    await p.goto('http://127.0.0.1:8793/review.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('section.q');   // 動画33本の読込は待たない
    await p.evaluate(() => localStorage.removeItem('hssv_review_v1'));
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('section.q');
    const nExam = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8')).length;
    const nDemo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo-questions.json'), 'utf8')).length;
    const cards = await p.$$eval('section.q', els => els.length);
    check(`カード数 = 本試験${nExam}+デモ${nDemo}`, cards === nExam + nDemo, cards);
    check('正解に✔が付く', (await p.$$eval('ol li.ans', els => els.length)) === cards);
    check('動画srcが全カードにある', (await p.$$eval('video', els => els.every(v => v.getAttribute('src').startsWith('videos/')))));
    // 言語切替
    await p.click('section.q[data-id="q01"] .langs button[data-lang="vi"]'); await sleep(150);
    const viText = await p.$eval('section.q[data-id="q01"] .qtext', e => e.textContent);
    check('q01 を vi 表示', /video/.test(viText) && !/動画/.test(viText), viText);
    // 判定と メモ
    await p.click('section.q[data-id="q01"] input[value="ok"]');
    await p.click('section.q[data-id="q14"] input[value="del"]');
    await p.click('section.q[data-id="q18"] input[value="fix"]');
    await p.type('section.q[data-id="q18"] textarea', '事務所での吸い上げは要確認');
    await sleep(200);
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('hssv_review_v1')));
    check('判定が localStorage に保存', saved.q01.status === 'ok' && saved.q14.status === 'del' && saved.q18.status === 'fix' && /要確認/.test(saved.q18.memo), saved);
    check('ヘッダ集計', /OK 1/.test(await p.$eval('#stat', e => e.textContent)) && /削除 1/.test(await p.$eval('#stat', e => e.textContent)));
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('section.q');
    check('リロード後も判定が残る', await p.$eval('section.q[data-id="q14"]', e => e.classList.contains('st-del')));
    await p.select('#filter', 'fix'); await sleep(150);
    check('フィルタ: 修正のみ', (await p.$$eval('section.q', els => els.length)) === 1);
    await p.select('#filter', '');
    // 出力
    for (const f of fs.readdirSync(dl)) if (f.startsWith('review-')) fs.unlinkSync(path.join(dl, f));
    await p.click('#export'); await sleep(1500);
    const file = fs.readdirSync(dl).find(f => f.startsWith('review-') && f.endsWith('.json'));
    check('JSONがダウンロードされる', !!file, fs.readdirSync(dl));
    if (file) {
      const j = JSON.parse(fs.readFileSync(path.join(dl, file), 'utf8'));
      check('JSONに全問+判定', j.items.length === cards && j.items.find(i => i.id === 'q18').memo.includes('要確認'));
      const out = execFileSync('python', [path.join(ROOT, 'tools', 'apply_review.py'), path.join(dl, file), '--dry-run'], { encoding: 'utf8' });
      check('apply_review --dry-run が3件を認識', /3件/.test(out) && /q01: ok/.test(out) && /q14: del/.test(out), out.slice(0, 300));
    }
    await p.evaluate(() => localStorage.removeItem('hssv_review_v1'));
  } catch (e) { ng++; log.push('EXCEPTION: ' + (e.stack || e)); }
  check('ページエラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(log.join('\n')); console.log(`\n=== review-e2e: OK ${ok} / NG ${ng} ===`);
  process.exit(ng ? 1 : 0);
})();
