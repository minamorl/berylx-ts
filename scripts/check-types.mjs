#!/usr/bin/env node
// ==================================================================
// 型レベル検査を二方向で回す。
//
//   正の対照 : test/types/*.types.ts が tsc を通ること。
//              ts-expect-error 付きの行はエラーが出ないと tsc 自身が
//              「Unused 'ts-expect-error' directive」で落ちるので、
//              負の対照が実際に落ちていることもここで担保される。
//
//   変異検査 : ts-expect-error を全部剥がした写しを tsc に掛け、
//              剥がした行がちょうどエラーになること。
//              ts-expect-error は理由を問わずエラーを飲むので、これが無いと
//              「自分のタイポで落ちているだけ」の負の対照を見抜けない。
//              行が足りなければ「落ちるはずが落ちていない」、
//              余れば「無関係な場所が壊れている」。どちらも失格。
// ==================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const TYPES_DIR = 'test/types';
const TMP_DIR = join(TYPES_DIR, '.mutated');

function tsc(project) {
  try {
    execFileSync('npx', ['tsc', '-p', project], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** tsc の出力から、指定ファイルのエラー行番号だけを拾う。 */
function errorLines(out, file) {
  const name = basename(file);
  const lines = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^(.*?)\((\d+),\d+\): error/);
    if (m && basename(m[1]) === name) {
      lines.add(Number(m[2]));
    }
  }
  return lines;
}

const targets = readdirSync(TYPES_DIR)
  .filter((f) => f.endsWith('.types.ts'))
  .map((f) => join(TYPES_DIR, f));

if (targets.length === 0) {
  console.error('check-types: test/types/*.types.ts が 1 本も無い');
  process.exit(1);
}

let failed = false;

// --- 正の対照 ------------------------------------------------------
const positive = tsc(join(TYPES_DIR, 'tsconfig.json'));
if (!positive.ok) {
  console.error('✗ 正の対照が落ちた (型付き API が壊れているか、負の対照がエラーを出していない)');
  console.error(positive.out.trim());
  failed = true;
} else {
  console.log(`✓ 正の対照 ${targets.length} file — tsc clean (ts-expect-error は全て消費された)`);
}

// --- 変異検査 ------------------------------------------------------
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });
writeFileSync(
  join(TMP_DIR, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../../tsconfig.json',
      compilerOptions: {
        noEmit: true,
        rootDir: '../../..',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      },
      include: ['../../../src', './*.types.ts'],
      // ルート tsconfig の exclude は "test" を落とすので必ず上書きする。
      // 上書きを忘れると型テストが 1 行も検査されないまま緑になる。
      exclude: ['../../../node_modules', '../../../dist'],
    },
    null,
    2,
  ),
);

for (const target of targets) {
  const src = readFileSync(target, 'utf8').split('\n');
  const expected = new Set();
  const mutated = src.map((line, i) => {
    if (/^\s*\/\/\s*@ts-expect-error/.test(line)) {
      // ディレクティブを剥がすと、その「次の」行がエラーになるはず。
      expected.add(i + 2);
      return '// (directive stripped by check-types.mjs)';
    }
    return line;
  });

  if (expected.size === 0) {
    console.error(`✗ ${target}: 負の対照が 1 本も無い`);
    failed = true;
    continue;
  }

  // 1 段深くなるので src への相対 import を付け替える。
  writeFileSync(
    join(TMP_DIR, basename(target)),
    mutated.join('\n').replace(/'\.\.\/\.\.\/src\//g, "'../../../src/"),
  );
}

const negative = tsc(join(TMP_DIR, 'tsconfig.json'));
for (const target of targets) {
  const src = readFileSync(target, 'utf8').split('\n');
  const expected = new Set();
  src.forEach((line, i) => {
    if (/^\s*\/\/\s*@ts-expect-error/.test(line)) expected.add(i + 2);
  });

  const actual = errorLines(negative.out, target);
  const missing = [...expected].filter((l) => !actual.has(l)).sort((a, b) => a - b);
  const extra = [...actual].filter((l) => !expected.has(l)).sort((a, b) => a - b);

  if (missing.length > 0) {
    console.error(
      `✗ ${target}: 剥がしても落ちない行 = ${missing.join(', ')} (負の対照が実際には検査していない)`,
    );
    failed = true;
  }
  if (extra.length > 0) {
    console.error(`✗ ${target}: 意図しない行がエラー = ${extra.join(', ')}`);
    failed = true;
  }
  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ 変異検査 ${target} — 負の対照 ${expected.size} 本が全て正しい行で落ちた`);
  }
}

rmSync(TMP_DIR, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
