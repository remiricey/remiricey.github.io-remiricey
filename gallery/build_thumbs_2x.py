# -*- coding: utf-8 -*-
"""
生成 2x 缩略图（<name>@2x.webp），供 srcset 在普通屏 / 高清屏之间自动选择。
保持与 1x 完全相同的处理：不裁剪、保持比例、透明区域合成暗色底。

图片源目录默认 gallery/originals/<分类名>/，可用环境变量覆盖：
    set SMG_SOURCES=D:\\我的图集
"""
import os
import sys
import time
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.environ.get("SMG_SOURCES") or os.path.join(HERE, "originals")
THUMBS = os.path.join(HERE, "thumbs")

CATEGORIES = [
    "Novel芙兰单人区",
    "Novel芙兰蕾米百合区",
    "GPT芙兰区",
    "NSFW区",
    "不知如何分类区",
]
EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".jfif"}
MAX_SIDE = 1040         # 2x：最长边 1040（1x 为 520）
QUALITY = 78
BG = (13, 10, 14)


def convert(src, dst):
    with Image.open(src) as im:
        im.load()
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            flat = Image.new("RGB", rgba.size, BG)
            flat.paste(rgba, mask=rgba.split()[-1])
            im = flat
        elif im.mode != "RGB":
            im = im.convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=5)


def main():
    t0 = time.time()
    print("图片目录:", SOURCES)
    done = skipped = failed = 0
    for cat in CATEGORIES:
        src_dir = os.path.join(SOURCES, cat)
        if not os.path.isdir(src_dir):
            continue
        names = [n for n in sorted(os.listdir(src_dir))
                 if os.path.splitext(n)[1].lower() in EXTS]
        for name in names:
            src = os.path.join(src_dir, name)
            dst = os.path.join(THUMBS, cat, os.path.splitext(name)[0] + "@2x.webp")
            if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
                skipped += 1
                continue
            try:
                convert(src, dst)
                done += 1
            except Exception as exc:
                failed += 1
                print("!! 失败:", name, exc, file=sys.stderr)
        print("[完成] %s  新建 %d 跳过 %d 失败 %d  (%.0fs)"
              % (cat, done, skipped, failed, time.time() - t0), flush=True)

    files = [os.path.join(dp, f) for dp, _, fs in os.walk(THUMBS) for f in fs]
    total = sum(os.path.getsize(f) for f in files) / 1048576
    twos = sum(1 for f in files if f.endswith('@2x.webp'))
    print("2x 缩略图 %d 个；thumbs 目录共 %d 个文件 / %.1f MB；耗时 %.0fs"
          % (twos, len(files), total, time.time() - t0))


if __name__ == "__main__":
    main()
