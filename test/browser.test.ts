import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as browser from '../src/browser.js';
import * as node from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let fixture: string;

beforeAll(() => {
  // Build a fresh package so `pnpm test` also works before `pnpm build`.
  fixture = mkdtempSync(resolve('node_modules/.browser-test-'));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify(pkg));
  execFileSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    '-p', 'tsconfig.json', '--outDir', join(fixture, 'dist'),
  ]);
});

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

function bundle(entry: string) {
  return buildSync({
    stdin: { contents: `export * from '${entry}';`, resolveDir: fixture },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'BerylxBrowser',
    treeShaking: false,
    ignoreAnnotations: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
}

describe('browser entry', () => {
  it('preserves the named API and shares its implementations with the Node entry', () => {
    expect(Object.keys(browser).sort()).toEqual(Object.keys(node).sort());
    for (const key of Object.keys(browser) as (keyof typeof browser)[]) {
      if (key !== 'Darkcore') expect(browser[key]).toBe(node[key]);
    }
    expect(browser.VERSION).toBe(pkg.version);
    for (const key of Object.keys(browser.Darkcore) as (keyof typeof browser.Darkcore)[]) {
      expect(browser.Darkcore[key]).toBe(node.Darkcore[key]);
    }
    expect(node.Darkcore).toHaveProperty('IOEffects');
    expect(browser.Darkcore).not.toHaveProperty('IOEffects');
  });

  it('bundles the published subpath without Node modules and runs a workflow without Node globals', () => {
    const result = bundle('@minamorl/berylx/browser');
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some((path) => path.endsWith('/dist/browser.js'))).toBe(true);
    expect(inputs.some((path) => path.endsWith('/darkcore/io-effects.js'))).toBe(false);
    for (const input of Object.values(result.metafile!.inputs)) {
      for (const dependency of input.imports) {
        expect(dependency.path).not.toMatch(/^node:/);
        expect(dependency.external).not.toBe(true);
      }
    }
    const { api, state } = runInNewContext(`${result.outputFiles[0].text}
      const b = BerylxBrowser.berylx();
      const root = b.root({ count: 1 });
      root.pipe(b.task('increment', (focus) => focus.at('count').update((n) => n + 1)));
      ({ api: BerylxBrowser, state: root.state() });
    `);
    expect(state).toEqual({ count: 2 });
    expect(api.Darkcore).not.toHaveProperty('IOEffects');
    expect(api.Timeline).toBeTypeOf('function');
  });

  it('keeps the Node entry and its IO graph as a negative control', () => {
    expect(() => bundle('@minamorl/berylx')).toThrow(/node:(fs|child_process)/);
    expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
    expect(pkg.exports['./timeline']).toEqual({ types: './dist/timeline.d.ts', import: './dist/timeline.js' });
    expect(pkg.exports['./timeline/berylx']).toEqual({ types: './dist/timeline/berylx.d.ts', import: './dist/timeline/berylx.js' });
  });
});
