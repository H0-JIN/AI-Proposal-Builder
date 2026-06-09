import 'server-only';

import { getSupabaseConfigState } from './supabase';
import { buildAvoidanceRuleFromOutcomeReason, classifyOutcomeReason, getOutcomeReasonTypeFromMetadata, type OutcomeReasonType } from './outcomeReasonClassifier';
import type { JsonValue, ProposalPatternRecord } from './dbTypes';

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
  pattern_reference_type: 'positive' | 'neutral' | 'caution' | 'anti_pattern';
}

export interface ProposalPatternRetrievalSummary {
  wonStructureCount: number;
  lostExternalStructureCount: number;
  unknownStructureCount: number;
  lostMixedCautionCount: number;
  lostQualityAvoidanceRuleCount: number;
}

export interface RetrievedProposalPatternGuidance {
  patterns: OutlineProposalPattern[];
  avoidanceRules: string[];
  summary: ProposalPatternRetrievalSummary;
}

interface ProposalPatternWithSourceMetadata extends ProposalPatternRecord {
  documents?: {
    file_name?: string | null;
    metadata?: JsonValue | null;
  } | null;
  projects?: {
    name?: string | null;
    client_name?: string | null;
  } | null;
}

export interface RetrieveProposalPatternsForOutlineOptions {
  limit?: number;
  antiPatternLimit?: number;
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

function patternReferenceType(outcome: string | null | undefined, type: OutcomeReasonType): OutlineProposalPattern['pattern_reference_type'] {
  if (outcome === 'won') return 'positive';
  if (outcome === 'lost' && type === 'external') return 'positive';
  if (outcome === 'lost' && type === 'mixed') return 'caution';
  if (outcome === 'lost' && type === 'quality') return 'anti_pattern';
  return 'neutral';
}

function retrievalPriority(pattern: ProposalPatternWithSourceMetadata) {
  const type = outcomeReasonType(pattern);
  const outcome = resolvedOutcome(pattern);
  if (outcome === 'won') return 5;
  if (outcome === 'lost' && type === 'external') return 4;
  if (outcome === 'unknown' || !outcome) return 3;
  if (outcome === 'lost' && type === 'mixed') return 2;
  if (outcome === 'lost' && type === 'quality') return 0;
  return 1;
}

export function filterProposalPatternsForOutline(patterns: ProposalPatternRecord[] = [], limit = defaultPatternLimit): OutlineProposalPattern[] {
  const safeLimit = Math.max(1, Math.min(20, limit));
  const grouped = new Map<string, OutlineProposalPattern[]>();

  for (const pattern of patterns as ProposalPatternWithSourceMetadata[]) {
    const type = outcomeReasonType(pattern);
    const outcome = resolvedOutcome(pattern);
    const reason = resolvedOutcomeReason(pattern);
    if (outcome === 'lost' && type === 'quality') continue;

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
      pattern_reference_type: patternReferenceType(outcome, type),
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
    const rule = buildAvoidanceRuleFromOutcomeReason(reason, type);
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
  };
}

export async function retrieveProposalPatternsForOutline(options: RetrieveProposalPatternsForOutlineOptions = {}): Promise<RetrievedProposalPatternGuidance> {
  const { client } = getSupabaseConfigState();
  const limit = Math.max(1, Math.min(20, options.limit ?? defaultPatternLimit));
  const antiPatternLimit = Math.max(1, Math.min(20, options.antiPatternLimit ?? defaultAntiPatternLimit));

  if (!client) {
    return { patterns: [], avoidanceRules: [], summary: summarize([], []) };
  }

  try {
    const baseSelect = '*, documents(file_name, metadata), projects(name, client_name)';
    const { data, error } = await client
      .from('proposal_patterns')
      .select(baseSelect)
      .not('reusable_principle', 'is', null)
      .neq('reusable_principle', '')
      .in('confidence', ['high', 'medium'])
      .order('created_at', { ascending: false })
      .limit(maxCandidateLimit);

    if (error) {
      console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline query failed: ${error.message}`);
      return { patterns: [], avoidanceRules: [], summary: summarize([], []) };
    }

    const sorted = sortPatternCandidates((data ?? []) as ProposalPatternRecord[]);
    const patterns = filterProposalPatternsForOutline(sorted, limit);
    const avoidanceRules = extractAvoidanceRules(sorted, antiPatternLimit);
    return { patterns, avoidanceRules, summary: summarize(patterns, avoidanceRules) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline failed: ${message}`);
    return { patterns: [], avoidanceRules: [], summary: summarize([], []) };
  }
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
    `다중 요소 차별화 감지: ${hasMultipleEntities ? '있음' : '없음'}`,
  ].join('\n');
}
