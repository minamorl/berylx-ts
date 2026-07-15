// ==================================================================
// darkcore — 全圏の集約 (aggregate)。
//
// darkcore-ruby の各圏を TS へ移植したモジュールをここで一括 re-export する。
// 親の src/darkcore.ts (barrel) がこれを再輸出し、berylx は
// `export * as Darkcore from './darkcore.js'` で名前空間として公開する。
//
// 名前空間内訳:
//   Effect substrate : Effect / pure / op / perform / fold / run / PURE / HandlerMap
//   非同期 substrate : foldAsync / runAsync / AsyncHandlerMap
//   Monad 導出       : deriveFmap / deriveAp
//   Maybe            : Maybe / Just / Nothing
//   Either           : Either / Left / Right
//   Result           : Result / Ok / Err / DarkcoreResult (berylx の Ok/Err とは別物)
//   State            : State
//   Validation       : Validation / Success / Failure
//   IOEffects        : IOEffects / realHandlers / VirtualWorld
// ==================================================================

export * from './effect.js';
export * from './async.js';
export * from './monad.js';
export * from './maybe.js';
export * from './either.js';
export * from './result.js';
export * from './state.js';
export * from './validation.js';
export * from './io-effects.js';
