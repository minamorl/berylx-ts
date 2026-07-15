// Ruby 版 test/effect_tree_test.rb の vitest 移植。
// EffectTree (berylx workflow を darkcore Effect 木へ載せ替えた adapter) の検証。
//   1. legacy 実行 (run) と EffectTree.run の結果一致 (dual-run 差分検証)。
//   2. Task が不透明サンクでなく tagged effect ノードで表れること。
//   3. handler 差し替えだけで dry-run (実行せず計画列挙) できること。
import { describe, it, expect } from 'vitest';
import {
  Ok,
  Err,
  Focus,
  Task,
  When,
  Else,
  Merge,
  EffectTree,
  run,
} from '../src/index.js';
import type { Result } from '../src/index.js';

// --- テスト用 workflow 部品 --------------------------------------
const strip = () => Task.of('strip', (lay) => lay.at('name').update((s) => (s as string).trim()));
const greet = () => Task.of('greet', (lay) => lay.at('greeting').set(`hello ${lay.at('name').get()}`));
const boom = () =>
  Task.of('boom', () => {
    throw new Error('kaboom');
  });
const domainReject = () => Task.of('validate', (lay) => lay.reject('invalid', 'name is blank'));
const setA = () => Task.of('set_a', (lay) => lay.at('a').set(1));
const setB = () => Task.of('set_b', (lay) => lay.at('b').set(2));
const positiveArm = () =>
  When.of('pos', (lay) => (lay.at('n').get() as number) > 0).then(
    Task.of('mark_positive', (lay) => lay.at('sign').set('positive')),
  );
const elseArm = () => Else.then(Task.of('mark_negative', (lay) => lay.at('sign').set('negative')));

// --- lay の突き合わせ (Focus は == を持たないので toObject 比較) ----
function assertSameEnvelope(legacy: Result, effect: Result): void {
  expect(effect.constructor).toBe(legacy.constructor);
  if (legacy instanceof Ok) {
    expect((effect as Ok).focus.toObject()).toEqual(legacy.focus.toObject());
  } else {
    const l = legacy as Err;
    const e = effect as Err;
    expect(e.focus.toObject()).toEqual(l.focus.toObject());
    expect(e.code).toBe(l.code);
    expect(e.message).toBe(l.message);
    if (l.failedNode === null) {
      expect(e.failedNode).toBeNull();
    } else {
      expect(e.failedNode).toBe(l.failedNode);
    }
    expect([...e.trace]).toEqual([...l.trace]);
    expect(e.parallelErrors.map((x) => x.toObject())).toEqual(l.parallelErrors.map((x) => x.toObject()));
  }
}

