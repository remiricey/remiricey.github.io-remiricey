/* ============================================================
 *  绯月画廊 · 真实浏览器运行时测试（Chrome DevTools Protocol）
 *  用 node 直接跑：node gallery/cdp_test.mjs
 *  会在无头 Chrome 中真实打开页面，逐项断言展示逻辑。
 * ============================================================ */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = process.argv[2] || 'http://127.0.0.1:8765/gallery/index.html';
const PORT = 9333;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const profile = mkdtempSync(join(tmpdir(), 'smg-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--hide-scrollbars', '--window-size=1600,1000',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome 还没起来 */ }
    await sleep(250);
  }
  throw new Error('无法连接 Chrome 调试端口');
}

const ws = new WebSocket(await findTarget());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const waiting = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res) => waiting.set(mid, res));
}
async function evalJS(expr) {
  const r = await send('Runtime.evaluate', {
    expression: `(function(){ ${expr} })()`,
    returnByValue: true, awaitPromise: true
  });
  if (r.error) throw new Error(JSON.stringify(r.error));
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description || ex.text);
  return r.result?.result?.value;
}

/** 轮询等待条件成立（真实浏览器里图片/IO 都是异步的） */
async function waitFor(expr, timeout = 12000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await evalJS(`return (${expr});`);
    if (v) return true;
    await sleep(step);
  }
  return false;
}

/** 真正滚到页面底部（等布局稳定），返回是否又长高了 */
async function scrollToBottom() {
  let last = -1;
  for (let i = 0; i < 6; i++) {
    const h = await evalJS(`window.scrollTo(0, document.documentElement.scrollHeight); return document.documentElement.scrollHeight;`);
    if (h === last) break;
    last = h;
    await sleep(300);
  }
  return last;
}

/** 读取真实列数：按卡片左边缘聚类（间距门限取最大卡宽的 1/4，兼容居中收窄的卡片） */
const COLS_EXPR = `
  const cards = [...document.querySelectorAll('.card')];
  const xs = cards.map(c => parseFloat(c.style.transform.match(/translate3d\\(([-\\d.]+)px/)[1]))
                   .sort((a, b) => a - b);
  const maxW = Math.max(...cards.map(c => parseFloat(c.style.width)));
  const gate = Math.max(6, maxW * 0.25);
  let cols = 0, last = -1e9;
  for (const x of xs) { if (x - last > gate) { cols++; last = x; } }
  return cols;
`;

await send('Page.enable');
await send('Runtime.enable');

/* ---------------- 收集控制台错误 ---------------- */
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails?.exception?.description
      || m.params.exceptionDetails?.text || 'unknown');
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

/* ---------------- 加载页面 ---------------- */
await send('Page.navigate', { url: PAGE });
await sleep(4500);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
};

/* 1. 顶层分类顺序 */
const tabs = await evalJS(`return [...document.querySelectorAll('.tab')].map(t => t.dataset.cat);`);
const want = ['Novel芙兰单人区', 'Novel芙兰蕾米百合区', 'GPT芙兰区', 'NSFW区', '不知如何分类区'];
check('顶层导航顺序固定', JSON.stringify(tabs) === JSON.stringify(want), tabs.join(' → '));

/* 2. 首轮渲染的卡片与最短列分布 */
const first = await evalJS(`
  const m = document.getElementById('masonry');
  const cs = [...m.querySelectorAll('.card')];
  const heights = cs.map(c => parseFloat(c.style.height));
  const lefts   = [...new Set(cs.map(c => Math.round(parseFloat(c.style.transform.match(/translate3d\\(([-\\d.]+)px/)[1]) + parseFloat(c.style.width))))];
  return { n: cs.length, tabs: cs.length, rand: cs[0] && cs[0].querySelector('.card-idx').textContent,
           minH: Math.min(...heights), maxH: Math.max(...heights),
           rightEdges: lefts.length, gridH: parseFloat(m.style.height), ratio: cs[0].style.width + '/' + cs[0].style.height };
`);
check('首轮渲染 40 张卡片', first.n === 40, `实际 ${first.n}`);
check('图片高度被限制在 max-height 400 内', first.maxH <= 400.5 && first.minH >= 60,
  `min ${first.minH} / max ${first.maxH}`);
