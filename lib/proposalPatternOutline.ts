import 'server-only';

import { getSupabaseConfigState } from './supabase';
import { buildAvoidanceRuleFromOutcomeReason, classifyFailureAreas, classifyOutcomeReason, getOutcomeReasonTypeFromMetadata, resolveFailureAreasFromMetadata, type FailureArea, type OutcomeReasonType } from './outcomeReasonClassifier';
import type { JsonValue, ProposalPatternRecord } from './dbTypes';
import type { PatternLearningSummary } from './types';

export interface OutlineProposalPattern {
  pattern_type: string | null;
  slide_role: string | null;
  narrative_stage: string | null;
  reusable_principle: string;
  why_it_matters: string | null;
  relation_to_concept: string | null;
  relation_to_proposal_thesis: string | null;
  before_slide_role: string | null;
  after_slide_role: string | null;
  outcome: string | null;
  outcome_reason: string | null;
  outcome_reason_type: OutcomeReasonType;
  failure_areas: FailureArea[];
  can_use_for_structure: boolean;
  pattern_reference_type: 'positive' | 'neutral' | 'caution' | 'anti_pattern';
}

export interface ProposalPatternRetrievalSummary {
  wonStructureCount: number;
  lostExternalStructureCount: number;
  unknownStructureCount: number;
  lostMixedCautionCount: number;
  lostQualityAvoidanceRuleCount: number;
  lostUsableStructureCount: number;
}

// A safe, structured won-vs-lost comparison derived ONLY from existing columns of the CURRENT project's own uploaded
// reference proposals. It is advisory structure/logic guidance — it must never override the current RFP, selected
// strategic direction, or final concept, and it carries NO old proposal copy (all text is name/file scrubbed).
export interface SuccessPatternItem {
  slideRole: string | null;
  narrativeStage: string | null;
  principle: string;
}
export interface ProposalSuccessPatternComparison {
  similarWinningPatterns: SuccessPatternItem[];
  similarLosingPatterns: Array<{ slideRole: string | null; narrativeStage: string | null; failureAreas: FailureArea[]; risk: string }>;
  winningDifferentiators: string[];
  losingRisksToAvoid: string[];
  recommendedPatternToApply: string | null;
  contentPatternToApply: string | null;
  proofPatternToApply: string | null;
  confidence: 'high' | 'medium' | 'low';
  evidenceSource: { wonCount: number; lostQualityCount: number; lostExternalCount: number; typeMatchedCount: number; sameProjectOnly: true };
}
export interface RetrievedProposalPatternGuidance {
  patterns: OutlineProposalPattern[];
  avoidanceRules: string[];
  summary: ProposalPatternRetrievalSummary;
  comparison: ProposalSuccessPatternComparison;
}

interface ProposalPatternWithSourceMetadata extends ProposalPatternRecord {
  documents?: {
    file_name?: string | null;
    metadata?: JsonValue | null;
  } | null;
  projects?: {
    name?: string | null;
    client_name?: string | null;
    proposal_type?: string | null;
  } | null;
}

export interface RetrieveProposalPatternsForOutlineOptions {
  limit?: number;
  antiPatternLimit?: number;
  // Outline-stage scoping: proposal_patterns are used only when scoped to the CURRENT project's own uploaded reference
  // proposals. When neither is provided (no scope available), the global read is SKIPPED — orphaned / other-project
  // patterns must never influence the current outline (generic structural principles are used instead).
  projectId?: string | null;
  documentIds?: string[];
  // Current proposal type (user-selected/inferred). Used only as a soft similarity signal for the success-pattern
  // comparison — never as a hard filter, since the patterns are already scoped to this project's own uploads.
  currentProposalType?: string | null;
}

const defaultPatternLimit = 16;
const defaultAntiPatternLimit = 10;
const maxCandidateLimit = 120;
const usefulNarrativeStages = new Set(['context', 'intro', 'problem', 'insight', 'strategy', 'concept', 'experience', 'content', 'proof', 'operation', 'credential', 'closing']);
const usefulSlideRoles = new Set([
  'cover', 'table_of_contents', 'project_context', 'core_problem', 'audience_insight', 'case_insight', 'strategic_opportunity', 'concept_rationale', 'content_keyword', 'core_concept', 'visitor_journey', 'spatial_strategy', 'hero_experience', 'key_media_scene', 'content_detail', 'company_credential', 'team_credential', 'schedule', 'operation_plan', 'execution_plan', 'impact_summary', 'closing',
]);

