// Ruby 版 test/catch_boundary_test.rb の vitest 移植。
// fatal (terminal) エラーを Catch がデフォルトでは回復せず、fatal:true を
// 明示したときのみ回復することを確認する。
import { describe, it, expect } from 'vitest';
import { ResultOps, Ok, Err, Focus, Lay, Flow, Task, Catch } from '../src/index.js';

const toObj = (r: { focus: Focus }) => r.focus.toObject();

describe('CatchBoundary', () => {
  it('test_catch_does_not_handle_terminal_errors_by_default', () => {
    const stop = Task.of('stop', (root) =>
      ResultOps.err(root.at('stopped').set(true), 'stop', 'stop', { fatal: true }),
    );
    const recover = Task.of('recover', (root) => root.at('recovered').set(true));

    const result = Flow.of(Lay.of({})).call(
      stop
        .then(Catch.of('recover', null, {}, (_error, root) => root.at('caught').set(true)))
        .then(recover),
    );

    expect(result).toBeInstanceOf(Err);
    expect((result as Err).code).toBe('stop');
    expect((result as Err).error.fatal()).toBe(true);
    expect(toObj(result)).toEqual({ stopped: true });
  });

  it('test_catch_can_opt_into_terminal_errors', () => {
    const stop = Task.of('stop', (root) =>
      ResultOps.err(root.at('stopped').set(true), 'stop', 'stop', { fatal: true }),
    );
    const recover = Task.of('recover', (root) => root.at('recovered').set(true));

    const result = Flow.of(Lay.of({})).call(
      stop
        .then(
          Catch.of('recover', null, { fatal: true }, (error, root) =>
            root.at('caught').set((error as Error).message),
          ),
        )
        .then(recover),
    );

    expect(result).toBeInstanceOf(Ok);
    expect(toObj(result)).toEqual({ stopped: true, caught: 'stop', recovered: true });
  });
});
