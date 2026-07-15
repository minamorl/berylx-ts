// ==================================================================
// Node 組み込み API の最小 ambient 宣言。
//
// IOEffects.realHandlers (圏R = 本物の OS) が使う node:fs / node:child_process /
// process / Buffer / console を、@types/node を新規導入せずに型付けするための
// 局所シム。実行時は Node が本物を供給する。ここでは realHandlers が触る範囲
// だけを宣言する (最小侵襲)。
// ==================================================================

declare module 'node:fs' {
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
  export function appendFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function unlinkSync(path: string): void;
  export function readdirSync(path: string): string[];
}

declare module 'node:child_process' {
  export function execSync(command: string): { toString(): string };
}

declare const process: {
  stdout: { write(s: string): boolean };
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  alloc(size: number): Uint8Array & { toString(encoding: string): string };
};

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};
