import type { JsonValue } from './dbTypes';
import type { DbLibraryDocumentMetadata, FailureArea, OutcomeReasonType, ProposalOutcome, ReferenceUsePolicy } from './types';
import { classifyFailureAreas, classifyOutcomeReason, getProposalPatternUsabilityFlags, type ProposalPatternUsabilityFlags } from './outcomeReasonClassifier';

// Pure, isomorphic helpers for reading document-level proposal outcome/tagging metadata (documents.metadata jsonb). No
// 'server-only' — usable by routes, generation seams (conceptFrameSynthesis / naming / outline / proposalPatternOutline),
// and the client. Reads are defensive: missing/garbled metadata yields safe neutral defaults, never a fabricated 'won'.

function asObject(value: JsonValue | null | undefined): Record<string, JsonValue | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}
function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function asStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}
function normalizeOutcome(value: string | undefined): ProposalOutcome | undefined {
  if (value === 'won' || value === 'lost' || value === 'unknown') return value;
  // NEVER coerce an unrecognized/absent value to 'won'. An untagged proposal stays untagged (undefined).
  return value ? 'unknown' : undefined;
}

// Coerce raw jsonb metadata into the typed DbLibraryDocumentMetadata shape (best-effort; all fields optional).
export function getDbLibraryMetadata(metadata: JsonValue | null | undefined): DbLibraryDocumentMetadata {
  const object = asObject(metadata);
  if (!object) return {};
  const policyObject = asObject(object.referenceUsePolicy);
  const referenceUsePolicy: ReferenceUsePolicy | undefined = policyObject
    ? {
        canUseForStrategy: typeof policyObject.canUseForStrategy === 'boolean' ? policyObject.canUseForStrategy : undefined,
        canUseForConcept: typeof policyObject.canUseForConcept === 'boolean' ? policyObject.canUseForConcept : undefined,
        canUseForStructure: typeof policyObject.canUseForStructure === 'boolean' ? policyObject.canUseForStructure : undefined,
        canUseForContent: typeof policyObject.canUseForContent === 'boolean' ? policyObject.canUseForContent : undefined,
        canUseForDesign: typeof policyObject.canUseForDesign === 'boolean' ? policyObject.canUseForDesign : undefined,
        canUseForExecution: typeof policyObject.canUseForExecution === 'boolean' ? policyObject.canUseForExecution : undefined,
        canUseForOperation: typeof policyObject.canUseForOperation === 'boolean' ? policyObject.canUseForOperation : undefined,
      }
    : undefined;
  const reasonType = asString(object.outcomeReasonType);
  const confidence = asString(object.confidence);
  return {
    outcome: normalizeOutcome(asString(object.outcome)),
    outcomeLabel: asString(object.outcomeLabel),
    outcomeReason: asString(object.outcomeReason),
    outcomeReasonType: reasonType === 'external' || reasonType === 'quality' || reasonType === 'mixed' || reasonType === 'unknown' ? reasonType : undefined,
    proposalType: asString(object.proposalType),
    projectCategory: asString(object.projectCategory),
    clientName: asString(object.clientName),
    industry: asString(object.industry),
    projectName: asString(object.projectName),
    proposalYear: asString(object.proposalYear),
    confidence: confidence === 'user_confirmed' || confidence === 'inferred' || confidence === 'unknown' ? confidence : undefined,
    winReasonTags: asStringArray(object.winReasonTags),
    lossReasonTags: asStringArray(object.lossReasonTags),
    contentTypeTags: asStringArray(object.contentTypeTags),
    technologyTags: asStringArray(object.technologyTags),
    experienceFormatTags: asStringArray(object.experienceFormatTags),
    referenceUsePolicy,
  };
}

