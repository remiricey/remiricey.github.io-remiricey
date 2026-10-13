# -*- coding: utf-8 -*-
"""
为每个分类生成 WebP 缩略图，用于瀑布流快速渲染（灯箱仍加载原图）。
- 最大边长限制（宽或高）MAX_SIDE，保持原始比例，绝不裁剪/拉伸
- RGBA / P 模式先合成到暗色背景（与页面底色一致），避免透明区域变成白块
- 已存在且比原图新的缩略图会跳过，支持断点续跑

图片源目录自动探测，兼容两种摆放方式：
    gallery/originals/      （图集自带）
    ../originals/           （放在项目根目录，与 gallery 分开）
也可用环境变量覆盖：
    set SMG_SOURCES=D:\\我的图集
"""
import os
import sys
import time
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)
THUMBS = os.path.join(HERE, "thumbs")

CATEGORIES = [
    "Novel芙兰单人区",
    "Novel芙兰蕾米百合区",
    "GPT芙兰区",
    "NSFW区",
    "不知如何分类区",
]

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".jfif"}


def find_source_dir():
    """找出原图目录。优先选带「原始扩展名」的那一份，
    这样缩略图文件名才能和清单里的文件名对上。"""
    env = os.environ.get("SMG_SOURCES")
    if env:
        return env
    for cand in (os.path.join(HERE, "originals"), os.path.join(PARENT, "originals")):
        if not os.path.isdir(cand):
            continue
        for d in os.listdir(cand):
            sub = os.path.join(cand, d)
            if os.path.isdir(sub) and any(
                    os.path.splitext(n)[1].lower() in EXTS for n in os.listdir(sub)):
                return cand
    return os.path.join(HERE, "originals")


SOURCES = find_source_dir()
MAX_SIDE = 520          # 缩略图最长边像素
QUALITY = 82
BG = (13, 10, 14)       # 暗黑哥特底色，用于 alpha 合成


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
        dst_dir = os.path.join(THUMBS, cat)
        if not os.path.isdir(src_dir):
            continue
        os.makedirs(dst_dir, exist_ok=True)
        names = [n for n in sorted(os.listdir(src_dir))
                 if os.path.splitext(n)[1].lower() in EXTS
                 and os.path.isfile(os.path.join(src_dir, n))]
        for name in names:
            src = os.path.join(src_dir, name)
            dst = os.path.join(dst_dir, os.path.splitext(name)[0] + ".webp")
            if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
                skipped += 1
                continue
            try:
                convert(src, dst)
                done += 1
            except Exception as exc:
                failed += 1
                print("!! 失败:", name, exc, file=sys.stderr)
            if (done + skipped + failed) % 50 == 0:
                print("  ... %d/%d  (%.0fs)" % (done + skipped + failed, 1103, time.time() - t0), flush=True)
        print("[完成] %s  新建 %d 跳过 %d 失败 %d  (%.0fs)"
              % (cat, done, skipped, failed, time.time() - t0), flush=True)
    total_mb = sum(os.path.getsize(os.path.join(dp, f))
                   for dp, _, fs in os.walk(THUMBS) for f in fs) / 1048576
    print("缩略图总计 %.1f MB，新建 %d，跳过 %d，失败 %d，耗时 %.0fs"
          % (total_mb, done, skipped, failed, time.time() - t0))


if __name__ == "__main__":
    main()
