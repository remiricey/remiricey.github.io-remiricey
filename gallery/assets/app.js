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

  /* ---------------- 配置 ---------------- */
  var CATS_PATH    = 'data/gallery.json';   // 由 build_data.py 生成
  var THUMB_DIR    = 'thumbs/';             // 由 build_thumbs.py 生成
  var ORIGINALS_DIR = 'originals/';     // 原图目录（相对 index.html，纯相对路径）
  /* 灯箱原图的扩展名覆盖。
     留空 '' = 沿用原图自身扩展名（originals/ 目录用这个）。
     改用 build_web_originals.py 生成的精简目录时，把它设为 '.webp'：
         var ORIGINALS_DIR  = 'originals-web/';
         var ORIGINALS_EXT  = '.webp';
     或者直接用 node gallery/switch_originals.mjs 一键切换。 */
  var ORIGINALS_EXT = '';
  var IMG_MAX_H    = 400;                   // 与 CSS --img-max-h 保持一致
  var GAP          = 16;                    // 与 CSS --gap 保持一致
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

  var lb = {
    root:    document.getElementById('lightbox'),
    backdrop:document.getElementById('lbBackdrop'),
    img:     document.getElementById('lbImg'),
    idx:     document.getElementById('lbIdx'),
    name:    document.getElementById('lbName'),
    size:    document.getElementById('lbSize'),
    orig:    document.getElementById('lbOrig'),
    spinner: document.getElementById('lbSpinner'),
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
    el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
    el.style.animationDelay = ((cards.length % BATCH) * 14) + 'ms';

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
  function makeCard(catName, item) {
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

    // 悬停时显示的序号
    var badge = document.createElement('span');
    badge.className = 'card-idx';
    badge.textContent = '#' + String(seq + 1).padStart(3, '0');
    card.appendChild(badge);

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
    if (busy || !cats[active]) return;
    busy = true;
    if (io) io.disconnect();

    var catName = cats[active].name;
    var n = Math.min(BATCH, pool.length);
    var fresh = [];

    for (var i = 0; i < n; i++) {
      var item = pool.shift();
      if (!item) break;
      var k = makeCard(catName, item);
      k.si = seq;
      liveIdx[seq] = k;
      seq++;
      $grid.appendChild(k.el);          // 先入 DOM
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
      if (++done < pending) return;
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
      setTimeout(function () {
        if (pending) { pending = 0; busy = false; trimIfNeeded(); armSentinel(); }
      }, 6000);
    }
  }

  /** 填充池子；池子空了就重新洗牌 —— 形成无限循环 */
  function refillPool() {
    if (!cats[active]) return;
    if (!pool.length) {
      if (hadFirstBatch) { pool = shuffle(cats[active].images.slice()); roundNo++; }
      else { pool = shuffle(cats[active].images.slice()); hadFirstBatch = true; }
    }
  }

  var hadFirstBatch = false;

  /** 回收最旧的卡片，避免无限滚动把 DOM 撑爆 */
  function trimIfNeeded() {
    if (cards.length <= MAX_CARDS) return;
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
    if (!io) return;
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
      b.appendChild(document.createTextNode(cat.name));
      var n = document.createElement('span');
      n.className = 'tab-n';
      n.textContent = cat.images.length;
      b.appendChild(n);
      b.addEventListener('click', function () { switchCat(i); });
      $tabs.appendChild(b);
    });
  }

  function updateTabs() {
    var tabs = $tabs.children;
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', i === active);
      tabs[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
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
    if (i === active && cards.length) { /* 同分类点击 -> 重新洗牌 */ }
    active = i;
    var nm = cats[i].name;
    if (nm === 'NSFW区' && lockNsfw) {
      lockNsfw = false;
      updateNsfwBtn();
    }
    updateTabs();
    resetGrid();
    try { history.replaceState(null, '', '#' + encodeURIComponent(nm)); } catch (e) { location.hash = nm; }

    refillPool();
    appendBatch();

    $count.innerHTML = '<b>' + cats[i].images.length + '</b> 张 · 无限随机';
    document.title = nm + ' · 绯月画廊';
  }

  function reshuffle() {
    resetGrid();
    refillPool();
    appendBatch();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      $nsfwBtn.classList.remove('danger');
      $nsfwLbl.textContent = '显示 NSFW';
      $nsfwBtn.title = '解锁 NSFW 分类';
    } else {
      $nsfwBtn.classList.add('danger');
      $nsfwLbl.textContent = '隐藏 NSFW';
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
        if (hasNsfw) { lockNsfw = true; $nsfwBtn.hidden = false; updateNsfwBtn(); }

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

  $shuffle.addEventListener('click', reshuffle);
  $nsfwBtn.addEventListener('click', function () {
    lockNsfw = !lockNsfw;
    updateNsfwBtn();
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
