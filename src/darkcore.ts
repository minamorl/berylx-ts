// ==================================================================
// darkcore substrate — 公開エントリ (barrel)。
//
// darkcore-ruby (minamorl/darkcore-ruby) の各圏 (Effect / Maybe / Either /
// Result / State / Validation / IOEffects) を TypeScript へ移植したものを
// `darkcore/` ディレクトリに分割し、ここから一括 re-export する。
//
// 既存の importer (`import * as Darkcore from './darkcore.js'` /
// `'../darkcore.js'`) を書き換えずに済むよう、この file は薄い barrel に
// 徹する。Effect substrate (旧 darkcore.ts の中身) は darkcore/effect.ts へ
// そのまま移設して再利用している (意味論は不変)。
// ==================================================================

export * from './darkcore/index.js';
