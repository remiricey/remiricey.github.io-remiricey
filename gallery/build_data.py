# -*- coding: utf-8 -*-
"""
扫描图片目录，提取所有图片的文件名与「实际显示尺寸」，生成 data/gallery.json
（纯相对路径，方便整包上传发布）。

为什么尺寸要和实际显示的图一致：
    瀑布流靠清单里的宽高提前算好每张卡片的高度，避免滚动时跳动；
    灯箱的 srcset 也用它作为宽度描述符。
    所以生成 originals-web/ 之后必须重新跑一次本脚本，
    否则清单里还是原图尺寸，高清屏会按错误宽度选图。

读取哪个目录（优先级从高到低）：
    1) 命令行参数       python build_data.py originals-web
    2) 环境变量         set SMG_SOURCES=D:\\我的图集
    3) data/manifest.json 里记录的目录（生成网页优化图时会自动写入）
    4) 默认             gallery/originals/
"""
import json
import os
import sys
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "data", "gallery.json")
MANIFEST = os.path.join(HERE, "data", "manifest.json")
DEFAULT_SOURCE_DIR = "originals"

# 固定顺序：顶层导航必须按此顺序
CATEGORIES = [
    "Novel芙兰单人区",
    "Novel芙兰蕾米百合区",
    "GPT芙兰区",
    "NSFW区",
    "不知如何分类区",
]

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".jfif"}


def _dir_has_images(path):
    if not os.path.isdir(path):
        return False
    for d in os.listdir(path):
        sub = os.path.join(path, d)
        if not os.path.isdir(sub):
            continue
        if any(os.path.splitext(n)[1].lower() in EXTS for n in os.listdir(sub)):
            return True
    return False


def detect_source_dir():
    """决定读取哪一份图片，用来生成清单。

    优先级：
      1) 命令行参数       python build_data.py originals-web
      2) 环境变量         set SMG_SOURCES=D:\\我的图集
      3) data/manifest.json 里记录的目录（生成网页优化图时自动写入，
                            保证清单尺寸与实际上传的图一致）
      4) gallery/originals/ 或 ../originals/（自动探测）
    """
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        return sys.argv[1]
    env = os.environ.get("SMG_SOURCES")
    if env:
        return env
    if os.path.isfile(MANIFEST):
        try:
            with open(MANIFEST, encoding="utf-8") as fh:
                d = (json.load(fh).get("originalsDir") or "").strip("./").rstrip("/")
            if d and _dir_has_images(os.path.join(HERE, d)):
                return os.path.join(HERE, d)
        except Exception:
            pass
    for cand in (os.path.join(HERE, DEFAULT_SOURCE_DIR),
                 os.path.join(PARENT, DEFAULT_SOURCE_DIR)):
        if _dir_has_images(cand):
            return cand
    return os.path.join(HERE, DEFAULT_SOURCE_DIR)


SOURCES = detect_source_dir()


def main():
    print("图片目录:", SOURCES)
    print("清单输出:", OUT)
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
