// 公開物に含める第三者ライセンスの一覧を作る（レビュー指摘 7）。
// package.json の dependencies（実行時に配布物へ入る依存）について、node_modules の LICENSE の全文を集める。
// 開発用の依存（devDependencies：vite・vitest・puppeteer など）は配布物に入らないので含めない。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'];

/**
 * @param {string} root プロジェクトの場所
 * @returns {{ name: string, version: string, license: string, text: string }[]}
 */
export function collectLicenses(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const dir = path.join(root, 'node_modules', name);
      const meta = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const file = LICENSE_FILES.map((f) => path.join(dir, f)).find((f) => existsSync(f));
      if (!file) throw new Error(`${name} のライセンス文が見つかりません（公開物に含められない）`);
      return { name, version: meta.version, license: meta.license ?? '', text: readFileSync(file, 'utf8').trim() };
    });
}

/** THIRD_PARTY_LICENSES.txt の内容。 */
export function licensesText(root) {
  const list = collectLicenses(root);
  const head = [
    '結の約束 — 第三者ライセンス / Third-party licenses',
    '',
    'このゲームの公開物に含まれる第三者のソフトウェアと、その著作権表示・許諾文。',
    'This file lists third-party software bundled in this build, with their copyright notices and license texts.',
    '',
  ];
  const body = list.flatMap((l) => ['='.repeat(72), `${l.name} ${l.version} (${l.license})`, '='.repeat(72), '', l.text, '']);
  return [...head, ...body].join('\n');
}

/** ビルドのたびに dist/THIRD_PARTY_LICENSES.txt を出力する Vite のプラグイン。 */
export function thirdPartyLicenses() {
  let root = '';
  return {
    name: 'third-party-licenses',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: licensesText(root) });
    },
  };
}
