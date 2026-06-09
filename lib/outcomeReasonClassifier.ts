import type { JsonValue } from './dbTypes';

export type OutcomeReasonType = 'external' | 'quality' | 'mixed' | 'unknown';

export type FailureArea =
  | 'concept'
  | 'strategy'
  | 'structure'
  | 'content'
  | 'design'
  | 'execution'
  | 'operation'
  | 'differentiation'
  | 'budget_external'
  | 'schedule_external'
  | 'procurement_external'
  | 'unknown';

export type ProposalPatternUsabilityFlags = {
  can_use_for_structure: boolean;
  can_use_for_concept: boolean;
  can_use_for_strategy: boolean;
  can_use_for_content: boolean;
  can_use_for_design: boolean;
  can_use_for_execution: boolean;
  can_use_for_operation: boolean;
};

const externalPatterns = [
  /budget|price|cost|fee|commercial|procurement|purchasing|tender condition|client internal decision|internal decision|incumbent agency|incumbent|timeline|schedule mismatch|schedule|contract scope|relationship factor|relationship|political factor|politic|evaluation outside proposal quality|evaluation outside proposal/i,
  /예산|가격|비용|견적|단가|조달|구매|입찰 조건|내부 결정|내부 사정|기존 업체|기존 대행사|인컴번트|일정|스케줄|기간|계약 범위|관계|정치|외부 요인|외부요인|발주처 사정/u,
];

const qualityPatterns = [
  /weak concept|weak differentiation|generic content|unclear strategy|weak feasibility|missing operation plan|missing operation|rfp mismatch|requirements not addressed|poor design direction|poor design|weak storytelling|insufficient evidence|unclear company\/product distinction|unclear distinction|proposal quality/i,
  /콘셉트.*약|컨셉.*약|차별.*부족|차별.*약|구분.*되지|구분.*부족|전략.*불명확|전략.*약|일반적|평범|실행력.*부족|실행 가능.*부족|운영.*부족|요구.*미반영|디자인.*약|스토리.*약|근거.*부족|증빙.*부족|품질|완성도|설득.*부족/u,
];

const failureAreaPatterns: Array<{ area: FailureArea; patterns: RegExp[] }> = [
  { area: 'budget_external', patterns: [/budget|price|pricing|cost|fee|commercial|too expensive|lower bid|견적|예산|가격|비용|단가|금액/u] },
  { area: 'schedule_external', patterns: [/timeline|schedule mismatch|schedule|deadline|duration|delivery date|일정|스케줄|기간|납기|마감/u] },
  { area: 'procurement_external', patterns: [/procurement|purchasing|tender|bid condition|client internal decision|internal decision|incumbent|relationship|political|contract scope|조달|구매|입찰|내부 결정|내부 사정|기존 업체|기존 대행사|인컴번트|관계|정치|계약 범위|발주처 사정/u] },
  { area: 'concept', patterns: [/concept|big idea|creative idea|core idea|theme|콘셉트|컨셉|핵심 아이디어|테마/u] },
  { area: 'strategy', patterns: [/strategy|strategic|thesis|storytelling|story|logic|positioning|rfp mismatch|requirements not addressed|전략|스토리|논리|방향성|포지셔닝|요구.*미반영|제안 근거/u] },
  { area: 'structure', patterns: [/structure|flow|outline|order|sequence|table of contents|narrative flow|deck flow|구조|흐름|목차|순서|구성|전개/u] },
  { area: 'content', patterns: [/content|program|generic|insufficient evidence|evidence|proof|detail|콘텐츠|컨텐츠|프로그램|일반적|평범|근거|증빙|세부/u] },
  { area: 'design', patterns: [/design|visual|look and feel|tone and manner|layout|graphic|디자인|비주얼|시각|톤앤매너|레이아웃|그래픽/u] },
  { area: 'execution', patterns: [/execution|feasibility|production|implementation|staffing|risk|delivery|실행|실행력|실현|제작|구현|인력|리스크|수행/u] },
  { area: 'operation', patterns: [/operation|maintenance|runbook|staffing plan|운영|유지보수|관리|운영계획/u] },
  { area: 'differentiation', patterns: [/differentiat|distinction|distinct|competitive|unique|me-too|차별|구분|고유|독창|경쟁/u] },
];

const externalFailureAreas = new Set<FailureArea>(['budget_external', 'schedule_external', 'procurement_external']);

const defaultUsabilityFlags: ProposalPatternUsabilityFlags = {
  can_use_for_structure: true,
  can_use_for_concept: true,
  can_use_for_strategy: true,
  can_use_for_content: true,
  can_use_for_design: true,
  can_use_for_execution: true,
  can_use_for_operation: true,
};

