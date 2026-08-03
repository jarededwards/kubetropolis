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

import type { ActionKind, Command, PodObj, SimState } from '../core/types'
import { DEMO_HOST, DEMO_IMAGE_V1, DEMO_IMAGE_V2, samples } from './samples'

/** Deterministic victim: the first shopfront pod by name. */
export function firstShopfrontPod(state: SimState): PodObj | undefined {
  let victim: PodObj | undefined
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Pod' || o.deletionTimestamp) continue
    if (!o.name.startsWith('shopfront-')) continue
    if (!victim || o.name < victim.name) victim = o
  }
  return victim
}

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
  mkCommand(state?: SimState): Command
  /** dynamic kubectl line (e.g. a live victim name); falls back to cmd */
  cmdFor?(state: SimState): string
  /** dynamic trace subject (e.g. the live victim); falls back to subject */
  subjectFor?(state: SimState): string
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

const SERVICE_YAML = `apiVersion: v1
kind: Service
metadata:
  name: shopfront
  namespace: shops
spec:
  selector: { app: shopfront }
  ports:
    - port: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shopfront
  namespace: shops
spec:
  rules:
    - host: ${DEMO_HOST}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: shopfront, port: { number: 80 } }`

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
  {
    kind: 'scale-6',
    label: 'Scale to 6',
    cmd: 'kubectl scale deployment/shopfront --replicas=6',
    watch:
      'Three new buildings and zero renovations — scaling edits the contract, not the template.',
    subject: 'shopfront',
    traceable: false,
    mkCommand: () => samples.scale(6),
  },
  {
    kind: 'set-image-v2',
    label: 'Ship v2',
    cmd: `kubectl set image deployment/shopfront app=${DEMO_IMAGE_V2}`,
    watch:
      'A second contract opens for v2 and the wave begins — no v1 door closes until a v2 door is Ready.',
    subject: 'shopfront',
    traceable: false,
    mkCommand: () => samples.setImage(DEMO_IMAGE_V2),
  },
  {
    kind: 'delete-pod',
    label: 'Delete a pod',
    cmd: 'kubectl delete pod shopfront-…',
    watch:
      'The demolition notice and the directory withdrawal leave City Hall at the same moment — and race. Count the misrouted callers.',
    subject: 'shopfront',
    traceable: true,
    mkCommand: (state) => {
      const victim = state ? firstShopfrontPod(state) : undefined
      return samples.deletePod(victim?.name ?? 'shopfront-')
    },
    cmdFor: (state) => {
      const victim = firstShopfrontPod(state)
      return `kubectl delete pod ${victim?.name ?? 'shopfront-…'}`
    },
    subjectFor: (state) => firstShopfrontPod(state)?.name ?? 'shopfront-',
  },
  {
    kind: 'apply-service',
    label: 'Apply a Service',
    cmd: 'kubectl apply -f service.yaml',
    yaml: SERVICE_YAML,
    watch:
      'The shops get a phone number, and the number only lists doors that are open.',
    subject: 'shopfront',
    traceable: false,
    mkCommand: () => samples.service(),
  },
]

export function actionFor(kind: ActionKind): ActionDef | undefined {
  return CATALOG.find((a) => a.kind === kind)
}

export function listActions(): readonly ActionDef[] {
  return CATALOG
}