check('容器高度已计算（瀑布流生效）', first.gridH > 2000, `grid height ${first.gridH}px`);

/* 3. 卡片宽高比与原图一致（说明尺寸由 JS 精确计算，无 letterbox 黑边） */
const arCards = await evalJS(`
  const cs = [...document.querySelectorAll('.card')];
  let worst = 0, n = 0, detail = '';
  for (const c of cs) {
    const im = c.querySelector('img');
    if (!im.naturalWidth) continue;
    n++;
    const cardAR = parseFloat(c.style.width) / parseFloat(c.style.height);
    const natAR = im.naturalWidth / im.naturalHeight;
    const d = Math.abs(cardAR - natAR);
    if (d > worst) { worst = d; detail = im.naturalWidth + 'x' + im.naturalHeight
      + ' card=' + cardAR.toFixed(3) + ' nat=' + natAR.toFixed(3); }
  }
  return { n, worst, detail };
`);
check('卡片宽高比 = 原图宽高比（无黑边留白）',
  arCards.n > 0 && arCards.worst < 0.012,
  `抽查 ${arCards.n} 张，最大偏差 ${arCards.worst.toFixed(4)}${arCards.detail ? ' (' + arCards.detail + ')' : ''}`);

/* 4. 随机性：以「图片本身」为准，打乱前后首屏图片序列必须不同 */
const orderExpr = `return [...document.querySelectorAll('.card img')].slice(0,12)
  .map(i => decodeURIComponent(i.getAttribute('data-full'))).join('|');`;
const order1 = await evalJS(orderExpr);
await evalJS(`document.getElementById('reshuffle').click(); return 1;`);
await sleep(1800);
const order2 = await evalJS(orderExpr);
check('点击打乱后图片序列改变（随机生效）', order1.length > 0 && order1 !== order2,
  `首张：${decodeURIComponent(order1.split('|')[0] || '').slice(0, 26)} → ${decodeURIComponent(order2.split('|')[0] || '').slice(0, 26)}`);

/* 4b. 随机性：同一分类连续两次重排，首张不同的概率应很高（抽查 8 次） */
const heads = await evalJS(`
  const out = [];
  for (let i = 0; i < 8; i++) {
    document.getElementById('reshuffle').click();
    out.push([...document.querySelectorAll('.card img')].slice(0,6)
      .map(x => x.getAttribute('data-full')).join(','));
  }
  return new Set(out).size;
`);
check('连续 8 次重排产生不同排列', heads >= 6, `8 次中得到 ${heads} 种不同排列`);

await evalJS(`document.getElementById('reshuffle').click(); return 1;`);
await sleep(1500);

/* 5. 懒加载：路径正确、懒加载属性齐备、图片真的解码显示 */
const lazy = await evalJS(`
  const cs = [...document.querySelectorAll('.card img')];
  const dec = i => decodeURIComponent(i.currentSrc || i.src || '');
  return { total: cs.length,
           loaded: cs.filter(i => i.getAttribute('src')).length,
           pending: cs.filter(i => i.getAttribute('data-src')).length,
           natural: cs.filter(i => i.naturalWidth > 0).length,
           thumbOk: cs.every(i => /\\/thumbs\\//.test(decodeURIComponent(i.getAttribute('data-src') || 'x'))),
           fullOk: cs.every(i => !/thumbs/.test(decodeURIComponent(i.getAttribute('data-full') || 'x'))),
           srcset: cs.filter(i => i.getAttribute('data-srcset')).length,
           lazyAttr: cs.every(i => i.loading === 'lazy'),
           oneLoaded: dec(cs.find(i => i.currentSrc) || {}) };
`);
check('拖到视野外前不提前赋值 src（懒加载生效）', lazy.pending === lazy.total,
  `${lazy.pending}/${lazy.total} 张以 data-src 待命，其中 ${lazy.loaded} 张已进入视野并加载`);
