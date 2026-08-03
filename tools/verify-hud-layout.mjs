#!/usr/bin/env node
/* Derived from PGSimCity tools/verify-hud-layout.mjs @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Rewritten lean for Kubetropolis M2: the CDP
 * harness (profile, gate-free single Chrome, cleanup) is theirs; the
 * assertions are ours, sized to the M2 HUD. Upstream's fuller instrument
 * (label-area budgets per camera, transport docking) returns as the HUD
 * grows. Invariants enforced here:
 *
 *   1. every viewport: brand visible, all vitals chips inside the viewport,
 *      no horizontal document overflow
 *   2. restraint: at most ONE .pg-panel visible at a time (help excluded —
 *      it is an overlay, and it must close on Escape)
 *   3. the inspector opens on a programmatic select and stays inside the
 *      viewport without covering the top bar
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { acquireCdpProfile } from './cdp-profile.mjs'
import { createCdpRunCleanup, installProcessCleanup } from './cdp-run.mjs'

/** CHROME_BIN wins; otherwise find a Chrome for this host (macOS included). */
export function resolveChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if (existsSync(mac)) return mac
  }
  return 'google-chrome'
}

const APP_URL = process.argv[2] ?? 'http://localhost:4173/'
const PORT = Number(process.env.CDP_PORT ?? 9571)
const profile = acquireCdpProfile({ explicitProfile: process.env.CDP_PROFILE, port: PORT })
const VIEWPORTS = [
  { width: 1280, height: 760 },
  { width: 1024, height: 760 },
  { width: 768, height: 760 },
  { width: 390, height: 844 },
]
const failures = []
const run = createCdpRunCleanup({ profile })
const removeProcessCleanup = installProcessCleanup(() => run.cleanup())

const chrome = spawn(
  resolveChrome(),
  [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ozone-platform=headless', '--no-proxy-server', '--password-store=basic',
    `--remote-debugging-port=${PORT}`, '--window-size=1280,844',
    '--no-first-run', '--disable-extensions',
    '--js-flags=--max-old-space-size=512', '--disable-gpu-shader-disk-cache',
    '--renderer-process-limit=1', '--disable-background-networking',
    `--user-data-dir=${profile.path}`, 'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)
run.trackChild(chrome)
profile.setOwner(chrome.pid)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targetWebSocket() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const page = (await response.json()).find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting.
    }
    await sleep(250)
  }
  throw new Error('Chrome DevTools did not become available')
}

const socket = new WebSocket(await targetWebSocket())
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
run.trackSocket(socket)

let commandId = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++commandId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  }
  return response.result.value
}

async function waitForHud() {
  for (let attempt = 0; attempt < 160; attempt++) {
    try {
      if (
        await evaluate(
          "(document.getElementById('boot')?.className||'').includes('done') && !!document.querySelector('.hud-brand')",
        )
      )
        return
    } catch {
      // page still loading
    }
    await sleep(500)
  }
  throw new Error('HUD never appeared')
}

function fail(context, message) {
  failures.push(`[${context}] ${message}`)
}

await send('Page.enable')
await send('Page.navigate', { url: APP_URL })
await waitForHud()

for (const vp of VIEWPORTS) {
  const context = `${vp.width}x${vp.height}`
  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: vp.width < 700,
  })
  await sleep(700)

  const report = await evaluate(`(() => {
    const vw = window.innerWidth
    const out = { overflow: document.documentElement.scrollWidth > vw + 1 }
    const brand = document.querySelector('.hud-brand')
    const b = brand?.getBoundingClientRect()
    out.brandVisible = !!b && b.width > 0 && b.left >= 0 && b.right <= vw
    out.chips = Array.from(document.querySelectorAll('.hud-chip')).map((c) => {
      const r = c.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    })
    out.panelsVisible = Array.from(document.querySelectorAll('.pg-panel')).filter((p) => {
      const r = p.getBoundingClientRect()
      return p.offsetParent !== null && r.width > 0 && r.height > 0
    }).length
    return out
  })()`)

  if (report.overflow) fail(context, 'document overflows horizontally')
  if (!report.brandVisible) fail(context, 'brand missing or clipped')
  for (const c of report.chips) {
    if (c.left < -1 || c.right > vp.width + 1) fail(context, `vitals chip outside viewport (${Math.round(c.left)}..${Math.round(c.right)})`)
  }
  if (report.panelsVisible > 1) fail(context, `${report.panelsVisible} panels visible; the restraint rule is one`)
}

