# Berylx for TypeScript

**Composable, inspectable workflows with immutable state and recoverable failures.**

Berylx is a TypeScript port of the Ruby [berylx](https://github.com/minamorl/berylx)
gem. It gives multistep workflows a small set of building blocks: named tasks,
sequences, branches, parallel composition, and recovery handlers.

Each task receives a `Focus` (also called `Lay`) and produces a result:

```text
Task: Focus<State> -> Ok<State> | Err<State>
```

Successful results carry the updated state. Failed results carry partial state
and a structured error, so recovery code can work with the context of the failure.
A `Root` owns committed state and commits a workflow's result only when it succeeds.

Use Berylx to compose workflows within a process. Persistence, job scheduling, and
distributed coordination belong to the application running the workflow.

## Installation

Install the published package from npm:

```bash
pnpm add @minamorl/berylx
```

The examples in this README use the `0.3.0` API.

The package uses ES modules, includes TypeScript declarations, and requires Node.js
18 or later.

## Quick start

Declare the state type once with `berylx<S>()`, then build tasks using that type:

```ts
import { berylx } from "@minamorl/berylx";

interface GreetingState {
  name: string;
  greeting: string;
}

const b = berylx<GreetingState>();

const stripName = b.task("strip_name", (focus) =>
  focus.at("name").update((name) => name.trim()),
);

const greet = b.task("greet", (focus) =>
  focus.at("greeting").set(`Hello, ${focus.at("name").get()}!`),
);

const workflow = stripName.then(greet);
const root = b.root({ name: "  Mina  ", greeting: "" });
const result = root.pipe(workflow);

result.focus.toObject();
// { name: 'Mina', greeting: 'Hello, Mina!' }

root.state();
// { name: 'Mina', greeting: 'Hello, Mina!' }
```

`then` passes each successful result to the next task. Running the entire sequence
through `root.pipe(workflow)` commits once, after the sequence succeeds. If it
returns `Err`, the root keeps its previously committed state and the result retains
the partial state.

## Working with state

`Focus<S, P>` tracks both the root state type `S` and the current path `P`.
`at(key)` moves to a child, `get()` reads the focused value, and `set()` or
`update()` returns a new focus at the root. The original focus remains unchanged.

```ts
import { Focus } from "@minamorl/berylx";

const original = Focus.of({ user: { name: "  Mina  ", age: 21 } });
const updated = original
  .at("user")
  .at("name")
  .update((name) => name.trim());

original.at("user").at("name").get(); // '  Mina  '
updated.at("user").at("name").get(); // 'Mina'
updated.toObject(); // { user: { name: 'Mina', age: 21 } }

// @ts-expect-error Only 'name' and 'age' are valid keys here.
original.at("user").at("nmae");
```

Plain objects and arrays are defensively copied and deeply frozen. Values such as
`Map`, `Set`, `Date`, typed arrays, and class instances are retained as supplied;
their internals are not frozen by `Focus`.

A workflow keeps one state type throughout composition. `set()` must accept the
type at its path; it does not widen the state type. Include fields that later
steps populate in your state interface. This keeps composition and error messages
manageable without modeling every step as a separate `Task<Input, Output>` type.

`berylx<S>()` is a convenience wrapper around constructors such as `Task.of<S>()`,
`Root.of()`, and `Flow.of()`. It returns the same classes and adds no separate
execution mechanism. For dynamic state, unparameterized `Task.of()` and
`Focus<any>` remain available. `Lay` is an alias for `Focus`.

## Composing workflows

| Operation              | API                                   | Behavior                                                          |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Sequence               | `a.then(b)`                           | Run `b` with the successful result of `a`.                        |
| Parallel composition   | `a.par(b)`                            | Run both branches from the same snapshot and merge their results. |
| Conditional branch     | `When.of(name, predicate).then(task)` | Run an arm when its predicate matches.                            |
| Additional arm         | `arm.or(otherArm)`                    | Try arms in order; the first match wins.                          |
| Fallback arm           | `arm.or(Else.then(task))`             | Supply a final unconditional arm.                                 |
| Recovery boundary      | `workflow.then(Catch.of(...))`        | Recover an earlier failure and allow the sequence to continue.    |
| Recovery wrapper       | `workflow.rescueWith(handler)`        | Run a handler if the wrapped workflow fails.                      |
| Execute and commit     | `root.pipe(workflow)`                 | Commit only a successful result.                                  |
| Execute without a root | `Flow.of(state).call(workflow)`       | Return a result without committing to a root.                     |

Ordinary `Task` execution is synchronous, including the branches of `par`.
For concurrent asynchronous branches, use `AsyncTask` and
`EffectTree.runAsync`, as described below.

## Parallel merges

Every parallel branch starts from the same base snapshot. The default reducer,
`Merge.strict()`, compares each result with that base before combining changes:

- A branch that leaves the state unchanged does not erase another branch's work.
- Changes to different paths are preserved.
- Matching updates to the same path are accepted.
- Incompatible updates to the same path return an `Err` with code `merge_conflict`.

```ts
import { Flow, Task } from "@minamorl/berylx";

const setA = Task.of("set_a", (focus) => focus.at("a").set(1));
const setB = Task.of("set_b", (focus) => focus.at("b").set(1));

const merged = Flow.of({ a: 0, b: 0 }).call(setA.par(setB));
merged.focus.toObject(); // { a: 1, b: 1 }

const paid = Task.of("paid", (focus) => focus.at("status").set("paid"));
const trial = Task.of("trial", (focus) => focus.at("status").set("trial"));

const conflict = Flow.of({ status: null }).call(paid.par(trial));
if (conflict.isErr()) {
  conflict.code; // 'merge_conflict'
  conflict.focus.toObject(); // { status: null }
}
```

This is a three-way join `μ_b(left, right)` over base `b`, with both identity laws
`μ_b(b, x) = x` and `μ_b(x, b) = x`.

`Merge.deep()` is a two-way merge that favors the right-hand value and ignores the
base. It can overwrite independent updates to existing keys. Choose it explicitly
when that behavior is intended:

```ts
import { Merge, Parallel } from "@minamorl/berylx";

const rightBiased = new Parallel([setA, setB]).reduce(Merge.deep());
```

`Parallel` defaults to `short_circuit` error handling. Use `.accumulate()` on a
`Parallel` instance to collect branch failures in `parallelErrors`.

## Failures and recovery

Return `focus.reject(code, message)` to fail with partial state. Task exceptions
are also converted to `Err` results. A `BerylxError` records information such as
the error code, failed task, trace, cause, and parallel failures.

```ts
import { Catch, Root, Task } from "@minamorl/berylx";

const charge = Task.of("charge", (focus) =>
  focus
    .at("chargeAttempted")
    .set(true)
    .reject("payment_failed", "Card declined"),
);

const recordFailure = Catch.of("record_failure", null, {}, (error, focus) =>
  focus
    .at("failure")
    .set(error instanceof Error ? error.message : String(error)),
);

const notify = Task.of("notify", (focus) => focus.at("notified").set(true));
const workflow = charge.then(recordFailure).then(notify);
const root = Root.of({ chargeAttempted: false });

const result = root.pipe(workflow);
result.focus.toObject();
// { chargeAttempted: true, failure: 'Card declined', notified: true }
```

Without `recordFailure`, the sequence returns an `Err` containing
`{ chargeAttempted: true }`, skips `notify`, and leaves `root.state()` at
`{ chargeAttempted: false }`.

`Catch` passes successful results through and runs its handler only for a matching
failure. Fatal errors are excluded by default; `{ fatal: true }` opts into
recovering them. Committing or rejecting state does not undo external side effects;
any compensation belongs in your recovery logic.

## Asynchronous tasks

Use `AsyncTask.of()` for callbacks that return promises, and run workflows that
contain them with `EffectTree.runAsync()`:

```ts
import { AsyncTask, EffectTree } from "@minamorl/berylx";

const loadName = AsyncTask.of("load_name", async (focus) => {
  const name = await Promise.resolve("Mina");
  return focus.at("name").set(name);
});

const loadTotal = AsyncTask.of("load_total", async (focus) => {
  const total = await Promise.resolve(42);
  return focus.at("total").set(total);
});

const result = await EffectTree.runAsync(loadName.par(loadTotal), {
  name: "",
  total: 0,
});

result.focus.toObject(); // { name: 'Mina', total: 42 }
```

Synchronous and asynchronous tasks can share a workflow. The asynchronous
interpreter starts parallel branches together and waits for them all to settle
before combining results. `EffectTree.runAsync()` returns a result; it does not
commit to a `Root` automatically.

## Dry runs and graphs

Using the `workflow` from the quick start, list task names without running task
callbacks:

```ts
import { EffectTree } from "@minamorl/berylx";

const dry = EffectTree.dryRun(workflow, { name: "  Mina  ", greeting: "" });
dry.steps; // ['strip_name', 'greet']
```

Dry runs evaluate branch predicates against the supplied state, so predicates
should be pure. Task updates are not simulated, and recovery handlers are not
invoked by a simulated failure.

Compile a workflow into an inspectable graph or export it as DOT or Mermaid:

```ts
import { Graph } from "@minamorl/berylx";

const graph = Graph.from(workflow);
graph.nodes(); // ['strip_name', 'greet']
graph.toDot(); // A Graphviz digraph.
graph.toMermaid(); // A Mermaid flowchart.
```

## Execution model

The workflow interpreter uses the bundled TypeScript port of
[darkcore](https://github.com/minamorl/darkcore-ruby). Tasks and combinators compile
into tagged effects, which `EffectTree` interprets through a handler map. The
runtime lives in `src/darkcore/` and is re-exported through `src/darkcore.ts`.

Handler maps let you add execution policies such as auditing or retry logic
without changing workflow definitions. Dry runs use the same effect structure
with different handlers.

## API overview

| Area           | Exports                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| State          | `Focus`, `Lay`, `Root`, `State`, `Flow`, `berylx`                                                    |
| Composition    | `Task`, `AsyncTask`, `Sequence`, `Parallel`, `When`, `Else`, `Branch`, `Catch`, `Rescue`, `Workflow` |
| Results        | `Ok`, `Err`, `ResultOps`, `BerylxError`                                                              |
| Merge reducers | `Merge.strict`, `Merge.deep`, `Merge.keepLeft`, `Merge.keepRight`                                    |
| Execution      | `EffectTree`, `Perform`, `Darkcore`                                                                  |
| Graphs         | `Graph`, `Graph.toDot()`, `Graph.toMermaid()`                                                        |
| Compatibility  | `attachRoot`, `fromCrayResult`, `toCrayResult`, `Cray`, `CraySuccess`, `CrayFailure`                 |
| Helpers        | `run(workflow, focus)`, `task(name, block)`                                                          |

`Darkcore` also exports `Maybe`, `Either`, `Result`, `State`, `Validation`, and
`IOEffects` with `VirtualWorld`. Its `Ok` and `Err` types are separate from
Berylx's workflow result types.

## Coming from Ruby or cray

Ruby operators map to methods in TypeScript:

| Ruby                  | TypeScript                   | Purpose                            |
| --------------------- | ---------------------------- | ---------------------------------- |
| `a >> b`              | `a.then(b)`                  | Sequence                           |
| `a & b`               | `a.par(b)`                   | Parallel composition               |
| `root \| workflow`    | `root.pipe(workflow)`        | Execute and commit                 |
| `state \| task`       | `state.pipe(task)`           | Execute in state space             |
| `state & task`        | `state.and(task)`            | Accumulate a node in a new `State` |
| `When[:name] { ... }` | `When.of('name', predicate)` | Define a condition                 |
| `arm \| Else`         | `arm.or(Else.then(task))`    | Add a fallback arm                 |

See [MIGRATION.md](./MIGRATION.md) for the migration plan from the
`@minamorl/cray` and `@minamorl/lay` packages in `root-paradigm`, including
differences in state updates, asynchronous execution, and errors.

## Development

```bash
git clone https://github.com/minamorl/berylx-ts.git
cd berylx-ts
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

The build writes JavaScript and declarations to `dist/`. `pnpm test` runs Vitest
and the positive and negative TypeScript checks in `scripts/check-types.mjs`.
Use `pnpm run test:watch` for Vitest watch mode or `pnpm run check:types` to run
only the type checks.

## License

[MIT](./LICENSE).
