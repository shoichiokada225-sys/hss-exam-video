#!/usr/bin/env node
/* 農場別ビルド（マルチテナント・キット方式）。
   使い方: node tools/build-tenant.mjs <テナントID> [--out <出力先>] [--no-videos]   例: node tools/build-tenant.mjs demo-farm
   ・tenants/<id>.json（会社名5言語・記録先 GAS の URL・管理者メール・公開URL・権利表記）から dist/<id>/ に「配る一式」を作る（コマンド1本）
   ・本試験パスワードは環境変数 TENANT_EXAM_PASSWORD か、git に入れない tenants/<id>.secret.json の {"examPassword":"…"} から読み、
     SHA-256 にして config.js に入れる（平文は出力に残らない）。ヒラノの値の流用は不可
   ・他農場の配布物はパスワード総当たり対策（5回まちがえると300秒ロック）が既定で有効
   ・元の config.js・index.html（ヒラノ版の既定）は変えない。出力にヒラノの記録先・パスワード・会社名・管理者メールが1つも残らないことを検査し、残れば失敗する
   ・動画・問題（videos/ data/）は既定でこのリポのものをそのままコピーする（ヒラノ撮影素材。他農場に出す前に社長判断。
     tenants/<id>.json の "contentDir" で、その農場の data/ と videos/ を入れた別フォルダに差し替えられる）。--no-videos は動画を入れない（検査用）
   ・本番には何も送らない */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 既定（ヒラノ版）の値の指紋。農場用の出力に残ってはいけない
