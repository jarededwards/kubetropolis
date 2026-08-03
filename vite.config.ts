/* Derived from PGSimCity vite.config.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Modified for Kubetropolis: single entry, no PGlite,
 * renamed env/defines. The entry-graph guard and the test rationale comments
 * are kept verbatim — both encode lessons paid for in broken deploys. */

import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const pkg = JSON.parse(readFileSync(entry('./package.json'), 'utf8')) as { version: string }

function shortGitSha(): string {
  const supplied = process.env.KUBETROPOLIS_GIT_SHA ?? process.env.GITHUB_SHA
  if (supplied && /^[0-9a-f]{7,40}$/i.test(supplied)) return supplied.slice(0, 7).toLowerCase()
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: entry('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Only build pages that actually exist on disk.
 *
 * A rollup input pointing at a missing file fails the whole build, which takes
 * down the Pages deploy for everyone. Listing an entry that is still being
 * written should degrade to "not built yet", not "nothing ships".
 *
 * Kubetropolis v1 has a single entry; the guard stays for any future second
 * entry. Set KUBETROPOLIS_ENTRIES=city to force the city alone regardless.
 */
const input: Record<string, string> = { city: entry('./index.html') }

// Example for a future secondary entry — include only when its whole graph exists:
// const allExist = (...paths: string[]) => paths.every((p) => existsSync(entry(p)))
// if (process.env.KUBETROPOLIS_ENTRIES !== 'city' && allExist('./diagnose/index.html', ...)) {
//   input.diagnose = entry('./diagnose/index.html')
// }
void existsSync

export default defineConfig({
  base: './',
  define: {
    __KUBETROPOLIS_VERSION__: JSON.stringify(pkg.version),
    __KUBETROPOLIS_GIT_SHA__: JSON.stringify(shortGitSha()),
  },
  server: { host: true, port: 5173, open: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    /* ES modules still load imported chunks when an older browser ignores the
     * preload hint. Omitting Vite's preload polyfill keeps any future entry's
     * dynamic loader out of the city's shared critical path. */
    modulePreload: { polyfill: false },
    rollupOptions: { input },
  },
  /* Agent worktrees land under .claude/worktrees/, inside the repo. Without this
   * exclude, vitest globs into them and runs another agent's in-progress
   * red tests as though they were this tree's -- which reported 166 tests and
   * 12 failures in a working tree that was clean. dist/ is built output. */
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    /*
     * Vitest's default is 5 s. These are deterministic model tests — no
     * `Date.now`, no `Math.random`, no `setTimeout` anywhere in `src/sim` — so a
     * wall-clock deadline measures the host, not the code. Several
     * disaster-recovery tests already take 3–5 s alone; under the suite's own
     * worker parallelism on a 4-core box they crossed 5 s and failed at
     * 5436–5743 ms while passing 55/55 in isolation at the same load average.
     *
     * That was the flake recorded as unexplained since v0.33.0. The wrong fix is
     * to shorten the tests: their assertions ARE the recovery coverage, and
     * trimming them to fit a deadline is how the vacuum-blockade lesson was lost
     * once already. Give deterministic work a deadline generous enough that
     * failure means "wrong", never "busy".
     */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
