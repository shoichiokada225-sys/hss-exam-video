# GAS 初回デプロイ手順（hss-exam-video 用・所要10分）

動画試験の記録先は **学科試験（hss-exam）とは別のGASプロジェクト**にする。
同じGASを使うと同じスプレッドシート「HSS試験記録」に混ざり、名簿突合が崩れる。

## 手順

### 0. コードをクリップボードにコピー

```
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\hss-exam-video\gas\copy-to-clipboard.ps1"
```

### 1. 新しいGASプロジェクトを作る

1. https://script.google.com/home/my を開く（学科版と同じ個人Gmailアカウント。`/home/projects` は404）
2. 「新しいプロジェクト」→ 名前を **HSS動画試験 Webhook** にする
3. `コード.gs` の中身を全部消して貼り付け → 保存

### 2. ウェブアプリとしてデプロイ

1. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
2. 実行するユーザー: **自分** / アクセスできるユーザー: **全員**
3. 「デプロイ」→ 承認 → **ウェブアプリのURL（/exec）をコピー**

### 3. アプリに設定

`config.js` の `email.webhookUrl` に貼る → `sw.js` の `CACHE_NAME` を上げる → push。

### 4. 反映確認

ブラウザで /exec を開いて次が出ればOK:

```
{"status":"ok","service":"HSS Video Exam Webhook","version":"2026-09-02-video","columns":17}
```

初回アクセスで記録用スプレッドシート「HSS動画試験記録_2026」が自動作成される（URLは実行ログ）。

### 5. 通しテスト

本試験を1人分受験 → シート「本試験結果」の **P列（動画再生計）・Q列（動画再生内訳）** と「回答詳細」の **I列（動画）・J列（再生回数）** が埋まるか確認 → エディタで `purgeTestRows` を実行してテスト行を消す。

## 学科版からの差分

| 項目 | 学科（hss-exam） | 動画（hss-exam-video） |
|---|---|---|
| CODE_VERSION | 2026-08-27 | 2026-09-02-video |
| スクリプトプロパティ | HSS_SHEET_ID | HSSV_SHEET_ID |
| スプレッドシート名 | HSS試験記録_YYYY | HSS動画試験記録_YYYY |
| 本試験結果の列数 | 15 | 17（＋動画再生計・動画再生内訳） |
| 回答詳細の列数 | 8 | 10（＋動画・再生回数） |

日次サマリー（`sendDailySummary`）は学科版と同じく既定で停止。必要なら `installDailyTrigger` を1回実行。