/* Inspector open/close + restraint at desktop size. */
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false })
await sleep(500)
const inspector = await evaluate(`(() => {
  const K = window.KUBETROPOLIS
  const first = K.registry.all().find((d) => d.readout) ?? K.registry.all()[0]
  K.bus.emit('select', { id: first.id })
  const card = document.querySelector('.pgc-insp')
  const r = card?.getBoundingClientRect()
  const bar = document.querySelector('.hud-bar')?.getBoundingClientRect()
  const visible = !!r && r.width > 0
  const inside = !!r && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
  const clearOfBar = !r || !bar || r.top >= bar.bottom - 2
  K.bus.emit('select', { id: null })
  const closed = (document.querySelector('.pgc-insp')?.getBoundingClientRect().width ?? 0) === 0
    || document.querySelector('.pgc-insp')?.style.display === 'none'
  return { visible, inside, clearOfBar, closed }
})()`)
if (!inspector.visible) fail('inspector', 'did not open on select')
if (!inspector.inside) fail('inspector', 'overflows the viewport')
if (!inspector.clearOfBar) fail('inspector', 'covers the top bar')
if (!inspector.closed) fail('inspector', 'did not close on deselect')

/* Help must render the notice and yield to Escape. */
const help = await evaluate(`(() => {
  const K = window.KUBETROPOLIS
  K.bus.emit('ui:help', { open: true })
  const overlay = document.getElementById('help-overlay')
  const openOk = overlay && !overlay.hidden && (overlay.textContent || '').includes('Linux Foundation')
  const payload = { handled: false }
  K.bus.emit('ui:escape', payload)
  return { openOk, escapeHandled: payload.handled, closed: overlay.hidden }
})()`)
if (!help.openOk) fail('help', 'overlay missing or notice absent')
if (!help.escapeHandled) fail('help', 'Escape was not offered/handled')
if (!help.closed) fail('help', 'did not close on Escape')

/* M3 — the action picker: opens, is the only surface, closes on Escape. */
const picker = await evaluate(`(() => {
  const K = window.KUBETROPOLIS
  K.bus.emit('trace:open', {})
  const overlay = document.querySelector('.trace-picker')
  const openOk = !!overlay && !overlay.hidden
  const grammar = (overlay?.textContent || '').includes('complete grammar')
  const visiblePanels = Array.from(document.querySelectorAll('.pg-panel')).filter((p) => {
    const r = p.getBoundingClientRect()
    return p.offsetParent !== null && r.width > 0 && r.height > 0
  }).length
  const payload = { handled: false }
  K.bus.emit('ui:escape', payload)
  return { openOk, grammar, visiblePanels, escapeHandled: payload.handled, closed: overlay.hidden }
})()`)
if (!picker.openOk) fail('picker', 'did not open on trace:open')
if (!picker.grammar) fail('picker', 'fidelity sentence missing')
if (picker.visiblePanels > 1) fail('picker', `${picker.visiblePanels} panels visible with the picker open`)
if (!picker.escapeHandled || !picker.closed) fail('picker', 'Escape did not close it first')

/* M3 — the narration card: lower third, one voice, Esc ends the trace. */
const trace = await evaluate(`(() => {
  const K = window.KUBETROPOLIS
  K.bus.emit('trace:run', { statement: 'apply-pod', playback: 'step' })
  const card = document.querySelector('.tour-narrate')
  const r = card?.getBoundingClientRect()
  const vh = window.innerHeight
  const visible = !!r && r.width > 0 && card.classList.contains('is-live')
  const lowerThird = !!r && r.top >= vh * 0.5 && r.bottom <= vh + 1
  const oneCard = document.querySelectorAll('.tour-narrate').length === 1
  const transport = !!card?.querySelector('.tour-btn--next')
  const tracing = !!K.sim.state.trace
  const payload = { handled: false }
  K.bus.emit('ui:escape', payload)
  const endedOnEscape = payload.handled && K.sim.state.trace === null
  const hidden = !card.classList.contains('is-live')
  return { visible, lowerThird, oneCard, transport, tracing, endedOnEscape, hidden }
})()`)
if (!trace.visible) fail('trace', 'narration card did not appear')
if (!trace.lowerThird) fail('trace', 'narration card is not in the lower third')
if (!trace.oneCard) fail('trace', 'more than one narration card exists')
if (!trace.transport) fail('trace', 'transport controls missing')
if (!trace.tracing) fail('trace', 'sim trace did not arm')
if (!trace.endedOnEscape) fail('trace', 'Escape did not end the trace/restore knobs')
if (!trace.hidden) fail('trace', 'card stayed visible after close')