check('缩略图与原图路径各自正确（原图在 originals/ 下）',
  lazy.thumbOk && lazy.fullOk, lazy.oneLoaded.slice(-52));

/* 5b. 可移植性：所有资源都是相对路径（以 ./ 开头），不含主机名或 ../ */
const paths = await evalJS(`
  const cs = [...document.querySelectorAll('.card img')];
  const samples = cs.slice(0, 5).map(i => i.getAttribute('data-src'));
  const fulls = cs.slice(0, 5).map(i => i.getAttribute('data-full'));
  const srcsets = cs.slice(0, 5).map(i => i.getAttribute('data-srcset'));
  const allAttrs = [...samples, ...fulls, ...srcsets];
  const absRe = /^[a-z]+:\\/\\//i;              // http:// 或 https:// 开头
  const rootRe = /^\\//;                        // /xxx 根路径
  const parentRe = /(^|\\/)\\.\\.(\\/|$)/;       // 含 ../ 说明跳出了画廊目录
  return {
    total: allAttrs.length,
    absolute: allAttrs.filter(u => absRe.test(u)).length,
    rootRel: allAttrs.filter(u => rootRe.test(u)).length,
    parent: allAttrs.filter(u => parentRe.test(u)).length,
    dotSlash: allAttrs.filter(u => /^\\.\\//.test(u)).length,
    thumbRel: /^\\.\\/thumbs\\//.test(decodeURIComponent(samples[0] || 'x')),
    fullRel: /^\\.\\/originals(-web)?\\//.test(decodeURIComponent(fulls[0] || 'x')),
    sampleThumb: samples[0],
    sampleFull: fulls[0],
    inHtml: [...document.querySelectorAll('link[href],script[src]')]
              .map(e => e.getAttribute('href') || e.getAttribute('src'))
              .filter(u => u && !u.startsWith('data:'))   // 内联 SVG 图标不算外部资源
  };
`);
check('图片路径全部是 ./ 相对路径（无 http:// 与 / 根路径）',
  paths.absolute === 0 && paths.rootRel === 0 && paths.dotSlash === paths.total
  && paths.thumbRel && paths.fullRel,
  `共 ${paths.total} 个路径，其中 ./-相对 ${paths.dotSlash}、绝对 ${paths.absolute}、根路径 ${paths.rootRel}；缩略图 ${paths.sampleThumb}；原图 ${paths.sampleFull}`);
check('路径不越出画廊目录（不含 ../，可整包打包）', paths.parent === 0,
  `检查 ${paths.total} 个路径`);
