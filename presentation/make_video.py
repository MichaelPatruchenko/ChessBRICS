"""Render an instrumental 1080p demo with animated feature callouts."""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
W, H = 1920, 1080
FPS = 30
ACCENT = "#d9ed8b"
MUSIC = ROOT.parent / "public" / "audio" / "lobby-cozy-evening.mp3"


def font(size, bold=False):
    return ImageFont.truetype("segoeuib.ttf" if bold else "segoeui.ttf", size)


def wrapped(draw, text, x, y, width, face, fill, leading):
    line = ""
    for word in text.split():
        candidate = (line + " " + word).strip()
        if line and draw.textlength(candidate, font=face) > width:
            draw.text((x, y), line, font=face, fill=fill)
            y += leading
            line = word
        else:
            line = candidate
    draw.text((x, y), line, font=face, fill=fill)
    return y + leading


def frame(scene, capture, path, number, count, backdrop):
    canvas = backdrop.copy()
    draw = ImageDraw.Draw(canvas)
    draw.text((76, 44), "ШАХМАТЫ БРИКС", font=font(32, True), fill="#f4f1e8")
    draw.text((1842, 53), f"{number:02} / {count:02}", anchor="ra", font=font(23, True), fill=ACCENT)
    draw.line((76, 101, 1844, 101), fill="#566553", width=2)
    draw.line((76, 101, 76 + 1768 * number / count, 101), fill=ACCENT, width=3)

    with Image.open(capture / (scene["image"] + ".png")) as source:
        shot = source.convert("RGB")
    shot.thumbnail((1260, 875), Image.Resampling.LANCZOS)
    # Leave space for the pop-up, including on desktop frames with a wide side panel.
    x = 76 + (1260 - shot.width) // 2
    y = 137 + (875 - shot.height) // 2
    draw.rounded_rectangle((x-4, y-4, x+shot.width+4, y+shot.height+4), 12, fill="#4c594c")
    canvas.paste(shot, (x,y))
    canvas.save(path)


def popup(scene, path):
    width = 548
    sample = Image.new("RGBA",(width,640))
    draw = ImageDraw.Draw(sample)
    draw.text((30,27),scene["tag"],font=font(20,True),fill=ACCENT)
    bottom = wrapped(draw,scene["title"],30,66,width-60,font(44,True),"#f7f4eb",52)
    bottom = wrapped(draw,scene["subtitle"],30,bottom+18,width-60,font(29),"#cbd3c6",40)
    height = bottom+24
    card = Image.new("RGBA",(width,height))
    base = ImageDraw.Draw(card)
    base.rounded_rectangle((0,0,width-1,height-1),22,fill="#202924",outline="#71865e",width=2)
    base.rounded_rectangle((30,19,62,22),2,fill=ACCENT)
    card.alpha_composite(sample.crop((0,0,width,height)))
    card.save(path)
    return height


def ffmpeg(*args):
    subprocess.run(["ffmpeg","-y","-loglevel","error",*args],check=True)


def render(capture, output, music):
    scenes = json.loads((ROOT / "scenes.json").read_text(encoding="utf-8"))
    background_file = ROOT.parent / "public" / "club-background.webp"
    with Image.open(background_file) as source:
        backdrop = ImageOps.fit(source.convert("RGB"),(W,H))
    backdrop = Image.blend(backdrop,Image.new("RGB",(W,H),"#121819"),.75)
    total = sum(scene["seconds"] for scene in scenes)

    with tempfile.TemporaryDirectory(prefix="brics-video-") as folder:
        temp = Path(folder)
        clips = []
        for i, scene in enumerate(scenes):
            still, callout, clip = (temp / f"{i}-{name}" for name in ("frame.png","popup.png","clip.mp4"))
            frame(scene,capture,still,i+1,len(scenes),backdrop)
            height = popup(scene,callout)
            y = min(660,1006-height)
            duration = scene["seconds"]
            motion = f"{y}+48*pow(max(0,1-(t-0.22)/0.38),3)"
            graph = (f"[1:v]format=rgba,fade=t=in:st=0.22:d=0.38:alpha=1,"
                     f"fade=t=out:st={duration-.36:.2f}:d=0.28:alpha=1[card];"
                     f"[0:v][card]overlay=x=1294:y='{motion}':eval=frame,format=yuv420p")
            ffmpeg("-filter_complex_threads","1",
                   "-loop","1","-framerate",str(FPS),"-i",str(still),
                   "-loop","1","-framerate",str(FPS),"-i",str(callout),
                   "-filter_complex",graph,"-t",str(duration),"-an","-c:v","libx264",
                   "-preset","fast","-crf","17",str(clip))
            clips.append(f"file '{clip.name}'")
        manifest = temp / "concat.txt"
        manifest.write_text("\n".join(clips)+"\n",encoding="ascii")
        result = temp / "demo.mp4"
        ffmpeg("-f","concat","-safe","0","-i",str(manifest),
               "-stream_loop","-1","-i",str(music),"-t",str(total),
               "-map","0:v:0","-map","1:a:0","-c:v","copy",
               "-af",f"volume=0.8,afade=t=in:d=1.2,afade=t=out:st={total-2.2:.2f}:d=2.2",
               "-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",str(result))
        # Keep the previous deliverable intact if a render fails.
        shutil.copyfile(result,output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("capture",type=Path)
    parser.add_argument("--output",type=Path,default=ROOT / "chessbrics-presentation.mp4")
    parser.add_argument("--music",type=Path,default=MUSIC)
    args = parser.parse_args()
    render(args.capture,args.output,args.music)

