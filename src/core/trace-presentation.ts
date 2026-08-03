/* Derived from PGSimCity src/core/trace-presentation.ts @ 6d2c854
 * (Apache-2.0, © 2026 Nikolay Samokhvalov). Rewritten at M1 for the
 * Kubernetes apply-journey stops. The full trace UI arrives at M3; this
 * presentation layer is contract now so the model and tests agree on stage
 * order and visited-state mechanics. */

import { traceStopBit } from './model-helpers'
import { CLAIM_VALUES } from './claims'
import type { TraceRecord, TraceStop } from './types'

export type TraceStageState = 'wait' | 'now' | 'done' | 'skip'

export interface PresentedTraceStage {
  stop: TraceStop
  label: string
}

/** The lower-third rail order for the flagship `kubectl apply` trace. */
export const PRESENTED_TRACE_STAGES: readonly PresentedTraceStage[] = [
  { stop: 'client', label: 'CLIENT' },
  { stop: 'admission', label: 'ADMIT' },
  { stop: 'etcd_commit', label: 'LEDGER' },
  { stop: 'watch_fanout', label: 'FANOUT' },
  { stop: 'sched_queue', label: 'QUEUE' },
  { stop: 'filter_score', label: 'ZONING' },
  { stop: 'bind', label: 'BIND' },
  { stop: 'kubelet_sees', label: 'FOREMAN' },
  { stop: 'image_pull', label: 'HARBOR' },
  { stop: 'start_probes', label: 'PROBES' },
  { stop: 'endpoints', label: 'DIRECTORY' },
  { stop: 'done', label: 'RECEIPT' },
]

/**
 * The deployment variant files one paper and watches the inspectors file
 * more: two desk stages slot in after the fan-out, before any concrete.
 */
export const PRESENTED_DEPLOYMENT_STAGES: readonly PresentedTraceStage[] = [
  ...PRESENTED_TRACE_STAGES.slice(0, 4),
  { stop: 'deploy_reconcile', label: 'HQ DESK' },
  { stop: 'rs_reconcile', label: 'RS DESK' },
  ...PRESENTED_TRACE_STAGES.slice(4),
]

/**
 * The delete rail (M6). Ordering is the content: the directory withdrawal and
 * the foreman's knock leave the watch board at the SAME moment, and nothing
 * orders them — the rail presents them in canonical order while the misroute
 * counter runs. preStop exists because of this pair.
 */
export const PRESENTED_DELETE_STAGES: readonly PresentedTraceStage[] = [
  { stop: 'client', label: 'CLIENT' },
  { stop: 'etcd_commit', label: 'LEDGER' },
  { stop: 'watch_fanout', label: 'FANOUT' },
  { stop: 'endpoint_withdraw', label: 'WITHDRAW' },
  { stop: 'sigterm', label: 'SIGTERM' },
  { stop: 'grace_countdown', label: 'GRACE' },
  { stop: 'sigkill', label: 'SIGKILL' },
  { stop: 'rs_notices', label: 'RS DESK' },
  { stop: 'done', label: 'RECEIPT' },
]

export function presentedStages(action: string): readonly PresentedTraceStage[] {
  if (action === 'apply-deployment') return PRESENTED_DEPLOYMENT_STAGES
  if (action === 'delete-pod') return PRESENTED_DELETE_STAGES
  return PRESENTED_TRACE_STAGES
}

/** Statement timings run on the deliberately stretched model clock. */
export function formatModelMilliseconds(milliseconds: number, fractionDigits = 0): string {
  return `${milliseconds.toFixed(fractionDigits)} ${CLAIM_VALUES.modelDuration.millisecondUnit}`
}

export function traceStageState(trace: TraceRecord, stop: TraceStop): TraceStageState {
  if (trace.stop === stop) return 'now'
  return (trace.visited & traceStopBit(stop)) !== 0 ? 'done' : 'wait'
}
