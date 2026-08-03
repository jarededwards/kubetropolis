/* Derived from PGSimCity src/core/model-helpers.ts @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Rewritten at M1: the trace-stop bitmask now
 * covers the Kubernetes apply journey; the Postgres WAL helper is gone. */

import type { TraceStop } from './types'

export function traceStopBit(stop: TraceStop): number {
  switch (stop) {
    case 'client': return 1 << 0
    case 'admission': return 1 << 1
    case 'etcd_commit': return 1 << 2
    case 'watch_fanout': return 1 << 3
    case 'deploy_reconcile': return 1 << 12
    case 'rs_reconcile': return 1 << 13
    case 'sched_queue': return 1 << 4
    case 'filter_score': return 1 << 5
    case 'bind': return 1 << 6
    case 'kubelet_sees': return 1 << 7
    case 'image_pull': return 1 << 8
    case 'start_probes': return 1 << 9
    case 'endpoints': return 1 << 10
    case 'done': return 1 << 11
    /* delete rail (M6) */
    case 'endpoint_withdraw': return 1 << 14
    case 'sigterm': return 1 << 15
    case 'grace_countdown': return 1 << 16
    case 'sigkill': return 1 << 17
    case 'rs_notices': return 1 << 18
    /* CRD rails (M7) */
    case 'operator': return 1 << 19
    case 'beacon': return 1 << 20
  }
}