const noisyTextPattern = /\b(?:ALL\s+RIGHTS\s+RESERVED|COPYRIGHT|CONFIDENTIAL)\b|(?:^|[\s/\\])[^\s/\\]+\.(?:jpe?g|png|pdf|pptx?|key|gif|svg|webp)(?:\b|$)/i;
const rawFileNamePattern = /(?:^|\s)[\w가-힣().\-[\]]{3,}\.(?:jpe?g|png|pdf|pptx?|key|gif|svg|webp)(?:\s|$)/i;
const meaninglessPrinciplePattern = /^(?:n\/?a|none|null|undefined|untitled|slide|copy|image|page|text|proposal|제안서|슬라이드|페이지|이미지|텍스트|없음|미정)$/i;

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function getJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function collectMetadataStrings(value: JsonValue | null | undefined, keys: string[] = []): string[] {
  const object = getJsonObject(value);
  if (!object) return [];
  return keys.map((key) => object[key]).filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function collectSourceNames(pattern: ProposalPatternWithSourceMetadata) {
  const names = [
    pattern.documents?.file_name,
    pattern.projects?.name,
    pattern.projects?.client_name,
    ...collectMetadataStrings(pattern.documents?.metadata, ['originalFileName', 'clientName', 'projectName', 'name']),
    ...collectMetadataStrings(pattern.metadata, ['originalFileName', 'clientName', 'projectName', 'sourceName']),
  ];
  const originalChunkMetadata = getJsonObject(pattern.metadata)?.originalChunkMetadata;
  names.push(...collectMetadataStrings(originalChunkMetadata, ['originalFileName', 'clientName', 'projectName', 'sourceName', 'slideTitle']));
  return Array.from(new Set(names.map((name) => normalizeText(name)).filter((name) => name.length >= 3)));
}

function containsNoisyText(value: string | null | undefined) {
  const text = normalizeText(value);
  return Boolean(text && (noisyTextPattern.test(text) || rawFileNamePattern.test(text)));
}

function containsSourceName(value: string | null | undefined, sourceNames: string[]) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return sourceNames.some((sourceName) => {
    const normalized = sourceName.toLowerCase();
    const baseName = normalized.replace(/\.[^.]+$/, '').trim();
    return normalized.length >= 3 && (text.includes(normalized) || (baseName.length >= 3 && text.includes(baseName)));
  });
}

function isUsefulPrinciple(value: string | null | undefined, sourceNames: string[]) {
  const principle = normalizeText(value);
  if (principle.length < 24) return false;
  if (!/[a-zA-Z가-힣]/.test(principle)) return false;
  if (meaninglessPrinciplePattern.test(principle)) return false;
  if (containsNoisyText(principle)) return false;
  if (containsSourceName(principle, sourceNames)) return false;
  return true;
}

function hasUsefulStageOrRole(pattern: ProposalPatternRecord) {
  const stage = normalizeText(pattern.narrative_stage).toLowerCase();
  const role = normalizeText(pattern.slide_role).toLowerCase();
  return usefulNarrativeStages.has(stage) || usefulSlideRoles.has(role);
}

function sanitizeField(value: string | null | undefined, sourceNames: string[]) {
  const text = normalizeText(value);
  if (!text) return null;
  if (containsNoisyText(text)) return null;
  if (containsSourceName(text, sourceNames)) return null;
  return text;
}

