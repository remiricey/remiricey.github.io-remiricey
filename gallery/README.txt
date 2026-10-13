================================================================
 绯月画廊 · Scarlet Moon Gallery  —— 发布到 GitHub 的完整步骤
================================================================

本文件说明如何把这个图集发布到网上（GitHub Pages）。


----------------------------------------------------------------
〇、先搞清楚要上传什么（很重要）
----------------------------------------------------------------

gallery 文件夹是「自包含」的：所有路径都是相对路径（./thumbs/...、./originals/...），
把这个文件夹整个搬到任何地方、任何子目录都能直接运行，不需要改任何代码。

    gallery/
    ├─ index.html            <- 网页入口
    ├─ assets/               <- 样式与脚本
    ├─ data/gallery.json     <- 图片清单（57 KB）
    ├─ thumbs/               <- 缩略图 1x + 2x，共 2206 个文件，约 165 MB
    ├─ originals/            <- 原图 1103 张，约 2.5 GB  ← 注意体积！
    └─ README.txt / README.md / *.py / *.mjs

体积一览：

    代码 + 数据                    0.2 MB
    缩略图（thumbs/）              165 MB     ← 浏览瀑布流只需要这些
    网页优化版原图（originals-web/）277 MB     ← 灯箱大图用这些
    ────────────────────────────────────────
    实际上传的总体积          约 442 MB     ✔ 远低于 GitHub 的 1 GB 上限

    原图（originals/，2.5 GB）    ← 只留在本地，不要上传

    ★ GitHub Pages 对「源码仓库」和「发布出去的站点」都有 1 GB 的推荐上限：
      https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
      2.5 GB 的原图传不上去，所以下面「方案 A」已经帮你把原图压好了。


----------------------------------------------------------------
一、方案选择
----------------------------------------------------------------

【方案 A】推荐：上传网页优化版原图（总体积约 442 MB，功能完整）

    本目录里已经生成好 originals-web/（1103 张，277 MB，
    由原图等比缩到最长边 1600px 并转成 WebP，画质几乎看不出差别）。
    灯箱显示上限约 1900px，1600px 完全够用。

    只需执行一条命令，把配置切到优化版：

        node switch_originals.mjs originals-web

    （等价于手动把 assets/app.js 改成：
         var ORIGINALS_DIR = 'originals-web/';
         var ORIGINALS_EXT = '.webp';  ）

    然后上传这五样：index.html、assets/、data/、thumbs/、originals-web/
    另外建议再上传：README.txt、.gitignore

    想切回本地全画质预览：node switch_originals.mjs originals


【方案 B】最省事：只上传缩略图（总体积约 170 MB，灯箱画质降低）

    跳过 originals-web/，把 assets/app.js 改成：

        var ORIGINALS_DIR = 'thumbs/';

    这样灯箱会加载 520px（1x）或 1040px（2x）的缩略图，能看但不够清晰。
    好处是体积最小、上传最快。


※ 无论哪种方案，都请把 originals/（2.5 GB）排除在上传之外。
   本目录已带 .gitignore，里面写了 originals/，Git 会自动忽略它。
※ NSFW区 会上传到公开仓库，如果不想公开，删掉
   thumbs/NSFW区 与 originals-web/NSFW区 即可，
   网页会自动少一个分类，不会报错。


----------------------------------------------------------------
二、上传到 GitHub（图形界面，推荐 GitHub Desktop）
----------------------------------------------------------------

1. 注册 / 登录 GitHub：https://github.com

2. 下载安装 GitHub Desktop：https://desktop.github.com
   （它会顺便装好 Git，不用自己配命令行）

3. 打开 GitHub Desktop → File → Add local repository…
   Local path 选择 gallery 文件夹所在的路径。
   如果提示 "not a Git repository"，点它给的
   "create a repository" → Create repository。

4. 左下角 Summary 随便填，比如 first commit，点 Commit to main。

5. 点顶部 Publish repository。
   ★ 把 "Keep this code private" 的勾去掉（GitHub Pages 免费版需要公开仓库），
   然后点 Publish repository。

6. 上传中：2.5 GB 的原图如果没排除，这里会卡很久甚至失败，
   所以务必先按「方案 A / B」处理，并确认 originals/ 没被提交。
   如果不小心提交了，可以在 GitHub Desktop 里右键该文件夹 → Ignore。

   【小技巧】在 gallery 文件夹里新建一个名为  .gitignore  的文件，
   内容写一行：

        originals/

   这样 Git 就会自动忽略原图目录，永远不会误传。


----------------------------------------------------------------
三、开启 GitHub Pages（让网页能在线访问）
----------------------------------------------------------------

1. 打开 https://github.com/你的用户名/仓库名

2. 点 Settings（设置）→ 左侧找到 Pages

3. Source 选 "Deploy from a branch"
   Branch 选 main，文件夹选 / (root)，点 Save

4. 等 1～2 分钟，刷新这个页面，顶部会出现网址，形如：

        https://你的用户名.github.io/仓库名/

5. 打开这个网址就能在线看图了。
   注意：入口是根目录的 index.html，所以直接访问上面的网址即可，
   不需要再加 /gallery/（因为仓库根目录就是 gallery 里的内容）。


----------------------------------------------------------------
四、关于图片路径（已确认无需再做任何修改）
----------------------------------------------------------------

