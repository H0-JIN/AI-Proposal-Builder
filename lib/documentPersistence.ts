import 'server-only';

import { createDocument, createProject, isSupabaseConfigured, saveChunks, saveProposalPatterns } from './ragStorage';
import { extractProposalPatternsFromChunks } from './proposalPatternExtractor';
import { inferUploadedDocumentRole } from './documentRoles';
import { classifyOutcomeReason } from './outcomeReasonClassifier';
import type { JsonValue, ProposalPatternInput } from './dbTypes';
import type { DocumentChunk } from './rag';
import type { ProjectInput, UploadedDocument } from './types';

export type DocumentDbSaveStatus = 'disabled' | 'saved' | 'failed';
export type ProposalPatternExtractionStatus = 'extracted' | 'skipped' | 'failed';

export interface PersistUploadedDocumentInput {
  input: ProjectInput;
  document: UploadedDocument;
  documentChunks?: DocumentChunk[];
}

export interface PersistUploadedDocumentResult {
  status: DocumentDbSaveStatus;
  projectId?: string;
  documentId?: string;
  chunkCount?: number;
  role?: 'rfp' | 'proposal' | 'reference' | 'memo';
  proposalPatternStatus?: ProposalPatternExtractionStatus;
  proposalPatternCount?: number;
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function toJsonValue(value: unknown): JsonValue | null {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue | null;
}

function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function logDocumentPersistenceError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
  console.error(`[documentPersistence] ${operation} failed: ${message}`);
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
  const explicitOutcomeReasonType = getMetadataString(metadata, 'outcomeReasonType');
  const outcomeReasonType = classifyOutcomeReason(outcome, outcomeReason, explicitOutcomeReasonType);

  return patterns.map((pattern) => ({
    ...pattern,
    outcome,
    outcome_reason: outcomeReason,
    outcome_reason_type: outcomeReasonType,
    metadata: toJsonValue({
      ...(pattern.metadata && typeof pattern.metadata === 'object' && !Array.isArray(pattern.metadata) ? pattern.metadata : {}),
      proposalOutcome: outcome,
      proposalOutcomeReason: outcomeReason,
      proposalOutcomeReasonType: outcomeReasonType,
      outcomeReasonType,
    }),
  }));
}

async function extractAndSaveProposalPatterns(role: PersistUploadedDocumentResult['role'], savedChunks: Awaited<ReturnType<typeof saveChunks>>, documentMetadata: JsonValue | null | undefined) {
  if (role !== 'proposal') {
    return { proposalPatternStatus: 'skipped' as const, proposalPatternCount: 0 };
  }

  if (!savedChunks.length) {
    return { proposalPatternStatus: 'skipped' as const, proposalPatternCount: 0 };
  }

  try {
    const patterns = applyOutcomeMetadata(extractProposalPatternsFromChunks(savedChunks), documentMetadata);

    if (!patterns.length) {
      return { proposalPatternStatus: 'skipped' as const, proposalPatternCount: 0 };
    }

    const savedPatterns = await saveProposalPatterns({ patterns });

    if (!savedPatterns.length) {
      return { proposalPatternStatus: 'failed' as const, proposalPatternCount: 0 };
    }

    return { proposalPatternStatus: 'extracted' as const, proposalPatternCount: savedPatterns.length };
  } catch (error) {
    logDocumentPersistenceError('extractAndSaveProposalPatterns', error);
    return { proposalPatternStatus: 'failed' as const, proposalPatternCount: 0 };
  }
}

export async function persistUploadedDocumentToSupabase({ input, document, documentChunks = [] }: PersistUploadedDocumentInput): Promise<PersistUploadedDocumentResult> {
  const role = document.documentRole ?? inferUploadedDocumentRole(document.fileName, document.documentAnalysisText || document.extractedText);

  if (!isSupabaseConfigured()) {
    return { status: 'disabled', chunkCount: documentChunks.length, role, proposalPatternStatus: 'skipped', proposalPatternCount: 0 };
  }

  try {
    const project = await createProject({
      name: input.projectName?.trim() || stripFileExtension(document.fileName) || 'Uploaded Documents',
      clientName: input.clientName?.trim() || null,
      proposalType: input.proposalType || null,
      metadata: toJsonValue({
        source: 'uploaded_document_storage',
        storageOnly: true,
        note: 'Saved for future RAG retrieval; not used by generation in this PR.',
      }),
    });

    if (!project) return { status: 'failed', chunkCount: documentChunks.length, role, proposalPatternStatus: 'skipped', proposalPatternCount: 0 };

    const normalizedOutcome = document.dbLibraryMetadata?.outcome;
    const normalizedOutcomeReason = document.dbLibraryMetadata?.outcomeReason;
    const outcomeReasonType = classifyOutcomeReason(normalizedOutcome, normalizedOutcomeReason, document.dbLibraryMetadata?.outcomeReasonType);

    const documentRecord = await createDocument({
      projectId: project.id,
      fileName: document.fileName || 'Uploaded document',
      role,
      mimeType: document.fileType || null,
      sourceType: document.visionUsed ? 'visionAnalysis' : 'textExtraction',
      metadata: toJsonValue({
        ...(document.dbLibraryMetadata ?? {}),
        ...(role === 'proposal' ? { outcomeReasonType } : {}),
        originalDocumentId: document.id,
        documentRole: role,
        documentType: document.documentType ?? null,
        storageOnly: true,
        extractionStatus: document.extractionStatus,
        extractedCharCount: document.extractedCharCount,
        visionUsed: document.visionUsed ?? false,
        totalPageCount: document.totalPageCount ?? document.visionTotalPageCount ?? null,
        ocrUsed: document.ocrUsed ?? false,
      }),
    });

    if (!documentRecord) return { status: 'failed', projectId: project.id, chunkCount: documentChunks.length, role, proposalPatternStatus: 'skipped', proposalPatternCount: 0 };

    const savedChunks = await saveChunks({
      projectId: project.id,
      documentId: documentRecord.id,
      chunks: documentChunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        category: chunk.category,
        categories: chunk.categories ?? [chunk.category],
        tags: chunk.tags,
        importance: chunk.importance,
        pageNumber: chunk.pageNumber ?? null,
        slideNumber: chunk.slideNumber ?? null,
        sectionTitle: chunk.sectionTitle ?? chunk.slideTitle ?? null,
        sourceType: chunk.sourceType,
        sourceName: chunk.documentName,
        tokenCount: estimateTokenCount(chunk.chunkText),
        embedding: null,
        metadata: toJsonValue({
          originalChunkId: chunk.id,
          storageOnly: true,
          sourceType: chunk.sourceType,
          visualSummary: chunk.visualSummary ?? null,
          slideTitle: chunk.slideTitle ?? null,
          slidePurpose: chunk.slidePurpose ?? null,
          keyMessage: chunk.keyMessage ?? null,
        }),
      })),
    });

    const patternResult = await extractAndSaveProposalPatterns(role, savedChunks, documentRecord.metadata);

    return { status: 'saved', projectId: project.id, documentId: documentRecord.id, chunkCount: savedChunks.length, role, ...patternResult };
  } catch (error) {
    logDocumentPersistenceError('persistUploadedDocumentToSupabase', error);
    return { status: 'failed', chunkCount: documentChunks.length, role, proposalPatternStatus: 'skipped', proposalPatternCount: 0 };
  }
}
