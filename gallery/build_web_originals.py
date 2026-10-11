# -*- coding: utf-8 -*-
"""
【可选】生成适合上传 GitHub 的「网页优化版原图」。

为什么需要它：
    GitHub Pages 的源码仓库与发布站点都有 1 GB 的推荐上限，
    而原始 PNG 总量约 2.5 GB，直接上传会被拒绝或严重拖慢克隆。
    本脚本把每张图等比缩放到最长边 WEB_MAX_SIDE（默认 1600px），
    转成 WebP 存到 originals-web/，通常能把体积压到 1/8 左右，
    而灯箱显示尺寸上限约 1900px，画质损失几乎看不出来。

用法：
    python build_web_originals.py             # 全量生成到 originals-web/
    python build_web_originals.py --limit 30  # 先试做 30 张看看体积和效果

配合上传：
    生成后把 index.html 里的 ORIGINALS_DIR 改成 'originals-web/'
    （在 assets/app.js 顶部配置区，或见 README.txt 第三步）
"""
import argparse
import os
import shutil
import sys
import time
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.environ.get("SMG_SOURCES") or os.path.join(HERE, "originals")
DEST = os.path.join(HERE, "originals-web")

CATEGORIES = [
    "Novel芙兰单人区",
    "Novel芙兰蕾米百合区",
    "GPT芙兰区",
    "NSFW区",
    "不知如何分类区",
]
EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".jfif"}

WEB_MAX_SIDE = 1600
QUALITY = 86
BG = (13, 10, 14)


def total_size_mb(path):
    if not os.path.isdir(path):
        return 0.0
    s = 0
    for dp, _, fs in os.walk(path):
        for f in fs:
            s += os.path.getsize(os.path.join(dp, f))
    return s / 1048576


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
        if max(im.size) > WEB_MAX_SIDE:
            im.thumbnail((WEB_MAX_SIDE, WEB_MAX_SIDE), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0,
                    help="只处理每个分类的前 N 张，用于快速试算体积")
    ap.add_argument("--clean", action="store_true",
                    help="先删除已有的 originals-web 目录再重建")
    args = ap.parse_args()

    if args.clean and os.path.isdir(DEST):
        print("删除旧目录:", DEST)
        shutil.rmtree(DEST)

    if not os.path.isdir(SOURCES):
        print("!! 找不到图片目录:", SOURCES, file=sys.stderr)
        return 1

    print("图片目录:", SOURCES)
    print("输出目录:", DEST)
    print("最长边 %dpx / WebP quality %d%s"
          % (WEB_MAX_SIDE, QUALITY, "  (试做每类 %d 张)" % args.limit if args.limit else ""))
    print("-" * 56)

    t0 = time.time()
    done = failed = 0
    for cat in CATEGORIES:
        src_dir = os.path.join(SOURCES, cat)
        if not os.path.isdir(src_dir):
            print("!! 缺少文件夹:", cat, file=sys.stderr)
            continue
        dst_dir = os.path.join(DEST, cat)
        os.makedirs(dst_dir, exist_ok=True)
        names = [n for n in sorted(os.listdir(src_dir))
                 if os.path.splitext(n)[1].lower() in EXTS]
        if args.limit:
            names = names[:args.limit]
        for name in names:
            src = os.path.join(src_dir, name)
            dst = os.path.join(dst_dir, os.path.splitext(name)[0] + ".webp")
            if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
                continue
            try:
                convert(src, dst)
                done += 1
            except Exception as exc:
                failed += 1
                print("!! 失败:", name, exc, file=sys.stderr)
        print("  %-24s 完成 %d 张  (%.0fs)" % (cat, len(names), time.time() - t0), flush=True)

    out = total_size_mb(DEST)
    print("-" * 56)
    print("转换 %d 张，失败 %d 张，耗时 %.0fs" % (done, failed, time.time() - t0))
    print("originals  原始体积 : %7.1f MB" % total_size_mb(SOURCES))
    print("originals-web 优化后 : %7.1f MB" % out)
    if args.limit:
        print("（这是 --limit 试做结果，全量体积约为它的 %.0f 倍）"
              % (1103 / max(1, args.limit * 5)))
    print()
    print("下一步（二选一）：")
    print("  A) 运行  node switch_originals.mjs originals-web   自动切换配置")
    print("  B) 手动把 assets/app.js 改成：")
    print("         var ORIGINALS_DIR = 'originals-web/';")
    print("         var ORIGINALS_EXT = '.webp';")
    print("  然后上传 index.html / assets / data / thumbs / originals-web 这五样。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