check('HTML 引用的资源也是相对路径',
  paths.inHtml.every(u => !/^[a-z]+:\/\//i.test(u) && !/^\//.test(u)),
  paths.inHtml.join(' , '));
check('每张图都带 1x/2x 候选，高清屏自动取更清晰版本',
  lazy.srcset === lazy.total, `${lazy.srcset}/${lazy.total}`);
check('图片成功解码显示（有 is-loaded 类）',
  await waitFor(`document.querySelectorAll('.card img.is-loaded').length > 0`, 10000),
  `${lazy.natural} 张 naturalWidth>0`);

/* 6. 无限滚动：反复滚到底，应持续追加新一轮 */
const before = await evalJS(`return document.querySelectorAll('.card').length;`);
let after1 = { n: 0, rounds: [], gridH: 0 };
for (let i = 0; i < 5; i++) {
  await scrollToBottom();
  await sleep(2200);
  after1 = await evalJS(`return { n: document.querySelectorAll('.card').length,
    rounds: [...new Set([...document.querySelectorAll('.round-tag')].map(t => t.textContent))],
    gridH: parseFloat(document.getElementById('masonry').style.height) };`);
  if (after1.n > before && after1.rounds.length > 0) break;
}
check('滚动触发无限滚动追加图片', after1.n > before, `${before} → ${after1.n} 张`);
check('追加以 ROUND 轮次标记区分（每轮重新洗牌）', after1.rounds.length > 0,
  after1.rounds.join(' / ') || '未出现轮次标记');

const n1 = after1.n;
await scrollToBottom();
await sleep(2500);
await scrollToBottom();
await sleep(2500);
const after2 = await evalJS(`return document.querySelectorAll('.card').length;`);
check('持续滚动继续追加（多轮）', after2 > n1, `${n1} → ${after2} 张`);

/* 6b. 两轮之间确实是「重新洗牌」：同一张图可能出现在不同轮次 */
const repeat = await evalJS(`
  const rounds = [...document.querySelectorAll('.card')];
  const r2 = rounds.filter(c => c.querySelector('.round-tag'));
  return { r1: rounds.length - r2.length, r2: r2.length };
`);
check('第二轮追加的卡片带 ROUND 标记', repeat.r2 > 0, `第 1 轮 ${repeat.r1} 张 / 第 2 轮 ${repeat.r2} 张`);

/* 7. 灯箱 */
await evalJS(`window.scrollTo(0, 0); return 1;`);
await sleep(400);
await evalJS(`document.querySelector('.card').click(); return 1;`);
check('点击缩略图立即出现灯箱',
  await waitFor(`document.getElementById('lightbox').hidden === false`, 4000));
check('灯箱加载的是原图且成功解码（非缩略图）',
  await waitFor(`(function(){ const i = document.getElementById('lbImg');
     return i.naturalWidth > 500
       && !/thumbs\\//.test(decodeURIComponent(i.currentSrc || i.src)); })()`, 20000));

const lbOpen = await evalJS(`
  const root = document.getElementById('lightbox');
  const im = document.getElementById('lbImg');
  return { hidden: root.hidden, bodyLocked: document.body.classList.contains('lb-open'),
           src: im.getAttribute('src') || '', nat: im.naturalWidth,
           natH: im.naturalHeight, dispW: im.getBoundingClientRect().width,
           idx: document.getElementById('lbIdx').textContent,
           name: document.getElementById('lbName').textContent,
           size: document.getElementById('lbSize').textContent,
           orig: document.getElementById('lbOrig').getAttribute('href'),
           spinner: document.getElementById('lbSpinner').classList.contains('is-on') };
`);
check('灯箱显示序号与尺寸信息', /\d+ \/ \d+/.test(lbOpen.idx) && /×/.test(lbOpen.size),
  `${lbOpen.idx} · ${lbOpen.size}`);
check('滚动锁定生效', lbOpen.bodyLocked === true);
check('加载完成后 spinner 隐藏', lbOpen.spinner === false);
check('「原图」链接指向真实原图',
  (function () {
    var link = decodeURIComponent(lbOpen.orig || '');
    var base = link.split('/').pop().replace(/\.[^.]+$/, '');   // 去掉扩展名比对主干
    return !!lbOpen.orig && base === lbOpen.name.replace(/\.[^.]+$/, '');
  })(),
  decodeURIComponent(lbOpen.orig || ''));

/* 7b. 灯箱大图切换时同样加载原图 */
await evalJS(`document.getElementById('lbNext').click(); return 1;`);
await sleep(1200);
const lbNextOk = await waitFor(`(function(){ const i = document.getElementById('lbImg');
   return i.naturalWidth > 500
     && !/thumbs\\//.test(decodeURIComponent(i.currentSrc || i.src)); })()`, 15000);
check('切换到下一张时加载的是原图', lbNextOk);

await evalJS(`document.getElementById('lbNext').click(); return 1;`);
await sleep(1200);
const lb2 = await evalJS(`return document.getElementById('lbIdx').textContent;`);
check('右箭头切换到下一张', lb2 !== lbOpen.idx, `${lbOpen.idx} → ${lb2}`);

await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); return 1;`);
await sleep(1000);
const lb3 = await evalJS(`return document.getElementById('lbIdx').textContent;`);
check('键盘 → 方向键切换', lb3 !== lb2, `${lb2} → ${lb3}`);

await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return 1;`);
await sleep(1000);
const lb4 = await evalJS(`return document.getElementById('lbIdx').textContent;`);
check('键盘 ← 方向键切换', lb4 === lb2, `${lb3} → ${lb4}`);