function normalize(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function uniqueFailureAreas(areas: FailureArea[]) {
  return Array.from(new Set(areas));
}

export function classifyOutcomeReason(outcome?: string | null, reason?: string | null, explicitType?: string | null): OutcomeReasonType {
  if (explicitType === 'external' || explicitType === 'quality' || explicitType === 'mixed' || explicitType === 'unknown') return explicitType;
  if (outcome !== 'lost') return 'unknown';

  const text = normalize(reason);
  if (!text) return 'unknown';

  const hasExternal = externalPatterns.some((pattern) => pattern.test(text));
  const hasQuality = qualityPatterns.some((pattern) => pattern.test(text));

  if (hasExternal && hasQuality) return 'mixed';
  if (hasExternal) return 'external';
  if (hasQuality) return 'quality';
  return 'unknown';
}

export function classifyFailureAreas(outcome?: string | null, reason?: string | null): FailureArea[] {
  if (outcome !== 'lost') return [];

  const text = normalize(reason);
  if (!text) return ['unknown'];

  const areas = failureAreaPatterns
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)))
    .map(({ area }) => area);

  return areas.length ? uniqueFailureAreas(areas) : ['unknown'];
}

export function resolveFailureAreasFromMetadata(metadata: JsonValue | null | undefined): FailureArea[] {
  const object = getJsonObject(metadata);
  const value = object?.failureAreas;
  if (!Array.isArray(value)) return [];
  const allowed = new Set<FailureArea>([
    'concept', 'strategy', 'structure', 'content', 'design', 'execution', 'operation', 'differentiation', 'budget_external', 'schedule_external', 'procurement_external', 'unknown',
  ]);
  return uniqueFailureAreas(value.filter((item): item is FailureArea => typeof item === 'string' && allowed.has(item as FailureArea)));
}

export function getProposalPatternUsabilityFlags(failureAreas: FailureArea[] = []): ProposalPatternUsabilityFlags {
  const flags = { ...defaultUsabilityFlags };
  const qualityAreas = failureAreas.filter((area) => !externalFailureAreas.has(area) && area !== 'unknown');

  if (!qualityAreas.length) return flags;

  if (failureAreas.includes('content')) flags.can_use_for_content = false;
  if (failureAreas.includes('concept')) flags.can_use_for_concept = false;
  if (failureAreas.includes('strategy')) flags.can_use_for_strategy = false;
  if (failureAreas.includes('structure')) flags.can_use_for_structure = false;
  if (failureAreas.includes('design')) flags.can_use_for_design = false;
  if (failureAreas.includes('execution')) flags.can_use_for_execution = false;
  if (failureAreas.includes('operation')) flags.can_use_for_operation = false;

  return flags;
}

export function getJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function getOutcomeReasonTypeFromMetadata(metadata: JsonValue | null | undefined) {
  const object = getJsonObject(metadata);
  const value = object?.outcomeReasonType ?? object?.proposalOutcomeReasonType;
  return typeof value === 'string' ? classifyOutcomeReason('lost', null, value) : null;
}

export function buildAvoidanceRuleFromOutcomeReason(reason?: string | null, reasonType?: OutcomeReasonType, failureAreas: FailureArea[] = []): string | null {
  const normalized = normalize(reason);
  if (!normalized || (reasonType !== 'quality' && reasonType !== 'mixed')) return null;

  if (failureAreas.includes('differentiation') || /구분|차별|distinct|differentiat/i.test(normalized)) {
    return 'Do not rely only on a single integrated motif. Make each entity, content item, product, zone, or audience role visibly distinguishable through role, message, experience, and proof.';
  }
  if (failureAreas.includes('content') || /일반|generic|평범|콘텐츠|content/i.test(normalized)) {
    return 'Avoid generic content lists. Tie each content item to a specific audience need, client objective, evaluation criterion, and proof point.';
  }
  if (failureAreas.includes('operation') || failureAreas.includes('execution') || /운영|실행|feasib|operation|staff|schedule|risk/i.test(normalized)) {
    return 'Include execution feasibility, staffing or responsibility logic, schedule, and risk response near the proof or operation section when they support the thesis.';
  }
  if (failureAreas.includes('concept') || /콘셉트|컨셉|concept/i.test(normalized)) {
    return 'Do not introduce the concept before enough rationale. Derive the concept from the current RFP strategic tension, audience barrier, client objective, and proof logic.';
  }
  if (failureAreas.includes('strategy') || /전략|story|스토리|thesis|설득/i.test(normalized)) {
    return 'Make the proposal thesis explicit before execution details, and ensure every major slide explains why it exists in the argument.';
  }
  if (/요구|requirement|미반영|missing/i.test(normalized)) {
    return 'Map RFP requirements and evaluation priorities into the outline so required scope is addressed with evidence rather than assumed.';
  }
  return 'Use this lost proposal reason as a quality anti-pattern only: avoid repeating the cited weakness, and translate it into current-RFP-specific strategy, differentiation, evidence, and feasibility checks.';
}
