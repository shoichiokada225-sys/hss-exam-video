# HSS動画試験（hss-exam-video）

短い動画（5秒程度）を見て四択で答える、HSS認定の新形式試験アプリ。
学科試験 `~/hss-exam/` の土台（5言語・GAS記録・離脱検知・進行保存・Service Worker）を複製し、**動画出題**を足したもの。
hss-exam には一切手を入れていない（別リポジトリ・別GAS・別スプレッドシート）。

- 公開予定URL: https://shoichiokada225-sys.github.io/hss-exam-video/ （未デプロイ）
- 現状: **骨組み完成**。問題30問＋デモ3問は全部「仮問題」、動画33本は全部「ダミー動画」（`videos/dummy-*.mp4`）

## 出題の流れ

1. 問題文の下に動画。**▶ を押して最後まで見るまで選択肢は出ない**（DOMにも置かない）
2. 見終わると選択肢4つが出る。本試験は動画を **1問2回まで**（`config.js` の `video.maxPlaysExam`。途中で止めて続きを見るのは数えない）。デモは無制限
3. 早送り（シーク）は無効。画面を離れると動画も止まる（離脱検知は学科版と同じ）
4. 開始時に全動画をダウンロードして手元に置いてから時計を動かす（通信待ちを試験時間に含めない。途中で電波が切れても最後まで受験できる）
5. 結果はGASへ送信。学科版の列に加えて「動画再生計」「動画再生内訳」、回答詳細に「動画」「再生回数」が付く

## 問題と動画の作り方（本物に差し替える手順）

```
tools/questions.xlsx   ← 社長が編集する正本（シート「本試験」「デモ」）
        │ python tools/build_from_xlsx.py
        ▼
data/questions.json / data/demo-questions.json
```

1. 動画を `videos/` に置く（**H.264 mp4・15秒以内・2MB以下推奨**。ファイル名は英数字）
   - 変換例: `ffmpeg -i 元動画.mov -t 5 -vf "scale=-2:720" -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart -an videos/q01.mp4`
2. `tools/questions.xlsx` を開き、各行の `video` を `videos/q01.mp4` のように書き、問題文・選択肢4つ・`answer`（正解の番号1〜4）・解説を埋める
   - `placeholder` 列を **0 にする**（1のままだと本番検査で止まる）
   - 翻訳（en/vi/id/es）は「問題文＋選択肢4つ」を全部埋めるか、全部空（＝日本語で表示）。**選択肢の並びは日本語と同じ順**（順序を崩すと採点事故）
3. 変換と検査
   ```
   python tools/build_from_xlsx.py
   python validate.py            # 仮問題・ダミーが残っていれば WARN
   python validate.py --release  # 本番前はこちら。仮問題・ダミー動画・webhook未設定が1件でもあれば FAIL
   node verify_logic.js
   node tests/e2e.js             # Chromeで実地（動画ゲート・再生上限・復帰・採点）
   ```
4. `sw.js` の `CACHE_NAME` を上げる（index.html / config.js / data を変えたら必ず）

仮問題を作り直したい時: `python tools/make_placeholder_xlsx.py --force` → `build_from_xlsx.py` → `python tools/make_dummy_videos.py`

## 本番前チェックリスト

- [ ] `config.js` の `webhookUrl` に **新しいGAS** の /exec を設定（`gas/DEPLOY.md`）。学科版のGASを流用しない
- [ ] `python validate.py --release` が PASS
- [ ] `node tests/e2e.js` が全OK
- [ ] 実機（iPhone Safari / Android Chrome）で1問だけ再生確認。特に **音の有無**（動画に音声を残すならマナーモードで聞こえないことを受験者案内に書く）
- [ ] 会場Wi-Fiで受験人数分の同時ダウンロードに耐えるか（30問×2MB=60MB/人が目安。20人なら1.2GB）
- [ ] 通しテスト1人分 → スプレッドシートに列が埋まるか → `purgeTestRows`

## 学科版と違う点（コードの差分が集中する場所）

| 箇所 | 内容 |
|---|---|
| `index.html` `VIDEO_T` | 動画試験用の翻訳（5言語）を元の翻訳に上書き |
| `selectExamQuestions` | 出題ルール。`required:true` 必出＋残りランダムで `questionsPerTest` 問 |
| `preloadVideos` | fetch→Blob→objectURL の事前読込 |
| `renderVideo` / `bindVideoOnce` / `setOptionsGate` | 再生・回数制限・ゲート |
| `saveProgress` の `vp` / `vw` | 再生回数・視聴済みの保存（復帰で復元） |
| `localStorage` キー | `hssv_progress_v1` / `hssv_pending_v1`（同一オリジン github.io で学科版と衝突するため別名） |
| `sw.js` | `/videos/` と Range 要求はSWを通さない（206応答のキャッシュ事故防止） |
| `gas/Code.gs` | 列追加・`CODE_VERSION = 2026-09-02-video`・プロパティ `HSSV_SHEET_ID` |

## 既知の限界・未決

- 動画の**音声**の扱い（無音前提か、音ありか）は未決。無音なら `<video muted>` を付ける
- 共有タブレット運用時の進行破棄導線は学科版と同じく無い
- 動画あり問題と無し問題の混在は動く（無しはゲートなし）が、想定運用ではない
- iOS の低電力モードでは `play()` が拒否されることがある → 「▶」を押し直せば再生される（続きから）
