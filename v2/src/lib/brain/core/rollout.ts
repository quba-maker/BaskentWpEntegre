import type { TenantBrain } from '../tenant-brain';
import type { QubaBrainRolloutMode } from './schema';

const VALID_ROLLOUT_MODES: QubaBrainRolloutMode[] = ['disabled', 'sandbox', 'shadow', 'active'];

export function normalizeQubaBrainRolloutMode(value: unknown): QubaBrainRolloutMode {
  const normalized = String(value || '').trim().toLowerCase();
  return (VALID_ROLLOUT_MODES as string[]).includes(normalized)
    ? normalized as QubaBrainRolloutMode
    : 'sandbox';
}

export function resolveQubaBrainRolloutMode(brain: TenantBrain): QubaBrainRolloutMode {
  const metadataMode = (brain.prompts.metadata as any)?.qubaBrain?.rolloutMode;
  const configMode = brain.context.config?.qubaBrain?.rolloutMode;
  const envMode = process.env.QUBA_BRAIN_CORE_MODE;
  return normalizeQubaBrainRolloutMode(metadataMode || configMode || envMode || 'sandbox');
}

export function shouldApplyQubaBrainSandboxDirective(mode: QubaBrainRolloutMode): boolean {
  return mode === 'sandbox' || mode === 'shadow' || mode === 'active';
}

export function shouldApplyQubaBrainLiveDirective(mode: QubaBrainRolloutMode): boolean {
  return mode === 'active';
}
