#!/usr/bin/env node
// Validate both acceptance and rejection: the original fixtures must compile,
// then copies with @ts-expect-error removed must fail at exactly those lines.
// This catches missing errors and directives hiding unrelated mistakes.

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

/** Extract compiler error line numbers for the requested file. */
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
  console.error('check-types: no test/types/*.types.ts files found');
  process.exit(1);
}

let failed = false;

// Positive control
const positive = tsc(join(TYPES_DIR, 'tsconfig.json'));
if (!positive.ok) {
  console.error('✗ Positive control failed: the typed API is invalid or an expected error is missing');
  console.error(positive.out.trim());
  failed = true;
} else {
  console.log(`✓ Positive control: ${targets.length} file(s) compile; all @ts-expect-error directives were used`);
}

// Mutation check
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
      // Override the root exclusion so these fixtures are actually checked.
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
      // Removing the directive must expose an error on the following line.
      expected.add(i + 2);
      return '// (directive stripped by check-types.mjs)';
    }
    return line;
  });

  if (expected.size === 0) {
    console.error(`✗ ${target}: no negative controls found`);
    failed = true;
    continue;
  }

  // Copies are one directory deeper, so adjust relative source imports.
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
      `✗ ${target}: missing expected errors on lines ${missing.join(', ')} (negative controls did not reject)`,
    );
    failed = true;
  }
  if (extra.length > 0) {
    console.error(`✗ ${target}: unexpected errors on lines ${extra.join(', ')}`);
    failed = true;
  }
  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ Mutation check: ${target} rejected all ${expected.size} negative controls on the expected lines`);
  }
}

rmSync(TMP_DIR, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