function getMetadataString(value: JsonValue | null | undefined, keys: string[]) {
  const object = getJsonObject(value);
  if (!object) return '';
  for (const key of keys) {
    const item = object[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function resolvedOutcome(pattern: ProposalPatternWithSourceMetadata) {
  const outcome = normalizeText(pattern.outcome) || getMetadataString(pattern.metadata, ['outcome', 'proposalOutcome']) || getMetadataString(pattern.documents?.metadata, ['outcome', 'proposalOutcome']);
  return outcome === 'won' || outcome === 'lost' || outcome === 'unknown' ? outcome : outcome ? 'unknown' : null;
}

function resolvedOutcomeReason(pattern: ProposalPatternWithSourceMetadata) {
  return normalizeText(pattern.outcome_reason) || getMetadataString(pattern.metadata, ['outcomeReason', 'proposalOutcomeReason']) || getMetadataString(pattern.documents?.metadata, ['outcomeReason', 'proposalOutcomeReason']);
}

function outcomeReasonType(pattern: ProposalPatternWithSourceMetadata): OutcomeReasonType {
  const columnType = normalizeText(pattern.outcome_reason_type);
  const patternMetadataType = getOutcomeReasonTypeFromMetadata(pattern.metadata);
  const documentMetadataType = getOutcomeReasonTypeFromMetadata(pattern.documents?.metadata);
  return classifyOutcomeReason(resolvedOutcome(pattern), resolvedOutcomeReason(pattern), columnType || patternMetadataType || documentMetadataType);
}


function resolvedFailureAreas(pattern: ProposalPatternWithSourceMetadata): FailureArea[] {
  if (Array.isArray(pattern.failure_areas) && pattern.failure_areas.every((area) => typeof area === 'string')) {
    return pattern.failure_areas as FailureArea[];
  }
  const patternMetadataAreas = resolveFailureAreasFromMetadata(pattern.metadata);
  if (patternMetadataAreas.length) return patternMetadataAreas;
  const documentMetadataAreas = resolveFailureAreasFromMetadata(pattern.documents?.metadata);
  if (documentMetadataAreas.length) return documentMetadataAreas;
  return classifyFailureAreas(resolvedOutcome(pattern), resolvedOutcomeReason(pattern));
}

function getMetadataBoolean(value: JsonValue | null | undefined, keys: string[]) {
  const object = getJsonObject(value);
  if (!object) return null;
  for (const key of keys) {
    const item = object[key];
    if (typeof item === 'boolean') return item;
  }
  return null;
}

function canUsePatternForStructure(pattern: ProposalPatternWithSourceMetadata) {
  if (typeof pattern.can_use_for_structure === 'boolean') return pattern.can_use_for_structure;
  const metadataValue = getMetadataBoolean(pattern.metadata, ['canUseForStructure', 'can_use_for_structure']);
  if (metadataValue !== null) return metadataValue;
  const outcome = resolvedOutcome(pattern);
  if (outcome !== 'lost') return true;
  return !resolvedFailureAreas(pattern).includes('structure');
}

function patternReferenceType(outcome: string | null | undefined, type: OutcomeReasonType, canUseForStructure = true): OutlineProposalPattern['pattern_reference_type'] {
  if (outcome === 'won') return 'positive';
  if (outcome === 'lost' && type === 'external') return 'positive';
  if (outcome === 'lost' && type === 'mixed') return canUseForStructure ? 'caution' : 'anti_pattern';
  if (outcome === 'lost' && type === 'quality') return canUseForStructure ? 'caution' : 'anti_pattern';
  return 'neutral';
}

function retrievalPriority(pattern: ProposalPatternWithSourceMetadata) {
  const type = outcomeReasonType(pattern);
  const outcome = resolvedOutcome(pattern);
  if (outcome === 'won') return 5;
  if (outcome === 'lost' && type === 'external') return 4;
  if (outcome === 'unknown' || !outcome) return 3;
  if (outcome === 'lost' && type === 'mixed') return canUsePatternForStructure(pattern) ? 2 : 0;
  if (outcome === 'lost' && type === 'quality') return canUsePatternForStructure(pattern) ? 2 : 0;
  return 1;
}

export function filterProposalPatternsForOutline(patterns: ProposalPatternRecord[] = [], limit = defaultPatternLimit): OutlineProposalPattern[] {
  const safeLimit = Math.max(1, Math.min(20, limit));
  const grouped = new Map<string, OutlineProposalPattern[]>();

  for (const pattern of patterns as ProposalPatternWithSourceMetadata[]) {
    const type = outcomeReasonType(pattern);
    const outcome = resolvedOutcome(pattern);
    const reason = resolvedOutcomeReason(pattern);
    const canUseForStructure = canUsePatternForStructure(pattern);
    if (outcome === 'lost' && !canUseForStructure) continue;

    const sourceNames = collectSourceNames(pattern);
    const reusablePrinciple = normalizeText(pattern.reusable_principle);
    if (!isUsefulPrinciple(reusablePrinciple, sourceNames)) continue;
    if (!['high', 'medium'].includes(normalizeText(pattern.confidence).toLowerCase())) continue;
    if (!hasUsefulStageOrRole(pattern)) continue;

    const safePattern: OutlineProposalPattern = {
      pattern_type: sanitizeField(pattern.pattern_type, sourceNames),
      slide_role: sanitizeField(pattern.slide_role, sourceNames),
      narrative_stage: sanitizeField(pattern.narrative_stage, sourceNames),
      reusable_principle: reusablePrinciple,
      why_it_matters: sanitizeField(pattern.why_it_matters, sourceNames),
      relation_to_concept: sanitizeField(pattern.relation_to_concept, sourceNames),
      relation_to_proposal_thesis: sanitizeField(pattern.relation_to_proposal_thesis, sourceNames),
      before_slide_role: sanitizeField(pattern.before_slide_role, sourceNames),
      after_slide_role: sanitizeField(pattern.after_slide_role, sourceNames),
      outcome: sanitizeField(outcome, sourceNames),
      outcome_reason: sanitizeField(reason, sourceNames),
      outcome_reason_type: type,
      failure_areas: resolvedFailureAreas(pattern),
      can_use_for_structure: canUseForStructure,
      pattern_reference_type: patternReferenceType(outcome, type, canUseForStructure),
    };

    const groupKey = `${retrievalPriority(pattern)}:${safePattern.narrative_stage || safePattern.slide_role || 'other'}`;
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), safePattern]);
  }

  const selected: OutlineProposalPattern[] = [];
  const groups = Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([, group]) => group);
  while (selected.length < safeLimit && groups.some((group) => group.length > 0)) {
    for (const group of groups) {
      const next = group.shift();
      if (next) selected.push(next);
      if (selected.length >= safeLimit) break;
    }
  }
  return selected;
}

