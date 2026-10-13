/* ============================================================
 *  绯月画廊 · Scarlet Moon Gallery
 *  纯前端瀑布流图集引擎（无任何第三方依赖）
 *
 *  功能：
 *   · 固定顺序分类标签 + 分类内随机排列（每次切换 / 刷新都不同）
 *   · 最短列瀑布流（Masonry），动态计算，绝不影响周围图片
 *   · 图片懒加载 + IntersectionObserver 无限滚动（每轮重新洗牌）
 *   · 灯箱大图：左右箭头 / ← → 键切换，Esc 或点遮罩关闭
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 入口动画：THE DOOR HAS OPENED ----------------
     0.5s 黑屏 → 门线/文字浮现 → 门开（0.7s 淡出）→ Hero 逐层苏醒。
     尊重 prefers-reduced-motion；无论发生什么都保证页面最终可用。 */
  var $door = document.getElementById('door');
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if ($door && !reduceMotion) {
    setTimeout(function () {
      $door.classList.add('is-open');
      document.body.classList.add('is-entered');
      setTimeout(function () {
        if ($door.parentNode) $door.parentNode.removeChild($door);
      }, 900);
    }, 2200);
  } else {
    if ($door && $door.parentNode) $door.parentNode.removeChild($door);
    document.body.classList.add('is-entered');
  }
  // 兜底：即使上方逻辑异常，也保证 Hero 一定出现
  setTimeout(function () {
    document.body.classList.add('is-entered');
    if ($door && $door.parentNode) $door.parentNode.removeChild($door);
  }, 4000);

  /* ---------------- 隐藏彩蛋：连续点月蚀五次 ----------------
     月亮短暂染成鲜红，浮现「Are you afraid of me?」，两秒后消失。 */
  var $eclipse = document.getElementById('eclipse');
  var eclipseClicks = 0;
  if ($eclipse) {
    $eclipse.addEventListener('click', function () {
      eclipseClicks++;
      clearTimeout($eclipse._decay);
      $eclipse._decay = setTimeout(function () { eclipseClicks = 0; }, 1600);
      if (eclipseClicks < 5) return;
      eclipseClicks = 0;
      document.body.classList.add('is-afraid');
      var w = document.querySelector('.afraid');
      if (w && w.parentNode) w.parentNode.removeChild(w);
      var p = document.createElement('p');
      p.className = 'afraid';
      p.textContent = 'Are you afraid of me?';
      document.body.appendChild(p);
      clearTimeout($eclipse._fear);
      $eclipse._fear = setTimeout(function () {
        document.body.classList.remove('is-afraid');
        if (p.parentNode) p.parentNode.removeChild(p);
      }, 2200);
    });
  }

  /* ---------------- 档案室分类标签（英/中对照） ---------------- */
  var ARCHIVE_EN = {
    'Novel芙兰单人区':    'SCARLET SOLO-NOVEL',
    'Novel芙兰蕾米百合区': 'SCARLET SISTERS-NOVEL',
    'GPT芙兰区':          'SCARLET GPT-ARCHIVE',
    'NSFW区':             'FORBIDDEN ARCHIVE',
    '不知如何分类区':      'UNSORTED ARCHIVE'
  };
  var ARCHIVE_CN = {
    'Novel芙兰单人区':    '芙兰单人收藏',
    'Novel芙兰蕾米百合区': '芙兰蕾米百合收藏',
    'GPT芙兰区':          'GPT芙兰收藏',
    'NSFW区':             '夜之禁藏',
    '不知如何分类区':      '未分类收藏'
  };

  /* ---------------- 主题状态：封存 / 解封（跟随 NSFW 锁） ----------------
     环境会变，作品不变。不读存储、不自动开启、不拦截输入。
     动画约 850ms；减少动画模式只切值不放过渡。 */
  var THEME_COPY = {
    sealed:   { word: '封存', desc: '它们暂时还很安静。', phase: '空间已封存', changing: '正在封存…', spoken: '当前为封存态，NSFW 隐藏。' },
    unsealed: { word: '解封', desc: '好了，现在听我的。',   phase: '空间已解封', changing: '正在解封…', spoken: '当前为解封态，NSFW 显示。' }
  };
  var themeState = 'sealed';
  var themeTimer = null;
  var themeReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $stateWord  = document.getElementById('stateWord');
  var $stateDesc  = document.getElementById('stateDesc');
  var $statePhase = document.getElementById('statePhase');
  var $stateLive  = document.getElementById('stateLive');
  var $nsfwCap    = document.getElementById('nsfwCap');

  function applyTheme(nsfw, opts) {
    var options = opts || {};
    themeReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animate = options.animate !== false && !themeReduced;
    var next = nsfw ? 'unsealed' : 'sealed';
    var changed = next !== themeState;
    if (!changed && animate) return themeState;   // 重复同步不打断进行中的过渡
    cancelFate('theme-change');
    themeState = next;
    var c = THEME_COPY[next];
    document.documentElement.dataset.state = next;
    document.documentElement.classList.toggle('theme-instant', !animate);
    if ($stateWord)  $stateWord.textContent  = c.word;
    if ($stateDesc)  $stateDesc.textContent  = c.desc;
    if ($statePhase) $statePhase.textContent = c.phase;
    if ($stateLive)  $stateLive.textContent  = c.spoken;
    clearTimeout(themeTimer);
    if (animate) {
      document.documentElement.dataset.phase = 'switching';
      if ($statePhase) $statePhase.textContent = c.changing;
      themeTimer = setTimeout(function () {
        document.documentElement.dataset.phase = 'stable';
        if ($statePhase) $statePhase.textContent = c.phase;
        themeTimer = null;
      }, 900);
    } else {
      document.documentElement.dataset.phase = 'stable';
      void document.documentElement.offsetWidth;   // 先提交无过渡样式，再移除 instant
      requestAnimationFrame(function () {
        document.documentElement.classList.remove('theme-instant');
      });
    }
    if (changed && options.emit !== false) {
      window.dispatchEvent(new CustomEvent('scarlet:modechange', { detail: { state: next, nsfw: nsfw } }));
    }
    return themeState;
  }

  /* ---------------- 配置 ---------------- */
  var CATS_PATH    = 'data/gallery.json';   // 由 build_data.py 生成
  var TAGS_PATH    = 'data/tags.json';      // 由 build_tags.py 生成（标签筛选索引）
  var THUMB_DIR    = 'thumbs/';             // 由 build_thumbs.py 生成
  var ORIGINALS_DIR = 'originals-web/';     // 原图目录（相对 index.html，纯相对路径）
  /* 灯箱原图的扩展名覆盖。
     留空 '' = 沿用原图自身扩展名（originals/ 目录用这个）。
     改用 build_web_originals.py 生成的精简目录时，把它设为 '.webp'：
         var ORIGINALS_DIR  = 'originals-web/';
         var ORIGINALS_EXT  = '.webp';
     或者直接用 node gallery/switch_originals.mjs 一键切换。 */
  var ORIGINALS_EXT = '.webp';
  var IMG_MAX_H    = 400;                   // 每张卡片的最大渲染高度（保持不变，测试契约 maxH ≤ 400.5）
  var GAP          = 14;                    // 列间距（resetLayout 里按列数微调：双列更紧凑，多列更舒展）
  var BATCH        = 40;                    // 每轮追加的图片数量
  var MAX_CARDS    = 1200;                  // DOM 中卡片上限，超出则回收最旧的
  var TRIM_TO      = 900;                   // 回收后保留的卡片数量
  var RESIZE_TOL   = 10;                    // 可用宽度变化多少像素才重排
  var SCROLL_MARGIN = 1400;                 // 距底部多远开始加载下一轮

  /* ---------------- 状态 ---------------- */
  var data     = null;    // 完整图集数据
  var cats     = [];      // 分类数组（保持 JSON 中的固定顺序）
  var active   = 0;       // 当前分类下标
  var lockNsfw = false;   // 「关于」里未显式开启前，NSFW 分类默认锁住

  /* 标签筛选（分类抽屉） */
  var tagsData   = null;  // data/tags.json
  var tagFilter  = null;  // { cat: 分类名, ids: Set<分类/文件名> }，null = 无筛选
  var drawerApi  = null;  // 抽屉控制器
  var DRAWER_GROUPS = [
    { key: 'collection',   label: '收藏来源',     mode: 'single' },
    { key: 'character',    label: '角色',         mode: 'multi' },
    { key: 'people',       label: '人数',         mode: 'multi' },
    { key: 'scene',        label: '场景 / 元素',  mode: 'multi' },
    { key: 'composition',  label: '构图 / 镜头',  mode: 'multi' },
    { key: 'style',        label: '风格 / 光影',  mode: 'multi' }
  ];

  var cards    = [];      // 已渲染卡片，保持 DOM 顺序：{el, si, r, c, h}
  var liveIdx  = {};      // 序列号 -> 卡片，用于回收时同步
  var seq      = 0;       // 全局递增序列号（灯箱导航依靠它）
  var pool     = [];      // 当前轮剩余待放置的图片
  var roundNo  = 1;       // 第几轮（无限滚动轮次）
  var heights  = [];      // 每列当前高度
  var lastH    = [];      // 每列上一张图片高度，用于 16px 间距
  var colW     = 0;
  var cols     = 0;
  var busy     = false;   // 防止同一滚动动作重复触发

  var observed = new WeakSet();   // 已交给懒加载观察器的图片
  var gridGeneration = 0, batchTimer = null;
  var pending  = 0;               // 本轮尚未结束加载的图片数

  /* ---------------- DOM ---------------- */
  var $tabs    = document.getElementById('tabs');
  var $grid    = document.getElementById('masonry');
  var $senti   = document.getElementById('sentinel');
  var $count   = document.getElementById('metaCount');
  var $fatal   = document.getElementById('fatal');
  var $shuffle = document.getElementById('reshuffle');
  var $nsfwBtn = document.getElementById('toggleNsfw');
  var $nsfwLbl = document.getElementById('nsfwLabel');
  var $prog    = document.getElementById('progress');
  var $chips   = document.getElementById('filterChips');
  var $empty   = document.getElementById('emptyFilter');

  var lb = {
    root:    document.getElementById('lightbox'),
    backdrop:document.getElementById('lbBackdrop'),
    img:     document.getElementById('lbImg'),
    idx:     document.getElementById('lbIdx'),
    name:    document.getElementById('lbName'),
    size:    document.getElementById('lbSize'),
    orig:    document.getElementById('lbOrig'),
    spinner: document.getElementById('lbSpinner'),
    frag:    document.getElementById('lbFragment'),
    cat:     document.getElementById('lbCat'),
    close:   document.getElementById('lbClose'),
    prev:    document.getElementById('lbPrev'),
    next:    document.getElementById('lbNext')
  };

  /* ============================================================
   *  工具函数
   * ============================================================ */
  function rand(n) { return Math.floor(Math.random() * n); }

  /** Fisher–Yates 洗牌：均匀随机，且返回同一个数组 */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rand(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 文件名 -> URL 路径（每个片段单独编码，保留 / 分隔符） */
  function encPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  /* 路径说明（全部为以 ./ 开头的相对路径，整包放到任何目录 / 子路径都能用）
         gallery/
         ├─ index.html
         ├─ assets/app.js
         ├─ data/gallery.json
         ├─ thumbs/<分类>/<文件名>.webp      <- 缩略图（1x / 2x）
         └─ originals/<分类>/<原文件名>       <- 原图（灯箱用）
     用 './' 前缀而非 '/xxx'，浏览器会相对「当前页面」解析，
     因此部署在 https://用户.github.io/仓库名/ 这类子路径下同样正确，
     直接把整个 gallery 文件夹丢到任何服务器根目录或子目录也都能跑。 */

  /** 原图 URL（相对路径；ORIGINALS_EXT 非空时替换扩展名） */
  function fullUrl(catName, fileName) {
    var name = fileName;
    if (ORIGINALS_EXT) name = fileName.replace(/\.[^.]+$/, '') + ORIGINALS_EXT;
    return './' + encPath(ORIGINALS_DIR + catName + '/' + name);
  }

  /** 缩略图基础路径（不含扩展名） */
  function thumbBase(catName, fileName) {
    return './' + encPath(THUMB_DIR + catName + '/' + fileName.replace(/\.[^.]+$/, ''));
  }

  /** 缩略图 URL */
  function thumbUrl(catName, fileName) {
    return thumbBase(catName, fileName) + '.webp';
  }

  /** 小图 1x / 2x 候选，普通屏与高清屏都清晰 */
  function thumbSrcset(catName, fileName) {
    var p = thumbBase(catName, fileName);
    return p + '.webp 1x, ' + p + '@2x.webp 2x';
  }

  function fmtSize(w, h) { return w + ' × ' + h; }

  function newImg(alt, cls) {
    var im = document.createElement('img');
    im.alt = alt || '';
    im.loading = 'lazy';
    im.decoding = 'async';
    im.draggable = false;
    if (cls) im.className = cls;
    return im;
  }

  /* ============================================================
   *  列数 / 布局
   * ============================================================ */
  function computeCols() {
    // 以实际可用宽度为准（clientWidth 在移动端模拟/缩放时比 innerWidth 可靠）
    var w = document.documentElement.clientWidth || window.innerWidth;
    if (w >= 1800) return 5;
    if (w >= 1400) return 4;
    if (w >= 1040) return 3;
    return 2;
  }

  /** 单张图片在给定列宽下的渲染高度（与 CSS 的 max-height + object-fit:contain 等价） */
  function cardHeight(w, h) {
    if (!w || !h) return 220;
    var hh = colW * h / w;
    return Math.max(60, Math.min(hh, IMG_MAX_H));
  }

  function resetLayout() {
    var total = $grid.clientWidth || window.innerWidth;
    cols = computeCols();
    GAP = cols <= 2 ? 10 : 14;          // 移动端双列 10px，桌面多列 14px
    colW = (total - GAP * (cols - 1)) / cols;
    heights = new Array(cols).fill(0);
    lastH = new Array(cols).fill(-1);
    lastGridW = total;
  }

  function shortestCol() {
    var k = 0;
    for (var i = 1; i < cols; i++) if (heights[i] < heights[k] - 0.5) k = i;
    return k;
  }

  function place(el, c, w, h) {
    var hh = cardHeight(w, h);
    // 卡片宽度贴合图片真实比例（超过 max-height 时收窄并居中），杜绝黑边留白
    var ar = (w && h) ? (w / h) : 1;
    var cw = Math.min(colW, hh * ar);
    if (!isFinite(cw) || cw < 24) cw = colW;
    var x = c * (colW + GAP) + (colW - cw) / 2;
    var y = heights[c] + (lastH[c] < 0 ? 0 : GAP);

    el.style.width = cw.toFixed(2) + 'px';
    el.style.height = hh.toFixed(2) + 'px';
    var rot = el.dataset.rot || '';
    el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)'
      + (rot ? ' rotate(' + rot + 'deg)' : '');
    // Entrance delay is assigned once, not replayed by every Masonry relayout.

    heights[c] = y + hh;
    lastH[c] = hh;
    return hh;
  }

  function layoutAll() {
    resetLayout();
    var y = 0;
    for (var i = 0; i < cards.length; i++) {
      var k = cards[i];
      k.c = shortestCol();
      k.h = place(k.el, k.c, k.w, k.h0);
      y = Math.max(y, heights[k.c]);
    }
    $grid.style.height = y + 'px';
  }

  /** 单张重排（回收后避免整页 reflow） */
  function relayoutOne(k) {
    k.c = shortestCol();
    k.h = place(k.el, k.c, k.w, k.h0);
  }

  /* ============================================================
   *  懒加载观察器
   * ============================================================ */
  var lazyObs = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var en = entries[i];
          if (!en.isIntersecting) continue;
          var im = en.target;
          var real = im.getAttribute('data-src');
          lazyObs.unobserve(im);
          if (real) {
            im.addEventListener('load', function () {
              this.classList.remove('is-lazy');
              this.classList.add('is-loaded');
            }, { once: true });
            var ss = im.getAttribute('data-srcset');
            if (ss) im.srcset = ss;
            im.src = real;
          }
        }
      }, { rootMargin: '600px 0px 900px 0px', threshold: 0.01 })
    : null;

  function watchLazy(im) {
    if (lazyObs && !observed.has(im)) {
      observed.add(im);
      im.classList.add('is-lazy');        // 交由观察器控制淡入
      lazyObs.observe(im);
    } else if (!lazyObs) {
      // 环境不支持 IntersectionObserver：直接加载，保证一定显示
      var ss = im.getAttribute('data-srcset');
      if (ss) im.srcset = ss;
      im.src = im.getAttribute('data-src');
      im.classList.remove('is-lazy');
      im.classList.add('is-loaded');
    }
  }

  /* ============================================================
   *  渲染
   * ============================================================ */
  function makeCard(catName, item, caged) {
    var fileName = item[0], w = item[1], h = item[2];

    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', fileName + '（点击查看大图）');
    card.dataset.si = String(seq);

    var im = newImg(fileName);
    // data-src 在图片进入视野时才真正赋值（懒加载）
    im.setAttribute('data-src', thumbUrl(catName, fileName));
    im.setAttribute('data-srcset', thumbSrcset(catName, fileName));
    im.setAttribute('data-full', fullUrl(catName, fileName));
    im.addEventListener('error', function () {
      var full = this.getAttribute('data-full');
      // 缩略图缺失时退回原图，只回退一次，避免死循环
      if (full && this.getAttribute('data-fb') !== '1') {
        this.setAttribute('data-fb', '1');
        this.removeAttribute('srcset');
        this.src = full;
      } else {
        this.classList.remove('is-lazy');
        this.classList.add('is-error');
      }
    });
    im.addEventListener('load', function () {
      this.classList.remove('is-lazy');
      this.classList.add('is-loaded');
    });
    card.appendChild(im);

    // 悬停浮现的铭牌（绯红侵蚀）：底部黑紫渐变 + 作品编号 + 菱形 ↗
    var veil = document.createElement('div');
    veil.className = 'card-veil';
    var no = document.createElement('span');
    no.className = 'card-idx';
    no.textContent = 'FRAGMENT ' + String(seq + 1).padStart(4, '0');
    var orn = document.createElement('span');
    orn.className = 'card-orn';
    orn.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2.9" y="2.9" width="4.2" height="4.2" transform="rotate(45 5 5)" fill="none" stroke="currentColor" stroke-width="1"/></svg><span>↗</span>';
    veil.appendChild(no);
    veil.appendChild(orn);
    card.appendChild(veil);

    // 收藏室装裱：约 5% 的卡片带明显歪斜（艺术家墙面上的错位画），
    // 其余保持端正。基于序号哈希，洗牌 / 重排后同一张卡的状态稳定。
    var hh = (seq * 2654435761) >>> 0;
    var rot = 0;
    if (hh % 20 === 0) {
      var TILTS = [-1.5, -1.1, -0.8, 0.8, 1.2];
      rot = TILTS[(hh >>> 4) % TILTS.length];
    }
    if (caged) rot = -1.4;                       // 异常藏品固定倾斜：它的身份
    card.dataset.rot = rot ? rot.toFixed(2) : '';
    card.dataset.frame = caged ? '2' : String(seq % 4);
    if (caged) {
      // 异常藏品：断开的收容框 + 重新固定的编号牌（每轮一件）
      card.classList.add('card-caged');
      var cage = document.createElement('span');
      cage.className = 'cage';
      cage.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'
        + '<path d="M2 16 L2 2 L16 2" fill="none" stroke="rgba(227,41,79,.5)"/>'
        + '<path d="M84 2 L98 2 L98 16" fill="none" stroke="rgba(227,41,79,.5)"/>'
        + '<path d="M2 84 L2 98 L16 98" fill="none" stroke="rgba(227,41,79,.5)"/>'
        + '<path d="M84 98 L90 98" fill="none" stroke="rgba(227,41,79,.5)"/>'
        + '<path d="M98 84 L98 90" fill="none" stroke="rgba(227,41,79,.5)"/>'
        + '<path d="M88 92 L94 96 M94 88 L96 94" fill="none" stroke="rgba(227,41,79,.4)"/>'
        + '<polygon points="92,93 99,96 95,99" fill="rgba(150,48,82,.35)" stroke="rgba(214,96,132,.55)"/>'
        + '</svg>';
      card.appendChild(cage);
      var plate = document.createElement('span');
      plate.className = 'cage-plate';
      plate.innerHTML = '<span class="cage-pin" aria-hidden="true"></span>FRAGMENT ' + String(seq + 1).padStart(4, '0');
      card.appendChild(plate);
      var note = document.createElement('span');
      note.className = 'card-note';
      note.textContent = '这个，别碰。';
      card.appendChild(note);
    } else if (seq % 4 === 3) {
      var shard = document.createElement('span');
      shard.className = 'card-shard';
      shard.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0.8 L7.4 3.4 L5 9.2 L2.6 3.4 Z" fill="none" stroke="currentColor" stroke-width="0.8"/></svg>';
      card.appendChild(shard);
    }

    // 第二轮及以后：左上角轮次标记
    if (roundNo > 1) {
      var tag = document.createElement('span');
      tag.className = 'round-tag';
      tag.textContent = 'ROUND ' + roundNo;
      card.appendChild(tag);
    }

    return {
      el: card, si: seq,
      w: w, h0: h,
      name: fileName, cat: catName,
      path: thumbUrl(catName, fileName),
      full: fullUrl(catName, fileName),
      round: roundNo,
      c: 0, h: 0
    };
  }

  /** 追加一批：每张图放进当前最短的列 */
  function appendBatch() {
    if (busy || fateBusy || !cats[active]) return;
    busy = true;
    if (io) io.disconnect();

    var generation = gridGeneration;
    var completed = false;
    var catName = cats[active].name;
    var n = Math.min(BATCH, pool.length);
    var fresh = [];

    for (var i = 0; i < n; i++) {
      var item = pool.shift();
      if (!item) break;
      var k = makeCard(catName, item, cards.length % BATCH === 0 && fresh.length === 0);
      k.si = seq;
      liveIdx[seq] = k;
      seq++;
      $grid.appendChild(k.el);          // 先入 DOM
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        k.el.classList.add('is-new');
        k.el.style.animationDelay = (Math.min(i, 24) * 40) + 'ms';
        k.el.addEventListener('animationend', function () {
          this.classList.remove('is-new'); this.style.removeProperty('animation-delay');
        }, { once: true });
      }
      k.c = shortestCol();
      k.h = place(k.el, k.c, k.w, k.h0);
      cards.push(k);
      fresh.push(k.el.querySelector('img'));
    }

    // 入 DOM 之后再交给懒加载观察器（否则 IntersectionObserver 不会派发）
    for (var f = 0; f < fresh.length; f++) watchLazy(fresh[f]);

    $grid.style.height = (heights.length ? Math.max.apply(null, heights) : 0) + 'px';

    // 等本轮图片加载完（或 6s 兜底），再重新挂上无限滚动哨兵
    pending = fresh.length;
    var done = 0;
    var finish = function () {
      if (completed || generation !== gridGeneration) return;
      if (++done < pending) return;
      completed = true;
      clearTimeout(batchTimer);
      pending = 0;
      busy = false;
      trimIfNeeded();
      armSentinel();
    };
    if (!pending) { busy = false; trimIfNeeded(); armSentinel(); }
    else {
      for (var j = 0; j < fresh.length; j++) {
        var im = fresh[j];
        if (!im || im.complete) finish();
        else {
          im.addEventListener('load', finish, { once: true });
          im.addEventListener('error', finish, { once: true });
        }
      }
      clearTimeout(batchTimer);
      batchTimer = setTimeout(function () {
        if (!completed && generation === gridGeneration && pending) {
          completed = true; pending = 0; busy = false; trimIfNeeded(); armSentinel();
        }
      }, 6000);
    }
  }

  /** 当前分类的作品清单（应用标签筛选后）；始终返回新数组，绝不触碰原数据 */
  function filteredImages(cat) {
    var imgs = cat.images.slice();
    if (tagFilter && tagFilter.cat === cat.name) {
      imgs = imgs.filter(function (img) {
        return tagFilter.ids.has(cat.name + '/' + img[0].replace(/\.[^.]+$/, ''));
      });
    }
    return imgs;
  }

  /** 填充池子；池子空了就重新洗牌 —— 形成无限循环 */
  function refillPool() {
    if (!cats[active]) return;
    if (!pool.length) {
      if (hadFirstBatch) { pool = shuffle(filteredImages(cats[active])); roundNo++; }
      else { pool = shuffle(filteredImages(cats[active])); hadFirstBatch = true; }
    }
  }

  var hadFirstBatch = false;

  /** 回收最旧的卡片，避免无限滚动把 DOM 撑爆 */
  function trimIfNeeded() {
    if (fateBusy || cards.length <= MAX_CARDS) return;
    var cut = cards.length - TRIM_TO;
    for (var i = 0; i < cut; i++) {
      var k = cards[i];
      delete liveIdx[k.si];
      if (k.el.parentNode) k.el.parentNode.removeChild(k.el);
    }
    cards = cards.slice(cut);
    // 只重排剩下的卡片，不做整页重绘
    heights = new Array(cols).fill(0);
    lastH = new Array(cols).fill(-1);
    for (var j = 0; j < cards.length; j++) relayoutOne(cards[j]);
    $grid.style.height = (heights.length ? Math.max.apply(null, heights) : 0) + 'px';
  }

  /* ---------------- 无限滚动哨兵 ---------------- */
  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          if (busy || !cats[active]) return;
          refillPool();
          appendBatch();
          return;
        }
      }, { rootMargin: SCROLL_MARGIN + 'px 0px ' + SCROLL_MARGIN + 'px 0px' })
    : null;

  function armSentinel() {
    if (!io || fateBusy) return;
    io.disconnect();
    var top = $senti.getBoundingClientRect().top;
    // 如果哨兵仍在提前触发范围内，说明是同一个滚动动作，等它离开再挂载
    if (top < window.innerHeight + SCROLL_MARGIN) {
      clearTimeout(armSentinel._t);
      armSentinel._t = setTimeout(armSentinel, 300);
      return;
    }
    io.observe($senti);
  }

  /* ============================================================
   *  分类切换
   * ============================================================ */
  function buildTabs() {
    $tabs.innerHTML = '';
    cats.forEach(function (cat, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.dataset.cat = cat.name;
      b.dataset.idx = String(i);
      b.innerHTML = '';
      var noEl = document.createElement('span');
      noEl.className = 'tab-no';
      noEl.textContent = String(i + 1).padStart(2, '0');
      var bodyEl = document.createElement('span');
      bodyEl.className = 'tab-body';
      var enEl = document.createElement('span');
      enEl.className = 'tab-en';
      enEl.textContent = ARCHIVE_EN[cat.name] || cat.name;
      var cnEl = document.createElement('span');
      cnEl.className = 'tab-cn';
      cnEl.textContent = (ARCHIVE_CN[cat.name] || cat.name) + ' · ';
      var n = document.createElement('span');
      n.className = 'tab-n';
      n.textContent = cat.images.length + ' fragments';
      cnEl.appendChild(n);
      bodyEl.appendChild(enEl);
      bodyEl.appendChild(cnEl);
      b.appendChild(noEl);
      b.appendChild(bodyEl);
      b.addEventListener('click', function () { switchCat(i); });
      $tabs.appendChild(b);
    });
  }

  function updateTabs(ensureVisible) {
    var tabs = $tabs.children;
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', i === active);
      tabs[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
      // 窄屏横向滑动导航：把选中标签完整滚入可视区（center 防止左缘被裁切）
      if (ensureVisible && i === active && tabs[i].scrollIntoView) {
        try { tabs[i].scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* 旧浏览器降级 */ }
      }
      if (lockNsfw && cats[i].name === 'NSFW区') {
        tabs[i].style.opacity = '.55';
        tabs[i].title = '该分类默认折叠，点击顶栏「显示 NSFW」按钮解锁';
      } else {
        tabs[i].style.opacity = '';
        tabs[i].title = '';
      }
    }
  }

  function resetGrid() {
    cancelFate('grid-reset');
    gridGeneration++;
    clearTimeout(batchTimer);
    if (io) io.disconnect();
    busy = false;
    $grid.innerHTML = '';
    cards = [];
    liveIdx = {};
    seq = 0;
    pool = [];
    roundNo = 1;
    hadFirstBatch = false;
    resetLayout();
    $grid.style.height = '0px';
  }

  function switchCat(i) {
    if (i < 0 || i >= cats.length) return;
    cancelFate('category-change');
    if (i === active && cards.length) { /* 同分类点击 -> 重新洗牌 */ }
    active = i;
    var nm = cats[i].name;
    if (nm === 'NSFW区' && lockNsfw) {
      lockNsfw = false;
      updateNsfwBtn();
      applyTheme(true);
    }
    updateTabs(true);
    resetGrid();
    try { history.replaceState(null, '', '#' + encodeURIComponent(nm)); } catch (e) { location.hash = nm; }

    refillPool();
    appendBatch();

    updateCountLine();
    syncDrawerToCategory();
    document.title = nm + ' · 绯月画廊';
  }

  /* ---------------- 标签筛选相关 ---------------- */
  function updateCountLine() {
    var cat = cats[active];
    if (!cat) return;
    var total = cat.images.length;
    var filtered = !!(tagFilter && tagFilter.cat === cat.name);
    var shown = filtered ? tagFilter.ids.size : total;
    $count.innerHTML = filtered
      ? '<b>' + shown + '</b> / ' + total + ' FRAGMENTS · SCARLET ARCHIVE'
      : '<b>' + total + '</b> FRAGMENTS · SCARLET ARCHIVE';
    if ($empty) $empty.hidden = !(filtered && shown === 0);
    if ($senti) $senti.style.display = (filtered && shown === 0) ? 'none' : '';
  }

  function renderFilterChips() {
    if (!$chips) return;
    $chips.innerHTML = '';
    if (!tagFilter || !drawerApi) { $chips.hidden = true; return; }
    var state = drawerApi.getState();
    var chips = [];
    var c = (state.groups && state.groups.collection) || [];
    if (c.length) chips.push(c[0]);
    DRAWER_GROUPS.forEach(function (g) {
      if (g.key === 'collection' || !state.groups) return;
      (state.groups[g.key] || []).forEach(function (v) { chips.push(v); });
    });
    if (state.query && state.query.trim()) chips.unshift('搜索：' + state.query.trim());
    if (!chips.length) { $chips.hidden = true; return; }
    chips.forEach(function (t) {
      var s = document.createElement('span');
      s.textContent = t;
      $chips.appendChild(s);
    });
    var n = document.createElement('span');
    n.className = 'fc-count';
    n.textContent = '共 ' + tagFilter.ids.size + ' 件';
    $chips.appendChild(n);
    $chips.hidden = false;
  }

  function syncDrawerToCategory() {
    if (!drawerApi || !cats[active]) return;
    var groups = {};
    DRAWER_GROUPS.forEach(function (g) {
      groups[g.key] = g.key === 'collection' ? [cats[active].name] : [];
    });
    drawerApi.setState({ query: '', groups: groups });
    renderFilterChips();
  }

  /** 原地重排：同一批作品、真实新顺序（不换样本，不重置编号） */
  function reshuffleInPlace() {
    if (cards.length < 2) return false;
    var before = cards.slice();
    shuffle(cards);
    var same = true;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i] !== before[i]) { same = false; break; }
    }
    if (same) { var f = cards.shift(); cards.push(f); }   // 绝不演一次没有结果的戏
    // DOM 顺序与数组同步（绝对定位不受影响），随后按新顺序重排瀑布流
    for (var j = 0; j < cards.length; j++) $grid.appendChild(cards[j].el);
    layoutAll();
    return true;
  }

  /* ============================================================
   *  打乱命运 — 翻牌重排（FATE STUDY 03 流程）
   *  翻到统一背面 → 背面朝上时提交真实新顺序 → 背牌飞向新位置
   *  → 倒序错拍翻回正面。幽灵层只复制缩略图，绝不触碰真实作品节点。
   * ============================================================ */
  var fateBusy = false;
  var fateMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  fateMedia.addEventListener('change', function () { if (fateMedia.matches) cancelFate('motion-preference-change'); });
  var FATE_SAYS = {
    idle:    '顺序暂时还由你记得。',
    start:   '先别看。',
    hold:    '这一次，由我决定。',
    reveal:  '好了，重新认识它们。',
    done:    '嗯，这样顺眼多了。',
    skipped: '至少需要两件可浏览的藏品。'
  };
  var $fateSay = document.getElementById('fateSay');

  function fateSay(t) { if ($fateSay) $fateSay.textContent = t; }

  function fateRect(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }
  function fateVisible(r) {
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < window.innerHeight
      && r.right > 0 && r.left < window.innerWidth;
  }

  var fateCancel = null;
  function cancelFate(reason) { if (fateCancel) fateCancel(reason || 'cancelled'); }
  function reshuffleFate() {
    if (fateBusy || lbOpen || !cards.length || (drawerApi && drawerApi.isOpen)) return;
    if (document.documentElement.dataset.phase === 'switching') { fateSay('主题正在切换，请稍候。'); return; }
    if (cards.length < 2) { fateSay(FATE_SAYS.skipped); return; }
    if (window.pageYOffset > 8) { reshuffleInPlace(); window.scrollTo(0, 0); return; }
    var root = document.documentElement;
    var before = cards.map(function(k){return {k:k,rect:fateRect(k.el)}}).filter(function(x){return fateVisible(x.rect)});
    var readyCount=before.filter(function(x){var im=x.k.el.querySelector('img');return im&&im.complete&&im.naturalWidth>0}).length;
    var motion = readyCount >= 2 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !!Element.prototype.animate && before.length >= 2 && before.length <= 12;
    var finished=false,committed=false,stage=null,watchdog=null;
    var animations=new Set(),waitTimers=new Set(),waitClosers=new Set();
    var savedVisibility=[$grid.style.getPropertyValue('visibility'),$grid.style.getPropertyPriority('visibility')];
    var savedBusy=$grid.getAttribute('aria-busy'),savedInert=$grid.inert;
    function emit(type,detail){document.dispatchEvent(new CustomEvent(type,{detail:detail||{}}))}
    function finish(status,reason){
      if(finished)return;finished=true;clearTimeout(watchdog);
      window.removeEventListener('scroll',onViewport,true);window.removeEventListener('resize',onViewport);
      animations.forEach(function(a){try{a.cancel()}catch(e){}});animations.clear();
      waitClosers.forEach(function(done){done()});waitClosers.clear();
      waitTimers.forEach(function(id){clearTimeout(id)});waitTimers.clear();
      if(stage&&stage.parentNode)stage.remove();
      if(savedVisibility[0])$grid.style.setProperty('visibility',savedVisibility[0],savedVisibility[1]);else $grid.style.removeProperty('visibility');
      $grid.inert=savedInert;
      if(savedBusy===null)$grid.removeAttribute('aria-busy');else $grid.setAttribute('aria-busy',savedBusy);
      $shuffle.removeAttribute('aria-disabled');$shuffle.classList.remove('is-pulse');
      root.classList.remove('gallery-flipping');delete $grid.dataset.fatePhase;
      fateBusy=false;if(fateCancel===cancel)fateCancel=null;
      emit(status==='completed'?'fate:shuffleend':status==='error'?'fate:shuffleerror':'fate:shufflecancel',{committed:committed,reason:reason||status});
      armSentinel();
    }
    function cancel(reason){fateSay(committed?'演出已停止，保留当前顺序。':'演出已停止，藏品未重排。');finish('cancelled',reason)}
    function onViewport(){cancel('viewport-change')}
    function check(){if(finished)throw new DOMException('Flip cancelled','AbortError')}
    function nextFrame(){return new Promise(function(res){var id=requestAnimationFrame(done);function done(){cancelAnimationFrame(id);waitClosers.delete(done);res()}waitClosers.add(done)}).then(check)}
    function animate(el,keyframes,opts){
      check();var a=el.animate(keyframes,Object.assign({fill:'both'},opts));animations.add(a);
      return a.finished.then(function(){check();var end=keyframes[keyframes.length-1];if(end.transform!==undefined)el.style.transform=end.transform;if(end.opacity!==undefined)el.style.opacity=String(end.opacity);animations.delete(a);a.cancel()});
    }
    function phase(name){check();$grid.dataset.fatePhase=name}
    function primeThumbnail(k){
      var im=k.el.querySelector('img');
      if(im&&!im.getAttribute('src')){
        var src=im.getAttribute('data-src'),ss=im.getAttribute('data-srcset');
        if(src){if(lazyObs)lazyObs.unobserve(im);if(ss)im.srcset=ss;im.src=src;im.loading='eager'}
      }
      return im;
    }
    function frontFor(ghost,k){
      var original=primeThumbnail(k),image=document.createElement('img');
      image.alt='';image.loading='eager';image.decoding='async';
      var current=original&&(original.currentSrc||original.getAttribute('src')||'');
      var src=original&&(current.indexOf('/thumbs/')>=0?current:original.getAttribute('data-src')); // Never clone fallback originals.
      ghost.front.replaceChildren(image);ghost.front.dataset.pending='true';
      image.addEventListener('load',function(){ghost.front.dataset.pending='false'},{once:true});
      if(src)image.src=src;
      if(image.complete&&image.naturalWidth>0)ghost.front.dataset.pending='false';
      return image;
    }
    function ghostFor(item,index,backwards){
      var el=document.createElement('div');el.className='fate-ghost';
      var rotor=document.createElement('div');rotor.className='fate-rotor';
      var front=document.createElement('div');front.className='fate-face fate-front';
      var back=document.createElement('div');back.className='fate-face fate-back';
      back.innerHTML='<span class="fate-back-eyebrow">SCARLET ARCHIVE</span><svg class="fate-back-emblem" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="37" fill="none" stroke="currentColor" opacity=".3"/><path d="M50 15L68 50 50 85 32 50Z M15 50L50 32 85 50 50 68Z" fill="none" stroke="currentColor" opacity=".65"/><path d="M50 34L60 50 50 66 40 50Z" fill="currentColor" opacity=".2"/><path d="M50 5v7M50 88v7M5 50h7M88 50h7" stroke="currentColor" opacity=".5"/></svg><span class="fate-back-title">命运暂时空白</span><span class="fate-back-foot">LET HER CHOOSE.</span><span class="fate-back-shine" aria-hidden="true"></span>';
      rotor.append(front,back);el.append(rotor);stage.append(el);
      var rect=item.rect,sign=index%2?-1:1;
      Object.assign(el.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',zIndex:String(10+index)});
      var g={el:el,rotor:rotor,front:front,key:item.k.si,rect:rect,sign:sign};
      el.dataset.fateSi=String(item.k.si);if(backwards)rotor.style.transform='rotateY('+(sign*180)+'deg)';frontFor(g,item.k);return g;
    }
    function readyWithin(images,ms){
      return new Promise(function(resolve){
        var id=setTimeout(done,ms);waitTimers.add(id);
        function done(){waitClosers.delete(done);waitTimers.delete(id);clearTimeout(id);resolve()}
        waitClosers.add(done);
        Promise.all(images.map(function(im){return im.decode?im.decode().catch(function(){}):Promise.resolve()})).then(done);
      });
    }
    fateBusy=true;fateCancel=cancel;root.classList.add('gallery-flipping');
    $shuffle.setAttribute('aria-disabled','true');$shuffle.classList.add('is-pulse');
    $grid.inert=true;$grid.setAttribute('aria-busy','true');
    if(io)io.disconnect();clearTimeout(armSentinel._t);
    emit('fate:shufflestart',{animated:motion?before.length:0});
    window.addEventListener('scroll',onViewport,{passive:true,capture:true});window.addEventListener('resize',onViewport,{passive:true});
    watchdog=setTimeout(function(){cancel('animation-timeout')},3200);
    (async function(){
      try{
        stage=document.createElement('div');stage.className='fate-stage';stage.setAttribute('aria-hidden','true');stage.inert=true;document.body.append(stage);
        fateSay(FATE_SAYS.start);
        if(!motion){
          if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!Element.prototype.animate){reshuffleInPlace();committed=true;fateSay(FATE_SAYS.done);finish('completed');return}
          var gridRect=fateRect($grid),curtain=document.createElement('div');curtain.className='fate-curtain';
          curtain.style.top=Math.max(0,gridRect.top)+'px';curtain.style.height=Math.max(0,Math.min(innerHeight,gridRect.bottom)-Math.max(0,gridRect.top))+'px';stage.append(curtain);
          phase('covered');await nextFrame();reshuffleInPlace();committed=true;await nextFrame();
          await animate(curtain,[{opacity:1},{opacity:0}],{duration:180});check();fateSay(FATE_SAYS.done);finish('completed');return;
        }
        var ghosts=before.map(function(item,i){return ghostFor(item,i,false)});
        await readyWithin(ghosts.map(function(g){return g.front.querySelector('img')}),100);check();
        $grid.style.visibility='hidden';phase('turning-back');
        await Promise.all(ghosts.map(function(g,i){return animate(g.rotor,[{transform:'rotateY(0deg)'},{transform:'rotateY('+(g.sign*90)+'deg) translateZ(12px)',offset:.52},{transform:'rotateY('+(g.sign*180)+'deg)'}],{duration:280,delay:Math.min(i*24,144),easing:'cubic-bezier(.3,.02,.22,1)'})}));
        phase('commit');fateSay(FATE_SAYS.hold);reshuffleInPlace();committed=true;await nextFrame();await nextFrame();
        // Batch-read the NEW viewport before any ghost writes. Incoming cards need ghosts too.
        var targets=cards.map(function(k){return {k:k,rect:fateRect(k.el)}}).filter(function(x){return fateVisible(x.rect)});
        if(targets.length>12){fateSay(FATE_SAYS.done);finish('completed');return}
        var wanted=new Set(targets.map(function(x){return x.k.si})),byKey=new Map(ghosts.map(function(g){return [g.key,g]}));
        var spare=ghosts.filter(function(g){return !wanted.has(g.key)}),images=[];
        var selected=targets.map(function(target,i){
          var g=byKey.get(target.k.si)||spare.shift()||ghostFor(target,i,true);
          g.key=target.k.si;g.el.dataset.fateSi=String(g.key);images.push(frontFor(g,target.k));return {g:g,target:target};
        });
        var keep=new Set(selected.map(function(x){return x.g}));ghosts.filter(function(g){return !keep.has(g)}).forEach(function(g){g.el.remove()});
        phase('moving-backs');
        var moving=Promise.all(selected.map(function(x,i){var g=x.g,from=g.rect,to=x.target.rect;
          Object.assign(g.el.style,{left:to.left+'px',top:to.top+'px',width:to.width+'px',height:to.height+'px',zIndex:String(10+i)});
          return animate(g.el,[{transform:'translate('+(from.left-to.left)+'px,'+(from.top-to.top)+'px) scale('+(from.width/to.width)+','+(from.height/to.height)+')'},{transform:'translate(0px,0px) scale(1,1)'}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'}).then(function(){g.rect=to});
        }));
        // Only viewport thumbnails, with a bounded wait overlapping movement. Never all-library decode.
        await Promise.all([moving,readyWithin(images,250)]);check();phase('revealing');fateSay(FATE_SAYS.reveal);
        await Promise.all(selected.map(function(x,i){var g=x.g,idx=selected.length-1-i;return animate(g.rotor,[{transform:'rotateY('+(g.sign*180)+'deg)'},{transform:'rotateY('+(g.sign*270)+'deg) translateZ(8px)',offset:.46},{transform:'rotateY('+(g.sign*360)+'deg)'}],{duration:340,delay:Math.min(idx*25,175),easing:'cubic-bezier(.2,.65,.22,1)'})}));
        check();fateSay(FATE_SAYS.done);finish('completed');
      }catch(error){if(!finished){fateSay('演出已停止，保留当前可用画廊。');finish(error.name==='AbortError'?'cancelled':'error',error.message)}}
    })();
  }


  /* ============================================================
   *  分类抽屉 — TagDrawer（六组筛选：来源单选 · 同组取并集 · 不同组取交集）
   *  勾选只是草稿，只更新数量；「查看结果」才应用；关闭/Esc 丢弃草稿。
   *  抽屉只消费已载入的索引（data/tags.json），不移动图片、不改文件名。
   * ============================================================ */
  function createTagDrawer(options) {
    function resolve(x) { return typeof x === 'string' ? document.querySelector(x) : x; }
    function norm(x) { return String(x == null ? '' : x).normalize('NFKC').toLocaleLowerCase().trim(); }
    function unique(x) { return Array.from(new Set(x)); }
    function values(x) {
      if (x == null) return [];
      return unique((Array.isArray(x) ? x : [x]).map(function (v) { return String(v).trim(); }).filter(Boolean));
    }
    function copy(x) { return JSON.parse(JSON.stringify(x)); }

    var panel = resolve(options.panel), handle = resolve(options.handle), backdrop = resolve(options.backdrop);
    var openers = (options.openers || []).map(resolve).filter(Boolean);
    var targets = (options.inertTargets || []).map(resolve).filter(Boolean);
    var groups = options.groups || [];
    var side = options.side === 'right' ? 'right' : 'left';
    var direction = side === 'left' ? 1 : -1;

    panel.dataset.side = side;
    handle.dataset.side = side;
    handle.setAttribute('aria-label', side === 'left' ? '向右拉出分类' : '向左拉出分类');
    var mark = handle.querySelector('[data-td-arrow]');
    if (mark) mark.textContent = side === 'left' ? '›' : '‹';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;

    panel.innerHTML = '<header class="td-header">'
      + '<p class="td-kicker">FIND A FRAGMENT</p>'
      + '<h2 class="td-title">命运索引</h2>'
      + '<button type="button" class="td-close" aria-label="收起分类">×</button>'
      + '<p class="td-subtitle">不必一件一件翻。</p>'
      + '<label class="td-search-label"><span class="td-sr-only">搜索作品名称或标签</span>'
      + '<input class="td-search" type="search" autocomplete="off"></label>'
      + '<p class="td-rule">来源单选 · 同组标签取并集 · 不同组取交集</p>'
      + '</header>'
      + '<div class="td-scroll">'
      + '<div class="td-summary"><span class="td-selected-count"></span>'
      + '<button type="button" class="td-reset">重置草稿</button></div>'
      + '<div class="td-groups"></div>'
      + '</div>'
      + '<footer class="td-footer">'
      + '<p class="td-result-count" role="status" aria-live="polite" aria-atomic="true"></p>'
      + '<button type="button" class="td-apply">查看结果</button>'
      + '<p class="td-error" role="status" aria-live="polite"></p>'
      + '</footer>';

    var titleEl = panel.querySelector('.td-title');
    panel.setAttribute('aria-labelledby', (titleEl.id = 'tdTitle'));
    var search = panel.querySelector('.td-search');
    search.placeholder = '搜索作品名称 / 标签…';
    var groupRoot = panel.querySelector('.td-groups');
    var closeButton = panel.querySelector('.td-close');
    var applyButton = panel.querySelector('.td-apply');
    var resetButton = panel.querySelector('.td-reset');
    var countEl = panel.querySelector('.td-result-count');
    var selectedCount = panel.querySelector('.td-selected-count');
    var errorText = panel.querySelector('.td-error');

    /* ---------- 索引 ---------- */
    function validateGroups() {
      if (!groups.length || new Set(groups.map(function (g) { return g.key; })).size !== groups.length) {
        throw new TypeError('Unique filter groups are required.');
      }
      groups.forEach(function (g) {
        if (!g.key || !g.label || !['single', 'multi'].includes(g.mode || 'multi')) throw new TypeError('Invalid filter group.');
      });
    }
    function stateOf(raw) {
      return {
        query: String((raw && raw.query) || ''),
        groups: Object.fromEntries(groups.map(function (g) {
          var v = values(raw && raw.groups && Object.prototype.hasOwnProperty.call(raw.groups, g.key) ? raw.groups[g.key] : undefined);
          return [g.key, g.mode === 'single' ? v.slice(0, 1) : v];
        }))
      };
    }
    function buildIndex(items) {
      validateGroups();
      if (!Array.isArray(items)) throw new TypeError('items must be an array.');
      var getKey = options.getKey || (function (item) { return item.id; });
      var getValues = options.getValues || (function (item, key) { return item.tags && item.tags[key]; });
      var ids = new Set();
      var rows = items.map(function (item) {
        var id = String(getKey(item) == null ? '' : getKey(item));
        if (!id || ids.has(id)) throw new TypeError('Every item requires a unique stable ID.');
        ids.add(id);
        var tags = Object.fromEntries(groups.map(function (g) {
          return [g.key, new Set(values(getValues(item, g.key)))];
        }));
        var text = norm(options.getSearchText
          ? options.getSearchText(item)
          : [item.title || ''].concat(groups.flatMap(function (g) { return Array.from(tags[g.key]); })).join(' '));
        return { id: id, item: item, tags: tags, text: text };
      });
      var choices = Object.fromEntries(groups.map(function (g) {
        var present = unique(rows.flatMap(function (r) { return Array.from(r.tags[g.key]); }))
          .sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
        return [g.key, unique(values(g.values).concat(present))];
      }));
      function prepared(raw) {
        var state = stateOf(raw);
        return { state: state, tokens: norm(state.query).split(/\s+/).filter(Boolean) };
      }
      function accepts(row, p, exclude) {
        if (p.tokens.some(function (t) { return row.text.indexOf(t) === -1; })) return false;
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i];
          if (g.key === exclude) continue;
          var selected = p.state.groups[g.key];
          if (selected.length && !selected.some(function (v) { return row.tags[g.key].has(v); })) return false;
        }
        return true;
      }
      function match(raw) {
        var p = prepared(raw);
        return rows.filter(function (r) { return accepts(r, p); }).map(function (r) { return r.id; });
      }
      function facets(raw) {
        var p = prepared(raw);
        var counts = Object.create(null), totals = Object.create(null);
        groups.forEach(function (g) {
          var bucket = Object.create(null);
          choices[g.key].forEach(function (label) { bucket[label] = 0; });
          var total = 0;
          rows.forEach(function (row) {
            if (accepts(row, p, g.key)) {
              total++;
              row.tags[g.key].forEach(function (label) { bucket[label] = (bucket[label] || 0) + 1; });
            }
          });
          counts[g.key] = bucket;
          totals[g.key] = total;
        });
        return { counts: counts, totals: totals, matchCount: match(p.state).length };
      }
      return Object.freeze({
        match: match, facets: facets, choices: choices,
        total: rows.length, normalize: function (raw) { return stateOf(raw); }
      });
    }

    var index = buildIndex(options.items || []);
    var active = index.normalize(options.initialState);
    var draft = copy(active);
    var opened = false, destroyed = false, progress = 0;
    var controls = [], detailsMap = new Map();
    var previousFocus = null, savedTargets = [], savedOverflow = null;
    var focusFrame = null, applyContext = null, drag = null;
    var suppressClickUntil = 0, searchTimer = null;
    var listeners = [];
    function listen(el, type, fn, opts) {
      el.addEventListener(type, fn, opts);
      listeners.push(function () { el.removeEventListener(type, fn, opts); });
    }
    function emit(name, detail) {
      panel.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    }
    function geometry() { return panel.getBoundingClientRect().width; }
    function position(p, instant) {
      if (destroyed) return;
      progress = Math.max(0, Math.min(1, p));
      [panel, handle, backdrop].forEach(function (el) { el.classList.toggle('td-dragging', !!instant); });
      var width = geometry();
      panel.style.transform = 'translate3d(' + (direction * (progress - 1) * width) + 'px,0,0)';
      handle.style.transform = 'translate3d(' + (direction * progress * width) + 'px,0,0)';
      backdrop.style.opacity = String(progress * .48);
      backdrop.style.pointerEvents = progress > 0 ? 'auto' : 'none';
    }
    function setBusy(busy) {
      applyButton.disabled = busy;
      resetButton.disabled = busy;
      search.disabled = busy;
      panel.querySelectorAll('fieldset').forEach(function (f) { f.disabled = busy; });
      panel.setAttribute('aria-busy', String(busy));
      applyButton.textContent = busy ? '正在整理…' : '查看结果';
    }
    function abortApply() {
      if (applyContext) { applyContext.controller.abort(); applyContext = null; }
      setBusy(false);
    }
    function rebuild() {
      var scrollEl = panel.querySelector('.td-scroll');
      var scrollTop = scrollEl.scrollTop;
      var expanded = new Map(Array.from(detailsMap).map(function (pair) { return [pair[0], pair[1].open]; }));
      controls = [];
      detailsMap = new Map();
      groupRoot.replaceChildren();
      groups.forEach(function (group, gi) {
        var details = document.createElement('details');
        details.className = 'td-group';
        details.dataset.group = group.key;
        details.open = expanded.get(group.key) !== undefined ? expanded.get(group.key) : gi < 2;
        var summary = document.createElement('summary');
        var caption = document.createElement('span');
        caption.textContent = group.label;
        var number = document.createElement('span');
        number.className = 'td-group-count';
        var mode = document.createElement('small');
        mode.textContent = group.mode === 'single' ? '单选' : '可多选';
        summary.append(caption, number, mode);
        details.append(summary);
        var field = document.createElement('fieldset');
        field.className = 'td-choices';
        var legend = document.createElement('legend');
        legend.className = 'td-sr-only';
        legend.textContent = group.label;
        field.append(legend);
        var entries = unique(index.choices[group.key].concat(active.groups[group.key]).concat(draft.groups[group.key]));
        if (group.mode === 'single') entries.unshift('');
        entries.forEach(function (value) {
          var pill = document.createElement('label');
          pill.className = 'td-pill';
          var input = document.createElement('input');
          input.type = group.mode === 'single' ? 'radio' : 'checkbox';
          input.name = 'td-' + gi;
          input.value = value;
          input.dataset.group = group.key;
          var text = document.createElement('span');
          text.textContent = value || '全部';
          var num = document.createElement('span');
          num.className = 'td-pill-number';
          num.setAttribute('aria-hidden', 'true');
          pill.append(input, text, num);
          field.append(pill);
          input.addEventListener('change', function () {
            if (group.mode === 'single') {
              draft.groups[group.key] = value ? [value] : [];
            } else {
              var set = new Set(draft.groups[group.key]);
              if (input.checked) set.add(value); else set.delete(value);
              draft.groups[group.key] = Array.from(set);
            }
            update(true);
          });
          controls.push({ group: group.key, value: value, pill: pill, input: input, num: num, number: number });
        });
        details.append(field);
        groupRoot.append(details);
        detailsMap.set(group.key, details);
      });
      scrollEl.scrollTop = scrollTop;
    }
    function update(notify) {
      var facets = index.facets(draft);
      var quantity = Object.values(draft.groups).reduce(function (n, x) { return n + x.length; }, 0);
      selectedCount.textContent = quantity ? '已选 ' + quantity + ' 个标签' : '还没有限定标签';
      countEl.textContent = '将找到 ' + facets.matchCount.toLocaleString('zh-CN') + ' 件 · 仅应用后更新图库';
      controls.forEach(function (c) {
        var selected = c.value ? draft.groups[c.group].includes(c.value) : draft.groups[c.group].length === 0;
        c.input.checked = selected;
        c.pill.dataset.selected = String(selected);
        var n = c.value ? (facets.counts[c.group][c.value] || 0) : facets.totals[c.group];
        c.num.textContent = n.toLocaleString('zh-CN');
        c.pill.dataset.zero = String(n === 0);
        c.number.textContent = draft.groups[c.group].length ? String(draft.groups[c.group].length) : '';
      });
      if (notify) emit('tagdrawer:change', { draft: copy(draft), count: facets.matchCount });
      return facets.matchCount;
    }
    function openDrawer(focus) {
      if (destroyed) return;
      cancelFate('drawer-open');
      if (!opened) {
        panel.dataset.enter = String(progress < .05);
        panel.dataset.open = 'true';
        handle.setAttribute('aria-label', '收起分类');
        if (mark) mark.textContent = side === 'left' ? '‹' : '›';
        previousFocus = document.activeElement;
        draft = copy(active);
        search.value = draft.query;
        errorText.textContent = '';
        rebuild();
        update();
        savedTargets = targets.map(function (target) { return [target, target.inert]; });
        savedTargets.forEach(function (pair) { pair[0].inert = true; });
        savedOverflow = [document.body.style.getPropertyValue('overflow-y'), document.body.style.getPropertyPriority('overflow-y')];
        document.body.style.setProperty('overflow-y', 'hidden');
        opened = true;
        panel.inert = false;
        panel.setAttribute('aria-hidden', 'false');
        [handle].concat(openers).forEach(function (el) { el.setAttribute('aria-expanded', 'true'); });
        emit('tagdrawer:open', { side: side });
      }
      position(1);
      if (focus) {
        cancelAnimationFrame(focusFrame);
        focusFrame = requestAnimationFrame(function () {
          if (opened && !destroyed) search.focus({ preventScroll: true });
        });
      }
    }
    function closeDrawer(reason) {
      cancelAnimationFrame(focusFrame);
      clearTimeout(searchTimer);
      drag = null;
      abortApply();
      opened = false;
      panel.dataset.open = 'false';
      panel.dataset.enter = 'false';
      handle.setAttribute('aria-label', side === 'left' ? '向右拉出分类' : '向左拉出分类');
      if (mark) mark.textContent = side === 'left' ? '›' : '‹';
      panel.inert = true;
      panel.setAttribute('aria-hidden', 'true');
      [handle].concat(openers).forEach(function (el) { el.setAttribute('aria-expanded', 'false'); });
      position(0);
      savedTargets.forEach(function (pair) { pair[0].inert = pair[1]; });
      savedTargets = [];
      if (savedOverflow) {
        if (savedOverflow[0]) document.body.style.setProperty('overflow-y', savedOverflow[0], savedOverflow[1]);
        else document.body.style.removeProperty('overflow-y');
        savedOverflow = null;
      }
      draft = copy(active);
      search.value = draft.query;
      if (previousFocus && previousFocus.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
      emit('tagdrawer:close', { reason: reason });
    }
    function applyDraft() {
      if (destroyed) return Promise.resolve({ status: 'destroyed' });
      if (applyContext) return Promise.resolve({ status: 'busy' });
      clearTimeout(searchTimer);
      draft.query = search.value;
      update();
      var next = index.normalize(draft);
      var ids = index.match(next);
      var ctx = { controller: new AbortController() };
      applyContext = ctx;
      setBusy(true);
      errorText.textContent = '';
      return Promise.resolve()
        .then(function () {
          if (options.onApply) return options.onApply({ state: copy(next), ids: ids.slice() }, { signal: ctx.controller.signal });
        })
        .then(function () {
          if (ctx.controller.signal.aborted || applyContext !== ctx) return { status: 'cancelled' };
          active = next;
          applyContext = null;
          setBusy(false);
          emit('tagdrawer:apply', { state: copy(active), ids: ids.slice() });
          closeDrawer('apply');
          return { status: 'completed', ids: ids };
        })
        .catch(function (error) {
          if (ctx.controller.signal.aborted || applyContext !== ctx) return { status: 'cancelled' };
          applyContext = null;
          setBusy(false);
          errorText.textContent = '这次没有整理好，原筛选保持不变。请重试。';
          emit('tagdrawer:error', { message: error && error.message });
          return { status: 'error', message: error && error.message };
        });
    }
    function resetDraft() {
      if (applyContext) return;
      draft = index.normalize({});
      search.value = '';
      errorText.textContent = '';
      update(true);
    }
    function focusables() {
      return Array.from(panel.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]'))
        .filter(function (el) { return el.getClientRects().length && getComputedStyle(el).visibility === 'visible'; });
    }
    listen(document, 'keydown', function (event) {
      if (!opened) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer('escape'); return; }
      if (event.key === 'Tab') {
        var list = focusables();
        if (!list.length) { event.preventDefault(); return; }
        var first = list[0], last = list[list.length - 1], current = document.activeElement;
        if (event.shiftKey && (current === first || !panel.contains(current))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (current === last || !panel.contains(current))) { event.preventDefault(); first.focus(); }
      }
    });
    listen(search, 'input', function () {
      clearTimeout(searchTimer);
      draft.query = search.value;
      searchTimer = setTimeout(function () { update(true); }, 100);
    });
    listen(closeButton, 'click', function () { closeDrawer('button'); });
    listen(backdrop, 'click', function () { if (opened) closeDrawer('backdrop'); else position(0); });
    listen(resetButton, 'click', resetDraft);
    listen(applyButton, 'click', function () { applyDraft(); });
    [handle].concat(openers).forEach(function (opener) {
      opener.setAttribute('aria-haspopup', 'dialog');
      opener.setAttribute('aria-controls', panel.id);
      opener.setAttribute('aria-expanded', 'false');
      listen(opener, 'click', function () {
        if (opener === handle && performance.now() < suppressClickUntil) { suppressClickUntil = 0; return; }
        if (opened) closeDrawer('opener'); else openDrawer(true);
      });
    });
    listen(handle, 'pointerdown', function (event) {
      if (event.button !== 0 || destroyed) return;
      drag = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        start: opened ? 1 : 0, moved: false,
        lastX: event.clientX, lastTime: performance.now(), velocity: 0
      };
      handle.setPointerCapture(event.pointerId);
    });
    listen(handle, 'pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy)) drag.moved = true;
      if (drag.moved) {
        var now = performance.now(), dt = now - drag.lastTime;
        drag.velocity = dt > 0 ? direction * (event.clientX - drag.lastX) / dt : 0;
        drag.lastX = event.clientX;
        drag.lastTime = now;
        position(drag.start + direction * dx / geometry(), true);
        event.preventDefault();
      }
    });
    listen(handle, 'pointerup', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (d.moved) {
        suppressClickUntil = performance.now() + 450;
        var velocity = performance.now() - d.lastTime < 100 ? d.velocity : 0;
        var shouldOpen = velocity > .35 ? true : velocity < -.35 ? false : progress > .45;
        if (shouldOpen) openDrawer(true); else closeDrawer('drag');
      }
    });
    listen(handle, 'pointercancel', function () { drag = null; position(opened ? 1 : 0); });
    listen(window, 'resize', function () {
      drag = null;
      position(opened ? 1 : 0, true);
      requestAnimationFrame(function () { position(opened ? 1 : 0); });
    });

    rebuild();
    update();
    position(0, true);
    requestAnimationFrame(function () { position(opened ? 1 : 0); });

    var api = Object.freeze({
      open: function () { openDrawer(true); },
      close: function () { closeDrawer('api'); },
      apply: applyDraft,
      reset: resetDraft,
      getState: function () { return copy(active); },
      getDraft: function () { return copy(draft); },
      setState: function (raw) {
        if (destroyed) return;
        active = index.normalize(raw);
        draft = copy(active);
        if (search) search.value = draft.query;
        rebuild();
        update();
      },
      get count() { return index.match(draft).length; },
      get isOpen() { return opened; },
      get busy() { return !!applyContext; },
      setItems: function (items) {
        if (destroyed) return;
        abortApply();
        panel.dataset.enter = 'false';
        index = buildIndex(items);
        active = index.normalize(active);
        draft = copy(active);
        if (search) search.value = draft.query;
        rebuild();
        update();
        emit('tagdrawer:indexchange', { total: index.total });
      },
      destroy: function () {
        if (destroyed) return;
        closeDrawer('destroy');
        destroyed = true;
        clearTimeout(searchTimer);
        cancelAnimationFrame(focusFrame);
        listeners.forEach(function (off) { off(); });
      }
    });
    return api;
  }

  /* ---------------- 抽屉初始化（数据载入后调用） ---------------- */
  function initDrawer() {
    if (!tagsData || !cats.length || drawerApi) return;
    var drawerItems = [];
    cats.forEach(function (cat) {
      cat.images.forEach(function (img) {
        var base = img[0].replace(/\.[^.]+$/, '');
        var t = (tagsData[cat.name] && tagsData[cat.name][base]) || null;
        drawerItems.push({
          id: cat.name + '/' + base,
          cat: cat.name,
          base: base,
          w: img[1], h: img[2],
          t: t
        });
      });
    });
    DRAWER_GROUPS[0].values = cats.map(function (c) { return c.name; });

    drawerApi = createTagDrawer({
      panel: '#tdPanel',
      handle: '#tdHandle',
      backdrop: '#tdBackdrop',
      openers: ['#findBtn'],
      inertTargets: ['header.site-head', 'nav.nav-wrap', 'main.stage', 'footer.site-foot'],
      side: 'left',
      groups: DRAWER_GROUPS,
      items: drawerItems,
      getKey: function (item) { return item.id; },
      getValues: function (item, key) {
        if (key === 'collection') return [item.cat];
        if (!item.t) return [];
        var k = key === 'composition' ? 'shot' : key;
        return item.t[k] || [];
      },
      getSearchText: function (item) {
        return (item.t ? item.t.all : '') + ' ' + item.base + ' ' + item.cat;
      },
      onApply: function (payload, ctx) {
        var state = payload.state, ids = payload.ids;
        var want = (state.groups.collection || [])[0];
        var target = active;
        if (want) {
          for (var i = 0; i < cats.length; i++) {
            if (cats[i].name === want) { target = i; break; }
          }
        }
        var catName = cats[target].name;
        var idSet = new Set();
        ids.forEach(function (id) {
          if (id.indexOf(catName + '/') === 0) idSet.add(id);
        });
        // 选中集覆盖整个分类 = 等价于无筛选，直接清空条件（保持干净的计数展示）
        var otherGroupsEmpty = DRAWER_GROUPS.every(function (g) {
          if (g.key === 'collection') return true;
          return !state.groups[g.key] || state.groups[g.key].length === 0;
        });
        tagFilter = (idSet.size >= cats[target].images.length && !state.query.trim() && otherGroupsEmpty)
          ? null
          : { cat: catName, ids: idSet };
        if (target !== active) {
          switchCat(target);          // 内部按新 tagFilter 重排（NSFW 解锁沿用原有规则）
        } else {
          resetGrid();
          refillPool();
          appendBatch();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        drawerApi.setState(state);    // switchCat 的同步会清空分组，这里恢复已应用条件
        updateCountLine();
        renderFilterChips();
        if (ctx && ctx.signal && ctx.signal.aborted) return;
      }
    });

    document.getElementById('tdHandle').disabled = false;
    document.getElementById('findBtn').disabled = false;
    syncDrawerToCategory();
  }

  /* ============================================================
   *  灯箱
   * ============================================================ */
  var lbOpen = false;
  var lbCur = 0;

  function lbList() {
    // 按当前 DOM 顺序（即瀑布流展示顺序）逐个翻页
    return cards;
  }

  function lbShow(si, push) {
    cancelFate('lightbox-open');
    var list = lbList();
    var pos = -1;
    for (var i = 0; i < list.length; i++) if (list[i].si === si) { pos = i; break; }
    if (pos < 0) return;
    lbCur = pos;

    var k = list[pos];
    lbOpen = true;
    lb.root.hidden = false;
    document.body.classList.add('lb-open');

    lb.img.classList.add('is-loading');
    lb.spinner.classList.add('is-on');

    var pre = new Image();
    var show = function () {
      // 尽量展示原图画质：src 为原图，srcset 让高 DPI 屏自动取更高分辨率
      lb.img.srcset = k.full + ' ' + k.w + 'w';
      lb.img.src = k.full;
      lb.img.alt = k.name;
      lb.img.classList.remove('is-loading');
      lb.spinner.classList.remove('is-on');
    };
    pre.onload = show;
    pre.onerror = show;
    pre.src = k.full;

    lb.idx.textContent = (pos + 1) + ' / ' + list.length;
    lb.name.textContent = k.name;
    lb.size.textContent = fmtSize(k.w, k.h0) + (k.round > 1 ? ' · R' + k.round : '');
    lb.orig.href = k.full;
    lb.frag.textContent = 'FRAGMENT ' + String(k.si + 1).padStart(4, '0');
    lb.cat.textContent = (ARCHIVE_EN && ARCHIVE_EN[k.cat]) || k.cat;

    // 预取相邻一张，切换更顺滑
    clearTimeout(lbShow._t);
    lbShow._t = setTimeout(function () { lbPre(k, pos + 1); lbPre(k, pos - 1); }, 320);
  }

  function lbPre(cur, pos) {
    var list = lbList();
    if (pos < 0 || pos >= list.length) return;
    var im = new Image();
    im.src = list[pos].full;
  }

  function lbStep(d) {
    var list = lbList();
    if (!list.length) return;
    var n = (lbCur + d + list.length) % list.length;
    lbShow(list[n].si);
  }

  function lbHide() {
    lbOpen = false;
    lb.root.hidden = true;
    document.body.classList.remove('lb-open');
    lb.img.removeAttribute('src');     // 释放大图内存
    lb.img.removeAttribute('srcset');
    lb.img.alt = '';
    clearTimeout(lbShow._t);
  }

  lb.backdrop.addEventListener('click', lbHide);   // 点击遮罩空白处关闭
  lb.close.addEventListener('click', lbHide);
  lb.prev.addEventListener('click', function (e) { e.stopPropagation(); lbStep(-1); });
  lb.next.addEventListener('click', function (e) { e.stopPropagation(); lbStep(1); });
  lb.img.addEventListener('click', function (e) { e.stopPropagation(); });
  lb.root.addEventListener('click', function (e) { if (e.target === lb.root) lbHide(); });

  // 灯箱内滚轮 / 触摸滑动切换
  var wheelLock = 0;
  lb.root.addEventListener('wheel', function (e) {
    if (!lbOpen) return;
    e.preventDefault();
    var now = Date.now();
    if (now - wheelLock < 240) return;
    wheelLock = now;
    lbStep(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  var touchX = 0, touchY = 0;
  lb.root.addEventListener('touchstart', function (e) {
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });
  lb.root.addEventListener('touchend', function (e) {
    if (!lbOpen) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) lbStep(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------------- 键盘 ---------------- */
  document.addEventListener('keydown', function (e) {
    if (lbOpen) {
      if (e.key === 'Escape') { e.preventDefault(); lbHide(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      var next = active + (e.key === 'ArrowRight' ? 1 : -1);
      if (next >= 0 && next < cats.length) { e.preventDefault(); switchCat(next); }
    }
  });

  /* ---------------- 点击卡片打开灯箱 ---------------- */
  $grid.addEventListener('click', function (e) {
    var card = e.target.closest ? e.target.closest('.card') : null;
    if (!card) return;
    lbShow(parseInt(card.dataset.si, 10));
  });

  $grid.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest ? e.target.closest('.card') : null;
    if (!card) return;
    e.preventDefault();
    lbShow(parseInt(card.dataset.si, 10));
  });

  /* ============================================================
   *  窗口尺寸变化
   * ============================================================ */
  var lastGridW = 0;
  var rzTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      if (!cards.length) return;
      var nw = $grid.clientWidth || window.innerWidth;
      var nc = computeCols();
      // 列数变化，或可用宽度实际变化超过一个像素级阈值 -> 重排
      if (nc === cols && Math.abs(nw - lastGridW) < RESIZE_TOL) return;
      lastGridW = nw;
      layoutAll();
    }, 140);
  });

  /* ---------------- 顶部进度线 + 回到原分类 ---------------- */
  window.addEventListener('scroll', function () {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, window.pageYOffset / max) : 0;
    $prog.style.width = (p * 100).toFixed(2) + '%';
  }, { passive: true });

  /* ============================================================
   *  NSFW 锁
   * ============================================================ */
  function updateNsfwBtn() {
    if (lockNsfw) {
      $nsfwBtn.classList.remove('is-on');
      $nsfwLbl.textContent = 'NSFW 隐藏中';
      $nsfwBtn.title = '解锁 NSFW 分类';
    } else {
      $nsfwBtn.classList.add('is-on');
      $nsfwLbl.textContent = 'NSFW 显示中';
      $nsfwBtn.title = '收起 NSFW 分类（不会自动跳转）';
    }
  }

  /* ============================================================
   *  启动
   * ============================================================ */
  function boot() {
    fetch(CATS_PATH, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || !json.categories || !json.categories.length) throw new Error('数据为空');
        cats = json.categories.filter(function (c) { return c.images && c.images.length; });

        // NSFW 分类存在则显示解锁按钮（默认隐藏该分类内容）
        var hasNsfw = cats.some(function (c) { return c.name === 'NSFW区'; });
        if (hasNsfw) { lockNsfw = true; $nsfwBtn.hidden = false; updateNsfwBtn(); $nsfwCap.hidden = false; applyTheme(false, { animate: false, emit: false }); }

        // 标签筛选索引（分类抽屉）；失败只降级抽屉，不影响画廊
        fetch(TAGS_PATH, { cache: 'no-cache' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (t) {
            tagsData = t;
            initDrawer();
          })
          .catch(function (err) {
            if (window.console) console.warn('[绯月画廊] 标签索引载入失败，分类抽屉不可用：', err);
          });

        buildTabs();

        // 支持 #分类名 直达
        var want = 0;
        try {
          var h = decodeURIComponent(location.hash.replace(/^#/, ''));
          for (var i = 0; i < cats.length; i++) if (cats[i].name === h) want = i;
        } catch (e) { /* 忽略非法 hash */ }

        resetLayout();
        switchCat(want);
      })
      .catch(function (err) {
        $fatal.hidden = false;
        $senti.style.display = 'none';
        $count.textContent = '载入失败';
        if (window.console) console.error('[绯月画廊]', err);
      });
  }

  $shuffle.addEventListener('click', reshuffleFate);
  $nsfwBtn.addEventListener('click', function () {
    lockNsfw = !lockNsfw;
    updateNsfwBtn();
    applyTheme(!lockNsfw);
    updateTabs();
    if (lockNsfw && cats[active] && cats[active].name === 'NSFW区') switchCat(0);
  });

  document.getElementById('year').textContent = new Date().getFullYear();

  // 重排一次，确保字体加载后列宽正确
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { if (cards.length) layoutAll(); });
  }

  boot();
})();