describe('EffectTree', () => {
  it('test_sequence_success_matches_legacy', () => {
    const workflow = strip().then(greet());
    const input = { name: '  mina  ' };
    const legacy = run(workflow, input);
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Ok);
    expect((effect as Ok).focus.toObject()).toEqual({ name: 'mina', greeting: 'hello mina' });
    assertSameEnvelope(legacy, effect);
  });

  it('test_sequence_exception_error_matches_legacy', () => {
    const workflow = strip().then(boom()).then(greet());
    const input = { name: '  mina  ' };
    const legacy = run(workflow, input);
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).failedNode).toBe('boom');
    expect((effect as Err).focus.toObject()).toEqual({ name: 'mina' });
    assertSameEnvelope(legacy, effect);
  });

  it('test_sequence_domain_reject_matches_legacy', () => {
    const workflow = domainReject().then(greet());
    const input = { name: '' };
    const legacy = run(workflow, input);
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).code).toBe('invalid');
    assertSameEnvelope(legacy, effect);
  });

  it('test_single_task_matches_legacy', () => {
    const legacy = run(strip(), { name: '  mina  ' });
    const effect = EffectTree.run(strip(), { name: '  mina  ' });
    assertSameEnvelope(legacy, effect);
    expect((effect as Ok).focus.toObject()).toEqual({ name: 'mina' });
  });

  it('test_task_is_a_tagged_effect_node_not_opaque_thunk', () => {
    const effect = EffectTree.build(strip().then(greet()), { name: '  mina  ' });
    expect(effect.tag).toBe(EffectTree.TASK);
    const [tsk, focus] = effect.payload as [Task, Focus];
    expect(tsk).toBeInstanceOf(Task);
    expect(tsk.name).toBe('strip');
    expect(focus).toBeInstanceOf(Focus);
  });

  it('test_dry_run_enumerates_plan_without_executing', () => {
    const workflow = strip().then(boom()).then(greet());
    const dry = EffectTree.dryRun(workflow, { name: '  mina  ' });
    expect(dry.steps).toEqual(['strip', 'boom', 'greet']);
    expect(dry.result).toBeInstanceOf(Ok);
    expect((dry.result as Ok).focus.toObject()).toEqual({ name: '  mina  ' });
  });

  it('test_dry_run_and_real_run_share_the_same_effect_tree', () => {
    const workflow = strip().then(greet());
    const real = EffectTree.run(workflow, { name: '  mina  ' });
    const dry = EffectTree.dryRun(workflow, { name: '  mina  ' });
    expect((real as Ok).focus.toObject()).toEqual({ name: 'mina', greeting: 'hello mina' });
    expect(dry.steps).toEqual(['strip', 'greet']);
    expect(Object.prototype.hasOwnProperty.call((dry.result as Ok).focus.toObject(), 'greeting')).toBe(false);
  });

  it('test_parallel_success_matches_legacy', () => {
    const workflow = setA().par(setB());
    const input = { base: 0 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Ok);
    expect((effect as Ok).focus.toObject()).toEqual({ base: 0, a: 1, b: 2 });
    assertSameEnvelope(legacy, effect);
  });

  it('test_parallel_short_circuit_matches_legacy', () => {
    const workflow = boom().par(domainReject());
    const input = { name: '' };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).failedNode).toBe('boom');
    expect((effect as Err).parallelErrors.length).toBe(0);
    assertSameEnvelope(legacy, effect);
  });

  it('test_parallel_accumulate_matches_legacy', () => {
    const workflow = boom().par(domainReject()).accumulate();
    const input = { name: '' };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).code).toBe('parallel_failed');
    expect((effect as Err).parallelErrors.length).toBe(2);
    expect((effect as Err).parallelErrors.map((e) => e.code)).toEqual(['Error', 'invalid']);
    assertSameEnvelope(legacy, effect);
  });

  it('test_parallel_default_is_short_circuit', () => {
    const workflow = boom().par(domainReject());
    const effect = EffectTree.run(workflow, { name: '' });
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).code).not.toBe('parallel_failed');
    expect((effect as Err).parallelErrors.length).toBe(0);
  });

  it('test_branch_match_matches_legacy', () => {
    const workflow = positiveArm().or(elseArm());
    const input = { n: 5 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Ok);
    expect((effect as Ok).focus.toObject()).toEqual({ n: 5, sign: 'positive' });
    assertSameEnvelope(legacy, effect);
  });

  it('test_branch_else_arm_matches_legacy', () => {
    const workflow = positiveArm().or(elseArm());
    const input = { n: -3 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Ok);
    expect((effect as Ok).focus.toObject()).toEqual({ n: -3, sign: 'negative' });
    assertSameEnvelope(legacy, effect);
  });

  it('test_branch_no_match_matches_legacy', () => {
    const workflow = positiveArm();
    const input = { n: -1 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).code).toBe('no_branch_matched');
    assertSameEnvelope(legacy, effect);
  });

  it('test_rescue_body_success_passes_through_matches_legacy', () => {
    const workflow = setA().rescueWith(null, 'rescue', (_error, focus) => focus.at('healed').set(true));
    const input = { base: 0 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Ok);
    expect((effect as Ok).focus.toObject()).toEqual({ base: 0, a: 1 });
    assertSameEnvelope(legacy, effect);
  });

  it('test_rescue_recovers_body_failure_matches_legacy', () => {
    const workflow = boom().rescueWith(null, 'rescue', (_error, focus) => focus.at('healed').set(true));
    const input = { base: 0 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Ok);
    expect((effect as Ok).focus.toObject()).toEqual({ base: 0, healed: true });
    assertSameEnvelope(legacy, effect);
  });

  it('test_rescue_recovery_failure_matches_legacy', () => {
    const workflow = boom().rescueWith(null, 'rescue', (_error, focus) =>
      focus.reject('heal_failed', 'could not heal'),
    );
    const input = { base: 0 };
    const legacy = workflow.call(Focus.of(input));
    const effect = EffectTree.run(workflow, input);
    expect(effect).toBeInstanceOf(Err);
    expect((effect as Err).code).toBe('heal_failed');
    expect((effect as Err).failedNode).toBe('rescue');
    assertSameEnvelope(legacy, effect);
  });

  it('test_dry_run_parallel_enumerates_all_branches_without_executing', () => {
    const workflow = setA().par(boom()).par(setB());
    const dry = EffectTree.dryRun(workflow, { base: 0 });
    expect(dry.steps).toEqual(['set_a', 'boom', 'set_b']);
    expect(dry.result).toBeInstanceOf(Ok);
    expect((dry.result as Ok).focus.toObject()).toEqual({ base: 0 });
  });

  it('test_dry_run_branch_enumerates_matched_arm_only', () => {
    const workflow = positiveArm().or(elseArm());
    const dry = EffectTree.dryRun(workflow, { n: 5 });
    expect(dry.steps).toEqual(['mark_positive']);
    expect(dry.result).toBeInstanceOf(Ok);
    expect((dry.result as Ok).focus.toObject()).toEqual({ n: 5 });
  });

  it('test_dry_run_rescue_enumerates_body_only', () => {
    const workflow = boom().rescueWith(null, 'rescue', (_error, focus) => focus.at('healed').set(true));
    const dry = EffectTree.dryRun(workflow, { base: 0 });
    expect(dry.steps).toEqual(['boom']);
    expect(dry.result).toBeInstanceOf(Ok);
    expect((dry.result as Ok).focus.toObject()).toEqual({ base: 0 });
  });
});
