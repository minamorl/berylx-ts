# cray-root-lay → berylx-ts 移行方針

> 「cray-root-lay」という名前の単一パッケージは存在しない。実体は
> `root-paradigm` モノレポ内の **`@minamorl/cray`** (workflow 合成子 + graph) と
> それが依存する **`@minamorl/lay`** (Deep Lens 状態) の 2 パッケージにまたがる
> "root + lay" 系ワークフロー基盤である。本書はこの 2 パッケージを berylx-ts
> (Ruby berylx gem の TS 移植) へ寄せて廃止するための段階計画。

## 1. 現状の対応関係

| 旧 (root-paradigm)                         | 新 (berylx-ts)                          | 補足 |
| ------------------------------------------ | --------------------------------------- | ---- |
| `@minamorl/lay` `Focus<S>` (mutable/購読) | `Focus` (immutable) + `Root#subscribe` | lay は set/update で破壊的更新＋reflect購読。berylx は immutable な set が新 Focus を返し、購読は Root に集約。 |
| `@minamorl/cray` `cray()` (task)           | `Task` / `task()`                       | 単発の状態遷移。 |
| `cray` sequence (`>>` 相当)                | `Sequence` (`node.then()`)              | 逐次合成。 |
| `parallel()` + `Reducer`                   | `Parallel` (`node.par()`) + `Merge`     | 並列合成と reducer。berylx は short_circuit/accumulate をタグで制御。 |
| `branch()` / `else_` / `elseCray`          | `When` / `Else` / `Branch` / `Catch`    | 分岐と回復境界。 |
| `Result` = `Success`/`Failure`             | `Result` = `Ok`/`Err`                   | 結果封筒。berylx の `Err` は構造化 `BerylxError` (code/failedNode/trace/parallelErrors) を運ぶ。 |
| `compile()` / `execute()` / `Graph`        | `Graph` (`node.compile()`)              | グラフ化。 |
| `toMermaid()`                              | `Graph#toMermaid()` / `Graph#toDot()`   | 可視化。DOT に加え Mermaid flowchart 出力を **ブリッジ済** (3-c)。 |
| `attachCray()` (`BridgeOptions`)           | `attachRoot()`                          | React 非依存の `Root#subscribe` ブリッジとして **移植済** (3-d)。 |
| darkcore substrate (Ruby)                  | `src/darkcore.ts` (内包)                | Freer Effect。berylx-ts は substrate を同梱。 |

## 2. 意味論的な差分 (移行時に必ず吸収する点)

1. **可変 vs 不変**: `@minamorl/lay` の `Focus` は `set`/`update` が現在の
   ストアを破壊的に書き換え、`reflect` で購読へ通知する。berylx-ts の `Focus`
   は **immutable** で、`set` は新しい `Focus` を返すだけ。購読は `Root` が
   `subscribe`/`commit` で担う。移行では「lay の Focus 直更新」を
   「Root へ commit し直す」パターンへ書き換える。
2. **非同期 vs 同期**: `@minamorl/cray` の `Cray` は `Promise<Result>` を返す
   非同期前提。berylx-ts の `Task#call` は同期だが、フェーズ 3-a で `AsyncTask`
   (`callAsync` = Promise 版) と `EffectTree.runAsync` (foldAsync ベースの async
   インタプリタ) を追加し、この差分は解消済み。同期経路は不変のまま維持する。
3. **エラー表現**: cray の `Failure.error` は任意型 `E`。berylx は必ず
   `BerylxError` に正規化し、code/failedNode/trace/parallelErrors/metadata を
   保持する。移行では `E` を `BerylxError.metadata` へ畳むか、code へ写す。
4. **並列の失敗方針**: cray は reducer で失敗を畳む自由度が高い。berylx は
   `short_circuit` (既定) / `accumulate` の 2 モードをタグで制御する。cray の
   カスタム reducer 失敗ロジックは、berylx では `Parallel.onErr` + `Merge` の
   組合せへ落とす。

## 3. 段階計画

### フェーズ 0: berylx-ts の確立 (完了)

