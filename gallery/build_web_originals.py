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
    python build_web_originals.py                  # 全量生成 originals-web/
    python build_web_originals.py --limit 30       # 先试做 30 张看体积
    python build_web_originals.py --check          # 只体检：列出缺失/过期/多余的图，不生成
    python build_web_originals.py --from 别的目录 --to 别的输出目录

更新图片时的正确顺序（见 README.txt 第九节）：
    1) 新图放进 originals/<分类>/
    2) python build_data.py
    3) python build_thumbs.py  &&  python build_thumbs_2x.py
    4) python build_web_originals.py        # 只会处理新增/改动的图
    5) node switch_originals.mjs originals-web
    （本脚本结束时也会自动重新生成 data/gallery.json 与 data/manifest.json）
"""
import argparse
import json
import os
import shutil
import sys
import time
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)

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


def find_default_source():
    """自动找出原图目录，兼容两种常见摆放方式：
         gallery/originals/     （图集自带）
         ../originals/          （放在项目根目录，与 gallery 分开）
    也支持环境变量 SMG_SOURCES 手动指定。"""
    env = os.environ.get("SMG_SOURCES")
    if env:
        return env
    for cand in (os.path.join(HERE, "originals"), os.path.join(PARENT, "originals")):
        if not os.path.isdir(cand):
            continue
        for d in os.listdir(cand):
            sub = os.path.join(cand, d)
            if not os.path.isdir(sub):
                continue
            if any(os.path.splitext(n)[1].lower() in EXTS for n in os.listdir(sub)):
                return cand
    return os.path.join(HERE, "originals")


DEFAULT_FROM = find_default_source()
DEFAULT_TO = os.path.join(HERE, "originals-web")
MANIFEST = os.path.join(HERE, "data", "manifest.json")


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


def scan(src_dir, dst_dir):
    """体检：返回 (待处理, 已最新, 输出里多余的) 三组文件名。"""
    todo, fresh, orphans = [], [], []
    for cat in CATEGORIES:
        s = os.path.join(src_dir, cat)
        d = os.path.join(dst_dir, cat)
        want = set()
        if os.path.isdir(s):
            for name in sorted(os.listdir(s)):
                if os.path.splitext(name)[1].lower() not in EXTS:
                    continue
                dst = os.path.join(d, os.path.splitext(name)[0] + ".webp")
                want.add(os.path.basename(dst))
                if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(os.path.join(s, name)):
                    fresh.append(cat + "/" + name)
                else:
                    todo.append(cat + "/" + name)
        if os.path.isdir(d):
            for name in os.listdir(d):
                if name not in want:
                    orphans.append(cat + "/" + name)
    return todo, fresh, orphans


def write_manifest(originals_dir):
    """记录当前使用的原图目录，并重新生成 data/gallery.json，
    使清单里的尺寸与实际要显示的图片完全一致（灯箱 srcset 依赖它）。"""
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"originalsDir": originals_dir, "ext": ".webp",
                   "maxSide": WEB_MAX_SIDE, "quality": QUALITY},
                  fh, ensure_ascii=False, indent=2)

    build_data = os.path.join(HERE, "build_data.py")
    if not os.path.isfile(build_data):
        return
    print("-" * 56)
    print("重新生成清单（尺寸取自 %s）…" % originals_dir)
    import subprocess
    rc = subprocess.call([sys.executable, build_data,
                          os.path.join(HERE, originals_dir)])
    if rc != 0:
        print("!! 清单生成失败，请手动运行： python build_data.py %s" % originals_dir,
              file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0,
                    help="只处理每个分类的前 N 张，用于快速试算体积")
    ap.add_argument("--clean", action="store_true",
                    help="先删除已有的输出目录再重建")
    ap.add_argument("--from", dest="src", default=DEFAULT_FROM,
                    help="原图目录（默认 originals/）")
    ap.add_argument("--to", dest="dst", default=DEFAULT_TO,
                    help="输出目录（默认 originals-web/）")
    ap.add_argument("--check", action="store_true",
                    help="只体检并列出缺失/过期/多余的图片，不做任何转换")
    args = ap.parse_args()

    SOURCES, DEST = args.src, args.dst

    if args.clean and os.path.isdir(DEST):
        print("删除旧目录:", DEST)
        shutil.rmtree(DEST)

    if not os.path.isdir(SOURCES):
        print("!! 找不到图片目录:", SOURCES, file=sys.stderr)
        return 1

    # ---------- 体检模式 ----------
    if args.check:
        todo, fresh, orphans = scan(SOURCES, DEST)
        print("原图目录:", SOURCES)
        print("输出目录:", DEST)
        print("-" * 56)
        print("已是最新 : %4d 张" % len(fresh))
        print("缺失/过期: %4d 张" % len(todo))
        print("输出里多余（原图已删）: %4d 个" % len(orphans))
        for label, items in (("需处理", todo), ("多余", orphans)):
            if items:
                print("\n%s（最多列出 15 个）:" % label)
                for it in items[:15]:
                    print("   ", it)
        if todo or orphans:
            print("\n建议：在项目目录下运行  python build_web_originals.py"
                  " --clean  重新生成一份干净的输出。")
        else:
            print("\n一切正常，无需处理。")
        return 0

    print("原图目录:", SOURCES)
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
    print("原图体积            : %7.1f MB  (%s)" % (total_size_mb(SOURCES), SOURCES))
    print("网页优化版体积      : %7.1f MB  (%s)" % (out, DEST))

    # 原图被删掉时，输出目录里会留下多余的图，顺手提示
    _, _, orphans = scan(SOURCES, DEST)
    if orphans:
        print()
        print("注意：输出目录里有 %d 个文件在原图目录中已不存在。" % len(orphans))
        print("      如想让两边完全一致，运行： python build_web_originals.py --clean")

    if failed:
        print()
        print("有 %d 张转换失败，请检查上面的错误信息。" % failed, file=sys.stderr)

    # 关键：清单里的尺寸必须取自「实际显示的图片」，否则灯箱 srcset 会选错
    rel = os.path.relpath(DEST, HERE).replace("\\", "/") + "/"
    write_manifest(rel)

    if args.limit:
        print("（这是 --limit 试做结果，不是完整清单）")
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
