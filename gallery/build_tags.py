# -*- coding: utf-8 -*-
"""
生成 gallery/data/tags.json —— 标签筛选索引。
数据源：标签对照报告.csv（新文件名 / 原文件名 / 角色 / 人数 / 内容_XP / 分级 / 构图_镜头 / 画面风格）
对齐：gallery/data/gallery.json（按 分类 + 原文件名去扩展名 匹配）
只生成索引，不移动图片、不修改任何文件名。
"""
import csv
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(os.path.dirname(HERE), '标签对照报告.csv')
GALLERY_PATH = os.path.join(HERE, 'data', 'gallery.json')
OUT_PATH = os.path.join(HERE, 'data', 'tags.json')

# 场景 / 元素：从内容_XP 词汇中明确分离出的「非 XP」标签（其余 XP 标签只进搜索文本）
SCENE_TAGS = {
    '夜晚', '雨天', '雪景', '室内', '室外', '风景', '花',
    '猫耳', '兽耳', '尾巴', '翅膀', '双马尾', '眼镜', '帽子',
    '武器', '魔法', '弹幕', '战斗', '日常', '吸血鬼', '血',
    '哭', '笑', '睡颜', '回眸', '表情特写',
}

def split(s):
    return [t for t in (s or '').split() if t]


def main():
    with open(GALLERY_PATH, 'r', encoding='utf-8') as f:
        gallery = json.load(f)

    raw = open(CSV_PATH, 'rb').read().decode('utf-8-sig', errors='strict')
    rows = list(csv.reader(io.StringIO(raw)))
    header = rows[0]
    assert header[0] == '文件夹' and header[2] == '原文件名', header

    # 原文件名（去扩展名） -> 标签行
    tag_map = {}
    for r in rows[1:]:
        if not r or not r[2].strip():
            continue
        base = os.path.splitext(r[2].strip())[0]
        content = split(r[5])
        tag_map[(r[0].strip(), base)] = {
            'character': split(r[3]),
            'people': split(r[4]),
            'scene': [t for t in content if t in SCENE_TAGS],
            'rating': r[6].strip(),
            'shot': split(r[7]),
            'style': split(r[8]),
            'all': r[9].strip(),
        }

    out = {}
    matched = 0
    missing = []
    for cat in gallery['categories']:
        bucket = {}
        for img in cat['images']:
            name = img[0]
            base = os.path.splitext(name)[0]
            t = tag_map.get((cat['name'], base))
            if t is None:
                missing.append(f"{cat['name']}/{name}")
                continue
            matched += 1
            bucket[base] = t
        out[cat['name']] = bucket

    csv_total = len(rows) - 1
    print(f"CSV 行数: {csv_total} | 图库图片: {matched + len(missing)} | 匹配: {matched} | 缺失: {len(missing)}")
    if missing:
        print("未匹配样例:")
        for m in missing[:12]:
            print("  ", m)
        if len(missing) > 40:
            print("  … 请检查文件名是否一致")
        sys.exit(1)

    with open(OUT_PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print("written:", OUT_PATH, os.path.getsize(OUT_PATH), "bytes")


if __name__ == '__main__':
    main()
