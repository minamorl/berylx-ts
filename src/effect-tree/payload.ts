import { Focus } from '../focus.js';
import { Task } from '../task.js';
import { AsyncTask } from '../async-task.js';
import { Parallel } from '../parallel.js';
import { Branch } from '../branch.js';
import { Rescue, Catch } from '../rescue.js';
import { Ok, Err, type Result } from '../result.js';

export type TaskPayload = [Task | AsyncTask, Focus];
export type ParallelPayload = [Parallel, Focus];
export type BranchPayload = [Branch, Focus];
export type RescuePayload = [Rescue, Focus];
export type RecoverPayload = [Rescue | Catch, Err];

/** Validate and narrow a handler response to a berylx result. */
export function decodeResult(value: unknown): Result {
  if (value instanceof Ok || value instanceof Err) {
    return value;
  }
  throw new TypeError('berylx effect handler must return Ok or Err');
}

export function decodeTaskPayload(value: unknown): TaskPayload {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    (!(value[0] instanceof Task) && !(value[0] instanceof AsyncTask)) ||
    !(value[1] instanceof Focus)
  ) {
    throw new TypeError('berylx_task payload must be [Task | AsyncTask, Focus]');
  }
  return [value[0], value[1]];
}

export function decodeParallelPayload(value: unknown): ParallelPayload {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !(value[0] instanceof Parallel) ||
    !(value[1] instanceof Focus)
  ) {
    throw new TypeError('berylx_parallel payload must be [Parallel, Focus]');
  }
  return [value[0], value[1]];
}

export function decodeBranchPayload(value: unknown): BranchPayload {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !(value[0] instanceof Branch) ||
    !(value[1] instanceof Focus)
  ) {
    throw new TypeError('berylx_branch payload must be [Branch, Focus]');
  }
  return [value[0], value[1]];
}

export function decodeRescuePayload(value: unknown): RescuePayload {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !(value[0] instanceof Rescue) ||
    !(value[1] instanceof Focus)
  ) {
    throw new TypeError('berylx_rescue payload must be [Rescue, Focus]');
  }
  return [value[0], value[1]];
}

export function decodeRecoverPayload(value: unknown): RecoverPayload {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    (!(value[0] instanceof Rescue) && !(value[0] instanceof Catch)) ||
    !(value[1] instanceof Err)
  ) {
    throw new TypeError('berylx_recover payload must be [Rescue | Catch, Err]');
  }
  return [value[0], value[1]];
}