function extractAvoidanceRules(patterns: ProposalPatternRecord[] = [], limit = defaultAntiPatternLimit) {
  const rules = new Set<string>();
  for (const pattern of patterns as ProposalPatternWithSourceMetadata[]) {
    const type = outcomeReasonType(pattern);
    const outcome = resolvedOutcome(pattern);
    if (outcome !== 'lost' || (type !== 'quality' && type !== 'mixed')) continue;
    const sourceNames = collectSourceNames(pattern);
    const reason = sanitizeField(resolvedOutcomeReason(pattern), sourceNames);
    const rule = buildAvoidanceRuleFromOutcomeReason(reason, type, resolvedFailureAreas(pattern));
    if (rule) rules.add(rule);
    if (rules.size >= limit) break;
  }
  return Array.from(rules);
}

function sortPatternCandidates(patterns: ProposalPatternRecord[]) {
  return [...patterns].sort((a, b) => {
    const confidenceScore = (pattern: ProposalPatternRecord) => (pattern.confidence === 'high' ? 2 : pattern.confidence === 'medium' ? 1 : 0);
    const usefulScore = (pattern: ProposalPatternRecord) => (hasUsefulStageOrRole(pattern) ? 1 : 0);
    const dateA = Date.parse(a.created_at || '') || 0;
    const dateB = Date.parse(b.created_at || '') || 0;
    return retrievalPriority(b as ProposalPatternWithSourceMetadata) - retrievalPriority(a as ProposalPatternWithSourceMetadata) || confidenceScore(b) - confidenceScore(a) || usefulScore(b) - usefulScore(a) || dateB - dateA;
  });
}

function summarize(patterns: OutlineProposalPattern[], avoidanceRules: string[]): ProposalPatternRetrievalSummary {
  return {
    wonStructureCount: patterns.filter((pattern) => pattern.outcome === 'won').length,
    lostExternalStructureCount: patterns.filter((pattern) => pattern.outcome === 'lost' && pattern.outcome_reason_type === 'external').length,
    unknownStructureCount: patterns.filter((pattern) => pattern.outcome === 'unknown' || !pattern.outcome).length,
    lostMixedCautionCount: patterns.filter((pattern) => pattern.outcome === 'lost' && pattern.outcome_reason_type === 'mixed').length,
    lostQualityAvoidanceRuleCount: avoidanceRules.length,
    lostUsableStructureCount: patterns.filter((pattern) => pattern.outcome === 'lost' && pattern.can_use_for_structure).length,
  };
}

const CONTENT_PATTERN_ROLES = new Set(['hero_experience', 'key_media_scene', 'content_detail', 'spatial_strategy', 'visitor_journey']);
const PROOF_PATTERN_ROLES = new Set(['impact_summary', 'company_credential', 'team_credential', 'execution_plan', 'operation_plan']);

function patternProjectType(pattern: ProposalPatternWithSourceMetadata): string {
  return normalizeText(pattern.projects?.proposal_type).toLowerCase();
}

function emptyComparison(): ProposalSuccessPatternComparison {
  return {
    similarWinningPatterns: [], similarLosingPatterns: [], winningDifferentiators: [], losingRisksToAvoid: [],
    recommendedPatternToApply: null, contentPatternToApply: null, proofPatternToApply: null,
    confidence: 'low', evidenceSource: { wonCount: 0, lostQualityCount: 0, lostExternalCount: 0, typeMatchedCount: 0, sameProjectOnly: true },
  };
}

