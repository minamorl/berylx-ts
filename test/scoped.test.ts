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
  it('produces the same task result as Task.of', () => {
    const scoped = b.task('strip', (f) => f.at('user').at('name').update((s) => s.trim()));
    const plain = Task.of('strip', (f) => f.at('user').at('name').update((s: string) => s.trim()));
    expect(toObj(b.flow(base).call(scoped))).toEqual(toObj(Flow.of(Lay.of(base)).call(plain)));
  });

  it('composes tasks through then', () => {
    const strip = b.task('strip', (f) => f.at('user').at('name').update((s) => s.trim()));
    const bump = b.task('bump', (f) => f.at('total').update((n) => n + 1));
    const result = b.flow(base).call(strip.then(bump));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ user: { name: 'mina', age: 17 }, total: 1, status: null });
  });

  it('selects branches with when and Else', () => {
    const paid = b.task('paid', (f) => f.at('total').set(100));
    const free = b.task('free', (f) => f.at('total').set(0));
    const branch = b
      .when('isPaid', (f) => f.at('status').get() === 'paid')
      .then(paid)
      .or(Else.then(free));

    expect(toObj(b.flow({ ...base, status: 'paid' }).call(branch))).toMatchObject({ total: 100 });
    expect(toObj(b.flow({ ...base, status: 'trial' }).call(branch))).toMatchObject({ total: 0 });
  });

  it('supports rescueWith on the result of then()', () => {
    const bump = b.task('bump', (f) => f.at('total').update((n) => n + 1));
    const boom = b.task('boom', () => {
      throw new Error('nope');
    });
    const heal = b.task('heal', (f) => f.at('status').set('trial'));
    const result = b.flow(base).call(bump.then(boom).rescueWith(heal));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toMatchObject({ total: 1, status: 'trial' });
  });

  it('preserves the state type through root and state', () => {
    const bump = b.task('bump', (f) => f.at('total').update((n) => n + 1));
    const root = b.root(base);
    expect(root.pipe(bump)).toBeInstanceOf(Ok);
    expect(root.state().total).toBe(1);
    expect(toObj(b.state(base).pipe(bump))).toMatchObject({ total: 1 });
  });

  it('uses the default three-way join with scoped tasks', () => {
    const setName = b.task('setName', (f) => f.at('user').at('name').set('mina'));
    const setTotal = b.task('setTotal', (f) => f.at('total').set(9));
    const result = b.flow(base).call(setName.par(setTotal));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ user: { name: 'mina', age: 17 }, total: 9, status: null });
  });
});
