// ==================================================================
// 型レベルの検査。実行はされない (vitest の include に入らない拡張子)。
// scripts/check-types.mjs が二方向で回す:
//   1. このファイルが tsc を通ること (正の対照)。
//      ts-expect-error が付いた行は「エラーが出ないと」逆に tsc が落ちるので、
//      負の対照が本当に落ちていることも同時に保証される。
//   2. ts-expect-error を全部剥がすと、剥がした行がちょうどエラーになること
//      (変異検査)。ts-expect-error は理由を問わずエラーを飲むので、これが無いと
//      「自分のタイポで落ちているだけ」を検出できない。
// ==================================================================

import {
  berylx,
  Focus,
  Task,
  Flow,
  Root,
  Merge,
  When,
  Else,
  Ok,
  Err,
  type Result,
} from '../../src/index.js';

interface Order {
  user: { name: string; age: number };
  total: number;
  status: 'paid' | 'trial' | null;
  items: string[];
}

const base: Order = {
  user: { name: '  mina  ', age: 17 },
  total: 0,
  status: null,
  items: [],
};

const b = berylx<Order>();

// ------------------------------------------------------------------
// 正の対照 — 通るべきものが通り、型が確定していること
// ------------------------------------------------------------------

// Focus: path を掘ると get の戻り値型が確定する
declare const f: Focus<Order>;
const name: string = f.at('user').at('name').get();
const age: number = f.at('user').at('age').get();
const total: number = f.at('total').get();
const status: 'paid' | 'trial' | null = f.at('status').get();
const items: string[] = f.at('items').get();
const whole: Order = f.toObject();

// set は path を root へ戻す (現行実装の assocIn の振る舞い)
const afterSet: Focus<Order, []> = f.at('user').at('name').set('mina');
const afterUpdate: Focus<Order, []> = f.at('total').update((n) => n + 1);
const afterPut: Focus<Order, []> = f.at('user').put('age', 18);

// default 付きの get / fetch は union になる
const withDefault: number | 'none' = f.at('total').get({ default: 'none' as const });
const fetched: string | null = f.at('user').at('name').fetch(null);
const maybeName: string | null = f.at('user').at('name').maybe();

// scope 付き入口: block の引数が Focus<Order> に推論される (注釈なし)
const strip = b.task('strip', (focus) => focus.at('user').at('name').update((s) => s.trim()));
const bump = b.task('bump', (focus) => focus.at('total').update((n) => n + 1));
const markPaid = b.task('markPaid', (focus) => focus.at('status').set('paid'));

// 合成子は S について単相に繋がる
const seq = strip.then(bump);
const par = strip.par(bump);
const branch = b.when('isPaid', (focus) => focus.at('status').get() === 'paid').then(markPaid);
const branchWithElse = branch.or(Else.then(bump));
const rescued = seq.rescueWith(bump);

// 実行系は Result<Order> を返す
const r1: Result<Order> = b.flow(base).call(seq);
const r2: Result<Order> = Flow.of(Focus.of(base)).call(par);
const r3: Result<Order> = b.root(base).pipe(branchWithElse);
const r4: Result<Order> = Root.of(base).call(rescued);
const r5: Result<Order> = b.state(base).pipe(seq);

// 結果封筒の focus も型付き
declare const ok: Ok<Order>;
declare const errored: Err<Order>;
const okTotal: number = ok.focus.at('total').get();
const partialTotal: number = errored.focus.at('total').get();
const okObject: Order = ok.focus.toObject();

// reducer も S で型付く
const strictReducer = Merge.strict<Order>();
const typedPar = strip.par(bump);

// 型を付けない使い方 (S = any) は従来どおり通る
const untypedTask = Task.of('legacy', (focus) => focus.at('whatever').at('nested').set(1));
const untypedResult = Flow.of({ whatever: { nested: 0 } }).call(untypedTask);
const untypedWhen = When.of('any', (focus) => focus.at('x').get());

// ------------------------------------------------------------------
// 負の対照 — 落ちるべきものが落ちること
// ------------------------------------------------------------------

// @ts-expect-error ネストしたキーの typo
f.at('user').at('nmae');

// @ts-expect-error トップレベルのキーの typo
f.at('totl');

// @ts-expect-error スカラの先は掘れない
f.at('total').at('nope');

// @ts-expect-error set の値の型違い
f.at('user').at('name').set(42);

// @ts-expect-error union に無いリテラル
f.at('status').set('refunded');

// @ts-expect-error get の戻り値を別の型へ代入
const wrongType: number = f.at('user').at('name').get();

// @ts-expect-error update のブロックが違う型を返す
f.at('total').update(() => 'not a number');

// @ts-expect-error put の値の型違い
f.at('user').put('age', 'seventeen');

// @ts-expect-error scope 付き task の block 内でも typo は落ちる
b.task('bad', (focus) => focus.at('user').at('nmae').set('x'));

// @ts-expect-error 別の状態型のノードは合成できない
b.task('a', (focus) => focus).then(berylx<{ other: number }>().task('b', (focus) => focus));

// @ts-expect-error Root#at のキーも検査される
Root.of(base).at('nope');

export {
  name, age, total, status, items, whole,
  afterSet, afterUpdate, afterPut,
  withDefault, fetched, maybeName,
  seq, par, branch, branchWithElse, rescued,
  r1, r2, r3, r4, r5,
  okTotal, partialTotal, okObject,
  strictReducer, typedPar,
  untypedTask, untypedResult, untypedWhen,
  wrongType,
};
