// ==================================================================
// IOEffects — 標準 IO の語彙 (smart constructor 群)。
//
// darkcore-ruby io_effects.rb の TS 移植。すべて「作用を値化」するだけで、
// ここでは一切 IO が起きない。read も stdin も shell も全部【同格の tagged
// effect】= ただのデータ (Darkcore.op ラッパ)。
//
// program を一文字も変えず handlers を差し替えるだけで、圏R (本物の OS) /
// 圏V (インメモリ仮想世界 = VirtualWorld) を切り替える。
//   (spec: category.selection = handler_map / io.no_opaque_thunk)
// ==================================================================

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { op } from './effect.js';
import type { Effect, HandlerMap } from './effect.js';

/** IO 作用の smart constructor 群。呼んでも副作用は起きずタグ付き作用を返す。 */
export const IOEffects = {
  // -- コンソール --
  say: (msg: unknown): Effect<null> => op('say', msg, decodeNull),
  warn: (msg: unknown): Effect<null> => op('warn', msg, decodeNull),
  ask: (prompt: unknown = null): Effect<string | undefined> =>
    op('ask', prompt, decodeOptionalString),

  // -- ファイル --
  read: (path: string): Effect<string> => op('read', path, decodeString),
  write: (path: string, data: string): Effect<null> =>
    op('write', stringPair(path, data), decodeNull),
  append: (path: string, data: string): Effect<null> =>
    op('append', stringPair(path, data), decodeNull),
  delete: (path: string): Effect<null> => op('delete', path, decodeNull),
  exists: (path: string): Effect<boolean> => op('exists', path, decodeBoolean),
  listDir: (path: string): Effect<string[]> => op('list_dir', path, decodeStringArray),

  // -- 環境 / システム --
  getenv: (key: string): Effect<string | null | undefined> =>
    op('getenv', key, decodeNullableString),
  now: (): Effect<unknown> => op('now', null, decodeUnknown),
  rand: (n: number): Effect<number> => op('rand', n, decodeNumber),
  shell: (cmd: string): Effect<string> => op('shell', cmd, decodeString),
};

function stringPair(first: string, second: string): [string, string] {
  return [first, second];
}

function decodeNull(value: unknown): null {
  if (value !== null) {
    throw new TypeError('effect handler must return null');
  }
  return value;
}

function decodeString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('effect handler must return a string');
  }
  return value;
}

function decodeOptionalString(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError('effect handler must return a string or undefined');
  }
  return value;
}

function decodeNullableString(value: unknown): string | null | undefined {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new TypeError('effect handler must return a string, null, or undefined');
  }
  return value;
}

function decodeBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('effect handler must return a boolean');
  }
  return value;
}

function decodeNumber(value: unknown): number {
  if (typeof value !== 'number') {
    throw new TypeError('effect handler must return a number');
  }
  return value;
}

function decodeStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => typeof entry === 'string')) {
    throw new TypeError('effect handler must return an array of strings');
  }
  return value;
}

function decodeUnknown(value: unknown): unknown {
  return value;
}

function decodeStringPair(value: unknown): [string, string] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string'
  ) {
    throw new TypeError('effect payload must be a [string, string] tuple');
  }
  return [value[0], value[1]];
}

/** stdin から 1 行を同期読み取る (real の ask 用。EOF/非ブロッキングは空文字)。 */
function readLineSync(): string {
  const buf = Buffer.alloc(1);
  let out = '';
  try {
    for (;;) {
      const n = fs.readSync(0, buf, 0, 1, null);
      if (n === 0) {
        break;
      }
      const ch = buf.toString('utf8');
      if (ch === '\n') {
        break;
      }
      out += ch;
    }
  } catch {
    // EAGAIN 等は空文字にフォールバック。
  }
  return out;
}

/**
 * 圏R — 本物の OS。実ファイル・実 stdin・実時刻・実乱数・実 shell。
 * 呼ぶたびに新鮮な handler マップを返す。
 */
