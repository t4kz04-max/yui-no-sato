// 本番ビルドの出力物を確かめる（レビュー指摘 7）。npm run build の最後に実行する。
// - 第三者ライセンス（THIRD_PARTY_LICENSES.txt）が出力され、配布物に入る依存（three）の著作権表示と許諾文の全文を含む。
// - 開発時だけの物（テスト・ソース地図など）が混ざっていない。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, 'dist');
const fail = (msg) => {
  console.error(`check-dist: ${msg}`);
  process.exit(1);
};
const file = path.join(dist, 'THIRD_PARTY_LICENSES.txt');
if (!existsSync(file)) fail('dist/THIRD_PARTY_LICENSES.txt がありません');
const text = readFileSync(file, 'utf8');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const name of Object.keys(pkg.dependencies ?? {})) {
  const dir = path.join(ROOT, 'node_modules', name);
  const version = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const license = readFileSync(path.join(dir, 'LICENSE'), 'utf8').trim();
  if (!text.includes(`${name} ${version}`)) fail(`${name} ${version} の見出しがありません`);
  if (!text.includes(license)) fail(`${name} のライセンス全文が一致しません`);
}
if (!text.includes('three.js authors') || !text.includes('Permission is hereby granted')) fail('three.js の著作権表示・許諾文がありません');
const all = readdirSync(dist, { recursive: true }).map(String);
if (all.some((f) => f.endsWith('.map') || f.includes('test'))) fail(`開発用のファイルが含まれています：${all.join(', ')}`);
if (!all.includes('index.html')) fail('index.html がありません');
console.log(`check-dist: OK（${all.length} files、THIRD_PARTY_LICENSES.txt ${text.length} 文字）`);
