# Timeline

Timeline coordinates events, human work, and AI or Berylx tasks within one
in-memory execution. It is available from `@minamorl/berylx/timeline`; the Berylx
connection is available from `@minamorl/berylx/timeline/berylx`.

## Execution model

A `Clock` is only a time source: its `now()` method reports the application's
current time. A `Timeline` is the coordinator: it owns task definitions, time
origins, observed events, predicates, and the resulting task states.

`Timeline.forExecution(execution, clock)` returns one Timeline Root for the given
execution object. Reusing the execution object returns the same Timeline; pairing
it with a different clock raises `CLOCK_CONFLICT`. Keep the execution object for
as long as that run must remain identifiable.

Definitions are collected before execution. `issue()` snapshots them into an
executable plan, and `start()` begins evaluation. A clock is never polled in the
background: after an external clock progresses, call `plan.advance()` to record
due origins and reevaluate work.

```ts
import {
  Timeline,
  predicates,
  type Clock,
} from "@minamorl/berylx/timeline";

class ManualClock implements Clock {
  constructor(public current: Date) {}
  now(): Date { return this.current; }
}

const execution = {};
const clock = new ManualClock(new Date("2026-09-26T08:59:00Z"));
const timeline = Timeline.forExecution(execution, clock);
const approval = timeline.user("approve release");

timeline.calendar({
  type: "release-window",
  at: new Date("2026-09-26T09:00:00Z"),
});

timeline.ai(
  "publish",
  (observation) => {
    console.log(`publishing after ${observation.events.length} observations`);
  },
  predicates.all(
    predicates.completed(approval),
    predicates.event("release-window"),
  ),
);

const plan = timeline.issue();
await plan.start();

clock.current = new Date("2026-09-26T09:00:00Z");
await plan.advance();
await plan.emit({ type: "human-completed", task: approval });
```

Predicates receive an `Observation`, so they can query `state(task)`,
`hasEvent(type)`, or the event list. The built-in `event`, `completed`, `all`, and
`any` helpers cover common gates. This lets observed state gate the next work;
it does not prescribe a development methodology.

## Time origins

Beat origins convert a beat position to elapsed time from `from` using BPM.
Positions may be fractional, and `every` repeats at that many beat positions:

```ts
timeline.beat({
  type: "pulse",
  beat: 0.25,
  every: 0.25,
  bpm: 120,
  from: new Date("2026-09-26T09:00:00Z"),
});
```

Calendar origins use UTC. `at` can identify one instant, `every` can repeat on
UTC minute/hour/day boundaries, and `cron` selects UTC calendar positions. Cron
fields are numeric selectors, not cron strings. When both `dayOfMonth` and
`dayOfWeek` are present, **both** must match:

```ts
timeline.calendar({
  type: "weekday-review",
  at: new Date("2026-09-01T00:00:00Z"),
  cron: {
    minute: 0,
    hour: 9,
    dayOfMonth: [7, 14, 21, 28],
    dayOfWeek: 1,
  },
});
```

Use `recurring(label, eventType, runner)` when work must run once for every new
occurrence. Ordinary `ai()` tasks are one-shot, even when their predicate refers
to a recurring event.

## Numeric keyframes

`KeyframeTrack` linearly interpolates numeric values between placed frames.
Sampling outside the track clamps to its first or last value. `generate()`
samples several requested times in order.

```ts
import { KeyframeTrack } from "@minamorl/berylx/timeline";

const opacity = new KeyframeTrack()
  .place(new Date("2026-09-26T09:00:00Z"), 0)
  .place(new Date("2026-09-26T09:00:10Z"), 1);

opacity.sample(new Date("2026-09-26T09:00:02.500Z")); // 0.25
opacity.generate([
  new Date("2026-09-26T08:59:00Z"),
  new Date("2026-09-26T09:00:05Z"),
  new Date("2026-09-26T09:01:00Z"),
]); // [0, 0.5, 1]
```

## Berylx login waits

The adapter uses a Berylx `Root` as the execution token. A login wait lives in an
`AsyncTask`: `waitForHumanLogin()` suspends that workflow until the application
emits `human-completed`. It does not block the event loop, so unrelated ready AI
or Berylx work can finish while dependent work waits.

```ts
import { AsyncTask, Root, Task } from "@minamorl/berylx";
import {
  BerylxTimeline,
  waitForHumanLogin,
} from "@minamorl/berylx/timeline/berylx";
import type { Clock } from "@minamorl/berylx/timeline";

interface State {
  authenticated: boolean;
  background?: boolean;
  continued?: boolean;
}

class ManualClock implements Clock {
  constructor(public current: Date) {}
  now(): Date { return this.current; }
}

const root = Root.of<State>({ authenticated: false });
const connection = BerylxTimeline.forRoot(
  root,
  new ManualClock(new Date("2026-09-26T09:00:00Z")),
);
const login = connection.humanLogin("finish browser login");

const authenticate = AsyncTask.of<State>(
  "authenticate",
  async (focus, performer) => {
    await waitForHumanLogin(performer, login);
    return focus.at("authenticated").set(true);
  },
).then(Task.of<State>("continue", (focus) =>
  focus.at("continued").set(true),
));

connection.workflow("login-dependent work", authenticate);
connection.workflow(
  "unrelated work",
  Task.of<State>("background", (focus) => focus.at("background").set(true)),
);

const plan = connection.issue();
const running = plan.start();
await new Promise<void>((resolve) => setTimeout(resolve, 0));

root.state().background; // true, while login-dependent work is waiting
await plan.emit({ type: "human-completed", task: login });
await running;
root.state(); // { authenticated: true, background: true, continued: true }
```

The event is a completion signal only. Do not place passwords, tokens, cookies,
authorization codes, or other credentials in event details.

## Errors, conflicts, and lifetime

Invalid definitions and lifecycle calls throw `TimelineError`, whose `toJSON()`
contains `code`, `message`, `details`, and `trace_id`. An AI runner failure fails
the plan with `TASK_FAILED`. In the Berylx adapter, workflow `Err` values remain
available through `plan.result(task)` without committing partial state. Concurrent
workflows that incompatibly update the same path produce `merge_conflict` instead
of silently overwriting one another.

Timeline definitions, observations, task states, keyframes, Berylx results, and
human waiters are process memory only. There is no persistence, distributed
scheduler, replay after restart, or credential store. Applications needing those
properties must provide them outside Timeline.
