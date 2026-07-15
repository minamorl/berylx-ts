// Ruby 版 test/berylx_test.rb の vitest 移植。
// 各テストは Ruby のケースと 1:1 対応し、演算子は TS API へ写す:
//   root | wf   → root.pipe(wf)
//   a >> b      → a.then(b)
//   a & b       → a.par(b)
//   state | t   → state.pipe(t)
//   When | Else → when.then(...).or(Else.then(...))
import { describe, it, expect } from 'vitest';
import {
  ResultOps,
  Ok,
  Err,
  Focus,
  Lay,
  Flow,
  State,
  Root,
  Task,
  When,
  Else,
  Catch,
  Merge,
  Workflow,
  Graph,
  BerylxError,
  task,
} from '../src/index.js';

const toObj = (r: { focus: Focus }) => r.focus.toObject();

describe('Berylx', () => {
  it('test_result_map', () => {
    const result = ResultOps.map(ResultOps.ok(10), (n) => (n.get() as number) + 1);
    // Ok(10) === ResultOps.ok(10) は Ruby の Data value 等価。TS では focus の値で確認。
    expect((ResultOps.ok(10).focus.get() as number)).toBe(10);
    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok).focus.get()).toBe(11);
  });

  it('test_flow_starts_from_lay_focus', () => {
    const flow = Flow.of(Lay.of({ name: '  mina  ' }));
    expect(flow).toBeInstanceOf(Flow);
    expect(flow.focus.toObject()).toEqual({ name: '  mina  ' });
  });

  it('test_flow_call_runs_node_from_its_lay_origin', () => {
    const strip = Task.of('strip', (root) => root.at('name').update((s) => (s as string).trim()));
    const greet = Task.of('greet', (root) =>
      root.at('greeting').set(`hello ${root.at('name').get()}`),
    );
    const result = Flow.of(Lay.of({ name: '  mina  ' })).call(strip.then(greet));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ name: 'mina', greeting: 'hello mina' });
  });

  it('test_state_pipe_task_syntax_lifts_lay_into_state_space', () => {
    const state = State.of({ name: '  mina  ' });
    const strip = task('strip', (lay) => lay.at('name').update((s) => (s as string).trim()));
    const greet = task('greet', (lay) => lay.at('greeting').set(`hello ${lay.at('name').get()}`));
    // Ruby state | strip | greet は (state|strip) が Result を返し、その Ok#| が続く。
    // TS では state.pipe(strip) が Result を返し、Ok#pipe(greet) で継続する。
    const result = state.pipe(strip).pipe(greet);
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ name: 'mina', greeting: 'hello mina' });
  });

  it('test_task_sequence_over_lay_focus', () => {
    const strip = Task.of('strip', (root) => root.at('name').update((s) => (s as string).trim()));
    const greet = Task.of('greet', (root) =>
      root.at('greeting').set(`hello ${root.at('name').get()}`),
    );
    const result = strip.then(greet).call(Lay.of({ name: '  mina  ' }));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ name: 'mina', greeting: 'hello mina' });
  });

  it('test_root_is_common_origin_for_lay_and_state_layers', () => {
    const strip = task('strip', (lay) => lay.at('name').update((s) => (s as string).trim()));
    const greet = task('greet', (lay) => lay.at('greeting').set(`hello ${lay.at('name').get()}`));
    const root = Root.of({ name: '  mina  ' });

    const layResult = strip.then(greet).call(root.toLay());
    const stateResult = root.pipe(strip.then(greet));

    expect(toObj(layResult)).toEqual({ name: 'mina', greeting: 'hello mina' });
    expect(toObj(stateResult)).toEqual(toObj(layResult));
  });

  it('test_err_unwrap_maps_back_to_plain_ruby_exception', () => {
    const cause = new Error('stripe timeout');
    const result = ResultOps.err(Lay.of({ charged: true }), 'payment_failed', 'payment failed', {
      cause,
    });
    expect(result.toException()).toBe(cause);
    expect(() => (result as Err).unwrap()).toThrow(cause);
  });

  it('test_root_commits_task_results_back_to_the_same_entity', () => {
    const root = Root.of({ request: { id: 'req_1' }, checkout: { user_id: 1 } });
    const enrich = task('enrich', (lay) => lay.at('checkout').at('plan_id').set(3));
    const result = root.pipe(enrich);
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ request: { id: 'req_1' }, checkout: { user_id: 1, plan_id: 3 } });
    expect(root.state()).toEqual(toObj(result));
  });

  it('test_root_does_not_commit_err_results_automatically', () => {
    const root = Root.of({ charged: false });
    const failAfterCharge = task('fail_after_charge', (lay) =>
      lay.at('charged').set(true).reject('payment_failed', 'payment failed'),
    );
    const result = root.pipe(failAfterCharge);
    expect(result).toBeInstanceOf(Err);
    expect(toObj(result)).toEqual({ charged: true });
    expect(root.state()).toEqual({ charged: false });
  });

  it('test_root_commit_deep_merges_external_observations', () => {
    const root = Root.of({ user: { id: 1, name: 'mina' } });
    root.commit({ user: { role: 'admin' } });
    expect(root.state()).toEqual({ user: { id: 1, name: 'mina', role: 'admin' } });
  });

  it('test_root_subscribe_observes_snapshot_and_commits', () => {
    const root = Root.of({ count: 0 });
    const events: unknown[] = [];
    root.subscribe((e) => events.push(e));
    root.commit({ count: 1 });
    expect(events[0]).toEqual({ type: 'snapshot', value: { count: 0 } });
    expect(events[events.length - 1]).toEqual({ type: 'commit', value: { count: 1 } });
  });

  it('test_focus_lookup_helpers_make_missing_paths_explicit', () => {
    const focus = Lay.of({ user: { name: 'mina' } });
    expect(focus.at('user').at('name').get()).toBe('mina');
    expect(focus.at('missing').maybe()).toBeNull();
    expect(focus.at('missing').fetch('fallback')).toBe('fallback');
    expect(focus.at('missing').present()).toBe(false);

    const result = focus.at('missing').required('missing_user');
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('missing_user');

    const present = focus.at('user').required('missing_user');
    expect(present).toBeInstanceOf(Ok);
    expect((present as Ok).focus.get()).toEqual({ name: 'mina' });
  });

  it('test_domain_err_unwrap_raises_berylx_error_when_no_plain_cause_exists', () => {
    const result = Lay.of({}).reject('duplicate_subscription', 'already subscribed');
    try {
      (result as Err).unwrap();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BerylxError);
      expect((e as BerylxError).code).toBe('duplicate_subscription');
      expect((e as BerylxError).message).toBe('already subscribed');
    }
  });

  it('test_parallel_runs_branches_against_snapshot_and_reduces', () => {
    const left = Task.of('left', (root) => root.at('left').set((root.at('base').get() as number) + 1));
    const right = Task.of('right', (root) => root.at('right').set((root.at('base').get() as number) + 2));
    const result = Flow.of(Lay.of({ base: 10 })).call(left.par(right).reduce(Merge.deep()));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ base: 10, left: 11, right: 12 });
  });

  it('test_strict_parallel_merge_allows_independent_updates', () => {
    const left = Task.of('left', (root) => root.at('left').set(1));
    const right = Task.of('right', (root) => root.at('right').set(2));
    const result = Flow.of(Lay.of({ base: 10 })).call(left.par(right).reduce(Merge.strict()));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ base: 10, left: 1, right: 2 });
  });

  it('test_strict_parallel_merge_rejects_conflicting_updates', () => {
    const left = Task.of('left', (root) => root.at('status').set('paid'));
    const right = Task.of('right', (root) => root.at('status').set('trial'));
    const result = Flow.of(Lay.of({ status: null })).call(left.par(right).reduce(Merge.strict()));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('merge_conflict');
    expect((result as Err).failedNode).toBe('parallel');
    expect(toObj(result)).toEqual({ status: null });
  });

  it('test_branch_when_else_syntax', () => {
    const paid = Task.of('paid', (root) => root.at('status').set('paid'));
    const trial = Task.of('trial', (root) => root.at('status').set('trial'));
    const branch = When.of('paid', (root) => root.at('plan').get() === 'paid')
      .then(paid)
      .or(Else.then(trial));

    const paidResult = Flow.of(Lay.of({ plan: 'paid' })).call(branch);
    const trialResult = Flow.of(Lay.of({ plan: 'free' })).call(branch);
    expect((paidResult as Ok).focus.at('status').get()).toBe('paid');
    expect((trialResult as Ok).focus.at('status').get()).toBe('trial');
  });

  it('test_rescue_with_task_keeps_partial_focus', () => {
    const charge = Task.of('charge', (root) => root.at('charged').set(true));
    const explode = Task.of('explode', () => {
      throw new Error('stripe timeout');
    });
    const compensate = Task.of('compensate', (root) =>
      root.at('compensated').set(root.at('charged').get()),
    );
    const result = Flow.of(Lay.of({})).call(charge.then(explode).rescueWith(compensate));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ charged: true, compensated: true });
  });

  it('test_catch_boundary_recovers_previous_sequence_failure_and_continues', () => {
    const charge = Task.of('charge', (root) => root.at('charged').set(true));
    const explode = Task.of('explode', () => {
      throw new Error('stripe timeout');
    });
    const notify = Task.of('notify', (root) => root.at('notified').set(true));
    const result = Flow.of(Lay.of({})).call(
      charge
        .then(explode)
        .then(
          Catch.of('refund', null, {}, (error, root) =>
            root.at('refunded').set((error as Error).message),
          ),
        )
        .then(notify),
    );
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ charged: true, refunded: 'stripe timeout', notified: true });
  });

  it('test_catch_boundary_is_ignored_when_sequence_is_successful', () => {
    const charge = Task.of('charge', (root) => root.at('charged').set(true));
    const notify = Task.of('notify', (root) => root.at('notified').set(true));
    const result = Flow.of(Lay.of({})).call(
      charge
        .then(Catch.of('refund', null, {}, (_error, root) => root.at('refunded').set(true)))
        .then(notify),
    );
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ charged: true, notified: true });
  });

  it('test_task_exception_returns_defined_error_with_failed_node_and_trace', () => {
    const charge = Task.of('charge', (root) => root.at('charged').set(true));
    const explode = Task.of('explode', () => {
      throw new Error('stripe timeout');
    });
    const result = Flow.of(Lay.of({})).call(charge.then(explode));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).error).toBeInstanceOf(BerylxError);
    expect((result as Err).code).toBe('Error');
    expect((result as Err).message).toBe('stripe timeout');
    expect((result as Err).failedNode).toBe('explode');
    expect([...(result as Err).trace]).toEqual(['explode']);
    expect(toObj(result)).toEqual({ charged: true });
  });

  it('test_lay_reject_returns_defined_error', () => {
    const reject = Task.of('reject_duplicate', (root) =>
      root.at('checked').set(true).reject('duplicate_subscription', 'already subscribed'),
    );
    const result = Flow.of(Lay.of({})).call(reject);
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('duplicate_subscription');
    expect((result as Err).message).toBe('already subscribed');
    expect((result as Err).failedNode).toBe('reject_duplicate');
    expect([...(result as Err).trace]).toEqual(['reject_duplicate']);
    expect(toObj(result)).toEqual({ checked: true });
  });

  it('test_parallel_collects_multiple_branch_errors', () => {
    const left = Task.of('left', () => {
      throw new Error('left failed');
    });
    const right = Task.of('right', () => {
      throw new Error('right failed');
    });
    const result = Flow.of(Lay.of({})).call(left.par(right).accumulate());
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('parallel_failed');
    expect((result as Err).parallelErrors.length).toBe(2);
    expect((result as Err).parallelErrors.map((e) => e.failedNode)).toEqual(['left', 'right']);
  });

  it('test_parallel_short_circuit_is_default', () => {
    const left = Task.of('left', () => {
      throw new Error('left failed');
    });
    const right = Task.of('right', () => {
      throw new Error('right failed');
    });
    const result = Flow.of(Lay.of({})).call(left.par(right));
    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).not.toBe('parallel_failed');
    expect((result as Err).code).toBe('Error');
    expect((result as Err).failedNode).toBe('left');
    expect((result as Err).parallelErrors.length).toBe(0);
  });

  it('test_parallel_short_circuit_success_still_merges', () => {
    const left = Task.of('left', (root) => root.at('left').set(1));
    const right = Task.of('right', (root) => root.at('right').set(2));
    const result = Flow.of(Lay.of({ base: 10 })).call(left.par(right).reduce(Merge.deep()));
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ base: 10, left: 1, right: 2 });
  });

  it('test_parallel_mode_preserved_through_reduce_and_and', () => {
    const left = Task.of('left', () => {
      throw new Error('left failed');
    });
    const right = Task.of('right', () => {
      throw new Error('right failed');
    });
    const third = Task.of('third', () => {
      throw new Error('third failed');
    });
    const combined = left.par(right).accumulate().reduce(Merge.deep()).par(third);
    const result = Flow.of(Lay.of({})).call(combined);
    expect(result).toBeInstanceOf(Err);
    expect(combined.onErr).toBe('accumulate');
    expect((result as Err).code).toBe('parallel_failed');
    expect((result as Err).parallelErrors.length).toBe(3);
    expect((result as Err).parallelErrors.map((e) => e.failedNode)).toEqual(['left', 'right', 'third']);
  });

  it('test_rescue_with_block_can_return_err_or_focus', () => {
    const explode = Task.of('explode', () => {
      throw new Error('boom');
    });
    const result = Flow.of(Lay.of({})).call(
      explode.rescueWith(null, 'mark_failed', (error, root) =>
        root.at('error').set((error as Error).message),
      ),
    );
    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ error: 'boom' });
  });

  it('test_workflow_compile_exposes_nodes_parallel_and_branches', () => {
    const a = Task.of('a', (x) => x);
    const b = Task.of('b', (x) => x);
    const c = Task.of('c', (x) => x);
    const fallback = Task.of('fallback', (x) => x);
    const workflow = Workflow.of('example', () =>
      a
        .par(b)
        .reduce(Merge.deep())
        .then(When.of('ok', () => true).then(c).or(Else.then(fallback))),
    );
    const graph = workflow.compile();
    expect(graph.nodes()).toEqual(['a', 'b', 'c', 'fallback']);
    expect(graph.parallelNodes()).toEqual([['a', 'b']]);
    expect(graph.name).toBe('example');
    expect(graph.toDot()).toContain('example');
  });

  it('test_to_dot_sequence_chains_nodes_with_edges', () => {
    const a = Task.of('a', (x) => x);
    const b = Task.of('b', (x) => x);
    const c = Task.of('c', (x) => x);
    const dot = a.then(b).then(c).compile().toDot();
    expect(dot).toContain('"a#0";');
    expect(dot).toContain('"b#1";');
    expect(dot).toContain('"c#2";');
    expect(dot).toContain('"a#0" -> "b#1";');
    expect(dot).toContain('"b#1" -> "c#2";');
  });

  it('test_to_dot_parallel_fans_out_and_in', () => {
    const a = Task.of('a', (x) => x);
    const b = Task.of('b', (x) => x);
    const dot = a.par(b).compile().toDot();
    expect(dot).toContain('"split#0";');
    expect(dot).toContain('"join#1";');
    expect(dot).toContain('"split#0" -> "a#2";');
    expect(dot).toContain('"a#2" -> "join#1";');
    expect(dot).toContain('"split#0" -> "b#3";');
    expect(dot).toContain('"b#3" -> "join#1";');
  });

  it('test_to_dot_branch_labels_each_arm', () => {
    const c = Task.of('c', (x) => x);
    const fallback = Task.of('fallback', (x) => x);
    const branch = When.of('ok', () => true).then(c).or(Else.then(fallback));
    const dot = Graph.from(branch).toDot();
    expect(dot).toContain('"branch#0";');
    expect(dot).toContain('"branch#0" -> "c#1" [label="ok"];');
    expect(dot).toContain('"branch#0" -> "fallback#2" [label="else"];');
  });
});