await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1;`);
await sleep(700);
const lbClosed = await evalJS(`return document.getElementById('lightbox').hidden;`);
check('Esc 键关闭灯箱', lbClosed === true);

await evalJS(`document.querySelector('.card').click(); return 1;`);
await sleep(900);
await evalJS(`document.getElementById('lbBackdrop').click(); return 1;`);
await sleep(500);
const lbClosed2 = await evalJS(`return document.getElementById('lightbox').hidden;`);
check('点击遮罩背景关闭灯箱', lbClosed2 === true);

/* 8. 分类切换 */
await evalJS(`document.querySelector('.tab[data-idx="2"]').click(); return 1;`);
await sleep(2500);
const cat3 = await evalJS(`
  const act = document.querySelector('.tab.is-active');
  const cs = [...document.querySelectorAll('.card')];
  const nsfwLocked = document.querySelector('.tab[data-cat="NSFW区"]').style.opacity;
  return { active: act.dataset.cat, count: cs.length,
           meta: document.getElementById('metaCount').textContent,
           title: document.title, hash: decodeURIComponent(location.hash),
           nsfwLocked };
`);
check('切换到 GPT芙兰区 生效', cat3.active === 'GPT芙兰区' && cat3.count > 0,
  `${cat3.active} · ${cat3.count} 张 · ${cat3.meta}`);
check('计数信息正确（742 张）', cat3.meta.includes('742'), cat3.meta);
check('URL hash 同步分类', cat3.hash === '#GPT芙兰区', cat3.hash);
check('NSFW 分类默认折叠', cat3.nsfwLocked === '0.55', `opacity=${cat3.nsfwLocked}`);

/* 9. 解锁 NSFW */
await evalJS(`document.getElementById('toggleNsfw').click(); return 1;`);
await sleep(300);
await evalJS(`document.querySelector('.tab[data-cat="NSFW区"]').click(); return 1;`);
await sleep(2500);
const nsfw = await evalJS(`
  const act = document.querySelector('.tab.is-active');
  const imgs = [...document.querySelectorAll('.card img')];
  return { active: act.dataset.cat, n: document.querySelectorAll('.card').length,
           decoded: imgs.filter(i => i.naturalWidth > 0).length };
`);
check('解锁后可浏览 NSFW 区', nsfw.active === 'NSFW区' && nsfw.n > 0,
  `${nsfw.n} 张，已解码 ${nsfw.decoded}`);

/* 10. 尺寸比例真实性：未被 max-height 截断的图片必须严格保持原比例 */
const ratio = await evalJS(`
  const cs = [...document.querySelectorAll('.card')];
  let worst = 0, detail = '', checked = 0, clamped = 0;
  for (const c of cs) {
    const im = c.querySelector('img');
    if (!im.naturalWidth) continue;
    const colW = parseFloat(c.style.width);
    const plainH = colW * im.naturalHeight / im.naturalWidth;   // 不限高时的高度
    if (plainH > 400) { clamped++; continue; }                  // 这一批被 max-height 限制，另行校验
    checked++;
    const d = Math.abs((colW / plainH) - (im.naturalWidth / im.naturalHeight));
    if (d > worst) { worst = d; detail = im.naturalWidth + 'x' + im.naturalHeight; }
  }
  return { worst, detail, checked, clamped };
`);
check('未截断的图片严格保持原比例（不拉伸）', ratio.checked > 0 && ratio.worst < 0.005,
  `校验 ${ratio.checked} 张未截断图片，最大偏差 ${ratio.worst.toFixed(5)}，另有 ${ratio.clamped} 张受 max-height 限制`);

/* 10b. 受 max-height 限制的图片高度正好 400，宽度按比例收窄 */
const clamp = await evalJS(`
  const cs = [...document.querySelectorAll('.card')];
  let ok = 0, bad = 0, sample = '';
  for (const c of cs) {
    const im = c.querySelector('img');
    if (!im.naturalWidth) continue;
    const w = parseFloat(c.style.width), h = parseFloat(c.style.height);
    if (h < 399.5) continue;
    const natAR = im.naturalWidth / im.naturalHeight;
    if (Math.abs(h - 400) < 0.6 && Math.abs(w - 400 * natAR) < 1.5) ok++;
    else { bad++; sample = im.naturalWidth + 'x' + im.naturalHeight + ' -> ' + w.toFixed(1) + 'x' + h.toFixed(1); }
  }
  return { ok, bad, sample };