export function realHandlers(): HandlerMap {
  return {
    say: (m) => {
      // eslint-disable-next-line no-console
      console.log(m);
      return null;
    },
    warn: (m) => {
      // eslint-disable-next-line no-console
      console.warn(m);
      return null;
    },
    ask: (prompt) => {
      if (prompt != null) {
        process.stdout.write(String(prompt));
      }
      return readLineSync();
    },
    read: (p) => fs.readFileSync(String(p), 'utf8'),
    write: (pd) => {
      const [p, d] = decodeStringPair(pd);
      fs.writeFileSync(p, d);
      return null;
    },
    append: (pd) => {
      const [p, d] = decodeStringPair(pd);
      fs.appendFileSync(p, d);
      return null;
    },
    delete: (p) => {
      if (fs.existsSync(String(p))) {
        fs.unlinkSync(String(p));
      }
      return null;
    },
    exists: (p) => fs.existsSync(String(p)),
    list_dir: (p) => fs.readdirSync(String(p)),
    getenv: (k) => process.env[String(k)] ?? null,
    now: () => new Date(),
    rand: (n) => Math.floor(Math.random() * Number(n)),
    shell: (cmd) => execSync(String(cmd)).toString(),
  };
}

/** VirtualWorld のコンストラクタ引数。 */
export interface VirtualWorldOptions {
  files?: Record<string, string>;
  inputs?: string[];
  env?: Record<string, string | undefined>;
  now?: unknown;
  randSeq?: number[];
  shell?: Record<string, string>;
}

/**
 * VirtualWorld — 圏V。完全インメモリの仮想世界。OS を一切触らないので決定的で
 * モック不要のテストができる。handlers() を program に差し込むだけで real IO と
 * 入れ替わる。fs / outputs / warnings / log を公開する。
 */
export class VirtualWorld {
  /** 仮想ファイルシステム { path => contents }。 */
  readonly fs: Record<string, string>;
  /** say の記録。 */
  readonly outputs: unknown[];
  /** warn の記録。 */
  readonly warnings: unknown[];
  /** 作用の記録 [[tag, arg], ...]。 */
  readonly log: [string, unknown][];

  private readonly inputs: string[];
  private readonly env: Record<string, string | undefined>;
  private readonly nowValue: unknown;
  private readonly randSeq: number[];
  private readonly shellTable: Record<string, string>;
  private randI: number;

  constructor(options: VirtualWorldOptions = {}) {
    this.fs = { ...(options.files ?? {}) };
    this.inputs = [...(options.inputs ?? [])];
    this.env = options.env ?? {};
    this.nowValue = options.now ?? null;
    this.randSeq = [...(options.randSeq ?? [0])];
    this.shellTable = options.shell ?? {};
    this.outputs = [];
    this.warnings = [];
    this.log = [];
    this.randI = 0;
  }

  handlers(): HandlerMap {
    return {
      say: (m) => {
        this.outputs.push(m);
        this.log.push(['say', m]);
        return null;
      },
      warn: (m) => {
        this.warnings.push(m);
        this.log.push(['warn', m]);
        return null;
      },
      ask: (p) => {
        this.log.push(['ask', p]);
        return this.inputs.shift();
      },
      read: (p) => {
        this.log.push(['read', p]);
        const key = String(p);
        if (!(key in this.fs)) {
          throw new Error(`vfs: no such file ${key}`);
        }
        return this.fs[key];
      },
      write: (pd) => {
        const [p, d] = decodeStringPair(pd);
        this.fs[p] = d;
        this.log.push(['write', p]);
        return null;
      },
      append: (pd) => {
        const [p, d] = decodeStringPair(pd);
        this.fs[p] = (this.fs[p] ?? '') + d;
        this.log.push(['append', p]);
        return null;
      },
      delete: (p) => {
        delete this.fs[String(p)];
        this.log.push(['delete', p]);
        return null;
      },
      exists: (p) => Object.prototype.hasOwnProperty.call(this.fs, String(p)),
      list_dir: (p) => {
        const prefix = `${String(p)}/`;
        return Object.keys(this.fs)
          .filter((k) => k !== String(p) && k.startsWith(prefix))
          .map((k) => k.slice(prefix.length));
      },
      getenv: (k) => this.env[String(k)],
      now: () => this.nowValue,
      rand: (n) => {
        const v = this.randSeq[this.randI % this.randSeq.length];
        this.randI += 1;
        return v % Number(n);
      },
      shell: (cmd) => {
        this.log.push(['shell', cmd]);
        return Object.prototype.hasOwnProperty.call(this.shellTable, String(cmd))
          ? this.shellTable[String(cmd)]
          : '';
      },
    };
  }
}
