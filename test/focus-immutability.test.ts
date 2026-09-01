import { describe, expect, it } from 'vitest';
import { Err, Focus } from '../src/index.js';

describe('Focus immutability', () => {
  it('keeps the construction snapshot after the source is mutated', () => {
    const source = { charged: false, items: [1, 2, 3] };
    const focus = Focus.of(source);

    source.charged = true;
    source.items.push(999);

    expect(focus.toObject()).toEqual({ charged: false, items: [1, 2, 3] });
  });

  it('does not retain the source object as its root value', () => {
    const source = { charged: false, items: [1, 2, 3] };
    const focus = Focus.of(source);

    expect(focus.toObject()).not.toBe(source);
  });

  it('deep-freezes values returned by construction and updates', () => {
    const constructed = Focus.of({ charged: false, items: [1, 2, 3] });
    const set = constructed.set({ charged: true, items: [4] });
    const put = constructed.put('charged', true);
    const updated = constructed.at('items').update((items) => [...(items as number[]), 4]);

    for (const focus of [constructed, set, put, updated]) {
      const value = focus.toObject() as { items: number[] };
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.items)).toBe(true);
    }
  });

  it('keeps an Err partial lay stable after external mutation', () => {
    const receipt = { id: 'receipt-1', lines: ['charge'] };
    const result = Focus.of({ charged: false })
      .put('receipt', receipt)
      .reject('payment_failed', 'payment failed');

    receipt.id = 'receipt-mutated';
    receipt.lines.push('refund');

    expect(result).toBeInstanceOf(Err);
    expect((result as Err).focus.toObject()).toEqual({
      charged: false,
      receipt: { id: 'receipt-1', lines: ['charge'] },
    });
  });

  it('copies and freezes cyclic records without recursing forever', () => {
    type CyclicRecord = { label: string; self?: CyclicRecord };
    const source: CyclicRecord = { label: 'root' };
    source.self = source;

    const value = Focus.of(source).toObject() as CyclicRecord;

    expect(value).not.toBe(source);
    expect(value.self).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('clones repeated mutable children separately like Ruby Freeze.deep', () => {
    const child = { value: 1 };
    const value = Focus.of({ left: child, right: child }).toObject() as {
      left: { value: number };
      right: { value: number };
    };

    expect(value.left).not.toBe(value.right);
    expect(value.left).not.toBe(child);
    expect(value.right).not.toBe(child);
  });
});