const HIRANO = ['354948ef61d10149fa91ad1bf6a8676f', 'AKfycbyRaRv_bsOlFCuaQh9p4jJY', 'so@oikk.co.jp', 'shoichiokada225-sys', '株式会社ヒラノ', 'Hirano', 'ヒラノ'];
const EXCLUDE = [/^tools\//, /^tests\//, /^tenants\//, /^docs\//, /^gas\//, /^dist\//, /^raw\//, /^review\.html$/, /^validate\.py$/, /^verify_logic\.js$/, /\.md$/, /^\./, /^icons\/generate-icons\.html$/];
const LANGS = ['ja', 'en', 'vi', 'id', 'es'];

function die(m) { console.error('NG: ' + m); process.exit(2); }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

export function loadTenant(id) {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(id || '')) die('テナントIDは英小文字・数字・ハイフン（2〜31字）');
  const f = path.join(ROOT, 'tenants', id + '.json');
  if (!fs.existsSync(f)) die(f + ' がありません（tenants/demo-farm.json をコピーして作る）');
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (t.id !== id) die('tenants/' + id + '.json の "id" がファイル名と違います');
  const c = t.company || {};
  for (const l of LANGS) { if (!String(c[l] || '').trim()) die('company.' + l + '（会社名）が必要です（5言語とも。無い言語は ja と同じ文字を入れる）'); if (/[<>"\n\r\\]/.test(c[l])) die('company.' + l + ' に < > " \\ 改行は使えません'); }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(t.webhookUrl || '') && t.webhookUrl !== '') die('webhookUrl は https://script.google.com/macros/s/…/exec の形（記録しないなら空文字 ""）');
  if (!/^[^@\s"<>]+@[^@\s"<>]+\.[^@\s"<>]+$/.test(t.adminEmail || '')) die('adminEmail が必要です');
  if (!/^https:\/\/[^"\s<>]+\/$/.test(t.appUrl || '')) die('appUrl は https:// で始まり / で終わる公開URL');
  if (HIRANO.some(k => [t.webhookUrl, t.adminEmail, t.appUrl].join('').includes(k))) die('webhookUrl / adminEmail / appUrl にヒラノの値が入っています');
  if (Object.keys(t).some(k => /pass|token|secret|合言葉/i.test(k))) die('パスワードは tenants/<id>.json に書かない（環境変数か secret.json）');
  let pw = process.env.TENANT_EXAM_PASSWORD || '';
  const sf = path.join(ROOT, 'tenants', id + '.secret.json');
  if (!pw && fs.existsSync(sf)) pw = String(JSON.parse(fs.readFileSync(sf, 'utf8')).examPassword || '');
  if (!pw) die('本試験パスワードがありません（TENANT_EXAM_PASSWORD か tenants/' + id + '.secret.json）');
  if (pw.length < 6) die('本試験パスワードは6文字以上');
  if (sha(pw) === '354948ef61d10149fa91ad1bf6a8676f94e7d6f2b0f7d1920797b8fbe56b3c81') die('ヒラノの本試験パスワードは使えません');
  return { t, pwHash: sha(pw) };
}

function setField(src, re, val, what) {
  if (!re.test(src)) die('config.js に ' + what + ' が見つかりません（元の config.js の形が変わった）');
  return src.replace(re, (_, a) => a + JSON.stringify(val));
}

export function build(id, outDir, opts) {
  opts = opts || {};
  const { t, pwHash } = loadTenant(id);
  const out = path.resolve(outDir || path.join(ROOT, 'dist', id));
  fs.rmSync(out, { recursive: true, force: true }); // dist/<id>/ だけを作り直す
  fs.mkdirSync(out, { recursive: true });
  let files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(f => !EXCLUDE.some(r => r.test(f))).filter(f => fs.existsSync(path.join(ROOT, f)));
  if (t.contentDir) files = files.filter(f => !/^(data|videos)\//.test(f));
  if (opts.noVideos) files = files.filter(f => !/^videos\//.test(f));
  const hide = (t.copyright && t.copyright.mode) !== 'show'; // 他農場は既定で © を出さない
  const names = { 'ja': '株式会社ヒラノ', 'en': 'Hirano Co., Ltd.', 'vi': 'Công ty Hirano', 'id': 'PT Hirano', 'es': 'Compañía Hirano' };
  for (const f of files) {
    const dst = path.join(out, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!/\.(js|html|json)$/.test(f)) { fs.copyFileSync(path.join(ROOT, f), dst, fs.constants.COPYFILE_FICLONE); continue; }
    let s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f === 'config.js') {
      s = setField(s, /(\n  passwordHash: )"[0-9a-f]{64}"/, pwHash, 'passwordHash');
      s = setField(s, /(webhookUrl: )"[^"]*"/, t.webhookUrl, 'webhookUrl');
      s = setField(s, /(adminEmail: )"[^"]*"/, t.adminEmail, 'adminEmail');
      s = setField(s, /(    name: )"[^"]*"/, t.company.ja, 'company.name');
      s = setField(s, /(  appUrl: )"[^"]*"/, t.appUrl, 'appUrl');
      s = s.replace(/security: \{ pwMaxTries: 0, pwLockSec: 300 \}/, 'security: { pwMaxTries: 5, pwLockSec: 300 }');
      if (!/pwMaxTries: 5/.test(s)) die('config.js の security 行が見つかりません');
    } else if (f === 'index.html' || f === 'qr.html' || f === 'manifest.json') {
      // 会社名（5言語）を差し替える。長い語から順に（「Compañía Hirano」より先に「Hirano」だけを置換しない）
      for (const l of LANGS) s = s.split(names[l]).join(t.company[l]);
      if (hide) s = s.split('© ').join('');   // 権利表記（© 会社名 …）は他農場では出さない。show の農場だけ残す
      if (f === 'index.html') s = s.replace(/<title>[^<]*<\/title>/, m => m); // 題名は会社名の置換で追従済み
    } else if (f === 'sw.js') {
      s = s.replace(/var CACHE_NAME = "([^"]+)"/, (_, v) => 'var CACHE_NAME = "' + v + '-' + id + '"'); // キャッシュ名を農場別に
    }
    fs.writeFileSync(dst, s);
  }
  if (t.contentDir) {
    const cd = path.resolve(ROOT, t.contentDir);
    for (const sub of ['data', 'videos']) {
      if (opts.noVideos && sub === 'videos') continue;
      if (!fs.existsSync(path.join(cd, sub))) die('contentDir に ' + sub + '/ がありません: ' + cd);
      fs.cpSync(path.join(cd, sub), path.join(out, sub), { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
    }
  }
  const bad = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|html|json)$/.test(n)) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const k of HIRANO) if (s.includes(k)) bad.push(path.relative(out, p) + ' に "' + k.slice(0, 10) + '…"');
      if (hide && /©/.test(s) && /\.(html|json)$/.test(n)) bad.push(path.relative(out, p) + ' に ©');
    }
  })(out);
  if (bad.length) { fs.rmSync(out, { recursive: true, force: true }); die('ヒラノ固有の値が残っています: ' + bad.join(' / ')); }
  return { out, files: files.length, videos: fs.existsSync(path.join(out, 'videos')) ? fs.readdirSync(path.join(out, 'videos')).length : 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const id = a.find(x => !x.startsWith('--') && a[a.indexOf(x) - 1] !== '--out');
  const oi = a.indexOf('--out');
  const t0 = fs.existsSync(path.join(ROOT, 'tenants', id + '.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', id + '.json'), 'utf8')) : {};
  const r = build(id, oi >= 0 ? a[oi + 1] : null, { noVideos: a.includes('--no-videos') });
  console.log('OK ' + r.out + '（' + r.files + 'ファイル・動画' + r.videos + '本）');
  if (!t0.contentDir) console.log('注意: 問題と動画はヒラノ版の素材のままです。他農場に出す前に社長判断（contentDir で差し替え可）');
}
