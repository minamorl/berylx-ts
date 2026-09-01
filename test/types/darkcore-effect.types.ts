import { Darkcore } from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

interface User {
  id: number;
  name: string;
}

function decodeUser(value: unknown): User {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'number' ||
    !('name' in value) ||
    typeof value.name !== 'string'
  ) {
    throw new TypeError('lookup_user handler must return a User');
  }
  return { id: value.id, name: value.name };
}

const program = Darkcore.op('lookup_user', { id: 7 }, decodeUser).bind((user) =>
  Darkcore.pure(user.name.length),
);

declare const handlers: Darkcore.HandlerMap;

const runValue = Darkcore.run(program, handlers);
const foldedValue = Darkcore.fold(program, (length) => ({ length }), handlers);
const asyncValue = Darkcore.runAsync(program, handlers);

type _ProgramKeepsResult = Expect<Equal<typeof program, Darkcore.Effect<number>>>;
type _RunKeepsResult = Expect<Equal<typeof runValue, number>>;
type _FoldReceivesResult = Expect<Equal<typeof foldedValue, { length: number }>>;
type _AsyncRunKeepsResult = Expect<Equal<typeof asyncValue, Promise<number>>>;

const ioProgram = Darkcore.IOEffects.exists('/tmp/example').bind((exists) =>
  Darkcore.pure(exists ? 'present' : 'missing'),
);
const ioValue = Darkcore.run(ioProgram, handlers);
const existsValue = Darkcore.run(Darkcore.IOEffects.exists('/tmp/example'), handlers);

type _IoBindReceivesBoolean = Expect<Equal<typeof ioProgram, Darkcore.Effect<string>>>;
type _IoRunKeepsResult = Expect<Equal<typeof ioValue, string>>;
type _ExistsRunKeepsBoolean = Expect<Equal<typeof existsValue, boolean>>;

// @ts-expect-error decoder is required at the dynamic handler boundary
Darkcore.op('lookup_user', { id: 7 });

// @ts-expect-error bind receives the decoder's User result
Darkcore.op('lookup_user', { id: 7 }, decodeUser).bind((user) => Darkcore.pure(user.missing));

// @ts-expect-error run preserves the program's number result
const wrongRunValue: string = runValue;

// @ts-expect-error IO exists has a concrete boolean response
const wrongExistsValue: string = existsValue;

export { program, runValue, foldedValue, asyncValue, ioProgram, ioValue, existsValue };
