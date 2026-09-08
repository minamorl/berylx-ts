# Migrating from cray and lay to Berylx

The name "cray-root-lay" refers to the workflow foundation formed by two packages
in the `root-paradigm` monorepo: **`@minamorl/cray`** for workflow composition and
graphs, and **`@minamorl/lay`** for state access through a deep lens. It is not the
name of a separate package.

This document describes the staged plan to replace those packages with
`berylx-ts`, the TypeScript port of the Ruby Berylx gem. The compatibility features
are implemented; consumer migration and deprecation remain separate work.

## API mapping

| Existing API                      | Berylx API                              | Migration notes                                                                           |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@minamorl/lay` `Focus<S>`        | `Focus` and `Root.subscribe()`          | `Focus.set()` returns a new immutable focus. Subscribe to committed state through `Root`. |
| `cray()`                          | `Task` or `task()`                      | A named state transition.                                                                 |
| cray sequence                     | `Sequence` or `node.then()`             | Sequential composition.                                                                   |
| `parallel()` and `Reducer`        | `Parallel`, `node.par()`, and `Merge`   | Error policy is selected with `short_circuit` or `accumulate`.                            |
| `branch()`, `else_`, `elseCray`   | `When`, `Else`, `Branch`, and `Catch`   | Conditional branches and recovery boundaries.                                             |
| `Success` / `Failure`             | `Ok` / `Err`                            | Errors use `BerylxError` with code, failed node, trace, and parallel errors.              |
| `compile()`, `execute()`, `Graph` | `Graph` and `Graph.from(node)`          | Compile workflow structure for inspection.                                                |
| `toMermaid()`                     | `Graph.toMermaid()` and `Graph.toDot()` | Export Mermaid or DOT.                                                                    |
| `attachCray()`                    | `attachRoot()`                          | A framework-independent subscription bridge.                                              |
| Ruby darkcore runtime             | Bundled `src/darkcore/` modules         | Re-exported through `src/darkcore.ts`.                                                    |

## Behavior to account for

### Immutable updates and subscriptions

The old lay `Focus` changes its store through `set` and `update`, then notifies
subscribers through `reflect`. Berylx returns a new `Focus` for each update.
Subscriptions belong to `Root`, which emits snapshot and commit events.

Replace direct mutations of a lay focus with workflows that return the updated
focus and commit through a root. `root.pipe(workflow)` commits successful results
and preserves the previous committed state when a workflow fails.

### Asynchronous execution

Cray workflows return `Promise<Result>`. Berylx supports synchronous `Task` and
asynchronous `AsyncTask`. Tasks of either kind can appear in the same sequence or
parallel composition; run a workflow containing asynchronous tasks through
`EffectTree.runAsync()`.

The asynchronous interpreter starts parallel branches together and uses
`Promise.allSettled` to await completion before applying the error policy and
merge reducer. Synchronous `Task` workflows remain available through the
synchronous interpreter. Calling an `AsyncTask` through its synchronous `call`
method throws an error.

### Error representation

Cray's `Failure.error` may contain any type `E`. Berylx normalizes failures to
`BerylxError`, retaining fields such as `code`, `failedNode`, `trace`,
`parallelErrors`, and `metadata`.

`fromCrayResult()` maps errors as follows:

- An existing `BerylxError` is retained.
- A JavaScript `Error` provides its name, message, and cause, and is also recorded
  in `metadata.crayError`.
- A string becomes an error code.
- Other values use the code `cray_failure` and are retained in
  `metadata.crayError`.

The compatibility layer also accepts structurally compatible result objects,
including objects with `isSuccess` / `isFailure`, a `success` field, or a `tag`.
Use `toCrayResult()` for the reverse conversion.

### Parallel failures and merging

Cray allows reducers to combine failures in custom ways. Berylx separates failure
handling from state merging: `Parallel.onErr` selects `short_circuit` (the default)
or `accumulate`, and `Merge` combines successful branch states.

The default `Merge.strict()` compares changes against the shared base snapshot.
It preserves independent updates and reports incompatible updates to the same
path as `merge_conflict`. `Merge.deep()` explicitly selects a two-way merge that
favors the right-hand value and can overwrite independent updates to existing keys.

## Migration stages

### Stage 0: Establish berylx-ts — complete

- [x] Port the Ruby Berylx modules and the darkcore runtime to TypeScript.
- [x] Verify workflow behavior with Vitest, differential execution checks, and dry runs.
- [x] Pass TypeScript type checking and the build.

### Stage 1: Inventory consumers

- [ ] List every import of `@minamorl/cray` and `@minamorl/lay`. Initial candidates
      include `packages/examples`, `host`, and `server` in `root-paradigm`; search
      other consuming repositories as well.
- [ ] Record which APIs each consumer uses and which migration adaptations it needs.

### Stage 2: Confirm distribution and integration

The current package metadata names `@minamorl/berylx` and configures public
publication to the npm registry. The earlier plan also considered incorporating
the library into `root-paradigm` as `packages/berylx`.

- [ ] Confirm how each consumer will obtain the package and resolve any remaining
      monorepo integration requirements.

### Stage 3: Close compatibility gaps — complete

- [x] **Asynchronous tasks.** `AsyncTask.callAsync()` and
      `EffectTree.runAsync()` provide promise-based execution. The asynchronous
      interpreter shares the synchronous workflow result and merge semantics.
- [x] **Result adapters.** `CraySuccess`, `CrayFailure`, `Cray`,
      `fromCrayResult()`, and `toCrayResult()` bridge result representations.
- [x] **Mermaid export.** `Graph.toMermaid()` generates a `flowchart TD` from the
      same workflow structure used for DOT export. Generated node IDs satisfy Mermaid
      identifier requirements, while labels preserve task names.
- [x] **Host subscription bridge.** `attachRoot()` projects snapshot and commit
      events through `select`, passes them to a host, and returns an unsubscribe
      function. It has no React dependency.

### Stage 4: Replace and deprecate

- [ ] Migrate consumers one package at a time and verify their tests after each change.
- [ ] Deprecate `@minamorl/cray` and `@minamorl/lay`, identifying Berylx as the
      replacement in their package metadata and documentation.
- [ ] Remove the old packages from `root-paradigm` once no consumers reference them.

## Remaining decisions

- Confirm the final distribution and repository arrangement for consumers.
- Decide the rollout order after completing the consumer inventory.

Asynchronous tasks and `attachRoot()` are already implemented; they are available
for consumer migration rather than pending feature decisions.
