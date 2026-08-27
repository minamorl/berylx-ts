// berylx<S>() scope 付き入口の実行時テスト。
//
// 型が効いているかは test/types/ と scripts/check-types.mjs が見る。ここでは
// 「型を足しても実行時の振る舞いが Task.of / Flow.of と一致すること」だけを見る。
import { describe, it, expect } from 'vitest';
import { berylx, Ok, Err, Task, Flow, Lay, Else } from '../src/index.js';

interface Order {
  user: { name: string; age: number };
  total: number;
  status: 'paid' | 'trial' | null;
}

const base: Order = { user: { name: '  mina  ', age: 17 }, total: 0, status: null };
const b = berylx<Order>();

const toObj = (r: unknown) => (r as Ok<Order> | Err<Order>).focus.toObject();

describe('berylx<S>() scoped entry', () => {
  it('task は Task.of と同じ結果になる', () => {
    const scoped = b.task('strip', (f) => f.at('user').at('name').update((s) => s.trim()));
    const plain = Task.of('strip', (f) => f.at('user').at('name').update((s: string) => s.trim()));
    expect(toObj(b.flow(base).call(scoped))).toEqual(toObj(Flow.of(Lay.of(base)).call(plain)));
  });

  it('then / par / when / rescueWith が繋がる', () => {
    const strip = b.task('strip', (f) => f.at('user').at('name').update((s) => s.trim()));
    const bump = b.task('bump', (f) => f.at('total').update((n) => n + 1));
    const result = b.flow(base).call(strip.then(bump));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ user: { name: 'mina', age: 17 }, total: 1, status: null });
  });

  it('when / Else の分岐が走る', () => {
    const paid = b.task('paid', (f) => f.at('total').set(100));
    const free = b.task('free', (f) => f.at('total').set(0));
    const branch = b
      .when('isPaid', (f) => f.at('status').get() === 'paid')
      .then(paid)
      .or(Else.then(free));

    expect(toObj(b.flow({ ...base, status: 'paid' }).call(branch))).toMatchObject({ total: 100 });
    expect(toObj(b.flow({ ...base, status: 'trial' }).call(branch))).toMatchObject({ total: 0 });
  });

  it('rescueWith は then() の戻り値からも呼べる', () => {
    const bump = b.task('bump', (f) => f.at('total').update((n) => n + 1));
    const boom = b.task('boom', () => {
      throw new Error('nope');
    });
    const heal = b.task('heal', (f) => f.at('status').set('trial'));
    const result = b.flow(base).call(bump.then(boom).rescueWith(heal));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toMatchObject({ total: 1, status: 'trial' });
  });

  it('root / state も同じ S で走る', () => {
    const bump = b.task('bump', (f) => f.at('total').update((n) => n + 1));
    const root = b.root(base);
    expect(root.pipe(bump)).toBeInstanceOf(Ok);
    expect(root.state().total).toBe(1);
    expect(toObj(b.state(base).pipe(bump))).toMatchObject({ total: 1 });
  });

  it('parallel の既定 (three-way join) も scope 付きで効く', () => {
    const setName = b.task('setName', (f) => f.at('user').at('name').set('mina'));
    const setTotal = b.task('setTotal', (f) => f.at('total').set(9));
    const result = b.flow(base).call(setName.par(setTotal));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ user: { name: 'mina', age: 17 }, total: 9, status: null });
  });
});
