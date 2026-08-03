/* Kubetropolis sim — canned sample commands for the console and the M3/M4
 * action picker. These are the complete grammar; free-form YAML would imply
 * behavior the model does not have (FIDELITY.md). */

import type {
  ApplyDeploymentCommand,
  ApplyPodCommand,
  DeletePodCommand,
  ScaleCommand,
} from '../core/types'

export const DEMO_IMAGE_V1 = 'harbor.city/shopfront:v1'
export const DEMO_IMAGE_V2 = 'harbor.city/shopfront:v2'

export const samples = {
  pod(name = 'web'): ApplyPodCommand {
    return { kind: 'ApplyPod', name, image: DEMO_IMAGE_V1 }
  },
  deployment(replicas = 3, name = 'shopfront'): ApplyDeploymentCommand {
    return { kind: 'ApplyDeployment', name, image: DEMO_IMAGE_V1, replicas }
  },
  scale(replicas: number, deployment = 'shopfront'): ScaleCommand {
    return { kind: 'Scale', deployment, replicas }
  },
  deletePod(name: string): DeletePodCommand {
    return { kind: 'DeletePod', name }
  },
} as const
