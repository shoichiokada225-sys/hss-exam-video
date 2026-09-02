#!/usr/bin/env python3
"""tools/clips.json の台帳どおりに raw/ の元動画から5秒クリップを切り出す。

使い方:  python tools/cut_clips.py            # videos/<id>.mp4 を生成(既存は上書き)
         python tools/cut_clips.py --sheet    # 検証用: 各クリップ1秒ごとのフレーム一覧 raw/sheets/clips_check.jpg も作る
出力: 960x540 H.264 baseline, 無音, faststart（iPhone/Android互換・1本1MB前後）
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "videos"
FFMPEG = shutil.which("ffmpeg")
DUR = 5
FONT = "C\\:/Windows/Fonts/arial.ttf"

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def cut(src: Path, start: float, dst: Path):
    cmd = [FFMPEG, "-y", "-loglevel", "error",
           "-ss", str(start), "-i", str(src), "-t", str(DUR),
           "-vf", "scale=960:-2,fps=30", "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1",
           "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "medium", "-movflags", "+faststart", "-an", str(dst)]
    subprocess.run(cmd, check=True)


def main():
    if not FFMPEG:
        sys.exit("ffmpeg が見つかりません")
    clips = json.loads((ROOT / "tools" / "clips.json").read_text(encoding="utf-8"))["clips"]
    OUT.mkdir(exist_ok=True)
    for c in clips:
        src = RAW / f"temp_video_{c['src']}.mp4"
        if not src.exists():
            print("SKIP (元動画なし):", c["id"], src.name)
            continue
        dst = OUT / f"{c['id']}.mp4"
        cut(src, c["start"], dst)
        print(f"{c['id']}: {src.name} @{c['start']}s -> {dst.name} {dst.stat().st_size // 1024}KB  {c.get('note', '')}")
    if "--sheet" in sys.argv:
        # 全クリップ×5フレーム(1秒ごと)を1枚に。行=クリップ
        sheets = RAW / "sheets"
        sheets.mkdir(exist_ok=True)
        parts = []
        for c in clips:
            dst = OUT / f"{c['id']}.mp4"
            if not dst.exists():
                continue
            row = sheets / f"row_{c['id']}.jpg"
            vf = (f"fps=1,scale=320:-1,drawtext=fontfile='{FONT}':text='{c['id']} %{{pts\\:hms}}':fontcolor=yellow:fontsize=18:"
                  f"box=1:boxcolor=black@0.6:x=4:y=4,tile=5x1")
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(dst), "-vf", vf, "-frames:v", "1", "-q:v", "4", str(row)], check=True)
            parts.append(row)
        # 縦に連結
        inputs = []
        for p in parts:
            inputs += ["-i", str(p)]
        n = len(parts)
        filt = "".join(f"[{i}:v]" for i in range(n)) + f"vstack=inputs={n}"
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", filt, "-q:v", "4", str(sheets / "clips_check.jpg")], check=True)
        for p in parts:
            p.unlink()
        print("sheet:", sheets / "clips_check.jpg")


if __name__ == "__main__":
    main()
