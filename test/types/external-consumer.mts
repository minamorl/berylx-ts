import { AsyncTask, Merge, Parallel, Task, Workflow, type BerylxNode } from '@minamorl/berylx';

const a = AsyncTask.of('a', async (focus) => focus);
const b = AsyncTask.of('b', async (focus) => focus);
const c = AsyncTask.of('c', async (focus) => focus);
export const chained = a.par(b).par(c).workers(2);
export const constructed = new Parallel([a, b]).workers(2);
export const configured = constructed.reduce(Merge.strict()).accumulate().par(c).workers(2);
export const sync = Task.of('a', (focus) => focus).par(Task.of('b', (focus) => focus)).workers(1);

export class ExistingWorkflow extends Workflow {
  override par(other: BerylxNode): BerylxNode { return super.par(other); }
}
