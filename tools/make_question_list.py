#!/usr/bin/env python3
"""data/*.json から確認用の問題一覧 docs/questions-list.md を作る（正本は xlsx。これは写し）。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

clips = {c["id"]: c for c in json.loads((ROOT / "tools" / "clips.json").read_text(encoding="utf-8"))["clips"]}
# 第3版(q31〜)の台帳: 素材ID/場面は clips_v2.json
V2 = ROOT / "tools" / "clips_v2.json"
if V2.exists():
    for c in json.loads(V2.read_text(encoding="utf-8"))["clips"]:
        src = c["media"] + (f"@{c['start']:g}" if c.get("start") is not None else "")
        clips[c["video"]] = {"src": src, "start": None, "note": c.get("scene", "")}
out = ["# 問題一覧（確認用の写し）", "",
       "正本は tools/questions.xlsx。直すときは Excel を直して `python tools/build_from_xlsx.py`。動画つきで見るなら review.html。", "",
       "| # | 動画 | 元動画@秒 | カテゴリ | 難易度 | 場面 | 問題(ja) | 正解 | 状態 |", "|---|---|---|---|---|---|---|---|---|"]
for f, label in [("data/questions.json", "本試験"), ("data/demo-questions.json", "デモ")]:
    out.append(f"| **{label}** | | | | | | | | |")
    for q in json.loads((ROOT / f).read_text(encoding="utf-8")):
        vid = Path(q.get("video", "")).stem
        c = clips.get(vid, {})
        st = "未監修" if q.get("placeholder") else "監修済"
        where = c.get("src", "") if c.get("start") is None else f"{c.get('src', '')}@{c.get('start', '')}"
        cell = lambda x: str(x).replace("|", "／").replace("\n", " ")
        out.append(f"| {q['id']} | {vid} | {where} | {q['category']} | {q.get('level', '')} | {cell(c.get('note', ''))} | {cell(q['question'])} | {cell(q['answer'])} | {st} |")
out += ["", "## 社長判断（2026-09-02）", "",
        "- 全問を試験に入れる（剖検 q14・採血/鼻保定 q12/q13/q28/q30/demo02 を含む）",
        "- q18 事務所での薬の吸い上げ、q26 洗い場 は農場の実態として正しい",
        "- 同じ動画に複数の問い（q27〜q30）は許容",
        "- 全問 placeholder=0（採用済み）。以後の修正は review.html → apply_review.py",
        "- 顔が映るクリップは避けた。q11/q20/q25 は後ろ姿・防護服姿。全クリップ無音",
        "",
        "## 第3版（2026-09-24）q31〜",
        "",
        "- 素材: 高橋さん写真集（動画・写真。社長判断=提供同意済み・公開可）、ウェアラブルカメラの未使用区間（W23 は横倒し撮影→回転）、睦沢の種付野帳の写真",
        "- 素材ID: T####=高橋さん写真集の通し番号（分類・命名一覧.csv）/ W##=ウェアラブル（Movies/FinalCut素材/ウェアラブルカメラ の日付順）/ M###=睦沢ストール / I###=2026-09-16 iPhone",
        "- 作問8+1名→担当別の辛口検証（Fable）→担当横断の統合審査（Fable）→完成動画の最終QA。根拠は swine-manual（beginner-guide ほか）",
        "- 全問 placeholder=1（未監修）。社長が review.html で OK にしたものから本番に出せる。【社長確認】の論点は xlsx の check_note 列"]
dest = ROOT / "docs" / "questions-list.md"
dest.write_text("\n".join(out) + "\n", encoding="utf-8")
print("->", dest.relative_to(ROOT))
