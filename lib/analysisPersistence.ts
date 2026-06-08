import 'server-only';

import { createDocument, createProject, isSupabaseConfigured, saveChunks } from './ragStorage';
import type { DocumentRole, JsonValue } from './dbTypes';
import type { DocumentChunk, DocumentType } from './rag';
import type { AnalysisResult, ProjectInput, UploadedDocument } from './types';

export type AnalysisDbSaveStatus = 'disabled' | 'saved' | 'failed';

export interface PersistAnalysisInput {
  input: ProjectInput;
  analysis: AnalysisResult;
  uploadedDocuments?: UploadedDocument[];
  documentChunks?: DocumentChunk[];
}

export interface PersistAnalysisResult {
  status: AnalysisDbSaveStatus;
  projectId?: string;
  documentCount?: number;
  chunkCount?: number;
}

function logAnalysisPersistenceError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
  console.error(`[analysisPersistence] ${operation} failed: ${message}`);
}

function getStringProperty(source: unknown, keys: string[]) {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return null;
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function inferProjectName(analysis: AnalysisResult, input: ProjectInput, uploadedDocuments: UploadedDocument[]) {
  return (
    getStringProperty(analysis, ['projectName', 'name']) ||
    uploadedDocuments.map((document) => stripFileExtension(document.fileName)).find(Boolean) ||
    input.projectName?.trim() ||
    'Untitled Project'
  );
}

function inferClientName(analysis: AnalysisResult, input: ProjectInput) {
  return getStringProperty(analysis, ['client', 'clientName', 'client_name']) || input.clientName?.trim() || null;
}

function inferProposalType(analysis: AnalysisResult, input: ProjectInput) {
  return getStringProperty(analysis, ['projectType', 'proposalType', 'proposal_type']) || analysis.inferredProposalType || input.proposalType || null;
}

function mapDocumentRole(documentType?: DocumentType): DocumentRole {
  if (documentType === 'rfp') return 'rfp';
  if (documentType === 'finalProposal') return 'proposal';
  if (documentType === 'reference') return 'reference';
  return 'memo';
}

function toJsonValue(value: unknown): JsonValue | null {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue | null;
}

function buildDocumentFallback(uploadedDocuments: UploadedDocument[], documentChunks: DocumentChunk[]) {
  if (uploadedDocuments.length) return uploadedDocuments;

  const byDocumentId = new Map<string, UploadedDocument>();
  documentChunks.forEach((chunk) => {
    if (byDocumentId.has(chunk.documentId)) return;
    byDocumentId.set(chunk.documentId, {
      id: chunk.documentId,
      fileName: chunk.documentName || 'Analyzed document',
      fileType: 'unknown',
      documentType: chunk.documentType,
      extractionStatus: '텍스트 추출 완료',
      extractedText: '',
      extractedCharCount: 0,
      chunks: documentChunks.filter((candidate) => candidate.documentId === chunk.documentId),
    });
  });

  return Array.from(byDocumentId.values());
}

export async function persistAnalysisToSupabase({ input, analysis, uploadedDocuments = [], documentChunks = [] }: PersistAnalysisInput): Promise<PersistAnalysisResult> {
  if (!isSupabaseConfigured()) {
    return { status: 'disabled', documentCount: uploadedDocuments.length, chunkCount: documentChunks.length };
  }

  try {
    const documents = buildDocumentFallback(uploadedDocuments, documentChunks);
    const project = await createProject({
      name: inferProjectName(analysis, input, documents),
      clientName: inferClientName(analysis, input),
      proposalType: inferProposalType(analysis, input),
      metadata: toJsonValue({
        source: 'analysis',
        inputProjectName: input.projectName || null,
        inputClientName: input.clientName || null,
        analysisBasis: {
          inferredProposalType: analysis.inferredProposalType,
          proposalScopeTypes: analysis.proposalScopeTypes,
        },
      }),
    });

    if (!project) {
      return { status: 'failed', documentCount: documents.length, chunkCount: documentChunks.length };
    }

    let savedDocumentCount = 0;
    let savedChunkCount = 0;

    for (const document of documents) {
      const documentRecord = await createDocument({
        projectId: project.id,
        fileName: document.fileName || 'Analyzed document',
        role: mapDocumentRole(document.documentType),
        mimeType: document.fileType || null,
        sourceType: document.visionUsed ? 'visionAnalysis' : 'textExtraction',
        metadata: toJsonValue({
          originalDocumentId: document.id,
          documentRole: mapDocumentRole(document.documentType),
          fileType: document.fileType || null,
          extractionStatus: document.extractionStatus,
          visionUsed: document.visionUsed ?? false,
          totalPageCount: document.totalPageCount ?? document.visionTotalPageCount ?? null,
        }),
      });

      if (!documentRecord) continue;
      savedDocumentCount += 1;

      const chunksForDocument = documentChunks.filter((chunk) => chunk.documentId === document.id);
      const savedChunks = await saveChunks({
        projectId: project.id,
        documentId: documentRecord.id,
        chunks: chunksForDocument.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          category: chunk.category,
          categories: chunk.categories ?? [chunk.category],
          tags: chunk.tags,
          importance: chunk.importance,
          pageNumber: chunk.pageNumber ?? null,
          slideNumber: chunk.slideNumber ?? null,
          sectionTitle: chunk.sectionTitle ?? null,
          embedding: null,
          metadata: toJsonValue({
            originalChunkId: chunk.id,
            sourceType: chunk.sourceType,
            visualSummary: chunk.visualSummary ?? null,
            slideTitle: chunk.slideTitle ?? null,
            slidePurpose: chunk.slidePurpose ?? null,
            keyMessage: chunk.keyMessage ?? null,
          }),
        })),
      });
      savedChunkCount += savedChunks.length;
    }

    return { status: 'saved', projectId: project.id, documentCount: savedDocumentCount, chunkCount: savedChunkCount };
  } catch (error) {
    logAnalysisPersistenceError('persistAnalysisToSupabase', error);
    return { status: 'failed', documentCount: uploadedDocuments.length, chunkCount: documentChunks.length };
  }
}