// Built from the RAW sorted records so every column (can_use_for_content/execution/operation, projects.proposal_type)
// is available — the structure-only OutlineProposalPattern filter drops those. All text is name/file scrubbed.
function buildSuccessPatternComparison(sorted: ProposalPatternWithSourceMetadata[], avoidanceRules: string[], currentProposalType?: string | null): ProposalSuccessPatternComparison {
  const currentType = normalizeText(currentProposalType).toLowerCase();
  const usable = sorted.filter((pattern) => isUsefulPrinciple(normalizeText(pattern.reusable_principle), collectSourceNames(pattern)) && ['high', 'medium'].includes(normalizeText(pattern.confidence).toLowerCase()));
  const isPositive = (pattern: ProposalPatternWithSourceMetadata) => resolvedOutcome(pattern) === 'won' || (resolvedOutcome(pattern) === 'lost' && outcomeReasonType(pattern) === 'external');
  const isQualityLoss = (pattern: ProposalPatternWithSourceMetadata) => resolvedOutcome(pattern) === 'lost' && (outcomeReasonType(pattern) === 'quality' || outcomeReasonType(pattern) === 'mixed');
  const won = usable.filter(isPositive);
  const lostQuality = usable.filter(isQualityLoss);
  if (!won.length && !lostQuality.length) return emptyComparison();

  const principleOf = (pattern: ProposalPatternWithSourceMetadata) => sanitizeField(normalizeText(pattern.reusable_principle), collectSourceNames(pattern)) || '';
  const toItem = (pattern: ProposalPatternWithSourceMetadata): SuccessPatternItem => ({ slideRole: sanitizeField(pattern.slide_role, collectSourceNames(pattern)), narrativeStage: sanitizeField(pattern.narrative_stage, collectSourceNames(pattern)), principle: principleOf(pattern) });

  const similarWinningPatterns = won.map(toItem).filter((item) => item.principle).slice(0, 8);
  const similarLosingPatterns = lostQuality.slice(0, 6).map((pattern) => ({ slideRole: sanitizeField(pattern.slide_role, collectSourceNames(pattern)), narrativeStage: sanitizeField(pattern.narrative_stage, collectSourceNames(pattern)), failureAreas: resolvedFailureAreas(pattern), risk: sanitizeField(resolvedOutcomeReason(pattern), collectSourceNames(pattern)) || '' }));

  const lostRoles = new Set(lostQuality.map((pattern) => normalizeText(pattern.slide_role).toLowerCase()).filter(Boolean));
  const winningDifferentiators = Array.from(new Set(won.filter((pattern) => lostRoles.has(normalizeText(pattern.slide_role).toLowerCase())).map(principleOf).filter(Boolean))).slice(0, 5);
  const losingRisksToAvoid = Array.from(new Set([...avoidanceRules, ...lostQuality.flatMap((pattern) => resolvedFailureAreas(pattern))])).slice(0, 8);

  const contentWon = won.find((pattern) => CONTENT_PATTERN_ROLES.has(normalizeText(pattern.slide_role).toLowerCase()) && pattern.can_use_for_content !== false);
  const proofWon = won.find((pattern) => (normalizeText(pattern.narrative_stage).toLowerCase() === 'proof' || PROOF_PATTERN_ROLES.has(normalizeText(pattern.slide_role).toLowerCase())) && (pattern.can_use_for_execution !== false || pattern.can_use_for_operation !== false));

  const typeMatchedCount = currentType ? usable.filter((pattern) => patternProjectType(pattern) === currentType).length : 0;
  const lostExternalCount = usable.filter((pattern) => resolvedOutcome(pattern) === 'lost' && outcomeReasonType(pattern) === 'external').length;
  const confidence: 'high' | 'medium' | 'low' = won.length >= 2 && typeMatchedCount >= 1 ? 'high' : won.length >= 1 ? 'medium' : 'low';

  return {
    similarWinningPatterns,
    similarLosingPatterns,
    winningDifferentiators,
    losingRisksToAvoid,
    recommendedPatternToApply: similarWinningPatterns[0]?.principle ?? null,
    contentPatternToApply: contentWon ? (principleOf(contentWon) || null) : null,
    proofPatternToApply: proofWon ? (principleOf(proofWon) || null) : null,
    confidence,
    evidenceSource: { wonCount: won.length, lostQualityCount: lostQuality.length, lostExternalCount, typeMatchedCount, sameProjectOnly: true },
  };
}