本项目所有图片路径都已经是相对路径，实测在两种部署方式下都正常：

    • 作为网站根目录：https://用户名.github.io/仓库名/index.html
    • 作为子目录：    https://用户名.github.io/仓库名/gallery/index.html

页面里不会出现 http://127.0.0.1 之类的本地地址，也不会出现 ../ 这种
跳出目录的写法，因此整包压缩后发给别人也能直接打开。


----------------------------------------------------------------
五、本地预览（上传前先自己看一眼）
----------------------------------------------------------------

在 gallery 文件夹里打开命令行，执行：

    python -m http.server 8000

然后浏览器访问：

    http://127.0.0.1:8000/index.html

（不要直接双击 index.html —— file:// 协议下浏览器会拒绝读取
 data/gallery.json，页面会给出提示。）


----------------------------------------------------------------
六、以后想增删图片（日常更新流程）
----------------------------------------------------------------

日常更新只有 4 条命令。所有脚本都「只处理新增或改动过的图」，
已处理过的会自动跳过，所以第二次跑通常只要几秒。

【情况一】加几张新图（最常见）

    1) 把新图片丢进原图目录，例如：
           originals\Novel芙兰单人区\新图.png

    2) cd 到 gallery 目录，依次执行：

           python build_data.py             # 更新图片清单
           python build_thumbs.py           # 补 1x 缩略图
           python build_thumbs_2x.py        # 补 2x 缩略图
           python build_web_originals.py    # 补网页优化版（压画质）

       第 4 条跑完会自动重新生成图片清单（这一步很关键，见下面的说明）。

    3) 部署，完成。


【情况二】删掉了图片，或替换了图片

    删图后 thumbs 与 originals-web 里会留下对应的“孤儿文件”。
    先体检看看差多少：

           python build_web_originals.py --check

    它会列出三类数量：已是最新 / 缺失或过期 / 输出里多余。
    想彻底对齐就重建一份干净的输出：

           python build_web_originals.py --clean
           python build_thumbs.py
           python build_thumbs_2x.py
           python build_data.py

    （--clean 只删重建 originals-web/，不会碰你的原图。）


【为什么必须重跑 build_web_originals.py】

    网页靠清单里的宽高提前算出每张卡片的高度，图片还没加载时布局
    就已经排好了（所以滚动不会跳动）。originals-web 里的图被等比缩小过，
    尺寸与原图不同；若压完图却忘了重建清单，网页拿到的还是旧尺寸，
    宽高比就会算歪，卡片高度跟着错。
    现在这一步已经自动化：build_web_originals.py 结束时会自动重建清单。


【一次性搞定全部（复制粘贴即可）】

    cd /d "你的路径\gallery"
    python build_data.py && python build_thumbs.py && python build_thumbs_2x.py && python build_web_originals.py


【原图放在哪里都能被找到】

    三个脚本会自动探测原图目录，下面两种摆放都支持，不用改代码：

        gallery\originals\<分类>\       （图集自带）
        originals\<分类>\               （放在项目根目录，当前就是这个）

    放在别处也行，用参数或环境变量指定：

        python build_data.py D:\我的图集
        set SMG_SOURCES=D:\我的图集

    脚本第一行会打印它实际读取的目录，可据此确认找对了地方。


【想改压缩参数】

    编辑 build_web_originals.py 顶部两行：

        WEB_MAX_SIDE = 1600     # 最长边像素（越大越清晰、体积越大）
        QUALITY = 86            # WebP 画质 0-100

    改完必须加 --clean 重新生成（否则已存在的图会被跳过）：

        python build_web_originals.py --clean
        node switch_originals.mjs originals-web

    参考：1103 张、最长边 1600、画质 86 → 约 277 MB。


----------------------------------------------------------------
七、文件说明
----------------------------------------------------------------

    index.html                 网页入口（打开这个文件）
    assets/style.css           暗黑哥特样式
    assets/app.js              瀑布流 / 懒加载 / 无限滚动 / 灯箱
                               ★ 顶部集中了所有可调参数：
                                 ORIGINALS_DIR  原图目录
                                 ORIGINALS_EXT  原图扩展名覆盖
                                 BATCH          每轮追加几张
                                 MAX_CARDS      DOM 卡片上限
                                 GAP / IMG_MAX_H 间距与单图最大高度
    data/gallery.json          图片清单与原始尺寸（由脚本生成）
    thumbs/                    缩略图（1x / 2x）
    originals/                 原图 2.5 GB（不上传，已被 .gitignore 忽略）
    originals-web/             网页优化版原图 277 MB（上传用）

    build_data.py              扫描图片，生成 data/gallery.json
    build_thumbs.py            生成 1x 缩略图
    build_thumbs_2x.py         生成 2x 缩略图
    build_web_originals.py     生成适合上传的网页优化版原图
    switch_originals.mjs       一键切换 原图 / 网页优化版（含扩展名）
    verify.py                  静态自检（路径、链接、文字、体积无关）
    cdp_test.mjs               真实浏览器端到端测试（47 项）
    .gitignore                 已排除 originals/


----------------------------------------------------------------
八、版权提示
----------------------------------------------------------------

图集为个人收藏整理，角色版权归原作者所有，仅供欣赏，请勿商用。
页脚已内置导言与联系方式（B站 / 抖音 / 小红书），如不需要可自行编辑
index.html 中 <footer> 部分。

================================================================
