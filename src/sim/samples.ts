/* Kubetropolis sim — canned sample commands for the console and the M3/M4
 * action picker. These are the complete grammar; free-form YAML would imply
 * behavior the model does not have (FIDELITY.md). */

import type {
  ApplyCrdCommand,
  ApplyDeploymentCommand,
  ApplyLighthouseCommand,
  ApplyPodCommand,
  ApplyServiceCommand,
  ChaosNodeTarget,
  DeletePodCommand,
  DrainNodeCommand,
  RollbackImageCommand,
  ScaleCommand,
  SetImageCommand,
  SetLimitCommand,
  SetNodePowerCommand,
  SetOperatorCommand,
  UncordonNodeCommand,
} from '../core/types'

export const DEMO_IMAGE_V1 = 'harbor.city/shopfront:v1'
export const DEMO_IMAGE_V2 = 'harbor.city/shopfront:v2'
export const DEMO_HOST = 'shop.city.example'

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
  setImage(image = DEMO_IMAGE_V2, deployment = 'shopfront'): SetImageCommand {
    return { kind: 'SetImage', deployment, image }
  },
  rollback(deployment = 'shopfront'): RollbackImageCommand {
    return { kind: 'RollbackImage', deployment }
  },
  setLimit(limitMemMi: number, deployment = 'shopfront'): SetLimitCommand {
    return { kind: 'SetLimit', deployment, limitMemMi }
  },
  service(name = 'shopfront', port = 80, host = DEMO_HOST): ApplyServiceCommand {
    return { kind: 'ApplyService', name, port, host }
  },
  crd(): ApplyCrdCommand {
    return { kind: 'ApplyCrd' }
  },
  lighthouse(name = 'harbor-light', beamRpm = 6): ApplyLighthouseCommand {
    return { kind: 'ApplyLighthouse', name, beamRpm }
  },
  setOperator(running: boolean): SetOperatorCommand {
    return { kind: 'SetOperator', running }
  },
  nodePower(node: ChaosNodeTarget, powered: boolean): SetNodePowerCommand {
    return { kind: 'SetNodePower', node, powered }
  },
  drain(node = 'node-b'): DrainNodeCommand {
    return { kind: 'DrainNode', node }
  },
  uncordon(node = 'node-b'): UncordonNodeCommand {
    return { kind: 'UncordonNode', node }
  },
} as const
