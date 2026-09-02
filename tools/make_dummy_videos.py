#!/usr/bin/env python3
"""ダミー動画(5秒・無音・H.264/mp4)を生成する。本物の動画が揃うまでの骨組み用。

使い方:  python tools/make_dummy_videos.py            # questions.json / demo-questions.json の video を全部作る(既存は飛ばす)
         python tools/make_dummy_videos.py --force    # 既存も作り直す
既存の本物動画を壊さないよう、ファイル名が dummy- で始まるものだけを対象にする。
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORCE = "--force" in sys.argv
FFMPEG = shutil.which("ffmpeg")
if not FFMPEG:
    sys.exit("ffmpeg が見つかりません (winget install Gyan.FFmpeg)")

FONT = "C\\:/Windows/Fonts/arial.ttf"  # drawtext 用(コロンはエスケープ必須)
COLORS = ["0x1c3557", "0x2b4f7d", "0x35608f", "0x4a7fb5", "0x0c1830"]


def make(path: Path, label: str, idx: int, seconds: int = 5):
    color = COLORS[idx % len(COLORS)]
    # 動く要素(横に流れる白い箱)を入れ、静止画と区別できるようにする
    vf = (
        "drawbox=x='mod(t*120,640)':y=300:w=60:h=30:color=white@0.8:t=fill,"
        f"drawtext=fontfile='{FONT}':text='{label}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-20,"
        f"drawtext=fontfile='{FONT}':text='DUMMY':fontcolor=white@0.7:fontsize=24:x=20:y=20"
    )
    cmd = [
        FFMPEG, "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"color=c={color}:s=640x360:r=24:d={seconds}",
        "-vf", vf,
        "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(path),
    ]
    subprocess.run(cmd, check=True)


def main():
    made = skipped = 0
    for f in ["data/questions.json", "data/demo-questions.json"]:
        p = ROOT / f
        if not p.exists():
            continue
        qs = json.loads(p.read_text(encoding="utf-8"))
        for i, q in enumerate(qs):
            v = q.get("video")
            if not v:
                continue
            out = ROOT / v
            if not out.name.startswith("dummy-"):
                continue  # 本物の動画には触らない
            if out.exists() and not FORCE:
                skipped += 1
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            label = ("DEMO " if "demo" in f else "Q ") + str(i + 1)
            make(out, label, i)
            made += 1
    print(f"dummy videos: made={made} skipped={skipped}")


if __name__ == "__main__":
    main()
