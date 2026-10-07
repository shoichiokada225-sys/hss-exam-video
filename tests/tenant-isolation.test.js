// マルチテナント分離テスト（第2弾 2026-10-07）。実行: node tests/tenant-isolation.test.js （puppeteer-core と Chrome for Testing は tests/_env.js 参照）
// [1] 農場別ビルド: A の配布物に B の記録先・メール・会社名・パスワードのハッシュが無い／逆も／どちらにもヒラノの値が無い
// [2] 作らない条件: ヒラノのパスワード・記録先／パスワード無し／json にパスワードのキー
// [3] 既定（ヒラノ版）の config.js は HEAD から security 行の追加以外変わらない（パスワード・記録先・会社名・メールが同じ）
// [4] 実ブラウザ: 既定=ヒラノの会社名・回数制限なし／A=Aの会社名・5回まちがえるとロック（正しいパスワードでも拒否）／B は A のパスワードでは進めない
// 本物の GAS には送らない（このテストは受験を最後まで進めず、パスワード画面までしか行かない）
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), vm = require('vm');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { puppeteer, findChrome } = require('./_env');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, failN = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  OK ' + n); } else { failN++; console.log('  NG ' + n + (x !== undefined ? '  <- ' + JSON.stringify(x) : '')); } };
const HIRANO = ['354948ef61d10149fa91ad1bf6a8676f', 'AKfycbyRaRv_bsOlFCuaQh9p4jJY', 'so@oikk.co.jp', 'shoichiokada225-sys', '株式会社ヒラノ', 'Hirano', 'ヒラノ'];
const sha = s => require('crypto').createHash('sha256').update(s).digest('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(root) {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      const fp = path.join(root, u);
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(fp).pipe(r);
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { build } = await import(pathToFileURL(path.join(ROOT, 'tools', 'build-tenant.mjs')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hssv-tenant-'));
  process.env.TENANT_EXAM_PASSWORD = 'exam-pw-AAA';
  const A = build('demo-farm', path.join(tmp, 'A'), { noVideos: true }).out;
  process.env.TENANT_EXAM_PASSWORD = 'exam-pw-BBB';
  const B = build('demo-farm-b', path.join(tmp, 'B'), { noVideos: true }).out;
  const readAll = d => { let s = ''; (function w(x) { for (const n of fs.readdirSync(x)) { const p = path.join(x, n); if (fs.statSync(p).isDirectory()) w(p); else if (/\.(js|html|json)$/.test(n)) s += fs.readFileSync(p, 'utf8'); } })(d); return s; };
  const sa = readAll(A), sb = readAll(B);

  console.log('[1] 配布物の分離');
  check('A に A の記録先・メール・会社名・ハッシュ', sa.includes('DEMOFARMdemofarm') && sa.includes('admin@demo-farm.example') && sa.includes('デモ畜産株式会社') && sa.includes(sha('exam-pw-AAA')));
  check('A に B の値が無い', !sa.includes('DEMOBdemoB') && !sa.includes('demo-b.example') && !sa.includes('デモB農産') && !sa.includes(sha('exam-pw-BBB')));
  check('B に B の値', sb.includes('DEMOBdemoB') && sb.includes('admin@demo-b.example') && sb.includes('デモB農産株式会社') && sb.includes(sha('exam-pw-BBB')));
  check('B に A の値が無い', !sb.includes('DEMOFARMdemofarm') && !sb.includes('demo-farm.example') && !sb.includes('デモ畜産') && !sb.includes(sha('exam-pw-AAA')));
  const bad = HIRANO.filter(k => sa.includes(k) || sb.includes(k));
  check('A/B にヒラノの値・固有名が無い ' + bad.join(','), !bad.length);
  check('パスワードの平文が無い', !sa.includes('exam-pw-AAA') && !sb.includes('exam-pw-BBB'));
  check('他農場の配布物は © 表記なし（既定 hide）', !/©/.test(sa) && !/©/.test(sb));
  check('SW のキャッシュ名が農場別', /CACHE_NAME = "hss-exam-video-v\d+-demo-farm"/.test(fs.readFileSync(path.join(A, 'sw.js'), 'utf8')));
  check('配布物に gas/tests/tools/tenants/review.html/docs が入らない', ['gas', 'tests', 'tools', 'tenants', 'review.html', 'docs'].every(n => !fs.existsSync(path.join(A, n))));
  check('他農場は回数制限が有効（5回/300秒）', /pwMaxTries: 5, pwLockSec: 300/.test(fs.readFileSync(path.join(A, 'config.js'), 'utf8')));

  console.log('[2] 作らない条件');
  const tf = path.join(ROOT, 'tenants', 'zz-bad.json');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', 'demo-farm.json'), 'utf8')); base.id = 'zz-bad';
  const exitOf = (obj, pw) => {
    fs.writeFileSync(tf, JSON.stringify(Object.assign({}, base, obj)));
    if (pw === undefined) delete process.env.TENANT_EXAM_PASSWORD; else process.env.TENANT_EXAM_PASSWORD = pw;
    const real = process.exit, err = console.error; let code = null;
    process.exit = c => { code = c; throw new Error('exit'); }; console.error = () => {};
    try { build('zz-bad', path.join(tmp, 'X' + Math.random()), { noVideos: true }); } catch (e) { /* exit */ }
    process.exit = real; console.error = err; return code;
  };
  try {
    check('正常な設定なら作れる（code=null）', exitOf({}, 'exam-pw-ZZZ') === null);
    check('パスワードが無いと作らない', exitOf({}, undefined) === 2);
    check('短いパスワードは作らない', exitOf({}, 'abc') === 2);
    check('ヒラノの記録先は使えない', exitOf({ webhookUrl: 'https://script.google.com/macros/s/AKfycbyRaRv_bsOlFCuaQh9p4jJY-qfVeOl4MX8rbMqLMr7bVbYirNJeVnyYBpxKcS1pXmky/exec' }, 'exam-pw-ZZZ') === 2);
    check('ヒラノの管理者メールは使えない', exitOf({ adminEmail: 'so@oikk.co.jp' }, 'exam-pw-ZZZ') === 2);
    check('会社名が5言語そろわないと作らない', exitOf({ company: { ja: 'x' } }, 'exam-pw-ZZZ') === 2);
    check('json にパスワードのキーを書くと作らない', exitOf({ examPassword: 'x' }, 'exam-pw-ZZZ') === 2);
  } finally { fs.rmSync(tf, { force: true }); }

  console.log('[3] 既定（ヒラノ版）の設定が変わっていない');
  const loadCfg = src => { const c = {}; vm.runInNewContext(src + ';this.__c=CONFIG;', c); return c.__c; };
  const head = loadCfg(execFileSync('git', ['show', 'HEAD:config.js'], { cwd: ROOT, encoding: 'utf8' }));   // コミット後は「この作業の前」ではなく直前のコミット
  const now = loadCfg(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'));
  const sec = now.security; delete now.security; delete head.security;   // 追加した security 行は比べない（コミット後は HEAD 側にもある）
  check('config.js は security 行の追加以外 HEAD と同じ（パスワード・記録先・会社名・メール・appUrl）', JSON.stringify(now) === JSON.stringify(head), { diff: Object.keys(now).filter(k => JSON.stringify(now[k]) !== JSON.stringify(head[k])) });
  check('既定の回数制限は無効（0）', sec && sec.pwMaxTries === 0);

  console.log('[3b] GAS の管理者メール・出力先の安全');
  const fakeEnv = (props, sent) => ({
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => { if (k === 'HSSV_SHEET_ID') return 'sheet-1'; if (props === 'throw') throw new Error('props unavailable'); return (props || {})[k] || null; }, setProperty() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null, getUrl: () => 'https://sheet.example/' }) },
    Utilities: { formatDate: () => '2026-10-07' }, Session: { getScriptTimeZone: () => 'Asia/Tokyo' }, Logger: { log() {} },
    MailApp: { sendEmail: m => sent.push(m) },
  });
  const runSummary = (src, props) => { const sent = []; const c = fakeEnv(props, sent); vm.createContext(c); vm.runInContext(src, c); c.sendDailySummary(); return { sent, c }; };
  const gasRepo = fs.readFileSync(path.join(ROOT, 'gas', 'Code.gs'), 'utf8');
  const gasTenant = fs.readFileSync(path.join(A + '.setup', 'Code.gs'), 'utf8');
  check('既定 GAS（ヒラノ）: プロパティ無しは従来どおり so@oikk.co.jp へ送る（動作不変）', runSummary(gasRepo, {}).sent.length === 1 && runSummary(gasRepo, {}).sent[0].to === 'so@oikk.co.jp');
  check('既定 GAS: ADMIN_EMAIL プロパティがあればそちらへ', runSummary(gasRepo, { ADMIN_EMAIL: 'x@demo-farm.example' }).sent[0].to === 'x@demo-farm.example');
  check('農場用 GAS: ADMIN_EMAIL 未設定なら日次サマリーを送らない（ヒラノ宛にもならない）', runSummary(gasTenant, {}).sent.length === 0);
  check('農場用 GAS: プロパティが例外でも送らない', runSummary(gasTenant, 'throw').sent.length === 0);
  check('農場用 GAS: ADMIN_EMAIL を入れればその宛先へだけ送る', (() => { const r = runSummary(gasTenant, { ADMIN_EMAIL: 'admin@demo-farm.example' }); return r.sent.length === 1 && r.sent[0].to === 'admin@demo-farm.example'; })());
  check('農場用 GAS のコードにヒラノのメール・名称が一切含まれない', !/oikk|ヒラノ|Hirano/.test(gasTenant) && /var TENANT_MODE = true;/.test(gasTenant) && /var ADMIN_EMAIL_DEFAULT = "";/.test(gasTenant));
  check('農場用 GAS は公開フォルダに入らず別フォルダ（<out>.setup/）にある', !fs.existsSync(path.join(A, 'gas')) && fs.existsSync(path.join(A + '.setup', 'Code.gs')));
  {
    const { spawnSync } = require('child_process');
    const cli = (args, extraEnv, cwd) => spawnSync('node', [path.join(ROOT, 'tools', 'build-tenant.mjs'), 'demo-farm', '--no-videos', ...args], { cwd: cwd || ROOT, env: Object.assign({}, process.env, { TENANT_EXAM_PASSWORD: 'exam-pw-cli' }, extraEnv || {}), encoding: 'utf8' });
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'hssv-safe-'));
    const mk = (name, files) => { const d = path.join(fake, name); fs.mkdirSync(d, { recursive: true }); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };
    const victim = mk('victim', { 'important.txt': 'precious' });
    check('印の無い既存フォルダは拒否し、中身を消さない（exit 2）', cli(['--out', victim]).status === 2 && fs.readFileSync(path.join(victim, 'important.txt'), 'utf8') === 'precious');
    const fakeHome = mk('home', { 'Desktop/keep.txt': 'x', '.hidden': 'y' });
    check('ホームそのものは拒否し、何も消さない', cli(['--out', fakeHome], { HOME: fakeHome }).status === 2 && fs.existsSync(path.join(fakeHome, 'Desktop', 'keep.txt')) && fs.existsSync(path.join(fakeHome, '.hidden')));
    check('ホーム直下の既存フォルダ（印なし）も拒否', cli(['--out', path.join(fakeHome, 'Desktop')], { HOME: fakeHome }).status === 2 && fs.existsSync(path.join(fakeHome, 'Desktop', 'keep.txt')));
    const gitLike = mk('repo-like', { '.git/HEAD': 'ref', 'src/a.js': '1' });
    check('--out . （カレントがリポ風フォルダ）は拒否し .git ごと残る', cli(['--out', '.'], {}, gitLike).status === 2 && fs.existsSync(path.join(gitLike, '.git', 'HEAD')) && fs.existsSync(path.join(gitLike, 'src', 'a.js')));
    check('--out リポ自身は拒否', cli(['--out', ROOT]).status === 2 && fs.existsSync(path.join(ROOT, '.git')));
    check('--out リポ内（dist 以外）は拒否', cli(['--out', path.join(ROOT, 'tests')]).status === 2 && fs.existsSync(path.join(ROOT, 'tests', 'e2e.js')));
    check('--out リポの親フォルダは拒否', cli(['--out', path.dirname(ROOT)]).status === 2 && fs.existsSync(ROOT));
    const ft = path.join(fake, 'afile'); fs.writeFileSync(ft, 'f');
    check('--out がファイルなら拒否', cli(['--out', ft]).status === 2 && fs.readFileSync(ft, 'utf8') === 'f');
    check('存在しない出力先には作れる（印ファイルが付く）', cli(['--out', path.join(fake, 'newout')]).status === 0 && fs.existsSync(path.join(fake, 'newout', '.tenant-build')));
    fs.writeFileSync(path.join(fake, 'newout', 'stale.txt'), 's');
    check('印のある前回の出力は作り直せる（古いファイルは消える）', cli(['--out', path.join(fake, 'newout')]).status === 0 && !fs.existsSync(path.join(fake, 'newout', 'stale.txt')));
    check('空のフォルダには作れる', cli(['--out', mk('empty', {})]).status === 0);
    fs.rmSync(fake, { recursive: true, force: true });
  }

  console.log('[4] 実ブラウザ');
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
  const run = async (root, fn) => {
    const { srv, port } = await serve(root); const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.setRequestInterception(true);
    const hits = []; page.on('request', r => { if (/script\.google\.com/.test(r.url())) { hits.push(r.url()); r.abort(); } else r.continue(); });
    await page.setViewport({ width: 420, height: 860 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    const out = await fn(page, port); out.errs = errs; out.hits = hits;
    await ctx.close(); srv.close(); return out;
  };
  const tryPw = async (page, pw, mode) => {
    await page.evaluate(m => { document.getElementById(m === 'demo' ? 'entry-demo' : 'entry-exam').click(); }, mode || 'exam');
    await page.waitForFunction(() => document.querySelector('.screen.active').id === 'password-screen');
    await page.$eval('#exam-password', e => { e.value = ''; });
    await page.type('#exam-password', pw); await page.click('#password-submit-btn');
    await new Promise(r => setTimeout(r, 250));
    return page.evaluate(() => ({ scr: document.querySelector('.screen.active').id, msg: document.getElementById('password-error-msg').textContent, shown: document.getElementById('password-error-msg').classList.contains('show') }));
  };
  const back = async page => { await page.click('#password-back-btn'); await page.waitForFunction(() => document.querySelector('.screen.active').id === 'home-screen'); };
  const info = page => page.evaluate(() => ({ sub: document.getElementById('home-subtitle').textContent, foot: document.getElementById('footer-text').textContent, hook: CONFIG.email.webhookUrl, tries: (CONFIG.security || {}).pwMaxTries }));

  const def = await run(ROOT, async page => {
    const i = await info(page); let last; for (let k = 0; k < 8; k++) { last = await tryPw(page, 'wrong' + k); await back(page); }
    i.afterMany = last; i.demo = await tryPw(page, '123', 'demo'); return i;
  });
  check('既定: 会社名・© 表記・記録先はヒラノのまま', def.sub === '株式会社ヒラノ' && def.foot.startsWith('© 株式会社ヒラノ') && /AKfycbyRaRv/.test(def.hook), def);
  check('既定: 8回まちがえてもロックされない（従来どおり）・メッセージは従来の文', def.afterMany.msg === 'パスワードが正しくありません' && def.afterMany.scr === 'password-screen', def.afterMany);
  check('既定: デモのパスワード 123 は今までどおり通る', def.demo.scr !== 'password-screen', def.demo);

  const ra = await run(A, async page => {
    const i = await info(page); const r = []; for (let k = 0; k < 5; k++) { r.push(await tryPw(page, 'wrong' + k)); await back(page); }
    i.fifth = r[4]; i.right = await tryPw(page, 'exam-pw-AAA'); i.lockStored = await page.evaluate(() => localStorage.getItem('hssv_pwfail_v1')); return i;
  });
  check('A: 会社名・記録先が A・© なし', ra.sub === 'デモ畜産株式会社' && ra.foot === 'デモ畜産株式会社 HSS認定制度' && ra.hook.includes('DEMOFARMdemofarm'), ra);
  check('A: 4回目までは通常のエラー・5回目でロックの案内になる前の状態を確認', r5(ra));
  function r5(x) { return x.fifth.shown === true; }
  check('A: 5回まちがえた後は正しいパスワードでも進めない（ロック文言）', ra.right.scr === 'password-screen' && /300秒|29\d秒|30\d秒|秒後/.test(ra.right.msg), ra.right);
  check('A: 通信の宛先は A の記録先だけ・JSエラーなし', ra.hits.every(u => u.includes('DEMOFARMdemofarm')) && !ra.errs.length, { h: ra.hits, e: ra.errs });

  const ra2 = await run(A, async page => ({ right: await tryPw(page, 'exam-pw-AAA') }));
  check('A: ロックしていない新しい端末では A のパスワードで進める（問題を読み込む）', ra2.right.scr !== 'password-screen', ra2.right);
  const rb = await run(B, async page => { const i = await info(page); i.withA = await tryPw(page, 'exam-pw-AAA'); await back(page); i.withB = await tryPw(page, 'exam-pw-BBB'); return i; });
  check('B: 会社名・記録先が B', rb.sub === 'デモB農産株式会社' && rb.hook.includes('DEMOBdemoB'), rb);
  check('B: A のパスワードでは進めず、B のパスワードで進む', rb.withA.scr === 'password-screen' && rb.withB.scr !== 'password-screen', { a: rb.withA, b: rb.withB });
  check('JSエラーなし', [def, ra, ra2, rb].every(x => !x.errs.length), [def, ra, ra2, rb].map(x => x.errs));

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n結果: ${pass} passed / ${failN} failed`); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
