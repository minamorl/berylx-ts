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

type _IoBindReceivesBoolean = Expect<Equal<typeof ioProgram, Darkcore.Effect<string>>>;
type _IoRunKeepsResult = Expect<Equal<typeof ioValue, string>>;
