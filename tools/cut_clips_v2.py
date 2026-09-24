#!/usr/bin/env python3
"""第3版(2026-09-24〜)の素材台帳 tools/clips_v2.json から 5秒クリップを作る。

第1・2版(tools/clips.json + raw/temp_video_*.mp4)とは別台帳。素材は PC 上の元ファイルを直接読む
（高橋さん写真集・ウェアラブルカメラ・睦沢ストール・iPhone写真。元ファイルには書き込まない）。

  動画: start 秒から5秒。5秒に満たない素材は 0.5倍スロー＋最後のコマで静止して5秒にそろえる
  写真: 5秒かけてゆっくり寄る（focus = center/left/right/top/bottom。rotate=90 で時計回りに回してから）
  縦長の素材は、ぼかした同じ映像を背景に敷き、大きく映して上から下へ流す（黒帯を出さない・小さくしない）
  台帳の任意項目: rotate(90/-90/180) / focus(写真の寄せ先) / anchor(縦撮り動画を流さず top/center/bottom で固定)
出力: videos/<video>.mp4  960x540 H.264 baseline 30fps 無音 faststart（第1版と同じ規格）

使い方:  python3 tools/cut_clips_v2.py            # 未作成のものだけ作る
         python3 tools/cut_clips_v2.py --force    # 全部作り直す
         python3 tools/cut_clips_v2.py q101 q102  # 指定のみ(作り直し)
"""
import json
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "videos"
LEDGER = ROOT / "tools" / "clips_v2.json"
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
DUR = 5.0
FPS = 30
ENC = [
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "26",
    "-preset",
    "medium",
    "-movflags",
    "+faststart",
    "-an",
]
# 16:9 に収める: 背景=拡大してぼかした同じ映像、前景=全体が入る大きさ
FIT = (
    "split[a][b];[a]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,boxblur=20:2[bg];"
    "[b]scale=960:540:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1"
)
PAN = {
    "center": ("iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
    "left": ("0", "ih/2-(ih/zoom/2)"),
    "right": ("iw-iw/zoom", "ih/2-(ih/zoom/2)"),
    "top": ("iw/2-(iw/zoom/2)", "0"),
    "bottom": ("iw/2-(iw/zoom/2)", "ih-ih/zoom"),
}


def src_path(c):
    p = Path(c["src"]).expanduser()
    return p if p.is_absolute() else Path.home() / p


def duration(p):
    o = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(p),
        ],
        capture_output=True,
        text=True,
    ).stdout.strip()
    return float(o) if o else 0.0


def is_portrait(src, rotate=0):
    """表示上の縦横（メタデータの回転と rotate 指定を反映）で縦長か"""
    j = json.loads(subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", str(src)],
        capture_output=True, text=True).stdout or "{}")
    st = (j.get("streams") or [{}])[0]
    w, h = st.get("width", 1), st.get("height", 1)
    r = int(float((st.get("tags") or {}).get("rotate", 0) or 0))
    for sd in st.get("side_data_list") or []:
        if "rotation" in sd:
            r = int(float(sd["rotation"]))
    if (r + int(rotate or 0)) % 180:
        w, h = h, w
    return h > w * 1.05


def fit_portrait(active, anchor=None):
    """縦撮り動画: 枠の幅6割まで拡大し、上から下へゆっくり流す（全体を入れると枠の3割になり小さすぎる）
    anchor=top/center/bottom なら流さずその位置で固定（見せたい物が上や下に偏っている素材用）"""
    span = max(1.0, active - 0.6)
    y = {"top": "0", "center": "-(h-H)/2", "bottom": "-(h-H)"}.get(anchor, f"-(h-H)*clip((t-0.3)/{span:.2f},0,1)")
    return ("split[a][b];[a]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,boxblur=20:2[bg];"
            f"[b]scale=576:-2[fg];[bg][fg]overlay=x=(W-w)/2:y='{y}':eval=frame,setsar=1")