// §7 helpers — read by future retrieval (conceptFrameSynthesis / naming / outline / proposalPatternOutline).
export function getDocumentOutcomeMetadata(metadata: JsonValue | null | undefined): { outcome?: ProposalOutcome; outcomeReason?: string; outcomeReasonType?: OutcomeReasonType; failureAreas?: FailureArea[] } {
  const meta = getDbLibraryMetadata(metadata);
  return { outcome: meta.outcome, outcomeReason: meta.outcomeReason, outcomeReasonType: meta.outcomeReasonType, failureAreas: meta.failureAreas };
}
export function getReferenceProposalType(metadata: JsonValue | null | undefined): string | null {
  return getDbLibraryMetadata(metadata).proposalType ?? null;
}
export function getReferenceContentTags(metadata: JsonValue | null | undefined): string[] {
  const meta = getDbLibraryMetadata(metadata);
  return Array.from(new Set([...(meta.contentTypeTags ?? []), ...(meta.technologyTags ?? []), ...(meta.experienceFormatTags ?? [])]));
}
// Reference-use policy as concrete booleans — absent dimension defaults to allowed (true), matching the all-true default.
export function getReferenceUsePolicy(metadata: JsonValue | null | undefined): Required<ReferenceUsePolicy> {
  const policy = getDbLibraryMetadata(metadata).referenceUsePolicy ?? {};
  return {
    canUseForStrategy: policy.canUseForStrategy ?? true,
    canUseForConcept: policy.canUseForConcept ?? true,
    canUseForStructure: policy.canUseForStructure ?? true,
    canUseForContent: policy.canUseForContent ?? true,
    canUseForDesign: policy.canUseForDesign ?? true,
    canUseForExecution: policy.canUseForExecution ?? true,
    canUseForOperation: policy.canUseForOperation ?? true,
  };
}
// Guardrails (§8): won → positive structural reference; lost → risk/anti-pattern only; unknown/untagged → neutral only.
export function isWinningReferenceDocument(metadata: JsonValue | null | undefined): boolean {
  return getDbLibraryMetadata(metadata).outcome === 'won';
}
export function isLosingReferenceDocument(metadata: JsonValue | null | undefined): boolean {
  return getDbLibraryMetadata(metadata).outcome === 'lost';
}
export function isUnknownOutcomeReferenceDocument(metadata: JsonValue | null | undefined): boolean {
  const outcome = getDbLibraryMetadata(metadata).outcome;
  return !outcome || outcome === 'unknown';
}

// A reference-use policy can only RESTRICT (AND), never re-enable a dimension that failure-area analysis disabled.
function applyReferenceUsePolicy(flags: ProposalPatternUsabilityFlags, policy?: ReferenceUsePolicy): ProposalPatternUsabilityFlags {
  if (!policy) return flags;
  return {
    can_use_for_strategy: flags.can_use_for_strategy && (policy.canUseForStrategy ?? true),
    can_use_for_concept: flags.can_use_for_concept && (policy.canUseForConcept ?? true),
    can_use_for_structure: flags.can_use_for_structure && (policy.canUseForStructure ?? true),
    can_use_for_content: flags.can_use_for_content && (policy.canUseForContent ?? true),
    can_use_for_design: flags.can_use_for_design && (policy.canUseForDesign ?? true),
    can_use_for_execution: flags.can_use_for_execution && (policy.canUseForExecution ?? true),
    can_use_for_operation: flags.can_use_for_operation && (policy.canUseForOperation ?? true),
  };
}

export interface PatternOutcomeFields {
  outcome: ProposalOutcome | null;
  outcome_reason: string | null;
  outcome_reason_type: OutcomeReasonType;
  failure_areas: FailureArea[];
  usabilityFlags: ProposalPatternUsabilityFlags;
  referenceContext: Record<string, JsonValue>;
}

// Single source of truth for stamping a document's outcome/tagging metadata onto its extracted proposal_patterns.
// Used by BOTH documentPersistence and proposalPatternBackfill so the two paths can never drift (RISK D). failure areas
// consider the reason memo AND any lossReasonTags; can_use_for_* honor an explicit (restrict-only) reference-use policy.
export function buildPatternOutcomeFields(metadata: JsonValue | null | undefined): PatternOutcomeFields {
  const meta = getDbLibraryMetadata(metadata);
  const outcome = meta.outcome ?? null;
  const outcomeReason = meta.outcomeReason ?? null;
  const outcomeReasonType = classifyOutcomeReason(outcome, outcomeReason, meta.outcomeReasonType ?? null);
  const lossText = [outcomeReason, ...(meta.lossReasonTags ?? [])].filter(Boolean).join(' ').trim() || null;
  const failureAreas = classifyFailureAreas(outcome, lossText);
  const usabilityFlags = applyReferenceUsePolicy(getProposalPatternUsabilityFlags(failureAreas), meta.referenceUsePolicy);
  const referenceContext: Record<string, JsonValue> = {
    proposalType: meta.proposalType ?? null,
    projectCategory: meta.projectCategory ?? null,
    clientName: meta.clientName ?? null,
    industry: meta.industry ?? null,
    projectName: meta.projectName ?? null,
    contentTypeTags: meta.contentTypeTags ?? [],
    technologyTags: meta.technologyTags ?? [],
    experienceFormatTags: meta.experienceFormatTags ?? [],
    winReasonTags: meta.winReasonTags ?? [],
    lossReasonTags: meta.lossReasonTags ?? [],
    referenceUsePolicy: meta.referenceUsePolicy ? { ...meta.referenceUsePolicy } as Record<string, JsonValue> : null,
  };
  return { outcome, outcome_reason: outcomeReason, outcome_reason_type: outcomeReasonType, failure_areas: failureAreas, usabilityFlags, referenceContext };
}