- [x] Ruby berylx gem 全 19 モジュール + darkcore substrate を TS 移植。
- [x] vitest 53 ケース全 green (dual-run 差分検証・dry-run 含む)。
- [x] `tsc` 型チェック・ビルド exit 0。

### フェーズ 1: 依存の棚卸し

- [ ] `@minamorl/cray` / `@minamorl/lay` を実際に import している消費側を全列挙
      (現時点で root-paradigm 内 `packages/examples`, `host`, `server` が候補。
      外部 yui 系リポジトリは別途 grep)。
- [ ] 各消費点が使っている API を「フェーズ 0 で置換可能」「拡張が必要
      (async / toMermaid / attachCray)」に仕分ける。

### フェーズ 2: berylx-ts の公開形態を決める

- [ ] berylx-ts を `@minamorl/berylx` として GitHub Packages へ publish するか、
      root-paradigm の `packages/berylx` として取り込むか決定。
      (USER_CONTEXT: `@minamorl/root-*` は GitHub Packages 非公開、他の
      `@minamorl/*` は npmjs 公開。berylx は後者候補)。

### フェーズ 3: 機能ギャップの解消 (置換の前提) — 完了

- [x] 3-a **async Task**: `src/async-task.ts` に `AsyncTask` (Task#call の
  Promise 版 = `callAsync`) を追加。`src/darkcore/async.ts` に darkcore の
  非同期トランポリン `foldAsync` / `runAsync` を、`src/effect-tree/async.ts` に
  berylx の async インタプリタ (`EffectTree.runAsync` / `runSubtreeAsync` /
  `asyncRealHandlers` / `runParallelAsync` / `runBranchAsync` /
  `runRescueAsync`) を追加した。async Parallel は `Promise.all` ベースで、
  short_circuit / accumulate / reducer merge は同期版の algebra をそのまま
  再利用する。同期経路 (`EffectTree.run` / `realHandlers`) は不変。AsyncTask と
  Task は同一 Sequence/Parallel に混在でき、混在木は `runAsync` で解釈する
  (同期 `call` は AsyncTask に対して明示的に例外を投げてガードする)。
- [x] 3-b **Result 互換シム**: `src/cray-compat.ts` に `CraySuccess` /
  `CrayFailure` / `Cray` と `fromCrayResult` / `toCrayResult` を追加。cray の
  任意型 `E` は上記 2. の方針に従い BerylxError へ畳む (BerylxError→そのまま /
  Error→code=name・message・cause + metadata.crayError / string→code へ写す /
  それ以外→code=`cray_failure` + metadata.crayError)。外来の cray 風オブジェクト
  (`isSuccess`/`isFailure`・`{success}`・`{tag}` 等) も構造的に受理する。
- [x] 3-c **toMermaid ブリッジ**: `Graph#toDot()` に加え `Graph#toMermaid()` を
  追加 (`src/graph.ts` の `MermaidBuilder`)。DOT と同じノード木・辿り方から
  Mermaid `flowchart TD` を生成する。ノード id は mermaid 制約に合わせ連番
  `nN` を振り、元の名前はラベルへ載せる。
- [x] 3-d **attachCray 相当**: `src/attach.ts` に `attachRoot` を追加。React 等の
  フレームワークには依存せず、`Root#subscribe` の snapshot/commit を `select` で
  射影して host へ流す薄い層に留める。戻り値は購読解除関数。

### フェーズ 4: 置換と廃止

- [ ] 消費側を berylx-ts へ 1 パッケージずつ切替え、各切替えでテスト green を確認。
- [ ] `@minamorl/cray` / `@minamorl/lay` を **deprecated** 化
      (package.json に `"deprecated"` メッセージ、README に移行先を明記)。
- [ ] 参照ゼロを確認後、root-paradigm から両 package を撤去。

## 4. まだ確定していない判断 (御主人様に要確認)

- berylx-ts の最終的な置き場所 (独立リポジトリ publish か root-paradigm 内取込か)。
- async Task を berylx-ts の第一級機能にするか、消費側で吸収するか。
- `attachCray` (React/host 連携) を移植対象に含めるか切り離すか。
