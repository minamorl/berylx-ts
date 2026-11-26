# Parallel execution and workers

Parallel branches start from the same state snapshot. The synchronous interpreter
runs them in declaration order. `EffectTree.runAsync` starts them concurrently;
by default there is no concurrency limit.

Call `a.par(b).par(c).workers(2)` or `new Parallel([a, b, c]).workers(2)` to allow at most two branches of that node to
run at once. The count must be an integer of at least one and is validated when
the node is created. A count of one runs asynchronous branches sequentially; a
count at least as large as the branch count has the same concurrency as the
default. Workers do not change synchronous branch scheduling or results.

All supported branches finish even if one returns an error or throws during
execution. The effect-tree interpreter supports Task, AsyncTask, Sequence,
Parallel, Branch, Rescue, and Catch nodes. For a node with no worker limit and
no directly nested Parallel, a synchronous error while constructing a branch
(for example an unsupported Workflow node) can reject before earlier branches
settle and prevent later branches starting. Other scheduling paths settle all
branches before propagating construction errors.
Results are merged
in declaration order using the node's existing reducer and original snapshot.
`short_circuit` returns the first error in declaration order; `accumulate`
collects all errors in that order. Thrown values are likewise rethrown in branch
order after all branches settle.

A limited parallel node is retained as one branch when composed into another
parallel node; unlimited parallel nodes continue to flatten. Each level has its
own limit, not a shared pool. An outer limit of two with inner limits of three
can therefore run six inner branches at once. Both interpreters fold the leaf
results at the outer node, preserving declaration order, reducer, and error
handling behavior without limits. Inner nodes only limit scheduling.

