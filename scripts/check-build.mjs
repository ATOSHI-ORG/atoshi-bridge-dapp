/**
 * 构建后自检产物里的资源路径。
 *
 * 这个检查存在的原因：挂在子路径下部署时资源路径前缀必须设对，设错的症状是
 * 白屏，而浏览器报的错是
 *   "Refused to apply style ... MIME type ('text/html')"
 * 跟真实原因完全不沾 —— 资源请求落到了域名根目录，被别的服务用它自己的
 * index.html 应答了，于是 CSS 拿到 text/html、JS 拿到 404。
 *
 * 所以构建完直接把实际路径和部署提示打出来，对不对一眼可见。
 */
import { existsSync, readFileSync } from 'node:fs';

/** 和 vite.config.ts 用同一个来源：环境变量优先，然后 .env */
function readBase() {
  if (process.env.BASE_PATH) return process.env.BASE_PATH;
  const envFile = new URL('../.env', import.meta.url);
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*BASE_PATH\s*=\s*(.*)$/m);
    if (m) {
      const v = m[1].trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  }
  return '/';
}

const base = readBase();
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

// 只看本地资源（以 / 开头），跳过 https:// 的字体等外部链接
const refs = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);

if (refs.length === 0) {
  console.log('\n⚠️  index.html 里没有本地资源引用，构建可能不完整\n');
  process.exit(1);
}

const bad = refs.filter((r) => !r.startsWith(base));
console.log('');
for (const r of refs) console.log(`  ${bad.includes(r) ? '✗' : '✓'} ${r}`);

if (bad.length > 0) {
  console.log(
    `\n✗ 打叉的路径不以 ${base} 开头。检查 .env 里的 BASE_PATH。\n`,
  );
  process.exit(1);
}

if (base === '/') {
  console.log(
    '\n本次产物部署位置：域名/子域名的根目录\n' +
      '  nginx: root /var/www/<目录>;  location / { try_files $uri $uri/ /index.html; }\n\n' +
      '  如果你要挂在子路径下（比如 /atoshi-bridge/），现在这份产物是错的 ——\n' +
      '  在 .env 里加一行 BASE_PATH=/atoshi-bridge/ 然后重新构建。\n',
  );
} else {
  console.log(
    `\n本次产物部署位置：子路径 ${base}\n` +
      `  nginx: location ${base} {\n` +
      `           alias /var/www/<目录>/;\n` +
      `           index index.html;\n` +
      `           try_files $uri $uri/ ${base}index.html;\n` +
      `         }\n\n` +
      `  location、alias、try_files 的兜底、以及这里的 BASE_PATH 四处必须一致。\n`,
  );
}
