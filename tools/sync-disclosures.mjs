// Copies the disclosure ledgers into public/ so the deployed site can serve
// them — the boot screen and help overlay both promise FIDELITY.md to every
// visitor, and a promise the site cannot serve is a broken one. Runs from the
// predev/prebuild npm hooks; no vite plugin, no magic.
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url))
for (const f of ['FIDELITY.md', 'KNOB-AUDIT.md']) {
  copyFileSync(root(f), root(`public/${f}`))
}
console.log('[disclosures] FIDELITY.md + KNOB-AUDIT.md → public/')
