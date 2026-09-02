#!/usr/bin/env python3
"""data/questions.json / data/demo-questions.json の検査（コミット前・デプロイ前に必ず実行）

Usage:  python validate.py            # 検査（仮問題は警告のみ）
        python validate.py --release  # 本番前検査（仮問題・ダミー動画が1件でもあれば FAIL）
Exit code: 0 = PASS, 1 = FAIL
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

ROOT = Path(__file__).resolve().parent
RELEASE = "--release" in sys.argv
VALID_CATEGORIES = {"繁殖・分娩", "子豚・育成", "衛生・防疫", "飼料・栄養", "飼養環境・施設", "肉豚・出荷・肉", "経営理念・行動規範"}
LANG_KEYS = ["en", "vi", "ind", "es"]
MAX_VIDEO_SEC = 15.0        # 「5秒くらいのショート動画」の設計。長すぎる素材を弾く
MAX_VIDEO_BYTES = 4 * 1024 * 1024
FFPROBE = shutil.which("ffprobe")

failures, warnings = [], []


def fail(m):
    failures.append(m)


def warn(m):
    warnings.append(m)


def read_config():
    txt = (ROOT / "config.js").read_text(encoding="utf-8")

    def num(key):
        m = re.search(key + r"\s*:\s*(\d+)", txt)
        return int(m.group(1)) if m else None
    return {
        "questionsPerTest": num("questionsPerTest"),
        "demoCount": num("questionCount"),
        "webhook": re.search(r'webhookUrl:\s*"([^"]*)"', txt).group(1),
    }


def probe(path: Path):
    if not FFPROBE:
        return None
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type",
                          "-of", "json", str(path)], capture_output=True, text=True)
    if out.returncode != 0:
        return {"error": out.stderr.strip()}
    j = json.loads(out.stdout)
    vcodec = next((s["codec_name"] for s in j.get("streams", []) if s.get("codec_type") == "video"), None)
    return {"duration": float(j["format"]["duration"]), "vcodec": vcodec}


def check_file(path: Path, label: str, expect_count):
    if not path.exists():
        fail(f"{label}: {path.name} がありません")
        return
    try:
        qs = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        fail(f"{label}: JSONが壊れています: {e}")
        return
    if not isinstance(qs, list) or not qs:
        fail(f"{label}: 配列が空です")
        return
    if expect_count is not None and len(qs) < expect_count:
        fail(f"{label}: {len(qs)}問しかありません（設定は{expect_count}問）")
    if expect_count is not None and len(qs) != expect_count:
        warn(f"{label}: {len(qs)}問（設定{expect_count}問）→ {expect_count}問をランダム抽出")

    ids, videos, placeholders, dummies = set(), {}, 0, 0
    for i, q in enumerate(qs, 1):
        tag = f"{label} 問{i}"
        qid = q.get("id")
        if not qid:
            fail(f"{tag}: id がありません")
        elif qid in ids:
            fail(f"{tag}: id 重複 {qid}")
        ids.add(qid)
        if not str(q.get("question", "")).strip():
            fail(f"{tag}: question が空")
        opts = q.get("options")
        if not isinstance(opts, list) or len(opts) < 2:
            fail(f"{tag}: options が2つ未満")
            continue
        if len(set(opts)) != len(opts):
            fail(f"{tag}: options に重複")
        if q.get("answer") not in opts:
            fail(f"{tag}: answer が options に無い")
        if q.get("category") not in VALID_CATEGORIES:
            fail(f"{tag}: category 不正: {q.get('category')!r}")
        if q.get("placeholder"):
            placeholders += 1
        for lk in LANG_KEYS:
            blk = q.get(lk)
            if blk is None:
                continue
            if not isinstance(blk, dict) or not str(blk.get("question", "")).strip():
                fail(f"{tag}: {lk}.question が空")
            lopts = blk.get("options") if isinstance(blk, dict) else None
            if not isinstance(lopts, list) or len(lopts) != len(opts):
                fail(f"{tag}: {lk}.options の数が日本語({len(opts)})と一致しない（順序ズレは採点事故）")
            elif any(not str(o).strip() for o in lopts):
                fail(f"{tag}: {lk}.options に空がある")
        v = q.get("video", "")
        if not v:
            warn(f"{tag}: video なし（テキスト問題として出題される）")
            continue
        if not re.fullmatch(r"videos/[A-Za-z0-9._-]+\.mp4", v):
            fail(f"{tag}: video のパス形式が不正: {v!r}（videos/英数字.mp4）")
            continue
        if v in videos:
            warn(f"{tag}: 動画 {v} は問{videos[v]}と同じ")
        videos.setdefault(v, i)
        vp = ROOT / v
        if not vp.exists():
            fail(f"{tag}: 動画ファイルがありません: {v}")
            continue
        if Path(v).name.startswith("dummy-"):
            dummies += 1
        size = vp.stat().st_size
        if size > MAX_VIDEO_BYTES:
            warn(f"{tag}: {v} が {size / 1048576:.1f}MB（会場Wi-Fiでの一斉準備に時間がかかる。2MB以下推奨）")
        info = probe(vp)
        if info is None:
            continue
        if "error" in info:
            fail(f"{tag}: ffprobe 失敗 {v}: {info['error']}")
        else:
            if info["duration"] > MAX_VIDEO_SEC:
                fail(f"{tag}: {v} が {info['duration']:.1f}秒（上限{MAX_VIDEO_SEC:.0f}秒）")
            if info["vcodec"] != "h264":
                fail(f"{tag}: {v} のコーデックが {info['vcodec']}（iPhone互換のため h264 必須）")
    msg = f"{label}: {len(qs)}問 / 動画{len(videos)}本 / 仮問題{placeholders} / ダミー動画{dummies}"
    if RELEASE and (placeholders or dummies):
        fail(msg + " ← 本番不可（仮問題・ダミー動画が残っています）")
    elif placeholders or dummies:
        warn(msg + "（骨組み状態）")
    else:
        print("  " + msg)


def main():
    cfg = read_config()
    check_file(ROOT / "data" / "questions.json", "本試験", cfg["questionsPerTest"])
    check_file(ROOT / "data" / "demo-questions.json", "デモ", cfg["demoCount"])
    if not cfg["webhook"]:
        (fail if RELEASE else warn)("config.js: webhookUrl が空（結果はどこにも記録されない）")
    # sw.js の CACHE_NAME が ASSETS と整合しているかは目視。ここでは存在確認のみ
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    if "/videos/" not in sw:
        fail("sw.js: /videos/ の除外が消えています（Range応答キャッシュ事故）")
    if not FFPROBE:
        warn("ffprobe が無いため動画の長さ・コーデック検査を省略")
    for w in warnings:
        print("  WARN:", w)
    for f in failures:
        print("  FAIL:", f)
    print("RESULT:", "FAIL" if failures else "PASS", f"(fail={len(failures)} warn={len(warnings)})")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