def cut_video(src, start, dst, rotate=0, anchor=None):
    rot = {90: "transpose=1,", -90: "transpose=2,", 270: "transpose=2,", 180: "hflip,vflip,"}.get(int(rotate or 0), "")
    d = duration(src)
    avail = max(0.0, d - start)
    portrait = is_portrait(src, rotate)
    if avail >= DUR:
        vf = f"{rot}fps={FPS},{fit_portrait(DUR, anchor) if portrait else FIT}"
        cmd = [
            FFMPEG,
            "-y",
            "-loglevel",
            "error",
            "-ss",
            str(start),
            "-i",
            str(src),
            "-t",
            str(DUR),
            "-filter_complex",
            vf,
            *ENC,
            str(dst),
        ]
    else:
        slow = 2.0 if avail * 2 <= DUR else DUR / avail
        pad = max(0.0, DUR - avail * slow) + 0.5
        fit = fit_portrait(min(DUR, avail * slow), anchor) if portrait else FIT
        vf = f"{rot}setpts={slow}*PTS,fps={FPS},{fit},tpad=stop_mode=clone:stop_duration={pad:.2f}"
        cmd = [
            FFMPEG,
            "-y",
            "-loglevel",
            "error",
            "-ss",
            str(start),
            "-i",
            str(src),
            "-filter_complex",
            vf,
            "-t",
            str(DUR),
            *ENC,
            str(dst),
        ]
    subprocess.run(cmd, check=True)


def cut_image(src, focus, dst, rotate=0):
    # HEIC/回転情報を sips+PIL で焼き込んだ JPEG にしてから ffmpeg へ
    from PIL import Image, ImageOps

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "a.jpg"
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-Z", "2400", str(src), "--out", str(tmp)],
            check=True,
            capture_output=True,
        )
        im = ImageOps.exif_transpose(Image.open(tmp)).convert("RGB")
        if rotate:
            im = im.rotate(-int(rotate), expand=True)  # rotate=90 は時計回り90°、-90 は反時計回り（横倒しで保存された写真）
        fixed = Path(td) / "b.jpg"
        im.save(fixed, quality=92)
        n = int(DUR * FPS)
        CW, CH = 2880, 1620  # 合成キャンバス（zoompan の拡大でぼけないよう出力の3倍）
        fit_w = CH * im.width / im.height  # 全体が入る大きさにしたときの写真の幅
        if fit_w < CW * 0.8:
            # 縦長: 最初の1.2秒は全体 → 0.8秒で横幅いっぱいまで寄る → 残り3秒で上から下へ流す
            # （16:9 の枠に全体を入れたままだと写真が枠の4割ほどになり、スマホでは小さすぎる）
            zmax = CW / fit_w
            t0, t1 = int(1.2 * FPS), int(2.0 * FPS)
            z = f"if(lt(on,{t0}),1,if(lt(on,{t1}),1+{zmax - 1:.4f}*(on-{t0})/{t1 - t0},{zmax:.4f}))"
            x = "iw/2-(iw/zoom/2)"
            y = f"(ih-ih/zoom)*if(lt(on,{t1}),0,min(1,(on-{t1})/{n - t1 - FPS // 3}))"
        else:
            z = f"1+0.15*on/{n}"
            x, y = PAN.get(focus or "center", PAN["center"])
        vf = (
            f"scale={CW}:{CH}:force_original_aspect_ratio=increase,crop={CW}:{CH},boxblur=30:2[bg];"
            f"[0:v]scale={CW}:{CH}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,"
            f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s=960x540:fps={FPS},setsar=1"
        )
        cmd = [
            FFMPEG,
            "-y",
            "-loglevel",
            "error",
            "-loop",
            "1",
            "-framerate",
            str(FPS),
            "-i",
            str(fixed),
            "-filter_complex",
            f"[0:v]{vf}",
            "-frames:v",
            str(n),
            *ENC,
            str(dst),
        ]
        subprocess.run(cmd, check=True)


def make(c):
    dst = OUT / f"{c['video']}.mp4"
    src = src_path(c)
    if not src.exists():
        return f"SKIP 元素材なし {c['video']} {src}"
    try:
        if c["kind"] == "image":
            cut_image(src, c.get("focus"), dst, c.get("rotate") or 0)
        else:
            cut_video(src, float(c.get("start") or 0), dst, c.get("rotate") or 0, c.get("anchor"))
    except subprocess.CalledProcessError as e:
        return f"NG {c['video']}: {e}"
    return f"{c['video']}: {dst.stat().st_size // 1024}KB  {c.get('media', '')} {c.get('scene', '')[:30]}"


def main():
    if not (FFMPEG and FFPROBE):
        sys.exit("ffmpeg/ffprobe が見つかりません")
    clips = json.loads(LEDGER.read_text(encoding="utf-8"))["clips"]
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if only:
        todo = [c for c in clips if c["video"] in only]
    else:
        todo = [c for c in clips if force or not (OUT / f"{c['video']}.mp4").exists()]
    OUT.mkdir(exist_ok=True)
    # ffmpeg を大量並列にするとメモリ不足で落ちることがある(第1版の実測)→ 4並列まで
    with ThreadPoolExecutor(4) as ex:
        for line in ex.map(make, todo):
            print(line)
    print(f"完了: {len(todo)}本")


if __name__ == "__main__":
    main()
