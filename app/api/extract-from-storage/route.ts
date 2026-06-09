import { NextResponse } from 'next/server';
import { getSupabaseConfigState } from '@/lib/supabase';
import { PROPOSAL_LIBRARY_BUCKET } from '@/lib/supabaseStorageUpload';
import { extractDocumentTextFromBuffer, getExtension } from '@/lib/documentTextExtraction';
import { createDocumentChunks, inferDocumentType } from '@/lib/rag';
import { mapStorageRoleToDocumentType } from '@/lib/documentRoles';
import { persistUploadedDocumentToSupabase } from '@/lib/documentPersistence';
import { TEXT_EXTRACTION_FAILED_MESSAGE } from '@/lib/extractedTextValidation';
import type { ProjectInput, UploadedDocument } from '@/lib/types';
import type { DocumentRole } from '@/lib/dbTypes';

const supportedStorageExtensions = new Set(['pdf', 'docx', 'pptx', 'txt', 'md']);

type StorageDocumentRole = Extract<DocumentRole, 'proposal' | 'reference' | 'memo'>;

interface ExtractFromStoragePayload {
  input?: ProjectInput;
  bucket?: string;
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  role?: StorageDocumentRole;
}

function isStorageDocumentRole(value: unknown): value is StorageDocumentRole {
  return value === 'proposal' || value === 'reference' || value === 'memo';
}

function createFallbackInput(fileName: string): ProjectInput {
  return {
    proposalType: 'basic',
    projectName: fileName.replace(/\.[^.]+$/, '') || 'Uploaded Documents',
    clientName: '',
    briefText: '',
  };
}

function getSaveStatus(extractionPartial: boolean, persistenceStatus?: string): 'saved' | 'partial' | 'failed' {
  if (persistenceStatus === 'saved') return extractionPartial ? 'partial' : 'saved';
  return 'failed';
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ExtractFromStoragePayload;
    const bucket = payload.bucket || PROPOSAL_LIBRARY_BUCKET;
    const storagePath = payload.storagePath?.trim();
    const fileName = payload.fileName?.trim() || storagePath?.split('/').pop() || 'uploaded-document';
    const extension = getExtension(fileName);
    const role = isStorageDocumentRole(payload.role) ? payload.role : 'reference';

    if (!storagePath) {
      return NextResponse.json({ status: 'failed', error: 'Storage 경로를 찾을 수 없습니다.' }, { status: 400 });
    }

    if (bucket !== PROPOSAL_LIBRARY_BUCKET) {
      return NextResponse.json({ status: 'failed', error: `지원하지 않는 Storage bucket입니다. ${PROPOSAL_LIBRARY_BUCKET} bucket을 사용해 주세요.` }, { status: 400 });
    }

    if (!supportedStorageExtensions.has(extension)) {
      return NextResponse.json({ status: 'failed', error: '지원하지 않는 파일 형식입니다. PDF, PPTX, DOCX, TXT, MD 파일을 업로드해주세요.' }, { status: 400 });
    }

    const { configured, client } = getSupabaseConfigState();
    if (!configured || !client) {
      return NextResponse.json({ status: 'failed', error: 'Supabase 서버 환경 변수가 설정되지 않았습니다.' }, { status: 503 });
    }

    const { data, error: downloadError } = await client.storage.from(bucket).download(storagePath);
    if (downloadError || !data) {
      return NextResponse.json({ status: 'failed', error: `Storage 파일 다운로드 실패: ${downloadError?.message ?? '파일을 찾을 수 없습니다.'}` }, { status: 404 });
    }

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileSize = payload.fileSize ?? buffer.byteLength;
    const { result, httpStatus } = await extractDocumentTextFromBuffer({
      buffer,
      fileName,
      fileSize,
      mode: 'db',
    });

    const text = (result.text ?? '').trim();
    if (!text) {
      return NextResponse.json(
        {
          status: 'failed',
          error: result.error || result.warning || result.message || TEXT_EXTRACTION_FAILED_MESSAGE,
          extractionStatus: result.status,
        },
        { status: httpStatus >= 400 ? httpStatus : 422 },
      );
    }

    const extractionPartial = result.status === 'partial' || Boolean(result.warning) || httpStatus >= 400;
    const documentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const documentType = mapStorageRoleToDocumentType(role) ?? inferDocumentType(fileName);
    const pageSources = result.slides?.length
      ? result.slides.map((slide) => ({ slideNumber: slide.slideNumber, sectionTitle: slide.title, text: slide.text, sourceType: 'textExtraction' as const }))
      : result.pages?.length
        ? result.pages.filter((page) => page.text.trim()).map((page) => ({ pageNumber: page.pageNumber, text: page.text, sourceType: 'textExtraction' as const }))
        : undefined;

    const document: UploadedDocument = {
      id: documentId,
      fileName,
      fileType: payload.mimeType || extension.toUpperCase(),
      documentType,
      documentRole: role,
      extractionStatus: extractionPartial ? '일부 텍스트만 추출' : '텍스트 추출 완료',
      extractedText: text,
      documentAnalysisText: text,
      extractedCharCount: text.length,
      visionStatus: 'unused',
      visionUsed: false,
      totalPageCount: result.pageCount,
      ocrUsed: false,
      ocrAvailable: false,
      warningMessage: extractionPartial ? result.warning || result.message || 'Partial text saved' : undefined,
      dbSaveStatus: 'saving',
    };

    const chunks = createDocumentChunks({
      documentId,
      documentName: fileName,
      documentType,
      text,
      sourceType: 'textExtraction',
      pageSources,
    });

    const persistence = await persistUploadedDocumentToSupabase({
      input: payload.input ?? createFallbackInput(fileName),
      document,
      documentChunks: chunks,
    });

    const status = getSaveStatus(extractionPartial, persistence.status);

    return NextResponse.json({
      status,
      message: status === 'partial' ? 'Partial text saved' : status === 'saved' ? 'Saved to DB' : 'DB upload failed',
      projectId: persistence.projectId,
      documentId: persistence.documentId,
      chunkCount: persistence.chunkCount,
      role: persistence.role ?? role,
      extractionStatus: result.status,
      warning: result.warning,
      pageCount: result.pageCount,
      extractedPageCount: result.extractedPageCount,
      storagePath,
      bucket,
      proposalPatternStatus: persistence.proposalPatternStatus,
      proposalPatternCount: persistence.proposalPatternCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : TEXT_EXTRACTION_FAILED_MESSAGE;
    console.error(`[extract-from-storage] DB upload failed: ${message}`);
    return NextResponse.json({ status: 'failed', error: message }, { status: 500 });
  }
}