export function formatProposalSuccessPatternComparisonForPrompt(comparison: ProposalSuccessPatternComparison): string {
  if (!comparison.similarWinningPatterns.length && !comparison.similarLosingPatterns.length) {
    return '수주 패턴 비교 데이터 없음 — 현재 RFP/선택 전략 방향/최종 컨셉 근거만 사용한다.';
  }
  const lines: string[] = [];
  if (comparison.similarWinningPatterns.length) lines.push(`수주 제안 구조 패턴(참고): ${comparison.similarWinningPatterns.map((p) => `[${p.narrativeStage || p.slideRole || '구조'}] ${p.principle}`).join(' / ')}`);
  if (comparison.winningDifferentiators.length) lines.push(`수주를 만든 차별 포인트: ${comparison.winningDifferentiators.join(' / ')}`);
  if (comparison.similarLosingPatterns.length) lines.push(`미수주 약점 패턴(반복 금지, 리스크 경고로만): ${comparison.similarLosingPatterns.map((p) => `[${p.narrativeStage || p.slideRole || '구조'}] ${[p.risk, p.failureAreas.join(',')].filter(Boolean).join(' · ') || '약한 구조'}`).join(' / ')}`);
  if (comparison.losingRisksToAvoid.length) lines.push(`미수주 회피 리스크(반복 금지, 리스크 경고로만 사용): ${comparison.losingRisksToAvoid.join(' / ')}`);
  if (comparison.recommendedPatternToApply) lines.push(`적용 권장 구조 패턴: ${comparison.recommendedPatternToApply}`);
  if (comparison.contentPatternToApply) lines.push(`콘텐츠/미디어 적용 패턴(컨셉 선언 이후 콘텐츠 페이지에 구체화): ${comparison.contentPatternToApply}`);
  if (comparison.proofPatternToApply) lines.push(`증명/실행 신뢰 패턴: ${comparison.proofPatternToApply}`);
  lines.push(`신뢰도: ${comparison.confidence} · 근거: 수주 ${comparison.evidenceSource.wonCount} / 품질 미수주 ${comparison.evidenceSource.lostQualityCount} / 유형 일치 ${comparison.evidenceSource.typeMatchedCount} (현재 프로젝트 업로드 레퍼런스 한정)`);
  lines.push('주의: 위 패턴은 구조·논리 참고용이다. 현재 RFP·선택 전략 방향·최종 컨셉명/슬로건·RFP 위계를 절대 덮어쓰지 않는다. 과거 제안의 컨셉명/슬로건/원문/클라이언트명/프로젝트명을 복사하지 않는다.');
  return lines.join('\n');
}

// Concept-naming-framed winning-pattern influence (Priority 4). Surfaces the won concept-logic STRUCTURE (problem
// reframing → strategy → concept emergence, content-after-concept, proof) so naming can apply a proven logic pattern —
// structure only, never copying old names/slogans/copy, and never overriding the current RFP / direction / frame.
export function formatWinningPatternInfluenceForConceptNaming(comparison: ProposalSuccessPatternComparison): string {
  if (!comparison.similarWinningPatterns.length && !comparison.similarLosingPatterns.length) {
    return '수주 패턴 비교 데이터 없음 — 현재 RFP·선택 전략 방향·Concept Frame Synthesis 근거만 사용한다(수주 패턴을 가정하지 말 것).';
  }
  const conceptStage = comparison.similarWinningPatterns.find((p) => /concept|rationale|strategy|개념|컨셉|전략/.test(`${p.narrativeStage || ''} ${p.slideRole || ''}`.toLowerCase()))?.principle || comparison.recommendedPatternToApply;
  const lines: string[] = ['=== Winning Pattern Influence (Priority 4 — 컨셉 로직 구조 참고용. 과거 제안의 이름/슬로건/원문/카피를 복사하지 말고 논리 구조만 참고) ==='];
  if (conceptStage) lines.push(`수주 컨셉 도출 로직(문제 재정의 → 전략 → 컨셉 전환): ${conceptStage}`);
  if (comparison.winningDifferentiators.length) lines.push(`수주를 만든 차별 로직: ${comparison.winningDifferentiators.join(' / ')}`);
  if (comparison.contentPatternToApply) lines.push(`수주 콘텐츠 전개 패턴(컨셉 이후): ${comparison.contentPatternToApply}`);
  if (comparison.proofPatternToApply) lines.push(`수주 증명 패턴: ${comparison.proofPatternToApply}`);
  if (comparison.losingRisksToAvoid.length) lines.push(`회피할 미수주 약점(리스크 경고로만, 긍정 영감 금지): ${comparison.losingRisksToAvoid.join(' / ')}`);
  lines.push(`신뢰도: ${comparison.confidence} · 근거: 수주 ${comparison.evidenceSource.wonCount} / 유형 일치 ${comparison.evidenceSource.typeMatchedCount} (현재 프로젝트 업로드 레퍼런스 한정)`);
  lines.push('요구: 최소 1개 후보는 위 수주 컨셉 로직 구조를 현재 RFP·선택 전략 방향에 맞게 적용한다. 단, 과거 제안의 이름/슬로건/카피/클라이언트·프로젝트명을 복사하지 말고 현재 RFP 고유 톤으로 새로 만든다. 이 영향은 현재 RFP·전략 방향·Concept Frame Synthesis·Korean seed→English transcreation 순서를 절대 바꾸지 않는다. 미수주 패턴을 긍정 영감으로 쓰면 거부한다.');
  return lines.join('\n');
}

