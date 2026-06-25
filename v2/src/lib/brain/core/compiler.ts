import type { TenantBrain } from '../tenant-brain';
import type {
  QubaBrainDiagnostics,
  QubaBrainProfileOverride,
  QubaBrainProfile,
  QubaBrainSource,
  QubaIndustry,
  QubaKnowledgeProfile,
  QubaRuntimeProfile,
  QubaServiceCatalogItem,
} from './schema';
import { getSectorPack } from './sector-packs';
import {
  resolveQubaBrainRolloutMode,
  shouldApplyQubaBrainLiveDirective,
  shouldApplyQubaBrainSandboxDirective,
} from './rollout';
import { DoctorDirectoryResolver } from '../../services/ai/doctor-directory-resolver';

function normalizeIndustry(value: unknown): QubaIndustry {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'healthcare' || normalized === 'health' || normalized === 'hospital') return 'healthcare';
  if (normalized === 'construction' || normalized === 'real_estate') return 'construction';
  if (normalized === 'fitness' || normalized === 'sports' || normalized === 'pool') return 'fitness';
  return 'general';
}

function extractServiceCatalogFromText(text: string): QubaServiceCatalogItem[] {
  const services: QubaServiceCatalogItem[] = [];
  const knownServices: Array<{ id: string; name: string; aliases: string[]; routeTo?: string }> = [
    { id: 'check_up', name: 'Check-up', aliases: ['check up', 'check-up', 'genel muayene'] },
    { id: 'cardiology', name: 'Kardiyoloji', aliases: ['kalp', 'kardiyoloji'], routeTo: 'Kardiyoloji' },
    { id: 'dermatology', name: 'Dermatoloji', aliases: ['dermatoloji', 'cildiye', 'egzama'], routeTo: 'Dermatoloji' },
    { id: 'gynecology', name: 'Kadın Hastalıkları ve Doğum', aliases: ['kadın doğum', 'jinekoloji', 'gebelik'], routeTo: 'Kadın Hastalıkları ve Doğum' },
    { id: 'spine', name: 'Bel ve boyun fıtığı', aliases: ['bel fıtığı', 'boyun fıtığı', 'fıtık'], routeTo: 'Beyin ve Sinir Cerrahisi' },
    { id: 'orthopedics', name: 'Ortopedi', aliases: ['ortopedi', 'diz', 'protez'], routeTo: 'Ortopedi' },
  ];
  const clean = text.toLocaleLowerCase('tr-TR');

  for (const service of knownServices) {
    if (service.aliases.some(alias => clean.includes(alias))) {
      services.push({
        ...service,
        category: 'healthcare_service',
        verifiedFacts: [],
        requiredInfo: [],
        safeAnswerHints: [],
      });
    }
  }

  return services;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function mergeById<T extends { id: string }>(base: T[], overrides?: T[]): T[] {
  if (!overrides || overrides.length === 0) return base;
  const map = new Map<string, T>();
  for (const item of base) map.set(item.id, item);
  for (const item of overrides) map.set(item.id, { ...(map.get(item.id) || {} as T), ...item });
  return Array.from(map.values());
}

function getQubaBrainOverride(brain: TenantBrain): QubaBrainProfileOverride {
  const configOverride = brain.context.config?.qubaBrain;
  const metadataOverride = (brain.prompts.metadata as any)?.qubaBrain;
  return {
    ...(configOverride && typeof configOverride === 'object' ? configOverride : {}),
    ...(metadataOverride && typeof metadataOverride === 'object' ? metadataOverride : {}),
  };
}

function resolveIdentity(brain: TenantBrain, override?: QubaBrainProfileOverride): QubaBrainProfile['identity'] {
  const metadataIdentity = (brain.prompts.metadata as any)?.identity || {};
  const configIdentity = brain.context.config?.identity || {};
  const brainIdentity = override?.identity || {};
  const tenantConfig = brain.context.config || {};
  const prompt = brain.prompts.systemPrompt || '';

  const assistantMatch = prompt.match(/\b(?:Ad[ıi]n|Bot\/persona ad[ıi]n|persona ad[ıi]n)\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'’-]+)/i);
  const promptAssistantName = assistantMatch?.[1]
    ?.replace(/['’]d[ıi]r$/i, '')
    ?.replace(/d[ıi]r$/i, '')
    ?.replace(/[.,;:!?]+$/g, '')
    ?.trim();
  const assistantName = brainIdentity.assistantName
    || metadataIdentity.personaName
    || configIdentity.personaName
    || tenantConfig.assistantName
    || promptAssistantName
    || '';

  const organizationName = brainIdentity.organizationName
    || metadataIdentity.organizationName
    || configIdentity.organizationName
    || tenantConfig.organizationName
    || tenantConfig.name
    || (prompt.includes('Başkent Üniversitesi Konya') ? 'Başkent Üniversitesi Konya Hastanesi' : '');

  return {
    organizationName,
    organizationShortName: brainIdentity.organizationShortName || metadataIdentity.organizationShortName || configIdentity.organizationShortName || tenantConfig.organizationShortName || organizationName,
    assistantName,
    revealBotIdentity: brainIdentity.revealBotIdentity ?? false,
    defaultLanguage: brainIdentity.defaultLanguage || 'tr',
    supportedLanguages: brainIdentity.supportedLanguages || ['tr', 'en', 'de', 'ru', 'uz', 'ar'],
  };
}

function resolveKnowledge(brain: TenantBrain, override?: QubaBrainProfileOverride): QubaKnowledgeProfile {
  const doctors = DoctorDirectoryResolver.getDoctors(brain);
  const rules = brain.context.knowledge?.rules || '';
  const prices = brain.context.knowledge?.prices || '';

  return {
    prices,
    rules,
    verifiedArchive: rules,
    doctorDirectoryAvailable: doctors.length > 0,
    serviceCatalogAvailable: /check|kardiyoloji|dermatoloji|kadın|ortopedi|fıtık/i.test(`${rules}\n${brain.prompts.systemPrompt || ''}`),
    ...(override?.knowledge || {}),
  };
}

function resolveRuntime(brain: TenantBrain, override?: QubaBrainProfileOverride): QubaRuntimeProfile {
  const settings = brain.context.settings;
  const config = brain.context.config || {};
  const hours = settings.workingHours || { enabled: false };

  const runtime = {
    model: settings.aiModel || config.aiModel || 'gemini-2.5-flash',
    responseStyle: settings.responseStyle || 'balanced',
    responseDelaySeconds: settings.responseDelaySeconds ?? 5,
    maxResponseTokens: settings.maxResponseTokens || 2000,
    timezone: config.timezone || 'Europe/Istanbul',
    workingHours: {
      enabled: !!hours.enabled,
      start: hours.start,
      end: hours.end,
      days: (hours as any).days,
    },
  };

  return {
    ...runtime,
    ...(override?.runtime || {}),
    workingHours: {
      ...runtime.workingHours,
      ...(override?.runtime?.workingHours || {}),
    },
  };
}

function resolveDiagnostics(profile: Pick<QubaBrainProfile, 'identity' | 'knowledge' | 'serviceCatalog'>): QubaBrainDiagnostics {
  const warnings: string[] = [];
  const missingSetup: string[] = [];
  const capabilities: string[] = [];

  if (!profile.identity.organizationName) missingSetup.push('organizationName');
  if (!profile.identity.assistantName) warnings.push('assistantName missing; bot should avoid personal identity claims.');
  if (!profile.knowledge.rules && !profile.knowledge.verifiedArchive) missingSetup.push('verifiedKnowledge');
  if (!profile.knowledge.doctorDirectoryAvailable) warnings.push('doctorDirectory not detected.');
  if (profile.serviceCatalog.length === 0) warnings.push('serviceCatalog inferred as empty.');

  if (profile.knowledge.doctorDirectoryAvailable) capabilities.push('doctor_directory');
  if (profile.knowledge.prices) capabilities.push('price_policy');
  if (profile.knowledge.rules) capabilities.push('verified_rules');
  if (profile.serviceCatalog.length > 0) capabilities.push('service_catalog');

  return { warnings, missingSetup, capabilities };
}

function resolveSource(brain: TenantBrain): QubaBrainSource {
  return brain.context.brainSource === 'v2_channel_prompts'
    ? 'compiled_from_v2_channel_prompt'
    : 'compiled_from_legacy_settings';
}

export class QubaBrainCompiler {
  public static compile(brain: TenantBrain): QubaBrainProfile {
    const override = getQubaBrainOverride(brain);
    const configIndustry = brain.context.config?.industry;
    const metadataIndustry = (brain.prompts.metadata as any)?.industry;
    const industry = normalizeIndustry(override.industry || configIndustry || metadataIndustry);
    const sector = getSectorPack(industry);
    const identity = resolveIdentity(brain, override);
    const knowledge = resolveKnowledge(brain, override);
    const textSource = `${brain.prompts.systemPrompt || ''}\n${knowledge.rules || ''}\n${knowledge.prices || ''}`;
    const serviceCatalog = override.serviceCatalog && override.serviceCatalog.length > 0
      ? override.serviceCatalog
      : extractServiceCatalogFromText(textSource);
    const rolloutMode = resolveQubaBrainRolloutMode(brain);
    const tone = override.tone
      ? {
          ...sector.defaultTone,
          ...override.tone,
          avoidPhrases: uniqueStrings([
            ...sector.defaultTone.avoidPhrases,
            ...(override.tone.avoidPhrases || []),
          ]),
          preferredClosers: uniqueStrings([
            ...sector.defaultTone.preferredClosers,
            ...(override.tone.preferredClosers || []),
          ]),
        }
      : sector.defaultTone;

    const partial = {
      identity,
      knowledge,
      serviceCatalog,
    };

    return {
      version: 'quba_brain_v1',
      source: resolveSource(brain),
      tenantId: brain.context.tenantId,
      channel: brain.context.channel,
      industry,
      identity,
      tone,
      goals: override.goals && override.goals.length > 0 ? override.goals : sector.goals,
      serviceCatalog,
      policies: mergeById(sector.policies, override.policies),
      actions: mergeById(sector.actions, override.actions),
      knowledge,
      setupQuestions: mergeById(sector.setupQuestions, override.setupQuestions),
      runtime: resolveRuntime(brain, override),
      rollout: {
        mode: rolloutMode,
        sandboxDirectiveEnabled: shouldApplyQubaBrainSandboxDirective(rolloutMode),
        liveDirectiveEnabled: shouldApplyQubaBrainLiveDirective(rolloutMode),
      },
      diagnostics: resolveDiagnostics(partial),
    };
  }

  public static buildDirective(profile: QubaBrainProfile): string {
    const lines: string[] = [
      '',
      '[QUBA BRAIN CORE]',
      `Sürüm: ${profile.version}`,
      `Sektör: ${profile.industry}`,
      `Kurum: ${profile.identity.organizationName || 'Belirtilmemiş'}`,
      profile.identity.assistantName ? `Asistan adı: ${profile.identity.assistantName}` : 'Asistan adı: belirtilmemiş',
      `Ton: ${profile.tone.preset}, hitap: ${profile.tone.addressStyle}`,
    ];

    if (profile.goals.length > 0) {
      lines.push(`Öncelikler: ${profile.goals
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5)
        .map(goal => goal.description)
        .join(' | ')}`);
    }

    if (profile.policies.length > 0) {
      lines.push(`Sert politikalar: ${profile.policies
        .filter(policy => policy.severity === 'hard')
        .map(policy => `${policy.title}: ${policy.instruction}`)
        .join(' | ')}`);
    }

    if (profile.actions.length > 0) {
      lines.push(`Aksiyon kuralları: ${profile.actions
        .map(action => `${action.action}: ${action.humanFacingInstruction}`)
        .join(' | ')}`);
    }

    if (profile.tone.avoidPhrases.length > 0) {
      lines.push(`Kaçınılacak kalıplar: ${profile.tone.avoidPhrases.join(', ')}`);
    }

    lines.push('Bu blok cevap olarak yazılmayacak; konuşmanın beyin çerçevesi olarak kullanılacak.');
    lines.push('[/QUBA BRAIN CORE]');
    return lines.join('\n');
  }
}