/* M4 — scenarios: the panel is a lone surface; beats and the decision speak
 * through THE narration card; Escape ends the run and restores knobs. */
const scenario = await evaluate(`(async () => {
  const K = window.KUBETROPOLIS
  K.bus.emit('scenario:open', {})
  const overlays = Array.from(document.querySelectorAll('.trace-picker'))
  const overlay = overlays.find((o) => (o.textContent || '').includes('SCENARIOS'))
  const openOk = !!overlay && !overlay.hidden
  const escPayload = { handled: false }
  K.bus.emit('ui:escape', escPayload)
  const closed = !!overlay && overlay.hidden
  K.sim.startScenario('steady-state')
  await new Promise((r) => setTimeout(r, 900))
  const card = document.querySelector('.tour-narrate')
  const live = !!card && card.classList.contains('is-live')
  const spoke = (card?.textContent || '').includes('SCENARIO')
  const oneCard = document.querySelectorAll('.tour-narrate').length === 1
  const endPayload = { handled: false }
  K.bus.emit('ui:escape', endPayload)
  const ended = endPayload.handled && K.sim.state.scenarioRun === null
  return { openOk, closed, live, spoke, oneCard, ended }
})()`)
if (!scenario.openOk) fail('scenario', 'panel did not open on scenario:open')
if (!scenario.closed) fail('scenario', 'Escape did not close the panel')
if (!scenario.live) fail('scenario', 'beats did not reach the narration card')
if (!scenario.spoke) fail('scenario', 'card kicker missing the SCENARIO voice')
if (!scenario.oneCard) fail('scenario', 'a second narration card exists')
if (!scenario.ended) fail('scenario', 'Escape did not end the scenario')

/* M5 — tour: the invitation chip yields to the tour; the tour speaks through
 * THE card with six progress chips; Escape ends it and the card hides. */
const tour = await evaluate(`(async () => {
  const K = window.KUBETROPOLIS
  const chipBefore = !!document.querySelector('[data-tour-invitation]')
  K.bus.emit('tour:start', {})
  await new Promise((r) => setTimeout(r, 700))
  const chipGone = !document.querySelector('[data-tour-invitation]')
  const card = document.querySelector('.tour-narrate')
  const spoke = (card?.textContent || '').includes('TOUR · CHAPTER 1/6')
  const chips = card ? card.querySelectorAll('.ts').length : 0
  const oneCard = document.querySelectorAll('.tour-narrate').length === 1
  const r = card?.getBoundingClientRect?.()
  const vh = window.innerHeight
  const lowerThird = !!r && r.top >= vh * 0.5 && r.bottom <= vh + 1
  const escPayload = { handled: false }
  K.bus.emit('ui:escape', escPayload)
  await new Promise((r2) => setTimeout(r2, 250))
  const ended = escPayload.handled && !(K.tour?.state?.().running)
  const hidden = !card || !card.classList.contains('is-live')
  return { chipBefore, chipGone, spoke, chips, oneCard, lowerThird, ended, hidden }
})()`)
if (!tour.chipBefore) fail('tour', 'first-run invitation chip missing on a fresh profile')
if (!tour.chipGone) fail('tour', 'invitation chip survived tour start')
if (!tour.spoke) fail('tour', 'card kicker missing the TOUR voice')
if (tour.chips !== 6) fail('tour', `expected 6 progress chips, saw ${tour.chips}`)
if (!tour.oneCard) fail('tour', 'a second narration card exists')
if (!tour.lowerThird) fail('tour', 'tour card is not in the lower third')
if (!tour.ended) fail('tour', 'Escape did not end the tour')
if (!tour.hidden) fail('tour', 'card stayed visible after the tour ended')

removeProcessCleanup()
await run.cleanup()

if (failures.length > 0) {
  console.error('HUD layout verification FAILED:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('HUD layout verification passed: ' + VIEWPORTS.map((v) => `${v.width}x${v.height}`).join(', ') + ' + inspector + help + picker + trace card + scenarios + tour')
process.exit(0)
