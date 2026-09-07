// This file is compiled, not executed by Vitest. check-types.mjs verifies that
// it compiles, then removes @ts-expect-error directives from a copy and checks
// that the resulting errors occur only at the expected lines.

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
// Positive controls: valid operations and inferred types
// ------------------------------------------------------------------

// Each path determines the return type of get().
declare const f: Focus<Order>;
const name: string = f.at('user').at('name').get();
const age: number = f.at('user').at('age').get();
const total: number = f.at('total').get();
const status: 'paid' | 'trial' | null = f.at('status').get();
const items: string[] = f.at('items').get();
const whole: Order = f.toObject();

// Updates return a focus at the root, not at the updated path.
const afterSet: Focus<Order, []> = f.at('user').at('name').set('mina');
const afterUpdate: Focus<Order, []> = f.at('total').update((n) => n + 1);
const afterPut: Focus<Order, []> = f.at('user').put('age', 18);

// Defaults are included in the return type.
const withDefault: number | 'none' = f.at('total').get({ default: 'none' as const });
const fetched: string | null = f.at('user').at('name').fetch(null);
const maybeName: string | null = f.at('user').at('name').maybe();

// Scoped callbacks infer Focus<Order> without annotations.
const strip = b.task('strip', (focus) => focus.at('user').at('name').update((s) => s.trim()));
const bump = b.task('bump', (focus) => focus.at('total').update((n) => n + 1));
const markPaid = b.task('markPaid', (focus) => focus.at('status').set('paid'));

// Composition preserves the same state type.
const seq = strip.then(bump);
const par = strip.par(bump);
const branch = b.when('isPaid', (focus) => focus.at('status').get() === 'paid').then(markPaid);
const branchWithElse = branch.or(Else.then(bump));
const rescued = seq.rescueWith(bump);

// Execution preserves the state type in Result<Order>.
const r1: Result<Order> = b.flow(base).call(seq);
const r2: Result<Order> = Flow.of(Focus.of(base)).call(par);
const r3: Result<Order> = b.root(base).pipe(branchWithElse);
const r4: Result<Order> = Root.of(base).call(rescued);
const r5: Result<Order> = b.state(base).pipe(seq);

// Both successful and failed results retain typed state.
declare const ok: Ok<Order>;
declare const errored: Err<Order>;
const okTotal: number = ok.focus.at('total').get();
const partialTotal: number = errored.focus.at('total').get();
const okObject: Order = ok.focus.toObject();

// Reducers accept the same state type.
const strictReducer = Merge.strict<Order>();
const typedPar = strip.par(bump);

// Untyped use remains supported through the default S = any.
const untypedTask = Task.of('legacy', (focus) => focus.at('whatever').at('nested').set(1));
const untypedResult = Flow.of({ whatever: { nested: 0 } }).call(untypedTask);
const untypedWhen = When.of('any', (focus) => focus.at('x').get());

// ------------------------------------------------------------------
// Negative controls: invalid operations must be rejected
// ------------------------------------------------------------------

// @ts-expect-error Misspelled nested key
f.at('user').at('nmae');

// @ts-expect-error Misspelled root key
f.at('totl');

// @ts-expect-error Cannot descend into a scalar
f.at('total').at('nope');

// @ts-expect-error Wrong value type for set()
f.at('user').at('name').set(42);

// @ts-expect-error Literal is not a member of the union
f.at('status').set('refunded');

// @ts-expect-error Cannot assign get() to an incompatible type
const wrongType: number = f.at('user').at('name').get();

// @ts-expect-error update() must preserve the focused value type
f.at('total').update(() => 'not a number');

// @ts-expect-error Wrong value type for put()
f.at('user').put('age', 'seventeen');

// @ts-expect-error Scoped task callbacks also reject misspelled keys
b.task('bad', (focus) => focus.at('user').at('nmae').set('x'));

// @ts-expect-error Cannot compose nodes with different state types
b.task('a', (focus) => focus).then(berylx<{ other: number }>().task('b', (focus) => focus));

// @ts-expect-error Root.at() also validates keys
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