export function buildPatternLearningSummary(comparison: ProposalSuccessPatternComparison): PatternLearningSummary | null {
  if (!comparison.similarWinningPatterns.length && !comparison.similarLosingPatterns.length) return null;
  return {
    used: true,
    confidence: comparison.confidence,
    winningPatternCount: comparison.similarWinningPatterns.length,
    riskCount: comparison.losingRisksToAvoid.length,
    contentPatternUsed: Boolean(comparison.contentPatternToApply),
    proofPatternUsed: Boolean(comparison.proofPatternToApply),
    recommendedPatternRole: comparison.similarWinningPatterns[0]?.slideRole ?? comparison.similarWinningPatterns[0]?.narrativeStage ?? null,
  };
}

export async function retrieveProposalPatternsForOutline(options: RetrieveProposalPatternsForOutlineOptions = {}): Promise<RetrievedProposalPatternGuidance> {
  const { client } = getSupabaseConfigState();
  const limit = Math.max(1, Math.min(20, options.limit ?? defaultPatternLimit));
  const antiPatternLimit = Math.max(1, Math.min(20, options.antiPatternLimit ?? defaultAntiPatternLimit));

  const documentIds = (options.documentIds ?? []).filter((id): id is string => Boolean(id));
  const hasScope = Boolean(options.projectId) || documentIds.length > 0;
  if (!client || !hasScope) {
    // No Supabase client OR no current project/document scope → do NOT read patterns globally across projects.
    return { patterns: [], avoidanceRules: [], summary: summarize([], []), comparison: emptyComparison() };
  }

  try {
    const baseSelect = '*, documents(file_name, metadata), projects(name, client_name, proposal_type)';
    let query = client
      .from('proposal_patterns')
      .select(baseSelect)
      .not('reusable_principle', 'is', null)
      .neq('reusable_principle', '')
      .in('confidence', ['high', 'medium']);
    // Scope to the current project's own uploaded reference proposals only (prevents cross-project / orphan leakage).
    if (options.projectId) query = query.eq('project_id', options.projectId);
    if (documentIds.length) query = query.in('document_id', documentIds);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(maxCandidateLimit);

    if (error) {
      console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline query failed: ${error.message}`);
      return { patterns: [], avoidanceRules: [], summary: summarize([], []), comparison: emptyComparison() };
    }

    const sorted = sortPatternCandidates((data ?? []) as ProposalPatternRecord[]);
    const patterns = filterProposalPatternsForOutline(sorted, limit);
    const avoidanceRules = extractAvoidanceRules(sorted, antiPatternLimit);
    const comparison = buildSuccessPatternComparison(sorted as ProposalPatternWithSourceMetadata[], avoidanceRules, options.currentProposalType);
    return { patterns, avoidanceRules, summary: summarize(patterns, avoidanceRules), comparison };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline failed: ${message}`);
    return { patterns: [], avoidanceRules: [], summary: summarize([], []), comparison: emptyComparison() };
  }
}

function truncatePromptField(value: string | null | undefined, maxLength = 160) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function isLostQualityPattern(pattern: OutlineProposalPattern) {
  return pattern.outcome === 'lost' && (pattern.outcome_reason_type === 'quality' || pattern.outcome_reason_type === 'mixed');
}

