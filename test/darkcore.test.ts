import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Darkcore } from '../src/index.js';

const {
  // Effect substrate
  pure,
  fold,
  // Maybe
  Maybe,
  Just,
  Nothing,
  // Either
  Either,
  Left,
  Right,
  // Result
  Result,
  Ok,
  Err,
  // State
  State,
  // Validation
  Validation,
  Success,
  Failure,
  // IO
  IOEffects,
  realHandlers,
  VirtualWorld,
} = Darkcore;

describe('Darkcore.Maybe', () => {
  it('just continues, nothing short-circuits bind', () => {
    const j = Maybe.just(3).bind((x) => Maybe.just((x as number) + 1));
    expect(j).toBeInstanceOf(Just);
    expect((j as InstanceType<typeof Just>).value).toBe(4);

    const n = Maybe.nothing().bind(() => Maybe.just(99));
    expect(n).toBeInstanceOf(Nothing);
  });

  it('fmap is derived and nothing short-circuits fmap/ap', () => {
    expect((Maybe.just(2).fmap((x) => (x as number) * 5) as InstanceType<typeof Just>).value).toBe(10);
    expect(Maybe.nothing().fmap((x) => x)).toBeInstanceOf(Nothing);

    const applied = Maybe.just((x: number) => x + 1).ap(Maybe.just(41));
    expect((applied as InstanceType<typeof Just>).value).toBe(42);
    expect(Maybe.nothing().ap(Maybe.just(1))).toBeInstanceOf(Nothing);
  });

  it('fromNil maps null/undefined to Nothing', () => {
    expect(Maybe.fromNil(null).isNothing()).toBe(true);
    expect(Maybe.fromNil(undefined).isNothing()).toBe(true);
    expect(Maybe.fromNil(0).isJust()).toBe(true);
  });
});

describe('Darkcore.Either', () => {
  it('right continues, left short-circuits', () => {
    const r = Either.right(10).bind((x) => Either.right((x as number) + 5));
    expect(r).toBeInstanceOf(Right);
    expect((r as InstanceType<typeof Right>).value).toBe(15);

    const l = Either.left('boom').bind(() => Either.right(1));
    expect(l).toBeInstanceOf(Left);
    expect((l as InstanceType<typeof Left>).value).toBe('boom');
  });

  it('pure is Right and left skips fmap/ap', () => {
    expect(Either.pure(7)).toBeInstanceOf(Right);
    expect(Either.left('e').fmap((x) => x)).toBeInstanceOf(Left);
    expect(Either.left('e').ap(Either.right(1))).toBeInstanceOf(Left);
  });
});

describe('Darkcore.Result', () => {
  it('ok continues, err short-circuits', () => {
    const ok = Result.ok(2).bind((x) => Result.ok((x as number) * 3));
    expect((ok as InstanceType<typeof Ok>).value).toBe(6);
    expect(ok.isOk()).toBe(true);

    const err = Result.err('nope').bind(() => Result.ok(1));
    expect(err).toBeInstanceOf(Err);
    expect(err.isErr()).toBe(true);
    expect((err as InstanceType<typeof Err>).error).toBe('nope');
  });

  it('try_ captures exceptions into Err(message)', () => {
    const ok = Result.try_(() => 5);
    expect((ok as InstanceType<typeof Ok>).value).toBe(5);
    const err = Result.try_(() => {
      throw new Error('bang');
    });
    expect(err).toBeInstanceOf(Err);
    expect((err as InstanceType<typeof Err>).error).toBe('bang');
  });
});

describe('Darkcore.State', () => {
  it('threads state through bind and static get/put/modify', () => {
    const program = State.get<number>()
      .bind((n) => State.put<number>((n as number) + 1).seq(State.get<number>()))
      .bind((n) => State.pure<number, number>((n as number) * 10));
    const [a, s] = program.run(4);
    expect(a).toBe(50); // (4+1)*10
    expect(s).toBe(5);

    const [, s2] = State.modify<number>((x) => x * 3).run(7);
    expect(s2).toBe(21);
  });

  it('fmap is derived from pure+bind', () => {
    const [a, s] = State.pure<number, number>(2).fmap((x) => (x as number) + 40).run(0);
    expect(a).toBe(42);
    expect(s).toBe(0);
  });
});

describe('Darkcore.Validation', () => {
  it('bind short-circuits but ap accumulates errors (Semigroup)', () => {
    const okBind = Validation.success(3).bind((x) => Validation.success((x as number) + 1));
    expect((okBind as InstanceType<typeof Success>).value).toBe(4);
    expect(Validation.failure('e1').bind(() => Validation.success(1))).toBeInstanceOf(Failure);

    const acc = Validation.failure('e1').ap(Validation.failure('e2'));
    expect(acc).toBeInstanceOf(Failure);
    expect([...(acc as InstanceType<typeof Failure>).errors]).toEqual(['e1', 'e2']);
  });

  it('success.ap applies the wrapped function', () => {
    const applied = Validation.success((x: number) => x * 2).ap(Validation.success(21));
    expect((applied as InstanceType<typeof Success>).value).toBe(42);
    expect(Validation.success((x: number) => x).ap(Validation.failure('bad'))).toBeInstanceOf(Failure);
  });

  it('failure(*es) flattens', () => {
    const f = Validation.failure(['a', 'b'], 'c');
    expect([...(f as InstanceType<typeof Failure>).errors]).toEqual(['a', 'b', 'c']);
  });
});

