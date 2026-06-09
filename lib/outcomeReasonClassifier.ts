import type { JsonValue } from './dbTypes';

export type OutcomeReasonType = 'external' | 'quality' | 'mixed' | 'unknown';

const externalPatterns = [
  /budget|price|cost|fee|commercial|procurement|purchasing|tender condition|client internal decision|internal decision|incumbent agency|incumbent|timeline|schedule mismatch|schedule|contract scope|relationship factor|relationship|political factor|politic|evaluation outside proposal quality|evaluation outside proposal/i,
  /예산|가격|비용|견적|단가|조달|구매|입찰 조건|내부 결정|내부 사정|기존 업체|기존 대행사|인컴번트|일정|스케줄|기간|계약 범위|관계|정치|외부 요인|외부요인|발주처 사정/u,
];

const qualityPatterns = [
  /weak concept|weak differentiation|generic content|unclear strategy|weak feasibility|missing operation plan|missing operation|rfp mismatch|requirements not addressed|poor design direction|poor design|weak storytelling|insufficient evidence|unclear company\/product distinction|unclear distinction|proposal quality/i,
  /콘셉트.*약|컨셉.*약|차별.*부족|차별.*약|구분.*되지|구분.*부족|전략.*불명확|전략.*약|일반적|평범|실행력.*부족|실행 가능.*부족|운영.*부족|요구.*미반영|디자인.*약|스토리.*약|근거.*부족|증빙.*부족|품질|완성도|설득.*부족/u,
];

function normalize(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
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

export function getJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function getOutcomeReasonTypeFromMetadata(metadata: JsonValue | null | undefined) {
  const object = getJsonObject(metadata);
  const value = object?.outcomeReasonType ?? object?.proposalOutcomeReasonType;
  return typeof value === 'string' ? classifyOutcomeReason('lost', null, value) : null;
}

export function buildAvoidanceRuleFromOutcomeReason(reason?: string | null, reasonType?: OutcomeReasonType): string | null {
  const normalized = normalize(reason);
  if (!normalized || (reasonType !== 'quality' && reasonType !== 'mixed')) return null;

  if (/구분|차별|distinct|differentiat/i.test(normalized)) {
    return 'Do not rely only on a single integrated motif. Make each entity, content item, product, zone, or audience role visibly distinguishable through role, message, experience, and proof.';
  }
  if (/일반|generic|평범|콘텐츠|content/i.test(normalized)) {
    return 'Avoid generic content lists. Tie each content item to a specific audience need, client objective, evaluation criterion, and proof point.';
  }
  if (/운영|실행|feasib|operation|staff|schedule|risk/i.test(normalized)) {
    return 'Include execution feasibility, staffing or responsibility logic, schedule, and risk response near the proof or operation section when they support the thesis.';
  }
  if (/콘셉트|컨셉|concept/i.test(normalized)) {
    return 'Do not introduce the concept before enough rationale. Derive the concept from the current RFP strategic tension, audience barrier, client objective, and proof logic.';
  }
  if (/전략|story|스토리|thesis|설득/i.test(normalized)) {
    return 'Make the proposal thesis explicit before execution details, and ensure every major slide explains why it exists in the argument.';
  }
  if (/요구|requirement|미반영|missing/i.test(normalized)) {
    return 'Map RFP requirements and evaluation priorities into the outline so required scope is addressed with evidence rather than assumed.';
  }
  return 'Use this lost proposal reason as a quality anti-pattern only: avoid repeating the cited weakness, and translate it into current-RFP-specific strategy, differentiation, evidence, and feasibility checks.';
}