function conceptPatternPriority(pattern: OutlineProposalPattern) {
  if (pattern.outcome === 'won') return 4;
  if (pattern.outcome === 'lost' && pattern.outcome_reason_type === 'external') return 3;
  if (pattern.outcome === 'unknown' || !pattern.outcome) return 2;
  if (isLostQualityPattern(pattern)) return 1;
  return 0;
}

export function formatProposalPatternsForConceptPrompt(patterns: OutlineProposalPattern[], rules: string[] = [], maxPatterns = 8) {
  const safeLimit = Math.max(1, Math.min(8, maxPatterns));
  const ordered = [...patterns]
    .sort((a, b) => conceptPatternPriority(b) - conceptPatternPriority(a))
    .slice(0, safeLimit);

  if (!ordered.length && !rules.length) return '사용 가능한 compact proposal_patterns 없음';

  const compactPatterns = ordered.map((pattern, index) => {
    const avoidanceRule = isLostQualityPattern(pattern)
      ? buildAvoidanceRuleFromOutcomeReason(pattern.why_it_matters || pattern.reusable_principle, pattern.outcome_reason_type, pattern.failure_areas)
      : '';

    if (isLostQualityPattern(pattern)) {
      return {
        pattern_index: index + 1,
        slide_role: truncatePromptField(pattern.slide_role, 60),
        narrative_stage: truncatePromptField(pattern.narrative_stage, 60),
        outcome: pattern.outcome,
        outcome_reason_type: pattern.outcome_reason_type,
        failure_areas: pattern.failure_areas,
        avoidanceRule: truncatePromptField(avoidanceRule || '해당 실패 영역을 반복하지 않도록 콘셉트 근거와 실행 연결을 간결히 검증할 것', 180),
      };
    }

    return {
      pattern_index: index + 1,
      slide_role: truncatePromptField(pattern.slide_role, 60),
      narrative_stage: truncatePromptField(pattern.narrative_stage, 60),
      reusable_principle: truncatePromptField(pattern.reusable_principle, 180),
      why_it_matters: truncatePromptField(pattern.why_it_matters, 160),
      outcome: pattern.outcome,
      outcome_reason_type: pattern.outcome_reason_type,
      failure_areas: pattern.failure_areas,
    };
  });

  const compactAvoidanceRules = rules.slice(0, safeLimit).map((rule, index) => ({
    rule_index: index + 1,
    avoidanceRule: truncatePromptField(rule, 180),
  }));

  return JSON.stringify({ patterns: compactPatterns, antiPatternNotes: compactAvoidanceRules }, null, 2);
}

export function formatProposalPatternsForOutlinePrompt(patterns: OutlineProposalPattern[]) {
  if (!patterns.length) return '사용 가능한 proposal_patterns 없음';
  return JSON.stringify(
    patterns.map((pattern, index) => ({
      pattern_index: index + 1,
      pattern_type: pattern.pattern_type,
      slide_role: pattern.slide_role,
      narrative_stage: pattern.narrative_stage,
      reusable_principle: pattern.reusable_principle,
      why_it_matters: pattern.why_it_matters,
      relation_to_concept: pattern.relation_to_concept,
      relation_to_proposal_thesis: pattern.relation_to_proposal_thesis,
      before_slide_role: pattern.before_slide_role,
      after_slide_role: pattern.after_slide_role,
      outcome: pattern.outcome,
      outcome_reason: pattern.outcome_reason,
      outcome_reason_type: pattern.outcome_reason_type,
      failure_areas: pattern.failure_areas,
      can_use_for_structure: pattern.can_use_for_structure,
    })),
    null,
    2,
  );
}

export function formatProposalAvoidanceRulesForPrompt(rules: string[]) {
  if (!rules.length) return '품질 관련 미수주 회피 규칙 없음';
  return JSON.stringify(rules.map((rule, index) => ({ rule_index: index + 1, avoidance_rule: rule })), null, 2);
}

export function formatProposalPatternDiagnostics(summary: ProposalPatternRetrievalSummary, hasMultipleEntities: boolean) {
  return [
    `참고한 수주 구조 패턴: ${summary.wonStructureCount}개`,
    `참고한 외부요인 미수주 구조 패턴: ${summary.lostExternalStructureCount}개`,
    `참고한 미수주 회피 규칙: ${summary.lostQualityAvoidanceRuleCount}개`,
    `부분 사용 가능한 미수주 구조 패턴: ${summary.lostUsableStructureCount}개`,
    `다중 요소 차별화 감지: ${hasMultipleEntities ? '있음' : '없음'}`,
  ].join('\n');
}
