# -*- coding: utf-8 -*-
"""
扫描 originals/ 下的五个分类文件夹，提取所有图片的路径与原始尺寸，
生成 data/gallery.json（纯相对路径，方便整包上传发布）。

图片目录默认取 gallery/originals/<分类名>/。
若图片放在别处，可用环境变量指定：
    set SMG_SOURCES=D:\\我的图集
"""
import json
import os
import sys
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
# 图片目录：默认 gallery/originals（相对本脚本所在的 gallery 目录）
SOURCES = os.environ.get("SMG_SOURCES") or os.path.join(HERE, "originals")
OUT = os.path.join(HERE, "data", "gallery.json")

# 固定顺序：顶层导航必须按此顺序
CATEGORIES = [
    "Novel芙兰单人区",
    "Novel芙兰蕾米百合区",
    "GPT芙兰区",
    "NSFW区",
    "不知如何分类区",
]

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".jfif"}


def main():
    print("图片目录:", SOURCES)
    categories = []
    total = 0
    for cat in CATEGORIES:
        cat_dir = os.path.join(SOURCES, cat)
        if not os.path.isdir(cat_dir):
            print("!! 缺少文件夹:", cat, file=sys.stderr)
            continue
        items = []
        for name in sorted(os.listdir(cat_dir)):
            path = os.path.join(cat_dir, name)
            if not os.path.isfile(path):
                continue
            if os.path.splitext(name)[1].lower() not in EXTS:
                continue
            try:
                with Image.open(path) as im:
                    w, h = im.size
            except Exception as exc:  # 损坏文件跳过并提示
                print("!! 读取失败:", name, exc, file=sys.stderr)
                continue
            if w <= 0 or h <= 0:
                continue
            # [文件名, 宽, 高]
            items.append([name, w, h])
        total += len(items)
        categories.append({"name": cat, "images": items})
        print("  %-24s %4d 张" % (cat, len(items)))

    data = {"generated": True, "count": total, "categories": categories}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(OUT) / 1024
    print("共 %d 张图片 -> %s (%.0f KB)" % (total, OUT, size_kb))


if __name__ == "__main__":
    main()
