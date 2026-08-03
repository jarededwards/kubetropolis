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
import { acquireCdpProfile } from './cdp-profile.mjs'
import { createCdpRunCleanup, installProcessCleanup } from './cdp-run.mjs'

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
  process.env.CHROME_BIN ?? 'google-chrome',
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

removeProcessCleanup()
await run.cleanup()

if (failures.length > 0) {
  console.error('HUD layout verification FAILED:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('HUD layout verification passed: ' + VIEWPORTS.map((v) => `${v.width}x${v.height}`).join(', ') + ' + inspector + help')
process.exit(0)