/* ============================================================
 *  SCARLET SPACE v3 — 被留下的收藏室（背景房间，装饰层）
 *  不读存储、不改数据、不含权限逻辑；绝不 transform/filter 作品本体。
 * ============================================================ */
(function () {
  'use strict';
  var active = null;
  function resolve(x) { return typeof x === 'string' ? document.querySelector(x) : x; }
  function validState(x) { return x === 'sealed' || x === 'unsealed'; }
  var NS = 'http://www.w3.org/2000/svg';
  var HUES = [0, 28, 52, 130, 185, 225, 280];
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var f1 = function (n) { return n.toFixed(1); };
  var hueIx = 0;
  function fan(r, ax, ay, a0, a1, n, len, wid) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? .5 : i / (n - 1);
      var ang = (a0 + (a1 - a0) * t + (r() - .5) * 8) * Math.PI / 180;
      var L = len * (.55 + r() * .6), w = wid * (.7 + r() * .7);
      var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
      var sh = .30 + r() * .18;
      function p(k, o) { return [ax + dx * L * k + nx * o, ay + dy * L * k + ny * o]; }
      function pt(a) { return a.map(f1).join(' '); }
      var s1 = p(sh, w), s2 = p(sh * 1.1, -w * .55);
      var tip = p(1, (r() - .5) * w * .35), mid = p(.8, 0);
      var A = f1(ax) + ' ' + f1(ay);
      out += '<g class="ss-fin" style="transform-origin:' + f1(ax) + 'px ' + f1(ay) + 'px;--h:' + HUES[hueIx++ % 7] + ';--r:' + (.4 + r() * 1.4).toFixed(2) + 'deg;--d:' + (12 + r() * 12).toFixed(1) + 's;--w:-' + (r() * 16).toFixed(1) + 's">'
        + '<path class="f" d="M' + A + 'L' + pt(s1) + ' ' + pt(tip) + ' ' + pt(s2) + 'Z"/><path class="h" d="M' + A + 'L' + pt(s1) + ' ' + pt(mid) + 'Z"/><path class="k" d="M' + A + 'L' + pt(tip) + 'M' + pt(s1) + 'L' + pt(s2) + '"/></g>';
    }
    return out;
  }
  function cracks(r, fx, fy, count, tBase) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var ang = (i / count) * Math.PI * 2 + (r() - .5) * .5;
      var len = 450 + r() * 900, seg = 9;
      var d = 'M' + f1(fx) + ' ' + f1(fy), x = fx, y = fy;
      for (var s = 1; s <= seg; s++) {
        var k = len / seg;
        var a = ang + (r() - .5) * (s < 3 ? .3 : .8);
        x += Math.cos(a) * k * (.7 + r() * .6);
        y += Math.sin(a) * k * (.7 + r() * .6);
        d += 'L' + f1(x) + ' ' + f1(y);
      }
      out.push({ d: d, t: tBase + r() * .75 });
    }
    return out;
  }
  // [x,y,w,h,基础倾斜,全失控额外倾斜,是否裂纹]
  var FRAMES = [[1290, 80, 210, 270, -.8, 6, 0], [1390, 430, 150, 200, 1.4, -9, 1], [24, 380, 140, 190, 0, 11, 0], [130, 34, 120, 150, -1.8, -5, 0], [1090, 560, 130, 170, .5, 15, 1], [-30, 700, 200, 260, .9, -8, 1], [1450, 720, 110, 150, -.4, -12, 0]];
  function frames() {
    return FRAMES.map(function (fr) {
      var x = fr[0], y = fr[1], w = fr[2], h = fr[3], b = fr[4], e = fr[5], c = fr[6];
      var cx = x + w / 2, top = y - 90;
      return '<g class="ss-frame" style="transform-origin:' + cx + 'px ' + top + 'px;--b:' + b + ';--x:' + e + '">'
        + '<path class="wire" d="M' + cx + ' ' + top + 'L' + (x + 10) + ' ' + y + 'M' + cx + ' ' + top + 'L' + (x + w - 10) + ' ' + y + '"/>'
        + '<rect class="bg" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>'
        + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>'
        + '<rect class="in" x="' + (x + 11) + '" y="' + (y + 11) + '" width="' + (w - 22) + '" height="' + (h - 22) + '"/>'
        + (c
          ? '<path class="glass" d="M' + (x + w) + ' ' + y + 'L' + (x + w * .45) + ' ' + (y + h * .4) + 'L' + (x + w * .52) + ' ' + (y + h * .46) + 'L' + x + ' ' + (y + h) + 'M' + (x + w * .45) + ' ' + (y + h * .4) + 'L' + (x + w * .2) + ' ' + (y + h * .3) + '"/>'
          : '<path class="glass" d="M' + (x + w * .7) + ' ' + (y + h) + 'L' + (x + w * .62) + ' ' + (y + h * .82) + 'L' + (x + w * .74) + ' ' + (y + h * .74) + '"/>')
        + '</g>';
    }).join('');
  }
  function mount(options) {
    if (active) return active;
    var environment = resolve(options.environment || '.env');
    var gallery = resolve(options.gallery || '.stage');
    var nav = resolve(options.nav || '.nav-wrap');
    var source = resolve(options.themeSource || '#stateWord');
    var root = document.documentElement;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    var useEyes = options.eyes !== false;
    var r = rng(20261013);
    hueIx = 0;
    var room = document.createElement('div');
    room.className = 'ss-room';
    room.setAttribute('aria-hidden', 'true');
    room.inert = true;
    function svg(inner) {
      return '<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="' + NS + '" aria-hidden="true">' + inner + '</svg>';
    }
    var cr = cracks(r, 1650, 360, 12, .04).concat(cracks(r, -50, 780, 8, .1));
    var crackSvg = cr.map(function (c) { return '<path style="--t:' + c.t.toFixed(2) + '" d="' + c.d + '"/>'; }).join('')
      + cr.filter(function (_, i) { return i % 5 === 2; }).map(function (c) { return '<path class="run" style="--t:' + Math.max(.3, c.t).toFixed(2) + '" d="' + c.d + '"/>'; }).join('');
    room.innerHTML =
      '<div class="ss-base"></div><div class="ss-halo"></div>'
      + '<div class="ss-floor"></div>'
      + '<div class="ss-layer ss-wall" data-k="0.2">' + svg('<path d="M150 0V1000M1470 0V1000M0 640H1600"/>') + '</div>'
      + '<div class="ss-layer ss-frames" data-k="0.4">' + svg(frames()) + '</div>'
      + '<div class="ss-layer ss-fins ss-far" data-k="0.3">' + svg(fan(r, -60, 820, -88, -40, 4, 760, 80) + fan(r, 1660, 600, 205, 255, 4, 760, 80)) + '</div>'
      + '<div class="ss-layer ss-crack" data-k="0.55">' + svg(crackSvg) + '</div>'
      + '<div class="ss-layer ss-fins ss-mid" data-k="0.7">' + svg(fan(r, -30, 900, -80, -45, 3, 520, 62) + fan(r, 1640, 720, 195, 240, 3, 500, 60)) + '</div>'
      + '<div class="ss-layer ss-fins ss-near" data-k="1.2">' + svg(fan(r, -120, 1020, -78, -55, 2, 780, 110) + fan(r, 1720, 1040, -125, -105, 2, 720, 100)) + '</div>'
      + (useEyes ? '<div class="ss-eyes"><i></i><i></i></div>' : '')
      + '<div class="ss-shock"></div><div class="ss-vignette"></div>';
    var layers = Array.prototype.slice.call(room.querySelectorAll('.ss-layer'));
    var fins = Array.prototype.slice.call(room.querySelectorAll('.ss-fin'));
    var frameEls = Array.prototype.slice.call(room.querySelectorAll('.ss-frame'));
    var crackBase = Array.prototype.slice.call(room.querySelectorAll('.ss-crack path:not(.run)'));
    var crackRuns = Array.from(room.querySelectorAll('.ss-crack path.run')).map(function(el){return {el:el,threshold:parseFloat(el.style.getPropertyValue('--t'))||0}});
    var floorCrop = -1;
    var eyes = room.querySelector('.ss-eyes');
    var shock = room.querySelector('.ss-shock');
    var restored = [];
    function addClass(el, n) {
      if (!el || el.classList.contains(n)) return;
      el.classList.add(n);
      restored.push(function () { el.classList.remove(n); });
    }
    addClass(root, 'ss-enabled');
    addClass(gallery, 'ss-gallery-plane');
    if (options.bridgeNav !== false) addClass(nav, 'ss-nav-bridge');
    var oldState = root.getAttribute('data-ss-state');
    restored.push(function () {
      if (oldState === null) root.removeAttribute('data-ss-state');
      else root.setAttribute('data-ss-state', oldState);
    });
    if (environment) environment.append(room);
    else { document.body.prepend(room); }
    var destroyed = false, state = 'sealed', manualPause = false, pageAway = false, fateHeld = false;
    var raf = null, timer = null, pulseTimer = null, eyesTimer = null;
    var pointerX = 0, sx = 0, sy = 0, pointerY = 0, scrollV = 0, lastScroll = window.scrollY;
    var lastT = 0, m = 0, shownM = -1, writes = 0, events = 0, lastFloor = -1;
    var layerValues = [], auxiliaryTimers = new Set();
    var listeners = [], observers = [];
    var modalSpec = options.modalTargets || ['#tdPanel', '#lightbox'];
    var modals = (Array.isArray(modalSpec) ? modalSpec : [modalSpec]).map(resolve).filter(Boolean);
    // Cache ONLY our own blurred background vectors, never gallery artwork.
    // Full-window CSS blur on a live SVG remains expensive even when JS is idle.
    var bitmapLayers = [], bitmapURLs = new Set(), cacheSerial = 0, cacheResizeTimer = null, cacheNeeded = false;
    function prepareBitmap(layer) {
      var original=layer.querySelector('svg'),w=layer.clientWidth,h=layer.clientHeight;
      if(!original||!w||!h)return null;
      var copy=original.cloneNode(true),paths=original.querySelectorAll('path'),copies=copy.querySelectorAll('path');
      copy.setAttribute('width',String(w));copy.setAttribute('height',String(h));
      paths.forEach(function(el,i){var cs=getComputedStyle(el);['fill','stroke','stroke-width','opacity','vector-effect'].forEach(function(k){copies[i].setAttribute(k,cs.getPropertyValue(k))})});
      copy.querySelectorAll('g').forEach(function(g){g.removeAttribute('style')});
      var scale=Math.min(window.devicePixelRatio||1,1.5,2048/w,1536/h);
      return {layer:layer,original:original,xml:new XMLSerializer().serializeToString(copy),w:w,h:h,scale:scale,blur:layer.classList.contains('ss-near')?(window.matchMedia('(max-width:700px)').matches?4:7):2};
    }
    async function makeBitmap(spec,serial) {
      var vectorURL=null,pixelURL=null;
      try {
        vectorURL=URL.createObjectURL(new Blob([spec.xml],{type:'image/svg+xml'}));
        var raw=new Image();raw.src=vectorURL;await raw.decode();if(destroyed||serial!==cacheSerial)return;
        var canvas=document.createElement('canvas');canvas.width=Math.min(2048,Math.max(1,Math.ceil(spec.w*spec.scale)));canvas.height=Math.min(1536,Math.max(1,Math.ceil(spec.h*spec.scale)));
        var ctx=canvas.getContext('2d');if(!ctx||!('filter' in ctx))return;
        ctx.filter='blur('+(spec.blur*spec.scale)+'px)';ctx.drawImage(raw,0,0,canvas.width,canvas.height);
        var png=await new Promise(function(res){canvas.toBlob(res,'image/png')});canvas.width=canvas.height=1;
        if(!png||destroyed||serial!==cacheSerial)return;
        pixelURL=URL.createObjectURL(png);var image=new Image();image.alt='';image.className='ss-fin-cache';image.src=pixelURL;await image.decode();
        if(destroyed||serial!==cacheSerial)return;
        // A completed cache is safe to swap: same geometry and colours; no art URLs involved.
        var prior=spec.layer.querySelector('.ss-fin-cache');
        if(prior){bitmapURLs.delete(prior.src);URL.revokeObjectURL(prior.src);prior.remove()}
        spec.layer.append(image);spec.layer.classList.add('ss-cached');bitmapURLs.add(pixelURL);pixelURL=null;
        if(bitmapLayers.indexOf(spec.layer)<0)bitmapLayers.push(spec.layer);
      } catch(e) { /* CSP/decoder/canvas failures retain the vector fallback. */ }
      finally { if(vectorURL)URL.revokeObjectURL(vectorURL);if(pixelURL)URL.revokeObjectURL(pixelURL) }
    }
    function cacheBlocked(){return fateHeld||root.dataset.phase==='switching'||manualPause||pageAway||document.hidden||modalOpen()}
    function cacheBackground() {
      if(destroyed)return;
      if(cacheBlocked()){cacheNeeded=true;return}cacheNeeded=false;
      var serial=++cacheSerial;
      // Batch all layout/style reads before asynchronous rendering.
      var specs=Array.from(room.querySelectorAll('.ss-far,.ss-near')).map(prepareBitmap).filter(Boolean);
      specs.forEach(function(spec){makeBitmap(spec,serial)});
    }

    function on(t, n, f, o) { t.addEventListener(n, f, o); listeners.push(function () { t.removeEventListener(n, f, o); }); }
    function watch(t, o, f) { var mo = new MutationObserver(f); mo.observe(t, o); observers.push(mo); }
    function modalOpen() {
      return modals.some(function (el) {
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
        if (el.getAttribute('aria-modal') === 'true' && el.getAttribute('aria-hidden') === 'false') return true;
        if (el.id === 'lightbox' && !el.hidden) return true;
        return el.dataset.open === 'true';
      });
    }
    function paused() { return manualPause || fateHeld || root.dataset.phase === 'switching' || pageAway || reduced.matches || document.hidden || modalOpen(); }
    function targetM() {
      var s = 1 - Math.exp(-(window.scrollY) / (options.madnessScale || 4500));
      return state === 'unsealed' ? Math.min(1, s * .78 + .22) : s;
    }
    function publishDepth() {
      var depth = +m.toFixed(3);
      room.style.setProperty('--m', String(depth));
      crackRuns.forEach(function(run) {
        var visible = String(depth > run.threshold);
        if (run.el.dataset.active !== visible) run.el.dataset.active = visible;
      });
    }
    function syncFloorGeometry() {
      if (destroyed) return;
      // Remove only the transparent upper 60% of the old 150%-high plane.
      // Bottom-origin perspective is unchanged; shift tile phase by exactly 90% of room height.
      var cut = room.getBoundingClientRect().height * .9;
      if (cut !== floorCrop) { floorCrop = cut; room.style.setProperty('--ss-floor-crop', cut + 'px'); }
    }
    function frame(t) {
      raf = null;
      if (destroyed || paused()) return;
      var dt = lastT ? t - lastT : 34;
      if (dt < 30) { raf = requestAnimationFrame(frame); return; }
      dt = Math.min(64, dt); lastT = t;
      var pBlend = 1 - Math.exp(-dt / 320), mBlend = 1 - Math.exp(-dt / 190);
      sx += (pointerX - sx) * pBlend; sy += (pointerY - sy) * pBlend;
      scrollV += (((window.scrollY - lastScroll) / Math.max(dt, 1)) - scrollV) * .24;
      lastScroll = window.scrollY;
      var desiredM = targetM(); m += (desiredM - m) * mBlend;
      var moving = Math.abs(pointerX-sx)>.002 || Math.abs(pointerY-sy)>.002 || Math.abs(desiredM-m)>.001 || Math.abs(scrollV)>.003;
      if (!moving) { sx=pointerX; sy=pointerY; m=desiredM; scrollV=0; }
      var tilt = Math.max(-2, Math.min(2, scrollV * .8)), changed=false;
      for (var i=0;i<layers.length;i++) {
        var k=+layers[i].dataset.k;
        var value='translate3d('+(sx*28*k).toFixed(1)+'px,'+(sy*14*k+Math.sin(window.scrollY/1500+k*3)*70*k).toFixed(1)+'px,0) rotate('+(tilt*k*.4).toFixed(2)+'deg)';
        if (value!==layerValues[i]) { layerValues[i]=value; layers[i].style.transform=value; changed=true; }
      }
      if (Math.abs(m-shownM)>.004 || (!moving && m!==shownM)) { shownM=m; publishDepth(); changed=true; }
      var floorNow=Math.floor(window.scrollY*.35)%120;
      if(floorNow!==lastFloor){lastFloor=floorNow;room.style.setProperty('--ss-floor',floorNow.toFixed(1));changed=true}
      if(changed)writes++;
      // No permanent JS loop: wake only for input, a theme settle or visibility.
      if(moving)raf=requestAnimationFrame(frame);
    }
    function start() { if(raf===null&&!destroyed&&!paused()){lastT=0;raf=requestAnimationFrame(frame)} }

    function snap(el, cls, ms) {
      el.classList.remove(cls);
      void el.getBoundingClientRect();
      el.classList.add(cls);
      later(function () { el.classList.remove(cls); }, ms, true);
    }
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    // 你不看的时候：某幅空画框悄悄滑一下，并保持滑过
    function event() {
      if (destroyed || paused() || m < .12) return;
      events++;
      var fr = pick(frameEls);
      var j = Math.max(-3, Math.min(3, (parseFloat(fr.style.getPropertyValue('--j')) || 0) + (Math.random() < .5 ? -1 : 1) * (.4 + Math.random() * .7)));
      fr.style.setProperty('--j', j.toFixed(2));
      var activeFins = fins.filter(function(fin){return !fin.closest('.ss-cached')});
      if (m > .3 && activeFins.length) snap(pick(activeFins), 'snap', 560);
      if (m > .4) snap(pick(crackBase), 'hot', 380);
    }
    function loop() {
      clearTimeout(timer);
      timer = setTimeout(function () { event(); loop(); }, (m < .12 ? 3500 : 14000 - 8000 * m + Math.random() * 5000));
    }
    function watchMe() {
      clearTimeout(eyesTimer);
      eyesTimer = setTimeout(function () {
        if (!destroyed && !paused() && eyes && m > .35) {
          var left = Math.random() < .5;
          eyes.style.left = (left ? 1.2 + Math.random() * 1.6 : 96.5 + Math.random() * 1.5) + '%';
          eyes.style.top = (22 + Math.random() * 58) + '%';
          eyes.dataset.on = 'false';
          void eyes.offsetWidth;
          eyes.dataset.on = 'true';
        }
        watchMe();
      }, 20000 + Math.random() * 25000);
    }
    function clearPulse() { clearTimeout(pulseTimer); pulseTimer = null; shock.dataset.pulse = 'false'; }
    function later(fn, ms, cleanup) {
      var id = setTimeout(function () {
        auxiliaryTimers.delete(id);
        if (!destroyed && (cleanup || !paused())) fn();
      }, ms);
      auxiliaryTimers.add(id); return id;
    }
    function pulse() {
      if (destroyed || paused()) return false;
      clearPulse(); void shock.offsetWidth; shock.dataset.pulse = 'true';
      // One optional echo; no 21 staggered reflows competing with a flip.
      pulseTimer = setTimeout(clearPulse, 1050); return true;
    }
    function setState(next) {
      if (!validState(next)) throw new TypeError('ScarletSpace state must be sealed or unsealed.');
      if (destroyed) return state;
      if (state === next && room.dataset.state === next) return state;
      state = next;
      room.dataset.state = state;
      // Theme bias is a one-time state update; scroll/pointer smoothing remains demand-driven.
      m = targetM(); shownM = m; publishDepth();
      root.dataset.ssState = state;
      return state;
    }
    function syncState() {
      if (destroyed) return;
      var next;
      if (typeof options.getState === 'function') next = options.getState();
      else if (source) {
        var t = source.textContent.trim();
        next = t === '解封' ? 'unsealed' : t === '封存' ? 'sealed' : undefined;
      }
      if (!validState(next)) next = validState(root.dataset.state) ? root.dataset.state : 'sealed';
      setState(next);
    }
    function settle() { m = targetM(); shownM = m; publishDepth(); }
    function suspension() {
      if (destroyed) return;
      if (cacheNeeded && !cacheBlocked()) cacheBackground();
      room.dataset.paused = String(paused());
      if (paused()) {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        clearPulse();
        clearTimeout(timer);
        clearTimeout(eyesTimer);
        if (reduced.matches) { layers.forEach(function (l) { l.style.transform = ''; }); settle(); }
      } else {
        lastScroll = window.scrollY; scrollV = 0;
        start();
        loop();
        if (useEyes) watchMe();
      }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(eyesTimer);
      clearPulse();
      auxiliaryTimers.forEach(function (id) { clearTimeout(id); }); auxiliaryTimers.clear();
      cacheSerial++; clearTimeout(cacheResizeTimer); bitmapURLs.forEach(function(url){URL.revokeObjectURL(url)}); bitmapURLs.clear();
      listeners.forEach(function (f) { f(); });
      observers.forEach(function (o) { o.disconnect(); });
      room.remove();
      restored.reverse().forEach(function (f) { f(); });
      active = null;
    }
    on(window, 'pointermove', function (e) {
      if (paused() || !finePointer.matches || e.pointerType === 'touch') return;
      pointerX = Math.max(-1, Math.min(1, e.clientX / Math.max(innerWidth, 1) * 2 - 1));
      pointerY = Math.max(-1, Math.min(1, e.clientY / Math.max(innerHeight, 1) * 2 - 1));
      start();
    }, { passive: true });
    on(document, 'pointerleave', function () { pointerX = pointerY = 0; start(); });
    on(window, 'scroll', function () { if (reduced.matches) settle(); else start(); }, { passive: true });
    on(document, 'visibilitychange', suspension);
    on(window, 'pagehide', function () { pageAway = true; suspension(); });
    on(window, 'pageshow', function () { pageAway = false; suspension(); });
    on(reduced, 'change', suspension);
    on(window, 'scarlet:modechange', syncState);
    on(document, 'fate:shufflestart', function () { fateHeld = true; suspension(); });
    ['fate:shuffleend', 'fate:shufflecancel', 'fate:shuffleerror'].forEach(function (name) {
      on(document, name, function () { fateHeld = false; suspension(); });
    });
    modals.forEach(function (el) {
      watch(el, { attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'aria-modal', 'data-open'] }, suspension);
    });
    if (source) watch(source, { childList: true, characterData: true, subtree: true }, syncState);
    watch(root, { attributes: true, attributeFilter: ['data-state', 'data-phase'] }, function () { syncState(); suspension(); });
    syncFloorGeometry();
    syncState();
    cacheBackground();
    on(window, 'resize', function(){syncFloorGeometry();clearTimeout(cacheResizeTimer);cacheResizeTimer=setTimeout(cacheBackground,180)}, {passive:true});
    settle();
    suspension();
    active = Object.freeze({
      setState: setState,
      syncState: syncState,
      pulse: pulse,
      event: event,
      destroy: destroy,
      pause: function () { manualPause = true; suspension(); },
      resume: function () { manualPause = false; suspension(); },
      getState: function () { return state; },
      getMadness: function () { return m; },
      diagnostics: function () {
        return {
          destroyed: destroyed, paused: paused(), manualPause: manualPause, fateHeld: fateHeld, bitmapLayers: bitmapLayers.length,
          reducedMotion: reduced.matches, framePending: raf !== null,
          frameWrites: writes, madness: +m.toFixed(3), events: events,
          fins: fins.length, frames: frameEls.length, activeCrackRuns: crackRuns.filter(function(run){return run.el.dataset.active === 'true'}).length
        };
      }
    });
    return active;
  }
  window.ScarletSpace = Object.freeze({ mount: mount });
})();

/* 房间挂载：背景 + 画廊平面 + 导航桥 + 主题同步 + 模态暂停 */
function mountScarletRoom() {
  window.__scarletSpace = window.ScarletSpace.mount({
    environment: '.env', gallery: '.stage', nav: '.nav-wrap',
    themeSource: '#stateWord', modalTargets: ['#tdPanel', '#lightbox']
  });
}
// app.js precedes the drawer markup in the supplied index.html.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountScarletRoom, { once: true });
else mountScarletRoom();
