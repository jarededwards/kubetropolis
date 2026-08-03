/* Kubetropolis sim — the canned action catalog (the sqlFor analog).
 *
 * actionFor() is a pure lookup: label, the exact kubectl line, the YAML
 * receipt the reader sees, and the command the model executes. The picker
 * repeats the fidelity sentence; free-form YAML would imply behavior the
 * model does not have (FIDELITY.md).
 *
 * M3 ships the two traceable applies. The rest of ActionKind arrives with
 * its mechanics (M4/M6/M7/M8) — an action is listed only when it is wired.
 */

import type { ActionKind, Command } from '../core/types'
import { DEMO_IMAGE_V1, samples } from './samples'

export interface ActionDef {
  kind: ActionKind
  label: string
  /** the exact kubectl line shown on the card */
  cmd: string
  /** the manifest receipt, when the command applies one */
  yaml?: string
  /** what you'll watch happen — one sentence, city voice */
  watch: string
  /** the primary object name the trace follows */
  subject: string
  traceable: boolean
  mkCommand(): Command
}

const POD_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: shops
spec:
  containers:
    - name: app
      image: ${DEMO_IMAGE_V1}
      resources:
        requests: { cpu: 250m, memory: 256Mi }
      readinessProbe:
        httpGet: { path: /healthz, port: 8080 }`

const DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shopfront
  namespace: shops
spec:
  replicas: 3
  selector:
    matchLabels: { app: shopfront }
  template:
    metadata:
      labels: { app: shopfront }
    spec:
      containers:
        - name: app
          image: ${DEMO_IMAGE_V1}
          resources:
            requests: { cpu: 250m, memory: 256Mi }`

const CATALOG: ActionDef[] = [
  {
    kind: 'apply-pod',
    label: 'Apply a Pod',
    cmd: 'kubectl apply -f pod.yaml',
    yaml: POD_YAML,
    watch:
      'One permit crosses the whole city and becomes one building — which nothing will rebuild, because it has no owner.',
    subject: 'web',
    traceable: true,
    mkCommand: () => samples.pod('web'),
  },
  {
    kind: 'apply-deployment',
    label: 'Apply a Deployment',
    cmd: 'kubectl apply -f deployment.yaml',
    yaml: DEPLOYMENT_YAML,
    watch:
      'You filed one paper and the inspectors filed four more — count the trips through City Hall.',
    subject: 'shopfront',
    traceable: true,
    mkCommand: () => samples.deployment(3, 'shopfront'),
  },
]

export function actionFor(kind: ActionKind): ActionDef | undefined {
  return CATALOG.find((a) => a.kind === kind)
}

export function listActions(): readonly ActionDef[] {
  return CATALOG
}
