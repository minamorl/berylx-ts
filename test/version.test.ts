import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('VERSION', () => {
  it('matches the package.json version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
