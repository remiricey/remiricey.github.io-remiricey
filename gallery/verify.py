# -*- coding: utf-8 -*-
"""对静态站点做一致性校验（不依赖浏览器）。"""
import json
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))

html = open(os.path.join(HERE, 'index.html'), encoding='utf-8').read()
js = open(os.path.join(HERE, 'assets', 'app.js'), encoding='utf-8').read()
css = open(os.path.join(HERE, 'assets', 'style.css'), encoding='utf-8').read()

print('=== 1. DOM id 一致性 ===')
ids_js = set(re.findall(r"getElementById\('([^']+)'\)", js))
ids_html = set(re.findall(r'id="([^"]+)"', html))
print('  JS 引用 id 数:', len(ids_js), '| HTML 定义 id 数:', len(ids_html))
print('  缺失:', sorted(ids_js - ids_html) or '无 OK')

print('=== 2. CSS 选择器覆盖 ===')
need = ['card', 'card-idx', 'round-tag', 'sentinel', 'masonry', 'lightbox',
        'lb-btn', 'lb-backdrop', 'lb-cap', 'sns', 'sns-bili', 'sns-dy', 'sns-xhs',
        'about-text', 'about-note', 'fatal', 'tabs', 'tab', 'scroll-progress']
print('  缺失:', [c for c in need if ('.' + c) not in css] or '无 OK')

print('=== 3. 导言文字与社交链接 ===')
text = re.sub(r'<[^>]+>', '', html).replace('&nbsp;', ' ')
for frag in ['本网站为个人制作网站，如需搬运使用商业合作，请联系个人，',
             '@B站 蕾米粒呀', '@抖音 蕾米粒呀', '@小红书 蕾米粒呀']:
    print('  %-30s %s' % (frag, 'OK' if frag in text else '缺失!'))

links = {'https://b23.tv/lU4FqHJ': 'B站 粉',
         'https://v.douyin.com/ddOjaJSAevY/': '抖音 青',
         'https://xhslink.cn/o/AeTITc7bLXU': '小红书 红'}
for url, name in links.items():
    m = re.search(r'<a\b[^>]*href="%s"[^>]*>' % re.escape(url), html)
    if not m:
        print('  %-10s 链接未找到!' % name)
        continue
    tag = m.group(0)
    print('  %-10s target=_blank:%s  noopener:%s  类名:%s'
          % (name,
             'OK' if 'target="_blank"' in tag else '缺失',
             'OK' if 'noopener' in tag else '缺失',
             (re.search(r'class="([^"]+)"', tag) or ['', '?'])[1]))

print('=== 4. URL 规则 -> 真实文件 ===')
g = json.load(open(os.path.join(HERE, 'data', 'gallery.json'), encoding='utf-8'))

# 从 app.js 读出发布时实际使用的原图目录，保证校验跟着配置走
m = re.search(r"ORIGINALS_DIR\s*=\s*'([^']+)'", js)
ORIGINALS_DIR = m.group(1) if m else 'originals/'
print('  app.js 中的 ORIGINALS_DIR =', repr(ORIGINALS_DIR))


def enc(p):
    return '/'.join(urllib.parse.quote(s, safe='') for s in p.split('/'))


bad_th = bad_full = 0
n = 0
for c in g['categories']:
    for item in c['images']:
        stem = os.path.splitext(item[0])[0]
        th = enc('thumbs/' + c['name'] + '/' + stem + '.webp')
        fu = enc(ORIGINALS_DIR + c['name'] + '/' + item[0])
        n += 1
        if not os.path.isfile(os.path.join(HERE, urllib.parse.unquote(th))):
            bad_th += 1
        if not os.path.isfile(os.path.join(HERE, urllib.parse.unquote(fu))):
            bad_full += 1
print('  校验 %d 张 | 缩略图路径错误 %d | 原图路径错误 %d' % (n, bad_th, bad_full))

print('=== 4b. 相对路径 / 可移植性 ===')
print('  生成路径使用 ./ 相对前缀:', 'OK' if re.search(r"return '\./' \+", js) else '缺失!')

# 只看「资源」URL：href/src 里排除外链与 data: 之后，必须都是相对路径
res = [u for u in re.findall(r'(?:href|src)="([^"]+)"', html) if not u.startswith('data:')]
assets = [u for u in res if not u.startswith(('http://', 'https://'))]
ext_links = [u for u in res if u.startswith(('http://', 'https://'))]
print('  本地资源引用:', assets)
print('  本地资源均为相对路径:',
      'OK' if assets and all(not u.startswith(('/', 'http://', 'https://')) for u in assets)
      else '存在绝对路径!')
print('  站外链接（社交账号，属正常）:', len(ext_links), '个 ->', ext_links)
print('  .gitignore 已排除原图目录:',
      'OK' if os.path.isfile(os.path.join(HERE, '.gitignore'))
      and ORIGINALS_DIR.rstrip('/') + '/' in open(os.path.join(HERE, '.gitignore'), encoding='utf-8').read()
      else '建议检查')

print('=== 5. 展示逻辑硬性要求 ===')
checks = [
    ('顶层分类顺序固定', [c['name'] for c in g['categories']] ==
     ['Novel芙兰单人区', 'Novel蕾米芙兰百合区'.replace('蕾米芙兰', '芙兰蕾米'), 'GPT芙兰区', 'NSFW区', '不知如何分类区']),
    ('JS 使用 Fisher-Yates 随机', 'function shuffle' in js and 'Math.random' in js),
    ('最短列瀑布流算法', 'shortestCol' in js),
    ('IntersectionObserver 无限滚动', 'IntersectionObserver' in js and 'rootMargin' in js),
    ('懒加载 (data-src)', 'data-src' in js),
    ('灯箱左右切换 / 键盘', 'ArrowLeft' in js and 'ArrowRight' in js and 'Escape' in js),
    ('点击遮罩关闭', 'lb.backdrop.addEventListener' in js),
    ('列间距 16px', '--gap:           16px' in css or '--gap: 16px' in css),
    ('图片 max-height 400', 'IMG_MAX_H    = 400' in js),
    ('悬停 scale(1.02)', 'scale(1.02)' in css),
    ('object-fit: contain', 'object-fit: contain' in css),
    ('响应式列数 2/3/4/5', 'return 5' in js and 'return 4' in js and 'return 3' in js and 'return 2' in js),
]
for name, ok in checks:
    print('  [%s] %s' % ('v' if ok else 'x', name))
