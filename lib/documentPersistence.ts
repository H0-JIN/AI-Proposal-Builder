import 'server-only';

import { createDocument, createProject, isSupabaseConfigured, saveChunks, saveProposalPatterns } from './ragStorage';
import { extractProposalPatternsFromChunks } from './proposalPatternExtractor';
import { inferUploadedDocumentRole } from './documentRoles';
import { buildPatternOutcomeFields } from './documentOutcomeMetadata';
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

function applyOutcomeMetadata(patterns: ProposalPatternInput[], metadata: JsonValue | null | undefined) {
  const fields = buildPatternOutcomeFields(metadata);

  return patterns.map((pattern) => ({
    ...pattern,
    outcome: fields.outcome,
    outcome_reason: fields.outcome_reason,
    outcome_reason_type: fields.outcome_reason_type,
    failure_areas: fields.failure_areas,
    ...fields.usabilityFlags,
    metadata: toJsonValue({
      ...(pattern.metadata && typeof pattern.metadata === 'object' && !Array.isArray(pattern.metadata) ? pattern.metadata : {}),
      proposalOutcome: fields.outcome,
      proposalOutcomeReason: fields.outcome_reason,
      proposalOutcomeReasonType: fields.outcome_reason_type,
      outcomeReasonType: fields.outcome_reason_type,
      failureAreas: fields.failure_areas,
      reference: fields.referenceContext,
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

    // Derive the same outcome fields the patterns will get (lossReasonTags-aware) so documents.metadata stays consistent
    // with proposal_patterns. Only stamped for the proposal role; reference/memo/rfp never receive an outcome.
    const documentOutcomeFields = buildPatternOutcomeFields(toJsonValue(document.dbLibraryMetadata ?? {}));

    const documentRecord = await createDocument({
      projectId: project.id,
      fileName: document.fileName || 'Uploaded document',
      role,
      mimeType: document.fileType || null,
      sourceType: document.visionUsed ? 'visionAnalysis' : 'textExtraction',
      metadata: toJsonValue({
        ...(document.dbLibraryMetadata ?? {}),
        ...(role === 'proposal' ? { outcomeReasonType: documentOutcomeFields.outcome_reason_type, failureAreas: documentOutcomeFields.failure_areas } : {}),
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
