// Minimal declarations for the Node APIs used by IOEffects.realHandlers.
// Node supplies the implementations; these local shims avoid adding @types/node.

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
