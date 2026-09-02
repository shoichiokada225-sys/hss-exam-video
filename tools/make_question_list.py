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
out = ["# 問題一覧（確認用の写し）", "",
       "正本は tools/questions.xlsx。直すときは Excel を直して `python tools/build_from_xlsx.py`。動画つきで見るなら review.html。", "",
       "| # | 動画 | 元動画@秒 | カテゴリ | 場面 | 問題(ja) | 正解 | 状態 |", "|---|---|---|---|---|---|---|---|"]
for f, label in [("data/questions.json", "本試験"), ("data/demo-questions.json", "デモ")]:
    out.append(f"| **{label}** | | | | | | | |")
    for q in json.loads((ROOT / f).read_text(encoding="utf-8")):
        vid = Path(q.get("video", "")).stem
        c = clips.get(vid, {})
        st = "未監修" if q.get("placeholder") else "監修済"
        out.append(f"| {q['id']} | {vid} | {c.get('src', '')}@{c.get('start', '')} | {q['category']} | {c.get('note', '')} | {q['question']} | {q['answer']} | {st} |")
out += ["", "## 監修時に見てほしい点", "",
        "- q18: 事務所の机で薬を吸い上げる場面。この農場の決まりとして「正しい場所」と言い切ってよいか",
        "- q26: 洗い場と判断したが用途の確証なし",
        "- q14: 剖検の場面(死亡子豚)。受験者に見せてよい内容か。外すなら review で「削除」",
        "- q12/q13/q28/q30/demo02: 採血・鼻保定は獣医の作業。従業員向け試験の範囲に入れるか",
        "- q27〜q30 は既存の動画に別の問いを付けたもの(同じ動画が2回出る)",
        "- 顔が映るクリップは避けたが、q11/q20/q25 は後ろ姿・防護服姿の人物が映る",
        "- 全クリップ無音(元動画の音は落とした)"]
dest = ROOT / "docs" / "questions-list.md"
dest.write_text("\n".join(out) + "\n", encoding="utf-8")
print("->", dest.relative_to(ROOT))
