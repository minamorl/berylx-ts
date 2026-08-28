# Berylx (TypeScript)

**Graphable TypeScript workflows over focused, recoverable state.**

Ruby gem [`berylx`](https://github.com/minamorl/berylx) の TypeScript 移植。
多段のビジネス workflow に、TS を DSL 化せずに小さな代数 (algebra) を与える:

```
Task : Lay -> Result[Lay]
```

一つの `Root` がコミット済み状態を所有する。名前つき `Task` はその状態を
`Lay` (= 焦点つき不変状態 `Focus`) を通して観測し、不変に変換する。各ステップは
`Ok(lay)` か `Err(partialLay, error)` を返すので、失敗しても診断・補償に足る
文脈が残る。

## なぜ Berylx か

- **境界は一つ** — `Root` が workflow 1 回分のコミット済み状態を所有する。
- **焦点つき不変更新** — `Lay` は共有変更なしにネスト値を読み替える。
- **失敗が状態を保つ** — 補償処理は「失われたローカル変数の列」ではなく
  部分 `Lay` を受け取る。
- **合成は小さいまま** — sequence / branch / parallel / merge / rescue を
  メソッドと値だけで組む。
- **workflow は検査可能** — 名前つき task はグラフオブジェクトと DOT 出力へ
  コンパイルできる。

Berylx はインプロセスの workflow 合成であり、ジョブキューでも永続スケジューラでも
分散 saga コーディネータでもない。

## Install

```bash
pnpm add @minamorl/berylx   # (publish 後)
```

```ts
import { Root, Task, task } from '@minamorl/berylx';
```

Ruby 版の演算子 (`>>` `&` `|`) は TS ではメソッドへ写している:

| Ruby            | TypeScript             | 意味                     |
| --------------- | ---------------------- | ------------------------ |
| `a >> b`        | `a.then(b)`            | 逐次合成 (Sequence)      |
| `a & b`         | `a.par(b)`             | 並列合成 (Parallel)      |
| `root \| wf`    | `root.pipe(wf)`        | 実行してコミット         |
| `state \| t`    | `state.pipe(t)`        | State 空間で実行         |
| `state & t`     | `state.and(t)`         | State にノードを蓄積     |
| `When[:x] { }`  | `When.of('x', () => …)`| 分岐の述語               |
| `arm \| Else`   | `arm.or(Else.then(…))` | arm の連結               |

## 並列の merge algebra

`a.par(b)` は全 branch を**同じ base snapshot から**走らせ、返ってきた Focus を
reducer で畳む。base があるので、これは binary な two-way merge ではなく
base `b` を持つ three-way join `μ_b(left, right)` である。既定 reducer の
`Merge.strict()` は次の法則を満たす:

| 法則 | 意味 |
| ---- | ---- |
| `μ_b(b, x) = x` | 何もしない左 branch は右の結果を消さない |
| `μ_b(x, b) = x` | 何もしない右 branch は左の結果を消さない |
| `Δ(l,b) ∩ Δ(r,b) = ∅ ⇒ 両方を保存` | 別々の path への更新は両方残る |
| 同一 path の非互換更新 | `Err(merge_conflict)` |

```ts
const setA = Task.of('setA', (f) => f.at('a').set(1));
const setB = Task.of('setB', (f) => f.at('b').set(1));

Flow.of(Lay.of({ a: 0, b: 0 })).call(setA.par(setB));
// => Ok({ a: 1, b: 1 })   両方の更新が残る

const paid  = Task.of('paid',  (f) => f.at('status').set('paid'));
const trial = Task.of('trial', (f) => f.at('status').set('trial'));

Flow.of(Lay.of({ status: null })).call(paid.par(trial));
// => Err({ status: null }, merge_conflict at status)
```

`Merge.deep()` は base を見ない right-biased な two-way merge なので、この
法則を**満たさない** (既存キーへの disjoint update と右単位律を落とす)。
right wins を明示的に欲しいときだけ `.reduce(Merge.deep())` で選ぶこと。

## 実行基盤

上の表層 API があなたの書くすべて。その下では、あらゆる workflow が単一の
substrate — [darkcore](https://github.com/minamorl/darkcore-ruby) の Effect 木
(Freer monad) — の上で走る。`Task` / sequence / parallel / branch / rescue は
1 種類のタグ付き effect にコンパイルされ、`EffectTree` が darkcore の
トランポリンで解釈する。ネイティブの第二実行系は存在しない。

darkcore の TS パッケージがまだ無いため、この基盤は `src/darkcore.ts` として
リポジトリ内に同梱している。

実行は「handler マップで解釈される effect 木」でしかないので、横断的関心事
(retry / dry-run / audit) は **handler マップを差し替える**だけで足せる。
workflow 本体は書き換えない。

## Quick start

```ts
import { Root, Task } from '@minamorl/berylx';

const stripName = Task.of('strip_name', (lay) =>
  lay.at('name').update((s) => (s as string).trim()),
);

const greet = Task.of('greet', (lay) =>
  lay.at('greeting').set(`hello ${lay.at('name').get()}`),
);

const workflow = stripName.then(greet);
const root = Root.of({ name: '  mina  ' });
const result = root.pipe(workflow);

result.focus.toObject();
// => { name: 'mina', greeting: 'hello mina' }

root.state();
// => { name: 'mina', greeting: 'hello mina' }
```

シーケンス全体が `root.pipe(workflow)` として走ったので、コミットは一度だけ。
どれかのステップが `Err` を返したら、Root は最後にコミットした状態に留まり、
結果は部分 `Lay` を保持する。

## 失敗と回復

```ts
import { Root, Task, Catch } from '@minamorl/berylx';

const charge = Task.of('charge', (lay) =>
  lay.at('charged').set(true).reject('payment_failed', 'card declined'),
);

const notify = Task.of('notify', (lay) => lay.at('notified').set(true));

const workflow = charge
  .then(Catch.of('record_failure', null, {}, (error, lay) =>
    lay.at('failure').set((error as Error).message),
  ))
  .then(notify);

const root = Root.of({ charged: false });
const result = root.pipe(workflow);

result.focus.toObject();
// => { charged: true, failure: 'card declined', notified: true }
```

`Catch` が無ければ、結果は部分 lay に `charged: true` を持つ `Err` となり、
`root.state()` は `{ charged: false }` のまま残る。

## dry-run (計画の列挙)

```ts
import { EffectTree } from '@minamorl/berylx';

const dry = EffectTree.dryRun(stripName.then(greet), { name: '  mina  ' });
dry.steps; // => ['strip_name', 'greet']  (Task の block は実行されない)
```

同じ effect 木を、handler マップの差し替えだけで real 実行 / dry-run へ
切り替えられる。

## グラフ化

```ts
const graph = stripName.then(greet).compile();
graph.nodes();  // => ['strip_name', 'greet']
graph.toDot();  // => 'digraph "berylx" { ... }'
```

## API 一覧

- 状態: `Focus` (別名 `Lay`) / `Root` / `State` / `Flow`
- 合成子: `Task` / `AsyncTask` / `Sequence` / `Parallel` / `When` / `Else` /
  `Branch` / `Catch` / `Rescue` / `Workflow`
- 結果: `Ok` / `Err` / `ResultOps` / `BerylxError`
- reducer: `Merge` (`strict` — 既定 / `deep` / `keepLeft` / `keepRight`)
- 基盤: `EffectTree` (同期 `run` / 非同期 `runAsync`) / `Darkcore`
- グラフ: `Graph#toDot()` / `Graph#toMermaid()`
- cray 互換ブリッジ: `attachRoot` / `fromCrayResult` / `toCrayResult` /
  `Cray` / `CraySuccess` / `CrayFailure`
- ヘルパ: `run(workflow, focus)` / `task(name, block)`

`Darkcore` 名前空間は substrate の Effect (`Effect` / `pure` / `op` / `fold` /
`run` / `foldAsync`) に加え、darkcore の全圏を提供する: `Maybe` (`Just` /
`Nothing`) / `Either` (`Left` / `Right`) / `Result` (`Ok` / `Err` — berylx の
`Ok`/`Err` とは別物) / `State` / `Validation` (`Success` / `Failure`) /
`IOEffects` + `VirtualWorld` (real / virtual 両圏)。

## 開発

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc -> dist/
pnpm test            # vitest run (53 tests)
```

## Ruby 版からの移行 / cray-root-lay 廃止

root-paradigm の `@minamorl/cray` + `@minamorl/lay` ("root + lay" 系ワークフロー
基盤) を berylx-ts へ寄せて廃止する計画は [`MIGRATION.md`](./MIGRATION.md) を参照。

## License

MIT.
