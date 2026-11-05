// Every rollout kernel by id. The episode cores (inline, Node workers, browser workers) all run kernels from here.
import { actorCritic } from './acKernel';
import { arp } from './arpKernel';
import { imitate } from './imitate';
import type { Kernel, KernelId } from './rollout';

export const KERNELS: Record<KernelId, Kernel> = { imitate, actorCritic, arp };
