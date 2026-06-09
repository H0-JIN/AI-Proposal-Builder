import 'server-only';

import { getSupabaseConfigState } from './supabase';
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
}

const defaultPatternLimit = 16;
const maxCandidateLimit = 100;
const usefulNarrativeStages = new Set(['context', 'intro', 'problem', 'insight', 'strategy', 'concept', 'experience', 'content', 'proof', 'operation', 'credential', 'closing']);
const usefulSlideRoles = new Set([
  'cover',
  'table_of_contents',
  'project_context',
  'core_problem',
  'audience_insight',
  'case_insight',
  'strategic_opportunity',
  'concept_rationale',
  'content_keyword',
  'core_concept',
  'visitor_journey',
  'spatial_strategy',
  'hero_experience',
  'key_media_scene',
  'content_detail',
  'company_credential',
  'team_credential',
  'schedule',
  'operation_plan',
  'execution_plan',
  'impact_summary',
  'closing',
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

  return keys
    .map((key) => object[key])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
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

export function filterProposalPatternsForOutline(patterns: ProposalPatternRecord[] = [], limit = defaultPatternLimit): OutlineProposalPattern[] {
  const safeLimit = Math.max(1, Math.min(20, limit));
  const grouped = new Map<string, OutlineProposalPattern[]>();

  for (const pattern of patterns as ProposalPatternWithSourceMetadata[]) {
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
      outcome: sanitizeField(pattern.outcome, sourceNames),
    };

    const groupKey = safePattern.narrative_stage || safePattern.slide_role || 'other';
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), safePattern]);
  }

  const selected: OutlineProposalPattern[] = [];
  const groups = Array.from(grouped.values());
  while (selected.length < safeLimit && groups.some((group) => group.length > 0)) {
    for (const group of groups) {
      const next = group.shift();
      if (next) selected.push(next);
      if (selected.length >= safeLimit) break;
    }
  }

  return selected;
}

function sortPatternCandidates(patterns: ProposalPatternRecord[]) {
  return [...patterns].sort((a, b) => {
    const outcomeScore = (pattern: ProposalPatternRecord) => (pattern.outcome === 'won' ? 3 : pattern.outcome === 'unknown' || !pattern.outcome ? 1 : 0);
    const confidenceScore = (pattern: ProposalPatternRecord) => (pattern.confidence === 'high' ? 2 : pattern.confidence === 'medium' ? 1 : 0);
    const usefulScore = (pattern: ProposalPatternRecord) => (hasUsefulStageOrRole(pattern) ? 1 : 0);
    const dateA = Date.parse(a.created_at || '') || 0;
    const dateB = Date.parse(b.created_at || '') || 0;

    return outcomeScore(b) - outcomeScore(a) || confidenceScore(b) - confidenceScore(a) || usefulScore(b) - usefulScore(a) || dateB - dateA;
  });
}

export async function retrieveProposalPatternsForOutline(options: RetrieveProposalPatternsForOutlineOptions = {}): Promise<OutlineProposalPattern[]> {
  const { client } = getSupabaseConfigState();
  const limit = Math.max(1, Math.min(20, options.limit ?? defaultPatternLimit));

  if (!client) {
    return [];
  }

  try {
    const baseSelect = '*, documents(file_name, metadata), projects(name, client_name)';
    const fetchCandidates = async (outcome?: 'won') => {
      let query = client
        .from('proposal_patterns')
        .select(baseSelect)
        .not('reusable_principle', 'is', null)
        .neq('reusable_principle', '')
        .in('confidence', ['high', 'medium'])
        .order('created_at', { ascending: false })
        .limit(maxCandidateLimit);

      if (outcome) {
        query = query.eq('outcome', outcome);
      }

      return query;
    };

    const wonResult = await fetchCandidates('won');
    if (wonResult.error) {
      console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline won query failed: ${wonResult.error.message}`);
      return [];
    }

    const selectedWon = filterProposalPatternsForOutline(sortPatternCandidates((wonResult.data ?? []) as ProposalPatternRecord[]), limit);
    if (selectedWon.length >= limit) {
      return selectedWon;
    }

    const fallbackResult = await fetchCandidates();
    if (fallbackResult.error) {
      console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline fallback query failed: ${fallbackResult.error.message}`);
      return selectedWon;
    }

    const seenIds = new Set((wonResult.data ?? []).map((pattern) => (pattern as ProposalPatternRecord).id));
    const fallbackCandidates = ((fallbackResult.data ?? []) as ProposalPatternRecord[]).filter((pattern) => !seenIds.has(pattern.id));
    return filterProposalPatternsForOutline(sortPatternCandidates([...(wonResult.data ?? []) as ProposalPatternRecord[], ...fallbackCandidates]), limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[proposalPatternOutline] retrieveProposalPatternsForOutline failed: ${message}`);
    return [];
  }
}

export function formatProposalPatternsForOutlinePrompt(patterns: OutlineProposalPattern[]) {
  if (!patterns.length) return '사용 가능한 proposal_patterns 없음';

  return JSON.stringify(
    patterns.map((pattern, index) => ({
      pattern_index: index + 1,
      ...pattern,
    })),
    null,
    2,
  );
}
