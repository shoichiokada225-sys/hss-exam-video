// 出題ロジック・採点ロジックのシミュレーション検証（index.html の selectExamQuestions / submitQuiz を再現）
// 実行: node verify_logic.js   (exit 1 = NG)
const fs = require('fs');
const path = require('path');
const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions.json'), 'utf8'));
const cfgTxt = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
const N = parseInt(cfgTxt.match(/questionsPerTest:\s*(\d+)/)[1], 10);
const MAXP = parseInt(cfgTxt.match(/maxPlaysExam:\s*(\d+)/)[1], 10);
const mixM = cfgTxt.match(/levelMix:\s*(\{[^}]*\})/);
const MIX = mixM ? JSON.parse(mixM[1]) : null;

function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
// --- index.html selectExamQuestions と同一ロジック ---
function selectExamQuestions(pool, n, mix){
  n = n | 0;
  const out = [], used = {}, cnt = {};
  const key = q => q.group || q.video || q.id;
  function take(q, force){
    if(out.length >= n || out.indexOf(q) >= 0) return false;
    if(used[key(q)] && !force) return false;
    used[key(q)] = true; out.push(q); cnt[q.level] = (cnt[q.level] || 0) + 1; return true;
  }
  pool.filter(q => q.required === true).forEach(q => take(q, true));
  const rest = shuffle(pool.filter(q => q.required !== true));
  if(mix){ Object.keys(mix).forEach(lv => rest.forEach(q => { if(q.level === lv && (cnt[lv] || 0) < mix[lv]) take(q); })); }
  rest.forEach(q => take(q));
  rest.forEach(q => take(q, true));
  return shuffle(out);
}
// --- 再生回数ゲート（bindVideoOnce の canStartPlay と同一）---
function canStartPlay(plays, mp){ return mp <= 0 || plays < mp; }

let ng = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if(!cond) ng++; };
const required = all.filter(q => q.required === true).length;
console.log(`データ: 全${all.length}問 (required ${required}) / 出題${N}問 / 動画再生上限${MAXP}`);

console.log('\n[出題ルール x1000]');
let sizes = new Set(), reqMissing = 0, dup = 0, freq = {}, mixNg = 0, grpDup = 0;
for(let t=0;t<1000;t++){
  const sel = selectExamQuestions(all, N, MIX);
  sizes.add(sel.length);
  if(sel.filter(q => q.required === true).length !== Math.min(required, Math.max(required, N))) reqMissing++;
  const ids = sel.map(q => q.id);
  if(new Set(ids).size !== ids.length) dup++;
  sel.forEach(q => freq[q.id] = (freq[q.id]||0)+1);
  if(MIX){ for(const lv of Object.keys(MIX)){ const have = all.filter(q => q.level === lv).length; if(sel.filter(q => q.level === lv).length < Math.min(MIX[lv], have)) mixNg++; } }
  const gk = sel.map(q => q.group || q.video || q.id); if(new Set(gk).size !== gk.length) grpDup++;
}
const expect = Math.min(N, all.length);
ok(sizes.size === 1 && [...sizes][0] === expect, `出題数が常に${expect}問 (観測: ${[...sizes].join(',')})`);
ok(reqMissing === 0, `required 問が毎回含まれる`);
ok(dup === 0, `重複出題なし`);
ok(Object.keys(freq).length === all.length, `全${all.length}問が出題対象に登場 (${Object.keys(freq).length})`);
if(MIX) ok(mixNg === 0, `難易度の配分 ${JSON.stringify(MIX)} を毎回満たす`);
const groups = new Set(all.map(q => q.group || q.video || q.id)).size;
ok(groups < N || grpDup === 0, `同じ場面(group)から1回に1問だけ (場面${groups}種)`);

console.log('\n[採点ロジック 全問]');
let bug = 0;
for(const q of all){
  const sh = shuffle(q.options.slice());
  const ci = sh.indexOf(q.answer);
  if(ci < 0){ bug++; console.log('  ✗ 正答が選択肢に無い:', q.id); continue; }
  for(let k=0;k<sh.length;k++){ if((sh[k]===q.answer) !== (k===ci)) bug++; }
}
ok(bug === 0, `採点バグなし`);

console.log('\n[動画ゲート]');
ok(!canStartPlay(MAXP, MAXP) && canStartPlay(MAXP-1, MAXP), `本試験は${MAXP}回で打ち止め`);
ok(canStartPlay(999, 0), `0=無制限`);
const noVideo = all.filter(q => !q.video).length;
ok(noVideo === 0, `全問に動画あり (無し${noVideo})`);

console.log('\n=== ' + (ng ? `NG ${ng}件` : '検証完了 OK') + ' ===');
process.exit(ng ? 1 : 0);
