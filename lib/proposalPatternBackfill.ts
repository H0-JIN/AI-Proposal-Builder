import 'server-only';

import {
  deleteProposalPatternsByDocument,
  getDocumentChunks,
  getProposalDocumentsForPatternBackfill,
  getProposalPatternCountByDocument,
  isSupabaseConfigured,
  saveProposalPatterns,
} from './ragStorage';
import { extractProposalPatternsFromChunks } from './proposalPatternExtractor';
import type { JsonValue, ProposalPatternInput } from './dbTypes';

export interface BackfillProposalPatternsInput {
  documentId?: string;
  projectId?: string;
  force?: boolean;
}

export type BackfillProposalPatternStatus = 'extracted' | 'skipped' | 'failed';
export type BackfillProposalPatternReason = 'not_configured' | 'existing_patterns' | 'no_chunks' | 'no_patterns' | 'replace_failed' | 'save_failed' | 'error';

export interface BackfillProposalPatternDocumentResult {
  documentId: string;
  projectId: string;
  fileName: string;
  status: BackfillProposalPatternStatus;
  reason?: BackfillProposalPatternReason;
  chunkCount: number;
  previousPatternCount: number;
  proposalPatternCount: number;
}

export interface BackfillProposalPatternsResult {
  status: 'disabled' | 'completed' | 'failed';
  force: boolean;
  processedCount: number;
  extractedCount: number;
  skippedCount: number;
  failedCount: number;
  results: BackfillProposalPatternDocumentResult[];
}

function normalizeId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toJsonValue(value: unknown): JsonValue | null {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue | null;
}

function getMetadataString(metadata: JsonValue | null | undefined, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOutcome(value: string | null) {
  if (value === 'won' || value === 'lost' || value === 'unknown') return value;
  return value ? 'unknown' : null;
}

function applyOutcomeMetadata(patterns: ProposalPatternInput[], metadata: JsonValue | null | undefined) {
  const outcome = normalizeOutcome(getMetadataString(metadata, 'outcome'));
  const outcomeReason = getMetadataString(metadata, 'outcomeReason');

  return patterns.map((pattern) => ({
    ...pattern,
    outcome,
    outcome_reason: outcomeReason,
    metadata: toJsonValue({
      ...(pattern.metadata && typeof pattern.metadata === 'object' && !Array.isArray(pattern.metadata) ? pattern.metadata : {}),
      proposalOutcome: outcome,
      proposalOutcomeReason: outcomeReason,
      extractionMethod: 'proposal_pattern_backfill_v1',
    }),
  }));
}

function summarize(results: BackfillProposalPatternDocumentResult[], force: boolean): BackfillProposalPatternsResult {
  return {
    status: 'completed',
    force,
    processedCount: results.length,
    extractedCount: results.filter((result) => result.status === 'extracted').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    results,
  };
}

export async function backfillProposalPatterns(input: BackfillProposalPatternsInput = {}): Promise<BackfillProposalPatternsResult> {
  const documentId = normalizeId(input.documentId);
  const projectId = normalizeId(input.projectId);
  const force = Boolean(input.force);

  if (!isSupabaseConfigured()) {
    return { status: 'disabled', force, processedCount: 0, extractedCount: 0, skippedCount: 0, failedCount: 0, results: [] };
  }

  const documents = await getProposalDocumentsForPatternBackfill({ documentId, projectId: documentId ? undefined : projectId });
  const results: BackfillProposalPatternDocumentResult[] = [];

  for (const document of documents) {
    const currentPatternCount = await getProposalPatternCountByDocument(document.id);

    if (currentPatternCount > 0 && !force) {
      results.push({
        documentId: document.id,
        projectId: document.project_id,
        fileName: document.file_name,
        status: 'skipped',
        reason: 'existing_patterns',
        chunkCount: document.chunkCount,
        previousPatternCount: currentPatternCount,
        proposalPatternCount: currentPatternCount,
      });
      continue;
    }

    const chunks = await getDocumentChunks(document.id);
    const textChunks = chunks.filter((chunk) => chunk.chunk_text?.trim());

    if (!textChunks.length) {
      results.push({
        documentId: document.id,
        projectId: document.project_id,
        fileName: document.file_name,
        status: 'skipped',
        reason: 'no_chunks',
        chunkCount: chunks.length,
        previousPatternCount: currentPatternCount,
        proposalPatternCount: currentPatternCount,
      });
      continue;
    }

    try {
      if (force && currentPatternCount > 0) {
        const deleted = await deleteProposalPatternsByDocument(document.id);
        if (!deleted) {
          results.push({
            documentId: document.id,
            projectId: document.project_id,
            fileName: document.file_name,
            status: 'failed',
            reason: 'replace_failed',
            chunkCount: textChunks.length,
            previousPatternCount: currentPatternCount,
            proposalPatternCount: currentPatternCount,
          });
          continue;
        }
      }

      const patterns = applyOutcomeMetadata(extractProposalPatternsFromChunks(textChunks), document.metadata);

      if (!patterns.length) {
        results.push({
          documentId: document.id,
          projectId: document.project_id,
          fileName: document.file_name,
          status: 'skipped',
          reason: 'no_patterns',
          chunkCount: textChunks.length,
          previousPatternCount: currentPatternCount,
          proposalPatternCount: 0,
        });
        continue;
      }

      const savedPatterns = await saveProposalPatterns({ patterns });

      if (!savedPatterns.length) {
        results.push({
          documentId: document.id,
          projectId: document.project_id,
          fileName: document.file_name,
          status: 'failed',
          reason: 'save_failed',
          chunkCount: textChunks.length,
          previousPatternCount: currentPatternCount,
          proposalPatternCount: 0,
        });
        continue;
      }

      results.push({
        documentId: document.id,
        projectId: document.project_id,
        fileName: document.file_name,
        status: 'extracted',
        chunkCount: textChunks.length,
        previousPatternCount: currentPatternCount,
        proposalPatternCount: savedPatterns.length,
      });
    } catch (error) {
      console.error(`[proposalPatternBackfill] ${document.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        documentId: document.id,
        projectId: document.project_id,
        fileName: document.file_name,
        status: 'failed',
        reason: 'error',
        chunkCount: textChunks.length,
        previousPatternCount: currentPatternCount,
        proposalPatternCount: force ? 0 : currentPatternCount,
      });
    }
  }

  return summarize(results, force);
}
