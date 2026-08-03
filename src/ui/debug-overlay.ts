/* Kubetropolis — M1 debug overlay.
 *
 * A read-only <pre> proving the cluster ticks before the city can show it
 * (M2 replaces this view with buildings). Hidden unless ?debug=1 or the
 * backtick key toggles it. Renders FROM SimState; never mutates it.
 */

import type { SimState } from '../core/types'

export interface DebugOverlay {
  update(s: SimState): void
  dispose(): void
}

export function createDebugOverlay(): DebugOverlay {
  const el = document.createElement('pre')
  el.id = 'debug-overlay'
  el.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:40',
    'margin:0', 'padding:10px 12px', 'max-width:44ch', 'max-height:80vh',
    'overflow:hidden', 'pointer-events:none',
    'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#cfe2ff', 'background:rgba(4,8,16,.78)',
    'border:1px solid rgba(120,160,255,.25)', 'border-radius:6px',
    'white-space:pre', 'text-align:left',
  ].join(';')

  let visible = new URLSearchParams(window.location.search).get('debug') === '1'
  el.hidden = !visible
  document.body.appendChild(el)

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== '`' || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    visible = !visible
    el.hidden = !visible
  }
  window.addEventListener('keydown', onKey)

  function update(s: SimState): void {
    if (!visible) return
    const lines: string[] = []
    const v = s.vitals
    lines.push(`t=${s.now.toFixed(1)}s  tick=${s.tick}  rev=${v.etcdRevision} (compacted ${s.etcd.compactedRevision})`)
    lines.push(`inflight=${s.api.inflight.length}  watch-lag=${v.watchMaxLagRev}rev  pulls=${v.imagePullsActive}`)
    lines.push(`sched q=${s.sched.queue.length} backoff=${s.sched.backoff.length} bound=${s.sched.scheduled}`)

    const desks = Object.values(s.controllers)
      .filter((c) => c.reconciles > 0 || c.workqueue.length > 0)
      .map((c) => `${c.id}:${c.workqueue.length}q/${c.reconciles}r`)
    if (desks.length > 0) lines.push(`desks ${desks.join('  ')}`)

    lines.push('')
    for (const n of s.nodes) {
      const obj = s.etcd.objects.get(n.objUid)
      const ready = obj?.kind === 'Node' && obj.status.conditions[0]?.status
      lines.push(
        `${n.id} ${n.powered ? (ready ? 'Ready   ' : 'NotReady') : 'OFF     '} `
          + `cpu ${n.allocated.cpuM}/${n.allocatable.cpuM}m  mem ${n.allocated.memMi}/${n.allocatable.memMi}Mi`
          + (n.pulls.length > 0 ? `  pulling ${n.pulls[0].doneMB.toFixed(0)}/${n.pulls[0].totalMB}MB` : ''),
      )
    }

    lines.push('')
    let shown = 0
    for (const o of s.etcd.objects.values()) {
      if (o.kind !== 'Pod') continue
      if (shown >= 14) {
        lines.push('  …')
        break
      }
      shown += 1
      const c = o.status.container
      const flag = o.deletionTimestamp !== undefined
        ? 'TERM'
        : o.status.ready
          ? 'READY'
          : c.reason ?? c.state
      lines.push(
        `${o.name.padEnd(24).slice(0, 24)} ${o.status.phase.padEnd(8)} ${String(flag).padEnd(12)}`
          + ` r${c.restartCount} ${o.spec.nodeName ?? '—'}`,
      )
    }
    if (shown === 0) lines.push('(no pods — try KUBETROPOLIS.sim.apply(KUBETROPOLIS.samples.deployment()))')

    const ev = s.events[s.events.length - 1]
    if (ev) lines.push('', `⚑ ${ev.reason}: ${ev.obj} — ${ev.message}`.slice(0, 46))

    el.textContent = lines.join('\n')
  }

  return {
    update,
    dispose(): void {
      window.removeEventListener('keydown', onKey)
      el.remove()
    },
  }
}
