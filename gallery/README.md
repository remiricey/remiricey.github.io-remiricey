# 绯月画廊 · Scarlet Moon Gallery

芙兰朵露（Flandre Scarlet）个人图集 · 暗黑哥特风静态画廊。
纯前端实现（HTML / CSS / 原生 JS），**无第三方依赖、无需构建、无后端框架**。

> 想上传到 GitHub 发布到网上，请看 **[README.txt](README.txt)**（含分步操作与体积方案）。

---

## 一、访问方式

`gallery` 是自包含目录，所有路径均为相对路径，搬到哪里都能跑。

**本地预览**（在 `gallery` 目录下执行）：

```powershell
python -m http.server 8000
```

然后访问 <http://127.0.0.1:8000/index.html>

> 不要直接双击 `index.html` —— `file://` 协议下浏览器会拒绝读取
> `data/gallery.json`，页面会给出明确提示。

**线上部署**：整个 `gallery` 目录即网站根目录，放到任何静态托管
（GitHub Pages / Cloudflare Pages / Netlify / 自己的服务器）的根目录或子目录都可以，
页面用 `./` 相对路径取资源，不依赖域名与部署路径。

---

## 二、目录结构

```
gallery/
├─ index.html                  页面入口
├─ assets/
│  ├─ style.css                暗黑哥特样式
│  └─ app.js                   瀑布流 / 懒加载 / 无限滚动 / 灯箱
├─ data/gallery.json           图片清单（文件名 + 原始宽高），由脚本生成
├─ thumbs/<分类>/*.webp        缩略图 1x + 2x，共 2206 张，约 165 MB
├─ originals/<分类>/*.png      原图 1103 张，约 2.5 GB（灯箱用，不上传）
├─ originals-web/<分类>/*.webp 网页优化版原图（可选，供上传用）
├─ build_data.py               扫描图片 → data/gallery.json
├─ build_thumbs.py             生成 1x 缩略图
├─ build_thumbs_2x.py          生成 2x 缩略图
├─ build_web_originals.py      生成适合上传的网页优化版原图
├─ verify.py                   静态自检
├─ cdp_test.mjs                真实浏览器端到端测试（47 项）
├─ README.txt                  上传 GitHub 的操作说明
└─ .gitignore                  已排除 originals/
```

图片目录默认取 `gallery/originals/<分类名>/`，可用环境变量指向别处：

```powershell
$env:SMG_SOURCES = "D:\我的图集"
python build_data.py
```

---

## 三、功能对照

| 需求 | 实现 |
| --- | --- |
| 顶部分类导航 | 顺序固定：Novel芙兰单人区 → Novel芙兰蕾米百合区 → GPT芙兰区 → NSFW区 → 不知如何分类区 |
| 分类内随机 | Fisher–Yates 洗牌，每次刷新 / 切换 / 点「打乱」都重新随机 |
| 响应式瀑布流 | JS 动态计算，每张图放进当前**最短的那一列**；列数 2 / 3 / 4 / 5 自适应 |
| 保持原图比例 | 卡片尺寸按原图宽高精确计算，不拉伸不裁剪；超 400px 的长图等比收窄并居中，无黑边 |
| 尺寸限制 | 单图 `max-height: 400px`、`object-fit: contain`；列间距 16px |
| 悬停效果 | `transform: scale(1.02)` + 暗红辉光，只动自身、不影响邻居排版 |
| 懒加载 | `loading="lazy"` + IntersectionObserver，接近视口才加载 |
| 无限滚动 | 距底部 1400px 自动重新洗牌并追加下一轮，带 `ROUND n` 标记；DOM 超 1200 张回收最旧的 |
| 灯箱 | 全屏暗色遮罩 + 原图画质；`←` `→` 切换、`Esc` 关闭、点遮罩或 ✕ 关闭；支持滚轮与手机滑动 |
| 关于导言 | 页脚「关于 · 导言」，含指定文字与三个平台链接 |
| 社交链接 | B站（粉）· 抖音（青）· 小红书（红），悬停高亮 + 心跳图标，新标签页打开 |
| 移动端 | 文字自动换行不溢出、页脚居中、2 列瀑布流、标签可横向滑动 |
| NSFW 折叠 | 默认折叠，顶栏「显示 NSFW」解锁后展示 |

### 快捷键

- `←` / `→`：灯箱内切换上一张 / 下一张；灯箱关闭时切换上一个 / 下一个分类
- `Esc`：关闭灯箱
- 点击卡片（或聚焦后按 `Enter` / `空格`）打开大图

---

## 四、维护脚本

```powershell
# 新增/删除图片后，重新生成清单与缩略图
python gallery\build_data.py
python gallery\build_thumbs.py
python gallery\build_thumbs_2x.py

# 需要上传 GitHub 时，生成网页优化版原图（不动原文件）
python gallery\build_web_originals.py

# 自检
python gallery\verify.py
node gallery\cdp_test.mjs
```

---

## 五、备注

- 图集内容为个人收藏整理，角色版权归原作者所有，仅供本地欣赏。
- 缩略图与原图分开存放：浏览只加载小图，灯箱才加载原图画质。
- `data/gallery.json` 记录的是**原始宽高**，因此瀑布流在图片加载前就算好高度，滚动不跳动。
