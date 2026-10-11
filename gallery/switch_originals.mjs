/* 把 app.js 里的 ORIGINALS_DIR 切换为指定目录，用于「上传版 / 本地版」互相切换。
   用法：
       node gallery/switch_originals.mjs originals-web   # 上传版（精简）
       node gallery/switch_originals.mjs originals       # 本地版（原图画质）
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, 'assets', 'app.js');

const target = (process.argv[2] || '').replace(/\/+$/, '');
if (!['originals', 'originals-web'].includes(target)) {
  console.error('用法: node switch_originals.mjs <originals|originals-web>');
  process.exit(2);
}

const src = readFileSync(FILE, 'utf8');
const reDir = /var ORIGINALS_DIR = '[^']*';/;
const reExt = /var ORIGINALS_EXT = '[^']*';/;
if (!reDir.test(src) || !reExt.test(src)) {
  console.error('!! 在 app.js 中找不到 ORIGINALS_DIR / ORIGINALS_EXT 配置行');
  process.exit(1);
}

// originals/ 用原图自身扩展名；originals-web/ 是 WebP，需要改写扩展名
const ext = target === 'originals-web' ? '.webp' : '';
const out = src
  .replace(reDir, `var ORIGINALS_DIR = '${target}/';`)
  .replace(reExt, `var ORIGINALS_EXT = '${ext}';`);
writeFileSync(FILE, out, 'utf8');

console.log('已切换 ->', out.match(reDir)[0], '|', out.match(reExt)[0]);
console.log('原图目录解析为:', join(HERE, target));

// 顺带检查目标目录是否真的存在，避免切过去才发现是空的
const dir = join(HERE, target);
if (!existsSync(dir)) {
  console.warn(`提示：${target}/ 目录还不存在，请先运行对应的生成脚本。`);
} else {
  console.log('目录存在，可以预览。');
}