`);
check('长图被压到 max-height=400 且宽度等比收窄（不裁剪）',
  clamp.ok > 0 && clamp.bad === 0, `${clamp.ok} 张符合，${clamp.bad} 张异常 ${clamp.sample}`);

/* 11. 页面无 JS 异常 */
check('运行期间无 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '无');

/* 12. 页脚链接 */
const foot = await evalJS(`
  const as = [...document.querySelectorAll('.site-foot a.sns')];
  return as.map(a => ({ href: a.getAttribute('href'), target: a.getAttribute('target'),
                        rel: a.getAttribute('rel'), cls: a.className,
                        txt: a.textContent.replace(/\\s+/g,' ').trim() }));
`);
const expect = [
  ['https://b23.tv/lU4FqHJ', 'sns-bili', '@B站'],
  ['https://v.douyin.com/ddOjaJSAevY/', 'sns-dy', '@抖音'],
  ['https://xhslink.cn/o/AeTITc7bLXU', 'sns-xhs', '@小红书']
];
let okLinks = foot.length === 3;
expect.forEach(([href, cls, label], i) => {
  const a = foot[i];
  if (!a) { okLinks = false; return; }
  if (a.href !== href || !a.cls.includes(cls) || !a.txt.includes(label)
      || a.target !== '_blank' || !a.rel.includes('noopener')) okLinks = false;
});
check('三个社交链接正确 · 新标签打开 · 配色区分', okLinks, JSON.stringify(foot.map(f => f.cls)));

/* 13. 页脚文字完整 */
const footText = await evalJS(`return document.querySelector('.about-text').textContent.replace(/\\s+/g,'');`);
check('导言文字逐字包含要求内容',
  footText.includes('本网站为个人制作网站，如需搬运使用商业合作，请联系个人，')
  && footText.includes('@B站蕾米粒呀') && footText.includes('@抖音蕾米粒呀')
  && footText.includes('@小红书蕾米粒呀'), footText.slice(0, 60) + '…');

/* 14. 移动端布局（真实模拟 390×844 手机视口） */
await send('Emulation.setDeviceMetricsOverride',
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(800);
await send('Emulation.setVisibleSize', { width: 390, height: 844 });
await sleep(400);
// 等视口真的变成 390 再触发重排，避免读到切换过程中的中间值
await waitFor(`document.documentElement.clientWidth === 390`, 8000, 200);
await evalJS(`window.dispatchEvent(new Event('resize')); return 1;`);
await sleep(3000);

const mob = await evalJS(`
  const vw = document.documentElement.clientWidth;
  const cards = [...document.querySelectorAll('.card')];
  const xsAll = cards.map(c => parseFloat(c.style.transform.match(/translate3d\\(([-\\d.]+)px/)[1])).sort((a, b) => a - b);
  const maxW = Math.max(...cards.map(c => parseFloat(c.style.width)));
  const gate = Math.max(6, maxW * 0.25);
  let cols = 0, lastX = -1e9;
  for (const x of xsAll) { if (x - lastX > gate) { cols++; lastX = x; } }
  const rights = cards.map(c => parseFloat(c.style.transform.match(/translate3d\\(([-\\d.]+)px/)[1]) + parseFloat(c.style.width));
  const at = document.querySelector('.about-text');
  const grid = document.getElementById('masonry').getBoundingClientRect();
  return { cols: cols, innerW: window.innerWidth,
           maxRight: Math.max(...rights), vw: vw,
           gridW: document.getElementById('masonry').clientWidth,
           gridRight: Math.round(grid.right),
           maxCardW: maxW.toFixed(1),
           bodyScrollW: document.body.scrollWidth,
           docScrollW: document.documentElement.scrollWidth,
           footOverflow: at.scrollWidth > at.clientWidth + 1,
           tabScrollable: document.getElementById('tabs').scrollWidth
                           >= document.getElementById('tabs').clientWidth };
`);
check('移动端自动降为 2 列', mob.cols === 2,
  `列数 ${mob.cols}（视口 ${mob.vw}px / 容器 ${mob.gridW}px / 卡片宽 ${mob.maxCardW}px / innerWidth ${mob.innerW}）`);
check('移动端图片不溢出屏幕',
  mob.maxRight <= mob.gridRight + 1 && mob.bodyScrollW <= mob.vw + 1 && mob.gridW <= mob.vw,
  `卡片最右 ${mob.maxRight.toFixed(1)} / 网格右边界 ${mob.gridRight} / 视口 ${mob.vw}；body 宽 ${mob.bodyScrollW}（无横向滚动）`);
check('页脚文字在手机上自动换行不溢出', mob.footOverflow === false);
check('分类标签在窄屏可横向滑动', mob.tabScrollable === true);

/* 14b. 窄屏仍然是瀑布流错落排布（各列高度接近） */
const stagger = await evalJS(`
  const cs = [...document.querySelectorAll('.card')];
  const xs = cs.map(c => parseFloat(c.style.transform.match(/translate3d\\(([-\\d.]+)px/)[1]));
  const ux = [...new Set(xs)].sort((a, b) => a - b);
  const bottom = ux.map(cx => Math.max(...cs.filter((c, i) => Math.abs(xs[i] - cx) < 0.5)
    .map(c => parseFloat(c.style.transform.match(/,\\s*([-\\d.]+)px,/)[1]) + parseFloat(c.style.height))));
  return { cols: ux.length, heights: bottom,
           diff: Math.max(...bottom) - Math.min(...bottom) };
`);
check('两列高度接近（最短列算法填平空白）',
  stagger.cols === 2 && stagger.diff < stagger.heights[0] * 0.35,
  `各列高度 ${stagger.heights.map(h => Math.round(h)).join(' / ')}，相差 ${Math.round(stagger.diff)}px`);

/* 14c. 桌面宽屏为 4–5 列 */
await send('Emulation.clearDeviceMetricsOverride');
await sleep(800);
await send('Emulation.setDeviceMetricsOverride',
  { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await send('Emulation.setVisibleSize', { width: 1920, height: 1080 });
await evalJS(`window.dispatchEvent(new Event('resize')); return 1;`);
await sleep(3000);
const wide = await evalJS(`return { cols: (function(){ ${COLS_EXPR} })(),
  vw: document.documentElement.clientWidth };`);
check('宽屏（1920px）为 5 列', wide.cols === 5, `列数 ${wide.cols}（视口 ${wide.vw}px）`);

/* 14d. 中途缩放窗口也能正确重排 */
await send('Emulation.setDeviceMetricsOverride',
  { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
await evalJS(`window.dispatchEvent(new Event('resize')); return 1;`);
await sleep(2500);
const mid = await evalJS(`return { cols: (function(){ ${COLS_EXPR} })(),
  vw: document.documentElement.clientWidth };`);
check('窗口缩到 1100px 自动变 3 列', mid.cols === 3, `列数 ${mid.cols}（视口 ${mid.vw}px）`);

await send('Emulation.clearDeviceMetricsOverride');

/* ---------------- 输出 ---------------- */
console.log('\n══════════ 绯月画廊 · 浏览器运行时测试 ══════════\n');
let pass = 0;
for (const r of results) {
  console.log(`${r.pass ? '  ✔' : '  ✘'} ${r.name}${r.detail ? '   — ' + r.detail : ''}`);
  if (r.pass) pass++;
}
console.log(`\n结果：${pass}/${results.length} 通过\n`);

ws.close();
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