describe('Monad laws', () => {
  const f = (x: number) => Maybe.just(x + 1);
  const g = (x: number) => Maybe.just(x * 2);
  const eqMaybe = (a: unknown, b: unknown) => {
    const av = a as { isJust(): boolean; value?: unknown };
    const bv = b as { isJust(): boolean; value?: unknown };
    expect(av.isJust()).toBe(bv.isJust());
    if (av.isJust()) {
      expect(av.value).toEqual(bv.value);
    }
  };

  it('left identity: pure(a).bind(f) == f(a)  [Maybe]', () => {
    eqMaybe(Maybe.pure(5).bind((x) => f(x as number)), f(5));
  });

  it('right identity: m.bind(pure) == m  [Maybe]', () => {
    eqMaybe(Maybe.just(9).bind((x) => Maybe.pure(x)), Maybe.just(9));
  });

  it('associativity: m.bind(f).bind(g) == m.bind(x => f(x).bind(g))  [Maybe]', () => {
    const m = Maybe.just(3);
    const lhs = m.bind((x) => f(x as number)).bind((x) => g(x as number));
    const rhs = m.bind((x) => f(x as number).bind((y) => g(y as number)));
    eqMaybe(lhs, rhs);
  });

  it('left identity also holds for Result', () => {
    const rf = (x: number) => Result.ok(x + 1);
    const lhs = Result.pure(5).bind((x) => rf(x as number));
    expect((lhs as InstanceType<typeof Ok>).value).toBe((rf(5) as InstanceType<typeof Ok>).value);
  });
});

describe('Darkcore.IOEffects dual-run (real vs virtual)', () => {
  // The same program writes, appends, and reads in both interpreters.
  const buildProgram = (p: string) =>
    IOEffects.write(p, 'hello')
      .seq(IOEffects.append(p, ' world'))
      .seq(IOEffects.read(p));

  it('virtual world runs entirely in memory and records the log', () => {
    const world = new VirtualWorld();
    const prog = buildProgram('/notes.txt');
    const out = fold(prog, (x) => x, world.handlers());
    expect(out).toBe('hello world');
    expect(world.fs['/notes.txt']).toBe('hello world');
    expect(world.log.map((e) => e[0])).toEqual(['write', 'append', 'read']);
  });

  it('same program yields the same value under the real OS handlers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'berylx-io-'));
    const file = path.join(dir, 'notes.txt');
    try {
      const prog = buildProgram(file);
      const out = fold(prog, (x) => x, realHandlers());
      expect(out).toBe('hello world');
      // The virtual and real interpreters must produce the same result.
      const world = new VirtualWorld();
      const vout = fold(buildProgram(file), (x) => x, world.handlers());
      expect(vout).toBe(out);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('virtual world: say/warn/exists/listDir/getenv/now/rand are deterministic', () => {
    const world = new VirtualWorld({
      files: { '/a/x': '1', '/a/y': '2', '/b/z': '3' },
      env: { TOKEN: 'sekret' },
      now: 'fixed-now',
      randSeq: [7, 3],
    });
    const prog = IOEffects.say('hi')
      .seq(IOEffects.warn('careful'))
      .seq(IOEffects.exists('/a/x'))
      .bind((exists) =>
        IOEffects.listDir('/a').bind((entries) =>
          IOEffects.getenv('TOKEN').bind((tok) =>
            IOEffects.now().bind((now) =>
              IOEffects.rand(10).bind((r) => pure({ exists, entries, tok, now, r })),
            ),
          ),
        ),
      );
    const out = fold(prog, (x) => x, world.handlers()) as Record<string, unknown>;
    expect(out.exists).toBe(true);
    expect((out.entries as string[]).sort()).toEqual(['x', 'y']);
    expect(out.tok).toBe('sekret');
    expect(out.now).toBe('fixed-now');
    expect(out.r).toBe(7);
    expect(world.outputs).toEqual(['hi']);
    expect(world.warnings).toEqual(['careful']);
  });

  it('pure fold is the identity terminal', () => {
    expect(fold(pure(123), (x) => x, {})).toBe(123);
  });

  it('decodes handler responses before bind and rejects malformed responses', () => {
    const effect = Darkcore.op('lookup', null, (value) => {
      if (typeof value !== 'number') {
        throw new TypeError('lookup handler must return a number');
      }
      return value;
    }).bind((value) => pure(value + 1));

    expect(fold(effect, (value) => value, { lookup: () => 41 })).toBe(42);
    expect(() => fold(effect, (value) => value, { lookup: () => '41' })).toThrow(
      /must return a number/,
    );
    expect(() => fold(IOEffects.exists('/x'), (value) => value, { exists: () => 'yes' })).toThrow(
      /must return a boolean/,
    );
  });

  it('rejects malformed concrete IO payloads at the handler boundary', () => {
    expect(() => realHandlers().write(['/only-a-path'])).toThrow(/\[string, string\] tuple/);
  });
});
