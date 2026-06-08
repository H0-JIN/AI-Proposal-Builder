'use client';

import { useEffect, useMemo, useState } from 'react';
import pptxgen from 'pptxgenjs';
import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ConceptDevelopmentLogic, ConceptRecommendation, ExtractionStatus, ProjectInput, ProposalNarrative, ProposalState, ProposalType, RetrievalEvidenceItem, SlideContent, SlideOutline, SupplementalInfo, UploadedDocument, VisionPageAnalysis } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { assessInputQuality } from '@/lib/inputQuality';
import { sanitizeGeneratedSlides, sanitizeImagePlaceholderForPpt } from '@/lib/slideSanitizer';
import { isInternalConceptComparisonSlide, removeInternalConceptComparisonSlides, sanitizeFinalPptxSlides, sanitizeFinalPptxText } from '@/lib/internalSlides';
import {
  ENCODING_CORRUPTION_DETECTED_MESSAGE,
  PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE,
  TEXT_EXTRACTION_FAILED_MESSAGE,
  TEXT_EXTRACTION_LOW_QUALITY_MESSAGE,
  VISION_CHUNK_CREATION_MESSAGE,
  VISION_FALLBACK_COMPLETED_MESSAGE,
  VISION_FALLBACK_IN_PROGRESS_MESSAGE,
  VISION_FULL_CHUNKED_LABEL,
  MIN_EXTRACTED_TEXT_LENGTH,
  VISION_PROCESSING_GUIDANCE,
  VISION_PROCESSING_PAGE_LIMIT_MESSAGE,
  VISION_REQUIRED_MESSAGE,
  validateExtractedText,
} from '@/lib/extractedTextValidation';
import { DEFAULT_VISION_CHUNK_SIZE, DEFAULT_VISION_MODE } from '@/lib/visionConfig';
import { getConceptDefinition, getConceptTagline, getPresentationConceptName } from '@/lib/conceptNamingGuard';
import { createDocumentChunks, inferDocumentType } from '@/lib/rag';
import { inferUploadedDocumentRole, mapStorageRoleToDocumentType } from '@/lib/documentRoles';

type Step = 'home' | 'create' | 'analysis' | 'concepts' | 'outline' | 'slides';

type UploadNotice = {
  type: 'success' | 'warning' | 'error';
  message: string;
};

type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
};

type ExtractedPptxSlide = {
  slideNumber: number;
  title?: string;
  text: string;
};

type ExtractedPageQuality = ExtractedPdfPage & {
  useVision: boolean;
  reasons: string[];
};

type ExtractTextResponse = {
  text?: string;
  status?: 'success' | 'partial';
  message?: string;
  warning?: string;
  error?: string;
  ocrNotice?: string;
  qualityReasons?: string[];
  extractionQuality?: 'low';
  pages?: ExtractedPdfPage[];
  slides?: ExtractedPptxSlide[];
  pageQuality?: ExtractedPageQuality[];
  pageCount?: number;
  extractedPageCount?: number;
};

type AnalysisApiResponse = AnalysisResult | { result: AnalysisResult; evidence?: RetrievalEvidenceItem[] };

type DbSaveStatus = 'idle' | 'disabled' | 'saving' | 'saved' | 'failed' | 'partial';

type PersistDocumentResponse = {
  status?: 'disabled' | 'saved' | 'failed' | 'partial';
  projectId?: string;
  documentId?: string;
  chunkCount?: number;
  role?: 'rfp' | 'proposal' | 'reference' | 'memo';
};

type PersistAnalysisResponse = {
  status?: 'disabled' | 'saved' | 'failed';
  projectId?: string;
  documentCount?: number;
  chunkCount?: number;
};

type VisionPdfResponse = {
  ok?: boolean;
  text?: string;
  documentAnalysisText?: string;
  pages?: VisionPageAnalysis[];
  status?: 'success' | 'partial' | 'failed';
  message?: string;
  error?: string;
  details?: string;
  guidance?: string;
  processedPageCount?: number;
  pageCount?: number;
  pageStart?: number;
  pageEnd?: number;
};


const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_DB_UPLOAD_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const LARGE_FILE_UPLOAD_GUIDANCE = '파일 용량이 커서 서버 업로드 제한에 걸렸습니다. PDF/PPTX 원본 대신 텍스트를 추출한 MD 또는 TXT 파일로 업로드하면 안정적으로 저장할 수 있습니다.';
const DB_UPLOAD_SIZE_GUIDANCE = '대용량 PDF/PPTX는 서버 제한으로 실패할 수 있습니다. 안정적인 저장은 MD/TXT 권장.';
const clientReadableExtensions = ['txt', 'md'];
const serverReadableExtensions = ['pdf', 'docx', 'pptx'];

const STORAGE_KEY = 'ai-proposal-builder-state';

const initialInput: ProjectInput = {
  proposalType: 'basic',
  projectName: '',
  clientName: '',
  briefText: '',
};

const initialSupplementalInfo: SupplementalInfo = {
  projectPurpose: '',
  spaceLocationScale: '',
  targetCustomer: '',
  experienceElements: '',
  brandMessage: '',
  schedule: '',
  budgetScope: '',
  designTone: '',
  exclusions: '',
};

const supplementalInfoFields: { key: keyof SupplementalInfo; label: string; placeholder: string }[] = [
  { key: 'projectPurpose', label: '프로젝트 목적', placeholder: '예: 신규 제품 인지도 확대, 방문 예약 전환, 브랜드 선호도 제고' },
  { key: 'spaceLocationScale', label: '공간 위치 및 규모', placeholder: '예: 서울 성수동 150평, 4주 운영, 1층 단독 팝업 공간' },
  { key: 'targetCustomer', label: '타깃 고객층', placeholder: '예: 25~35세 얼리어답터, 라이프스타일 관심 고객, VIP 초청객' },
  { key: 'experienceElements', label: '필수 체험 요소', placeholder: '예: 인터랙티브 미디어월, 제품 데모, SNS 이벤트, 굿즈 존' },
  { key: 'brandMessage', label: '제품 및 브랜드 핵심 메시지', placeholder: '예: 지속가능한 기술 혁신과 일상 속 프리미엄 경험' },
  { key: 'schedule', label: '일정', placeholder: '예: 8월 말 오픈, 6주 준비, 2주 설치, 4주 운영' },
  { key: 'budgetScope', label: '예산 및 제작 범위', placeholder: '예: 중간 규모 예산, 기획/디자인/시공/운영 포함, 매체 집행 제외' },
  { key: 'designTone', label: '디자인 톤앤매너', placeholder: '예: 미니멀, 미래적, 친환경 소재감, 블루/실버 포인트' },
  { key: 'exclusions', label: '제외 사항', placeholder: '예: 대규모 구조 변경 제외, 외부 광고 집행 제외, 과도한 사은품 지양' },
];

const supplementalInfoMarker = '--- 보완 입력 정보 ---';
const shortBriefGuidance = '입력 정보가 부족하면 제안서가 일반적으로 생성될 수 있습니다. 아래 정보를 추가하면 결과 품질이 개선됩니다.';

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${context} returned non-JSON response: ${text.slice(0, 300) || 'empty response'}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${context} returned invalid JSON response: ${text.slice(0, 300) || 'empty response'}`);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await parseJsonResponse<{ error?: string; message?: string }>(response, url);
  if (!response.ok) {
    throw new Error(data.error || data.message || '요청 처리 중 오류가 발생했습니다.');
  }

  return data as T;
}

function buildVisionErrorMessage(data: VisionPdfResponse, fallback: string) {
  return [data.message || fallback, data.error, data.details]
    .filter(Boolean)
    .join(' · ');
}

function isLargePayloadError(error: unknown, responseStatus?: number) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return responseStatus === 413 || /request entity too large|function_payload_too_large|payload too large|413/i.test(message);
}

function getUploadErrorMessage(error: unknown, fallback: string, responseStatus?: number) {
  return isLargePayloadError(error, responseStatus) ? LARGE_FILE_UPLOAD_GUIDANCE : error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-bold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
    >
      {children}
    </button>
  );
}


function InputQualityPanel({ quality, compact = false }: { quality: ReturnType<typeof assessInputQuality>; compact?: boolean }) {
  const levelLabels: Record<typeof quality.level, string> = {
    low: '낮음',
    medium: '보통',
    high: '높음',
  };
  const tone = quality.isInsufficient
    ? compact
      ? 'border-amber-100 bg-amber-50/70 text-amber-900'
      : 'border-amber-200 bg-amber-50 text-amber-950'
    : compact
      ? 'border-emerald-100 bg-emerald-50/70 text-emerald-900'
      : 'border-emerald-200 bg-emerald-50 text-emerald-950';

  return (
    <div className={`${compact ? 'rounded-2xl p-4' : 'rounded-3xl p-5'} border ${tone}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-black">입력 정보 충분도: {levelLabels[quality.level]}</p>
          <h3 className={`${compact ? 'mt-1 text-lg' : 'mt-2 text-xl'} font-black`}>{quality.isInsufficient ? '추가 정보 입력 권장' : '입력 정보 품질 양호'}</h3>
          <p className={`${compact ? 'mt-1' : 'mt-2'} text-sm leading-6`}>{quality.guidance}</p>
        </div>
        <div className={`${compact ? 'rounded-xl px-3 py-2 text-xs' : 'rounded-2xl px-4 py-3 text-sm'} bg-white/70 font-semibold shadow-sm`}>
          브리프 {quality.briefLength.toLocaleString()}자 · 확인된 정보 {quality.presentItems.length}/9
        </div>
      </div>

      {quality.aiMissingInfo.length > 0 && !compact && (
        <div className="mt-4 rounded-2xl bg-white/70 p-4">
          <p className="text-sm font-bold">추가 확인이 필요한 정보</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {quality.aiMissingInfo.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {quality.missingItems.map((item) => (
            <div key={item.key} className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <p className="font-bold">{item.label}</p>
              <p className="mt-1 text-sm leading-5 opacity-80">{item.description}</p>
            </div>
          ))}
          {quality.missingItems.length === 0 && (
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm md:col-span-3">
              <p className="font-bold">자동 체크리스트 기준 필수 항목이 모두 확인되었습니다.</p>
              <p className="mt-1 text-sm opacity-80">AI가 표시한 추가 확인 필요 항목이 있다면 장표 생성 시 '확인 필요'로 반영됩니다.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DbSaveStatusIndicator({ status }: { status: DbSaveStatus }) {
  if (status === 'idle') return null;

  const statusConfig: Record<Exclude<DbSaveStatus, 'idle'>, { label: string; tone: string }> = {
    disabled: { label: 'DB save disabled', tone: 'border-slate-200 bg-slate-50 text-slate-600' },
    saving: { label: 'Saving analysis to DB', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
    saved: { label: 'Saved to DB', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    failed: { label: 'DB save failed, analysis still available', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
    partial: { label: 'Partial text saved', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  };

  const config = statusConfig[status];

  return (
    <div className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-xs font-black ${config.tone}`} role="status" aria-live="polite">
      {status === 'saving' && <span className="h-2 w-2 animate-pulse rounded-full bg-current" />}
      <span>{config.label}</span>
    </div>
  );
}


function getDocumentDbSaveStatusLabel(status?: UploadedDocument['dbSaveStatus']) {
  const statusConfig: Record<Exclude<DbSaveStatus, 'idle'>, { label: string; tone: string }> = {
    disabled: { label: 'DB upload disabled', tone: 'border-slate-200 bg-slate-50 text-slate-600' },
    saving: { label: 'Uploading to DB', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
    saved: { label: 'Saved to DB', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    failed: { label: 'DB upload failed', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
    partial: { label: 'Partial text saved', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  };

  if (!status || status === 'idle') return null;
  return statusConfig[status];
}

function LoadingOverlay({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-5 backdrop-blur-sm" role="status" aria-live="polite" aria-label="작업 진행 중">
      <div className="w-full max-w-md rounded-[2rem] border border-white/30 bg-white p-8 text-center shadow-2xl shadow-slate-950/30">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        </div>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.24em] text-blue-600">Processing</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">잠시만 기다려주세요</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{message}</p>
      </div>
    </div>
  );
}


function getVisionAnalysisLabel(document: UploadedDocument) {
  if (document.visionStatus === 'quick_analyzing' || document.extractionStatus === '빠른 Vision 분석 중') return '빠른 분석 중';
  if (document.visionStatus === 'quick_completed' || document.extractionStatus === '빠른 Vision 분석 완료') return '빠른 분석 완료';
  if (document.extractionStatus === '하이브리드 PDF 분석 중') return '하이브리드 분석 중';
  if (document.extractionStatus === '하이브리드 PDF 분석 완료') return '하이브리드 완료';
  if (document.visionStatus === 'analyzing' || document.extractionStatus === 'Vision 분석 중' || document.extractionStatus === '전체 Vision 분석 중') return '전체 분석 중';
  if (document.visionStatus === 'completed' || document.extractionStatus === 'Vision 분석 완료' || document.extractionStatus === '전체 Vision 분석 완료') return '전체 완료';
  if (document.visionStatus === 'partial' || document.extractionStatus === 'Vision 일부 완료') return '일부 완료';
  if (document.visionStatus === 'failed' || document.extractionStatus === 'Vision 분석 실패') return '실패';
  if (document.visionStatus === 'queued') return '대기';
  return document.visionUsed ? '사용' : '미사용';
}

function getVisionPageLabel(document: UploadedDocument) {
  if (document.visionStatus === 'quick_analyzing' || document.visionStatus === 'quick_completed' || document.visionStatus === 'analyzing' || document.extractionStatus === 'Vision 분석 중' || document.extractionStatus === '빠른 Vision 분석 중' || document.extractionStatus === '빠른 Vision 분석 완료' || document.extractionStatus === '전체 Vision 분석 중' || document.extractionStatus === '하이브리드 PDF 분석 중') {
    return `${document.visionPageCount ?? 0}/${document.totalPageCount ?? document.visionTotalPageCount ?? DEFAULT_VISION_CHUNK_SIZE}`;
  }

  if ((document.visionStatus === 'failed' || document.extractionStatus === 'Vision 분석 실패') && !document.visionPageCount) {
    return '-';
  }

  if (document.visionPageNumbers?.length) return `${document.visionPageCount ?? 0}/${document.visionPageNumbers.length}`;
  const totalPageCount = document.totalPageCount ?? document.visionTotalPageCount;
  if (document.visionPageCount !== undefined && totalPageCount) return `${document.visionPageCount}/${totalPageCount}`;
  if (document.visionPageCount !== undefined) return `${document.visionPageCount}p`;

  return '-';
}

function UploadedDocumentsList({
  documents,
}: {
  documents: UploadedDocument[];
}) {
  const statusTone: Record<ExtractionStatus, string> = {
    '텍스트 추출 중': 'bg-blue-50 text-blue-700 ring-blue-200',
    '텍스트 추출 완료': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    '일부 텍스트만 추출': 'bg-amber-50 text-amber-800 ring-amber-200',
    '텍스트 추출 실패': 'bg-red-50 text-red-700 ring-red-200',
    '텍스트 품질 낮음': 'bg-amber-50 text-amber-800 ring-amber-200',
    '이미지 중심 PDF 가능성 높음': 'bg-amber-50 text-amber-800 ring-amber-200',
    'OCR 필요': 'bg-blue-50 text-blue-700 ring-blue-200',
    'OCR 추출 완료': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    'OCR 일부 추출': 'bg-amber-50 text-amber-800 ring-amber-200',
    'OCR 추출 실패': 'bg-red-50 text-red-700 ring-red-200',
    '이미지 중심 PDF로 판단': 'bg-purple-50 text-purple-700 ring-purple-200',
    '빠른 Vision 분석 중': 'bg-blue-50 text-blue-700 ring-blue-200',
    '빠른 Vision 분석 완료': 'bg-sky-50 text-sky-700 ring-sky-200',
    '전체 Vision 분석 중': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    '전체 Vision 분석 완료': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    '하이브리드 PDF 분석 중': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    '하이브리드 PDF 분석 완료': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    'Vision 분석 중': 'bg-blue-50 text-blue-700 ring-blue-200',
    'Vision 분석 완료': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    'Vision 일부 완료': 'bg-amber-50 text-amber-800 ring-amber-200',
    'Vision 분석 실패': 'bg-red-50 text-red-700 ring-red-200',
    '추가 메모 입력 필요': 'bg-red-50 text-red-700 ring-red-200',
    '이미지 중심 문서 / OCR 필요': 'bg-slate-100 text-slate-700 ring-slate-200',
    '추출 실패': 'bg-red-50 text-red-700 ring-red-200',
  };

  if (!documents.length) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-white/70 p-4 text-sm font-semibold text-slate-600">
        아직 업로드된 파일이 없습니다. 파일을 업로드하면 추출 원문 대신 파일별 추출 상태만 표시됩니다.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-blue-100 bg-white">
      <div className="grid grid-cols-12 gap-3 border-b border-blue-100 bg-blue-50 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-blue-700">
        <span className="col-span-3">문서명</span>
        <span className="col-span-1">문서 유형</span>
        <span className="col-span-2">추출 상태</span>
        <span className="col-span-2">주요 category</span>
        <span className="col-span-1 text-center">chunk</span>
        <span className="col-span-1 text-center">high</span>
        <span className="col-span-1 text-center">Vision</span>
        <span className="col-span-1 text-right">글자</span>
      </div>
      <div className="divide-y divide-slate-100">
        {documents.map((document, index) => (
          <div key={document.id || `${document.fileName}-${index}`} className="grid grid-cols-12 gap-3 px-4 py-4 text-sm text-slate-700">
            <div className="col-span-12 font-bold text-slate-950 md:col-span-3">{document.fileName}</div>
            <div className="col-span-3 text-xs font-bold md:col-span-1">
              <p>{document.documentRole ?? inferUploadedDocumentRole(document.fileName, document.documentAnalysisText || document.extractedText)}</p>
              <p className="mt-1 text-[10px] text-slate-400">{document.documentType ?? inferDocumentType(document.fileName)}</p>
            </div>
            <div className="col-span-9 md:col-span-2">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusTone[document.extractionStatus]}`}>
                {document.extractionStatus}
              </span>
              {document.warningMessage && <p className="mt-2 text-xs leading-5 text-slate-500">{document.warningMessage}</p>}
              {document.visionPageNumbers?.length ? <p className="mt-2 text-xs leading-5 text-indigo-700">Vision 분석 페이지: {formatPageNumberList(document.visionPageNumbers)} · 텍스트 사용 페이지: {formatPageNumberList(document.textExtractionPageNumbers ?? [])}</p> : null}
              {document.failedChunks?.length ? <p className="mt-2 text-xs leading-5 text-slate-500">실패 구간: {formatFailedChunks(document.failedChunks)}</p> : null}
              {document.failedPages?.length ? <p className="mt-2 text-xs font-semibold leading-5 text-red-600">재시도 후 실패 페이지: {formatFailedPages(document.failedPages)}</p> : null}
              {document.errorMessage && document.errorMessage !== document.warningMessage && <p className="mt-2 text-xs font-semibold leading-5 text-red-600">{document.errorMessage}</p>}
              {(() => {
                const dbStatus = getDocumentDbSaveStatusLabel(document.dbSaveStatus);
                return dbStatus ? (
                  <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${dbStatus.tone}`}>
                    {document.dbSaveStatus === 'saving' && <span className="mr-2 h-1.5 w-1.5 animate-pulse self-center rounded-full bg-current" />}
                    {dbStatus.label}{document.dbChunkCount !== undefined ? ` · ${document.dbChunkCount} chunks` : ''}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="col-span-6 text-xs leading-5 text-slate-600 md:col-span-2">{getTopCategories(document)}</div>
            <div className="col-span-2 text-center text-xs font-bold tabular-nums md:col-span-1">{(document.chunks ?? []).length}</div>
            <div className="col-span-2 text-center text-xs font-bold tabular-nums text-red-600 md:col-span-1">{getHighImportanceChunkCount(document)}</div>
            <div className="col-span-2 text-center text-xs font-bold md:col-span-1">
              {getVisionAnalysisLabel(document)} · {getVisionPageLabel(document)}
            </div>
            <div className="col-span-12 text-right font-semibold tabular-nums md:col-span-1">
              {document.extractedCharCount.toLocaleString()}자
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalysisSectionPanel({ title, section }: { title: string; section?: AnalysisResult['rfpRequirements'] }) {
  const safeSection = section ?? { rfpFact: [], aiProposal: [], confirmNeeded: [] };
  const columns = [
    ['RFP Fact', safeSection.rfpFact, 'border-slate-200 bg-slate-50 text-slate-700'],
    ['AI Proposal', safeSection.aiProposal, 'border-blue-100 bg-blue-50 text-blue-800'],
    ['Confirm Needed', safeSection.confirmNeeded, 'border-amber-100 bg-amber-50 text-amber-900'],
  ] as const;

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-sm font-bold text-slate-950">{title}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {columns.map(([label, items, tone]) => (
          <div key={label} className={`rounded-2xl border p-3 ${tone}`}>
            <p className="text-xs font-black uppercase tracking-[0.12em]">{label}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
              {items.length ? items.map((item, index) => <li key={`${label}-${item}-${index}`}>{item}</li>) : <li>해당 없음</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}


const INITIAL_EVIDENCE_VISIBLE_COUNT = 4;

function RetrievalEvidencePanel({ evidence }: { evidence?: RetrievalEvidenceItem[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (!evidence?.length) return null;

  const visibleEvidence = showAll ? evidence : evidence.slice(0, INITIAL_EVIDENCE_VISIBLE_COUNT);
  const hiddenCount = Math.max(evidence.length - visibleEvidence.length, 0);
  const highImportanceCount = evidence.filter((item) => item.importance === 'high').length;
  const categorySummary = Array.from(
    evidence.reduce((counts, item) => {
      (item.categories?.length ? item.categories : [item.category]).forEach((category) => counts.set(category, (counts.get(category) ?? 0) + 1));
      return counts;
    }, new Map<string, number>()),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category)
    .join(' / ');

  return (
    <div className="rounded-3xl border border-cyan-100 bg-cyan-50 p-5 text-cyan-950">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-700">검색 근거 자료</p>
          <h3 className="mt-2 text-xl font-black">RAG Retrieval Evidence</h3>
          <p className="mt-2 text-sm font-bold text-cyan-800">
            근거 {evidence.length}건 · High {highImportanceCount}건 · {categorySummary ? `${categorySummary} 중심` : 'category 미분류'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsExpanded((current) => !current);
            setShowAll(false);
          }}
          className="w-full rounded-2xl border border-cyan-200 bg-white px-4 py-3 text-sm font-black text-cyan-700 transition hover:bg-cyan-100 md:w-auto"
          aria-expanded={isExpanded}
        >
          {isExpanded ? '근거 자료 접기' : '근거 자료 보기'}
        </button>
      </div>

      {isExpanded && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {visibleEvidence.map((item, index) => (
              <div key={`${item.sourceDocument}-${item.pageNumber ?? 'na'}-${index}`} className="rounded-2xl bg-white/80 p-4 text-sm leading-6 shadow-sm">
                <p className="font-black text-cyan-800">{item.sourceDocument}</p>
                <p className="mt-1 text-xs font-bold text-cyan-700">
                  {item.pageNumber ? `${item.pageNumber}p` : '페이지 미상'} · {(item.categories?.length ? item.categories : [item.category]).slice(0, 5).join(' / ')}
                  {item.importance ? ` · ${item.importance}` : ''}
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-800">
                  {(item.bulletSummary?.length ? item.bulletSummary : [item.shortExcerpt]).map((bullet, bulletIndex) => (
                    <li key={`${bullet}-${bulletIndex}`}>{bullet}</li>
                  ))}
                </ul>
                {item.shortExcerpt && (
                  <details className="mt-3 rounded-xl bg-cyan-50 px-3 py-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-bold text-cyan-700">원문 excerpt 보기</summary>
                    <p className="mt-2 leading-5">{item.shortExcerpt}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-2xl border border-cyan-200 bg-white px-4 py-2 text-sm font-black text-cyan-700 transition hover:bg-cyan-100"
              >
                근거 {hiddenCount}개 더 보기
              </button>
            )}
            {showAll && evidence.length > INITIAL_EVIDENCE_VISIBLE_COUNT && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="rounded-2xl border border-cyan-200 bg-white px-4 py-2 text-sm font-black text-cyan-700 transition hover:bg-cyan-100"
              >
                기본 근거만 보기
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function uniqueItems(items: Array<string | undefined>) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]));
}

function CompactBulletSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-blue-700">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {items.slice(0, 8).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
      {items.length > 8 && <p className="mt-2 text-xs font-bold text-slate-500">외 {items.length - 8}개 항목은 후속 생성 단계에서 근거로 유지됩니다.</p>}
    </div>
  );
}

type ConfirmationInfo = {
  analysisNeeds: string[];
  checklistMissingItems: ReturnType<typeof assessInputQuality>['missingItems'];
  aiMissingInfo: string[];
  items: string[];
  count: number;
};

function AdditionalInfoRecommendationPanel({ confirmationInfo }: { confirmationInfo: ConfirmationInfo }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-700">추가 정보 입력 권장</p>
          <h3 className="mt-1 text-lg font-black">확인 필요 {confirmationInfo.count}건 · 추가 입력 시 분석 정확도 향상</h3>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm font-black text-amber-800 transition hover:bg-amber-100 md:w-auto"
          aria-expanded={isExpanded}
        >
          {isExpanded ? '상세 항목 접기' : '상세 항목 보기'}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
            <p className="text-sm font-bold text-amber-900">AI 확인 필요 항목</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
              {confirmationInfo.analysisNeeds.length ? confirmationInfo.analysisNeeds.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>현재 AI 확인 필요 항목이 없습니다.</li>}
            </ul>
          </div>
          <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
            <p className="text-sm font-bold text-amber-900">자동 체크리스트 부족 항목</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
              {confirmationInfo.checklistMissingItems.length ? confirmationInfo.checklistMissingItems.map((item) => (
                <li key={item.key}>
                  <span className="font-semibold">{item.label}</span>: {item.description}
                </li>
              )) : <li>자동 체크리스트 기준 필수 항목이 모두 확인되었습니다.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

type RfpSummarySection = {
  title: string;
  text: string;
};

function normalizeSummarySentence(value: string) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

function splitSummarySentences(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  return sentences.length ? sentences : [normalized];
}

function getEvidenceCategoryCandidates(evidence: RetrievalEvidenceItem[] | undefined, category: string) {
  return uniqueItems(
    (evidence ?? [])
      .filter((item) => (item.categories?.length ? item.categories : [item.category]).includes(category))
      .flatMap((item) => (item.bulletSummary?.length ? item.bulletSummary : [item.shortExcerpt])),
  );
}

function buildRfpSummarySectionText(candidates: string[], usedSentences: Set<string>, maxSentences = 3) {
  const selected: string[] = [];

  candidates.some((candidate) => {
    return splitSummarySentences(candidate).some((sentence) => {
      const normalized = normalizeSummarySentence(sentence);
      if (!normalized || usedSentences.has(normalized)) return false;

      selected.push(sentence);
      usedSentences.add(normalized);
      return selected.length >= maxSentences;
    });
  });

  return selected.join(' ');
}

function buildRfpSummarySections(data: AnalysisResult, evidence?: RetrievalEvidenceItem[]): RfpSummarySection[] {
  const usedSentences = new Set<string>();
  const sectionConfigs = [
    {
      title: '프로젝트 배경',
      category: 'backgroundInsight',
      fallback: [data.clientChallenge, ...(data.numericInfo?.currentIssue ?? [])],
    },
    {
      title: '프로젝트 목적',
      category: 'projectObjective',
      fallback: [data.projectOverview],
    },
    {
      title: '운영 방향',
      category: 'operationDirection',
      fallback: [data.operationCondition, data.contentCondition, data.spatialCondition, data.targetInfo],
    },
    {
      title: '핵심 과제',
      category: 'requiredDeliverables',
      fallback: [
        ...(data.requiredDeliverables ?? []),
        ...(data.taskSections?.map((section) => section.taskTitle) ?? []),
        ...(data.scopeOfWork ?? []),
      ],
    },
  ];

  return sectionConfigs.map(({ title, category, fallback }) => {
    const categoryCandidates = getEvidenceCategoryCandidates(evidence, category);
    const text = buildRfpSummarySectionText(categoryCandidates.length ? categoryCandidates : uniqueItems(fallback), usedSentences);
    return { title, text: text || 'RFP 원문 또는 추가 입력에서 확인이 필요합니다.' };
  });
}

function RfpSummaryPanel({ sections }: { sections: RfpSummarySection[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 md:col-span-2">
      <p className="text-sm font-semibold text-blue-700">RFP Summary</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="rounded-2xl bg-slate-50 p-3">
            <p className="text-sm font-black text-slate-900">{section.title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">{section.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyValueList({ data, evidence }: { data: AnalysisResult; evidence?: RetrievalEvidenceItem[] }) {
  const rfpSummarySections = buildRfpSummarySections(data, evidence);
  const rfpSummaryContent = new Set(rfpSummarySections.flatMap((section) => splitSummarySentences(section.text).map((item) => item.trim())));
  const requiredProposalItems = uniqueItems([
    ...(data.requiredDeliverables ?? []),
    ...(data.requiredItems ?? []),
    ...(data.taskSections?.flatMap((section) => section.requiredDeliverables) ?? []),
  ]).filter((item) => !rfpSummaryContent.has(item.trim()));
  const goalsAndKpis = uniqueItems([
    ...(data.kpiObjectives ?? []),
    ...(data.numericInfo?.targetKPI ?? []),
    ...(data.numericInfo?.proposedMeasurement ?? []),
  ]);
  const constraintsAndNotes = uniqueItems([
    ...(data.constraints ?? []),
    ...(data.existingAssets ?? []),
    ...(data.doNotTreatAsScope ?? []),
    data.spatialCondition,
    data.contentCondition,
    data.operationCondition,
    ...(data.taskSections?.flatMap((section) => [...section.existingAssets, ...section.constraints, ...section.referenceMentions]) ?? []),
  ]);
  const scheduleAndEvaluation = uniqueItems([
    ...(data.schedule ?? []),
    ...(data.evaluationCriteria ?? []),
    ...(data.kpiScheduleConstraints ?? []),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-sm font-semibold text-blue-700">프로젝트 개요</p>
        <p className="mt-1 text-slate-800">{data.projectOverview}</p>
      </div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-sm font-semibold text-blue-700">RFP 기반 제안서 유형</p>
        <p className="mt-1 text-slate-800">{data.inferredProposalType ? proposalTypeLabels[data.inferredProposalType] : '해당 없음'} · {data.proposalTypeReasoning}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <RfpSummaryPanel sections={rfpSummarySections} />
        <CompactBulletSection title="핵심 목표 / KPI" items={goalsAndKpis} />
        <CompactBulletSection title="필수 제안 항목" items={requiredProposalItems} />
        <CompactBulletSection title="주요 제약 / 참고 사항" items={constraintsAndNotes} />
        <CompactBulletSection title="일정 / 평가 기준" items={scheduleAndEvaluation} />
      </div>
    </div>
  );
}



function conceptRationaleRows(concept: ConceptCandidate) {
  const rationale = concept.conceptRationale;
  if (!rationale) return [];

  return [
    ['문제 인식', rationale.problemInsight],
    ['발주처 니즈', rationale.clientNeed],
    ['관람객 장벽', rationale.audienceBarrier],
    ['전략적 전환', rationale.strategicShift],
    ['컨셉 도출 이유', rationale.whyThisConcept],
  ].filter(([, value]) => Boolean(value?.trim()));
}

function scoreSummary(concept: ConceptCandidate) {
  const scores = concept.evaluationScores;
  if (!scores) return '평가 점수 없음';

  return [
    `RFP ${scores.rfpFitScore}`,
    `타깃 ${scores.targetFitScore}`,
    `차별화 ${scores.differentiationScore}`,
    `공간 ${scores.spatialFeasibilityScore}`,
    `확산 ${scores.viralPotentialScore}`,
    `운영 ${scores.operationFeasibilityScore}`,
  ].join(' / ');
}


function ProposalNarrativePanel({ narrative }: { narrative?: ProposalNarrative }) {
  if (!narrative) return null;

  const rows = [
    ['Market Context', narrative.marketContext],
    ['Core Problem', narrative.coreProblem],
    ['Strategic Opportunity', narrative.strategicOpportunity],
    ['Proposal Thesis', narrative.proposalThesis],
    ['Why Now', narrative.whyNow],
    ['Why Us', narrative.whyUs],
    ['Why This Concept', narrative.whyThisConcept],
  ];

  return (
    <div className="mt-6 rounded-3xl border border-violet-100 bg-violet-50 p-5 text-violet-950">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-violet-700">Proposal Narrative</p>
      <h3 className="mt-2 text-xl font-black">설득형 제안 내러티브</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rows.filter(([, value]) => Boolean(value?.trim())).map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white/80 p-3 text-sm leading-6">
            <p className="font-black text-violet-800">{label}</p>
            <p>{value}</p>
          </div>
        ))}
      </div>
      {narrative.narrativeFlow?.length ? (
        <div className="mt-4 rounded-2xl bg-white/80 p-3 text-sm leading-6">
          <p className="font-black text-violet-800">Narrative Flow</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {narrative.narrativeFlow.map((flow, index) => <li key={`${flow.stage}-${index}`}><span className="font-bold">{flow.stage}</span> · {flow.purpose}</li>)}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function ConceptDevelopmentLogicPanel({ logic }: { logic?: ConceptDevelopmentLogic }) {
  if (!logic) return null;

  const rows = [
    ['Winning Strategy Brief', logic.winningStrategyBrief],
    ['Proposal Thesis', logic.proposalThesis],
    ['Experience Logic', logic.experienceLogic],
    ['Client Intent', logic.clientIntent],
    ['Audience Takeaway', logic.audienceTakeaway],
    ['Strategic Tension', logic.strategicTension],
    ['Concept Seed', logic.conceptSeed],
    ['핵심 과제', logic.coreChallenge],
    ['타깃 인사이트', logic.targetInsight],
    ['브랜드/제품 가치', logic.brandOrProductValue],
    ['경험 기회', logic.experienceOpportunity],
    ['전략 접근', logic.strategicApproach],
    ['콘셉트 필연성', logic.conceptNecessity],
    ['선택 콘셉트 실행 연결', logic.selectedConceptReason],
  ];

  return (
    <div className="mt-6 rounded-3xl border border-indigo-100 bg-indigo-50 p-5 text-indigo-950">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-indigo-700">Strategy + Experience Approach</p>
      <h3 className="mt-2 text-xl font-black">전략 메시지 추출 및 경험 설계 접근</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rows.filter(([, value]) => Boolean(value?.trim())).map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white/80 p-3 text-sm leading-6">
            <p className="font-black text-indigo-800">{label}</p>
            <p>{value}</p>
          </div>
        ))}
      </div>
      {logic.conceptDevelopmentCriteria?.length ? (
        <div className="mt-4 rounded-2xl bg-white/80 p-3 text-sm leading-6">
          <p className="font-black text-indigo-800">컨셉 개발 기준</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {logic.conceptDevelopmentCriteria.map((criterion, index) => <li key={`${criterion}-${index}`}>{criterion}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ConceptRecommendationPanel({ recommendation }: { recommendation?: ConceptRecommendation }) {
  if (!recommendation) return null;

  return (
    <div className="mt-6 rounded-3xl border border-emerald-100 bg-emerald-50 p-5 text-emerald-950">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-700">AI Recommendation</p>
      <h3 className="mt-2 text-xl font-black">AI 추천 콘셉트: {recommendation.recommendedConceptId}</h3>
      <p className="mt-3 text-sm leading-6"><span className="font-black">추천 이유</span><br />{recommendation.recommendationReason}</p>
      <p className="mt-3 text-sm leading-6"><span className="font-black">다른 후보 보류 이유</span><br />{recommendation.whyNotOthers}</p>
      <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-sm font-bold text-emerald-800">AI 추천은 참고용이며, 최종 선택은 사용자가 직접 진행합니다.</p>
    </div>
  );
}

function getAnalysisConfirmationNeeds(analysis?: AnalysisResult) {
  if (!analysis) return [];
  return uniqueItems([...(analysis.confirmNeeded ?? []), ...(analysis.missingInfo ?? [])]).slice(0, 12);
}

function getConfirmationInfo(analysis: AnalysisResult | undefined, quality: ReturnType<typeof assessInputQuality>): ConfirmationInfo {
  const analysisNeeds = getAnalysisConfirmationNeeds(analysis);
  const items = uniqueItems([
    ...analysisNeeds,
    ...quality.missingItems.map((item) => item.label),
    ...quality.aiMissingInfo,
  ]);

  return {
    analysisNeeds,
    checklistMissingItems: quality.missingItems,
    aiMissingInfo: quality.aiMissingInfo,
    items,
    count: items.length,
  };
}

function buildSupplementalInfoBlock(info: SupplementalInfo) {
  const lines = supplementalInfoFields
    .map((field) => {
      const value = info[field.key].trim();
      return value ? `${field.label}: ${value}` : '';
    })
    .filter(Boolean);

  return lines.length ? `${supplementalInfoMarker}\n${lines.join('\n')}` : '';
}

function mergeInputWithSupplementalInfo(input: ProjectInput, info: SupplementalInfo): ProjectInput {
  const supplementalBlock = buildSupplementalInfoBlock(info);
  if (!supplementalBlock) return input;

  const originalBrief = input.briefText.split(supplementalInfoMarker)[0].trim();

  return {
    ...input,
    briefText: `${originalBrief}\n\n${supplementalBlock}`.trim(),
  };
}


function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function getFileTypeLabel(fileName: string) {
  const extension = getFileExtension(fileName);
  return extension ? extension.toUpperCase() : '알 수 없음';
}

function getVisionProcessingMessage(processedPageCount?: number, totalPageCount?: number) {
  const progress = totalPageCount ? `페이지: ${processedPageCount ?? 0}/${totalPageCount}` : undefined;
  return [VISION_PROCESSING_GUIDANCE, progress, VISION_PROCESSING_PAGE_LIMIT_MESSAGE].filter(Boolean).join(' ');
}

function enrichDocumentWithChunks(document: UploadedDocument): UploadedDocument {
  const text = (document.documentAnalysisText || document.extractedText || '').trim();
  const documentRole = document.documentRole ?? inferUploadedDocumentRole(document.fileName, document.documentAnalysisText || document.extractedText);
  const documentType = document.documentType ?? mapStorageRoleToDocumentType(documentRole) ?? inferDocumentType(document.fileName);
  const sourceType = document.visionUsed ? 'visionAnalysis' : 'textExtraction';
  const chunks = text
    ? createDocumentChunks({
        documentId: document.id,
        documentName: document.fileName,
        documentType,
        text,
        sourceType,
        pageSources: document.pageTextSources,
        visionPages: document.pageTextSources?.length ? undefined : document.visionAnalysis?.map((page) => ({
          pageNumber: page.pageNumber,
          extractedText: page.extractedText,
          visualSummary: page.visualSummary,
        })),
      })
    : [];

  return { ...document, documentRole, documentType, chunks };
}

function getAllDocumentChunks(documents: UploadedDocument[] = []) {
  return documents.flatMap((document) => document.chunks ?? []);
}

function parseAnalysisApiResponse(response: AnalysisApiResponse) {
  if ('result' in response) return response;
  return { result: response, evidence: [] };
}

const chunkImportanceWeight = { high: 3, medium: 2, low: 1 } as const;

function getTopCategories(document: UploadedDocument) {
  const categoryStats = new Map<string, { categoryCount: number; importanceScore: number; highChunkCount: number }>();

  (document.chunks ?? []).forEach((chunk) => {
    const categories = chunk.categories?.length ? chunk.categories : [chunk.category];
    const weight = chunkImportanceWeight[chunk.importance] ?? chunkImportanceWeight.low;

    categories.forEach((category) => {
      const current = categoryStats.get(category) ?? { categoryCount: 0, importanceScore: 0, highChunkCount: 0 };
      categoryStats.set(category, {
        categoryCount: current.categoryCount + 1,
        importanceScore: current.importanceScore + weight,
        highChunkCount: current.highChunkCount + (chunk.importance === 'high' ? 1 : 0),
      });
    });
  });

  return Array.from(categoryStats.entries())
    .sort(
      (a, b) =>
        b[1].importanceScore - a[1].importanceScore ||
        b[1].highChunkCount - a[1].highChunkCount ||
        b[1].categoryCount - a[1].categoryCount ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, 5)
    .map(([category, stats]) => `${category} ${stats.categoryCount}`)
    .join(', ') || '-';
}

function getHighImportanceChunkCount(document: UploadedDocument) {
  return (document.chunks ?? []).filter((chunk) => chunk.importance === 'high').length;
}

function formatFailedChunks(failedChunks: NonNullable<UploadedDocument['failedChunks']>) {
  return failedChunks.map((chunk) => `${chunk.pageStart}~${chunk.pageEnd}p`).join(', ');
}

function formatFailedPages(failedPages: NonNullable<UploadedDocument['failedPages']>) {
  return failedPages.map((page) => `${page.pageNumber}p`).join(', ');
}


function formatPageNumberList(pageNumbers: number[]) {
  const sorted = Array.from(new Set(pageNumbers)).sort((a, b) => a - b);
  if (!sorted.length) return '-';

  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const pageNumber of sorted.slice(1)) {
    if (pageNumber === previous + 1) {
      previous = pageNumber;
      continue;
    }
    ranges.push(start === previous ? `${start}p` : `${start}~${previous}p`);
    start = pageNumber;
    previous = pageNumber;
  }

  ranges.push(start === previous ? `${start}p` : `${start}~${previous}p`);
  return ranges.join(', ');
}

function buildTextPageSources(pages: ExtractedPdfPage[] = [], visionPageNumbers: number[] = []) {
  const visionPageSet = new Set(visionPageNumbers);
  return pages
    .filter((page) => !visionPageSet.has(page.pageNumber) && page.text.trim().length >= MIN_EXTRACTED_TEXT_LENGTH)
    .map((page) => ({ pageNumber: page.pageNumber, text: `[Text Page ${page.pageNumber}]\n${page.text.trim()}`, sourceType: 'textExtraction' as const }));
}

function mergeHybridPageSources(textPageSources: NonNullable<UploadedDocument['pageTextSources']>, visionPages: VisionPageAnalysis[] = []) {
  const visionSources = visionPages.map((page) => ({
    pageNumber: page.pageNumber,
    slideNumber: undefined,
    text: [page.extractedText, page.visualSummary].filter(Boolean).join('\n'),
    sourceType: 'visionAnalysis' as const,
    visualSummary: page.visualSummary,
  }));

  return [...textPageSources, ...visionSources]
    .filter((page) => page.text.trim())
    .sort((a, b) => (a.pageNumber ?? a.slideNumber ?? 0) - (b.pageNumber ?? b.slideNumber ?? 0));
}

function buildSlideTextSources(slides: ExtractedPptxSlide[] = []) {
  return slides
    .filter((slide) => slide.text.trim())
    .map((slide) => ({
      slideNumber: slide.slideNumber,
      sectionTitle: slide.title,
      text: slide.text.trim(),
      sourceType: 'textExtraction' as const,
    }));
}

function buildDocumentTextFromPageSources(pageSources: NonNullable<UploadedDocument['pageTextSources']>) {
  return pageSources.map((page) => page.text.trim()).filter(Boolean).join('\n\n');
}

function getSuccessfulUploadedDocuments(documents: UploadedDocument[] = []) {
  return documents.filter((document) =>
    (document.extractionStatus === '텍스트 추출 완료' ||
      document.extractionStatus === '일부 텍스트만 추출' ||
      document.extractionStatus === 'OCR 추출 완료' ||
      document.extractionStatus === 'OCR 일부 추출' ||
      document.extractionStatus === '빠른 Vision 분석 완료' ||
      document.extractionStatus === '전체 Vision 분석 중' ||
      document.extractionStatus === '전체 Vision 분석 완료' ||
      document.extractionStatus === '하이브리드 PDF 분석 중' ||
      document.extractionStatus === '하이브리드 PDF 분석 완료' ||
      document.extractionStatus === 'Vision 분석 완료' ||
      document.extractionStatus === 'Vision 일부 완료') &&
    document.extractedText.trim(),
  );
}

function buildAnalysisBriefText(input: ProjectInput, documents: UploadedDocument[] = []) {
  const documentBlocks = getSuccessfulUploadedDocuments(documents).map((document, index) =>
    `[업로드 자료 ${index + 1}: ${document.fileName}]\n${(document.documentAnalysisText || document.extractedText).trim()}`, 
  );
  const memo = input.briefText.trim();
  if (memo) {
    documentBlocks.push(`[사용자 추가 메모]\n${memo}`);
  }

  return documentBlocks.join('\n\n').trim();
}

function appendUploadedDocument(document: UploadedDocument) {
  return (current: ProposalState): ProposalState => ({
    ...current,
    uploadedDocuments: [...(current.uploadedDocuments ?? []), document],
    analysis: undefined,
    analysisBasis: undefined,
    conceptDevelopmentLogic: undefined,
    conceptCandidates: undefined,
    conceptRecommendation: undefined,
    conceptGenerationResult: undefined,
    proposalNarrative: undefined,
    selectedConcept: undefined,
    outline: undefined,
    slides: undefined,
  });
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'proposal';
}

function hasText(value?: string) {
  return Boolean(value?.trim());
}

function labelValue(label: string, value?: string) {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

function getImagePlaceholder(slide: SlideContent) {
  return sanitizeImagePlaceholderForPpt(slide.imagePlaceholder);
}

function buildStructuredSlideLines(slide: SlideContent) {
  const assetLines = slide.keyExperienceAssets?.slice(0, 3).flatMap((asset, index) => [
    `[Asset ${index + 1}] ${asset.assetName}`,
    labelValue('Role', asset.roleInProposal),
    labelValue('Visitor Action', asset.visitorAction),
    labelValue('Mechanism', asset.experienceMechanism),
    labelValue('Placement', asset.spatialPlacement),
    labelValue('Media/Object', asset.mediaOrObject),
    labelValue('Output/Reward', asset.outputOrReward),
    labelValue('Why', asset.whyItMatters),
  ].filter(Boolean) as string[]) ?? [];

  const productLines = slide.productExperienceDetails?.flatMap((product) => [
    `[${product.productCode}] ${product.experienceTitle || product.productRole}`,
    labelValue('Mission', product.visitorMission),
    labelValue('Visitor Action', product.visitorAction),
    labelValue('System Response', product.systemResponse),
    labelValue('Placement', product.spatialPlacement),
    labelValue('Media/Object', product.mediaOrObject),
    labelValue('Output/Reward', product.outputOrReward),
    labelValue('SNS Share', product.snsSharePoint),
  ].filter(Boolean) as string[]) ?? [];

  const scenarioLines = slide.experienceScenarioSteps?.map((step) =>
    `${step.step} | ${step.visitorAction} → ${step.systemResponse} → ${step.output}`
  ) ?? [];

  const referenceLines = slide.referenceInsights?.flatMap((reference, index) => [
    `[Reference ${index + 1}] ${reference.referenceName}`,
    labelValue('Reference Type', reference.referenceType),
    labelValue('What to Learn', reference.whatToLearn),
    labelValue('How to Apply', reference.howToApply),
    labelValue('Caution', reference.caution),
  ].filter(Boolean) as string[]) ?? [];

  return [...assetLines, ...productLines, ...scenarioLines, ...referenceLines];
}

async function downloadPptx(input: ProjectInput, slides: SlideContent[], selectedConcept?: ConceptCandidate) {
  const exportSlides = sanitizeFinalPptxSlides(sanitizeGeneratedSlides(removeInternalConceptComparisonSlides(slides)));
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AI Proposal Builder';
  pptx.subject = `${input.clientName} ${input.projectName}`;
  pptx.title = input.projectName;
  pptx.company = input.clientName;
  pptx.theme = {
    headFontFace: 'Arial',
    bodyFontFace: 'Arial',
  };

  exportSlides.forEach((slideData) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: '2563EB' }, line: { color: '2563EB' } });
    slide.addText(String(slideData.slideNumber).padStart(2, '0'), { x: 0.55, y: 0.35, w: 0.7, h: 0.3, fontSize: 11, color: '2563EB', bold: true });
    slide.addText(slideData.slideTitle, { x: 0.55, y: 0.7, w: 5.8, h: 0.55, fontSize: 24, bold: true, color: '111827', breakLine: false });
    slide.addText(slideData.keyMessage, { x: 0.58, y: 1.28, w: 5.8, h: 0.45, fontSize: 12, color: '475569' });
    const shouldShowConcept = selectedConcept && !isInternalConceptComparisonSlide(slideData) && /selected concept rationale|core concept|key experience asset|spatial \/ content|media \/ interactive|콘셉트|핵심 체험|공간|콘텐츠|미디어|인터랙/i.test(`${slideData.slideType} ${slideData.slideTitle}`);
    if (shouldShowConcept) {
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.72, y: 6.25, w: 11.95, h: 0.48, rectRadius: 0.08, fill: { color: 'EEF2FF' }, line: { color: 'C7D2FE' } });
      slide.addText(sanitizeFinalPptxText(`Core Concept: ${getPresentationConceptName(selectedConcept)} · ${selectedConcept.coreMessage}`), { x: 0.95, y: 6.36, w: 11.45, h: 0.18, fontSize: 8, color: '3730A3', bold: true, fit: 'shrink' });
    }
    slide.addShape(pptx.ShapeType.rect, { x: 6.75, y: 0.72, w: 5.9, h: 3.6, fill: { color: 'E5E7EB' }, line: { color: 'CBD5E1', transparency: 20 } });
    slide.addText(getImagePlaceholder(slideData), { x: 7.05, y: 2.0, w: 5.3, h: 0.7, align: 'center', valign: 'middle', fontSize: 14, color: '64748B', bold: true });
    const detailLines = [
      labelValue('Visitor Action', slideData.visitorAction),
      labelValue('Mechanism', slideData.contentMechanism),
      labelValue('Placement', slideData.spatialPlacement),
      labelValue('Media/Object', slideData.mediaOrObject),
      labelValue('Output/Reward', slideData.outputOrReward),
    ].filter(Boolean) as string[];
    const structuredLines = buildStructuredSlideLines(slideData);
    const bodyText = [...slideData.bodyBullets.map((bullet) => `• ${bullet}`), ...structuredLines.map((line) => `• ${line}`)].join('\n');
    slide.addText(bodyText, { x: 0.75, y: 1.9, w: 5.55, h: 2.0, fontSize: 13, color: '111827', breakLine: false, fit: 'shrink', valign: 'top' });
    if (detailLines.length) {
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.72, y: 4.05, w: 5.8, h: 1.0, rectRadius: 0.08, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } });
      slide.addText(detailLines.join('\n'), { x: 0.95, y: 4.17, w: 5.35, h: 0.75, fontSize: 7.8, color: '334155', fit: 'shrink', valign: 'top' });
    }
    if (hasText(slideData.visualDirection)) {
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 5.15, w: 11.95, h: 0.55, rectRadius: 0.08, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE' } });
      slide.addText(`Visual: ${slideData.visualDirection}`, { x: 0.95, y: 5.32, w: 11.45, h: 0.18, fontSize: 8.5, color: '1D4ED8', fit: 'shrink' });
    }
    const noteLines = [
      slideData.speakerNote,
    ].filter(Boolean) as string[];
    if (noteLines.length) {
      slide.addNotes(noteLines.join('\n'));
    }
    slide.addText(`${input.clientName} · ${proposalTypeLabels[input.proposalType]}`, { x: 0.55, y: 6.95, w: 5, h: 0.2, fontSize: 8, color: '94A3B8' });
  });

  await pptx.writeFile({ fileName: `${safeFileName(input.projectName)}_proposal.pptx` });
}

export default function Home() {
  const [step, setStep] = useState<Step>('home');
  const [state, setState] = useState<ProposalState>({ input: initialInput, supplementalInfo: initialSupplementalInfo, uploadedDocuments: [], dbUploadedDocuments: [] });
  const [loading, setLoading] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null);
  const [dbSaveStatus, setDbSaveStatus] = useState<DbSaveStatus>('idle');
  const [dbUploadRole, setDbUploadRole] = useState<'proposal' | 'reference' | 'memo'>('proposal');
  const [dbUploadNotice, setDbUploadNotice] = useState<UploadNotice | null>(null);
  const [isDbUploadModalOpen, setIsDbUploadModalOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ProposalState;
        setState(parsed);
        if (parsed.slides?.length) setStep('slides');
        else if (parsed.outline?.length) setStep('outline');
        else if (parsed.selectedConcept || parsed.conceptCandidates?.length) setStep('concepts');
        else if (parsed.analysis) setStep('analysis');
        else setStep('create');
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const supplementalInfo = state.supplementalInfo ?? initialSupplementalInfo;
  const uploadedDocuments = state.uploadedDocuments ?? [];
  const dbUploadedDocuments = state.dbUploadedDocuments ?? [];
  const latestDbUploadedDocument = dbUploadedDocuments.at(-1);
  const latestDbUploadStatus = getDocumentDbSaveStatusLabel(latestDbUploadedDocument?.dbSaveStatus);
  const analysisInput = useMemo(() => ({ ...state.input, briefText: buildAnalysisBriefText(state.input, uploadedDocuments) }), [state.input, uploadedDocuments]);
  const hasFastVisionAnalysisInProgress = uploadedDocuments.some((document) => document.visionStatus === 'quick_analyzing' || document.extractionStatus === '빠른 Vision 분석 중');
  const hasFullVisionAnalysisInProgress = uploadedDocuments.some((document) => document.visionStatus === 'analyzing' || document.extractionStatus === '전체 Vision 분석 중' || document.extractionStatus === '하이브리드 PDF 분석 중' || document.extractionStatus === 'Vision 분석 중');
  const hasVisionAnalysisInProgress = hasFastVisionAnalysisInProgress || hasFullVisionAnalysisInProgress;
  const hasPartialVisionAnalysisInput = uploadedDocuments.some((document) =>
    (document.visionStatus === 'quick_completed' || document.visionStatus === 'analyzing' || document.extractionStatus === '빠른 Vision 분석 완료' || document.extractionStatus === '전체 Vision 분석 중' || document.extractionStatus === '하이브리드 PDF 분석 중') &&
    Boolean((document.documentAnalysisText || document.extractedText).trim()) &&
    !(document.visionStatus === 'completed' || document.extractionStatus === '전체 Vision 분석 완료' || document.extractionStatus === '하이브리드 PDF 분석 완료' || document.extractionStatus === 'Vision 분석 완료'),
  );
  const partialVisionAnalysisDocument = uploadedDocuments.find((document) =>
    (document.visionStatus === 'quick_completed' || document.visionStatus === 'analyzing' || document.extractionStatus === '빠른 Vision 분석 완료' || document.extractionStatus === '전체 Vision 분석 중' || document.extractionStatus === '하이브리드 PDF 분석 중') &&
    Boolean((document.documentAnalysisText || document.extractedText).trim()) &&
    !(document.visionStatus === 'completed' || document.extractionStatus === '전체 Vision 분석 완료' || document.extractionStatus === '하이브리드 PDF 분석 완료' || document.extractionStatus === 'Vision 분석 완료'),
  );
  const hasUploadedDocumentOrRfp = useMemo(() => Boolean(analysisInput.briefText.trim()), [analysisInput.briefText]);
  const canAnalyze = useMemo(() => Boolean(state.input.projectName && state.input.clientName && analysisInput.briefText) && !hasFastVisionAnalysisInProgress, [state.input.clientName, state.input.projectName, analysisInput.briefText, hasFastVisionAnalysisInProgress]);
  const canGenerateProposalStructure = Boolean(state.selectedConcept && state.analysis && hasUploadedDocumentOrRfp);
  const activeVisionDocument = uploadedDocuments.find((document) => document.visionStatus === 'quick_analyzing' || document.visionStatus === 'analyzing' || document.extractionStatus === 'Vision 분석 중' || document.extractionStatus === '빠른 Vision 분석 중' || document.extractionStatus === '전체 Vision 분석 중' || document.extractionStatus === '하이브리드 PDF 분석 중');
  const currentUploadNotice = activeVisionDocument?.warningMessage
    ? { type: 'warning' as const, message: activeVisionDocument.warningMessage }
    : uploadNotice;
  const inputQuality = useMemo(() => assessInputQuality(analysisInput, step === 'analysis' ? state.analysis : undefined), [analysisInput, state.analysis, step]);
  const documentChunks = useMemo(() => getAllDocumentChunks(uploadedDocuments.map(enrichDocumentWithChunks)), [uploadedDocuments]);
  const confirmationInfo = useMemo(() => getConfirmationInfo(state.analysis, inputQuality), [state.analysis, inputQuality]);
  const hasConfirmationNeeds = confirmationInfo.count > 0;
  const shouldShowShortBriefGuidance = analysisInput.briefText.trim().length > 0 && analysisInput.briefText.trim().length < 220;

  const updateInput = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => {
    setState((current) => ({ ...current, input: { ...current.input, [key]: value }, analysis: undefined, analysisBasis: undefined, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, proposalNarrative: undefined, selectedConcept: undefined, outline: undefined, slides: undefined }));
  };

  const updateSupplementalInfo = <K extends keyof SupplementalInfo>(key: K, value: SupplementalInfo[K]) => {
    setState((current) => ({
      ...current,
      supplementalInfo: { ...(current.supplementalInfo ?? initialSupplementalInfo), [key]: value },
    }));
  };


  const addUploadedDocument = (document: UploadedDocument, noticeType: UploadNotice['type'], message: string) => {
    setState(appendUploadedDocument(document));
    setUploadNotice({ type: noticeType, message });
  };

  const updateUploadedDocument = (documentId: string, patch: Partial<UploadedDocument>) => {
    setState((current) => ({
      ...current,
      uploadedDocuments: (current.uploadedDocuments ?? []).map((item) => (item.id === documentId ? enrichDocumentWithChunks({ ...item, ...patch }) : item)),
    }));
  };

  const persistUploadedDocumentSafely = async (document: UploadedDocument) => {
    const enrichedDocument = enrichDocumentWithChunks(document);
    const role = enrichedDocument.documentRole ?? inferUploadedDocumentRole(enrichedDocument.fileName, enrichedDocument.documentAnalysisText || enrichedDocument.extractedText);

    if (role === 'rfp' || !enrichedDocument.chunks?.length) return;

    updateUploadedDocument(enrichedDocument.id, { dbSaveStatus: 'saving' });

    try {
      const response = await postJson<PersistDocumentResponse>('/api/persist-document', {
        input: state.input,
        document: { ...enrichedDocument, dbSaveStatus: 'saving' },
        documentChunks: enrichedDocument.chunks,
      });

      updateUploadedDocument(enrichedDocument.id, {
        documentRole: response.role ?? role,
        dbSaveStatus: response.status === 'disabled' ? 'disabled' : response.status === 'saved' ? 'saved' : 'failed',
        dbProjectId: response.projectId,
        dbDocumentId: response.documentId,
        dbChunkCount: response.chunkCount,
      });
    } catch {
      updateUploadedDocument(enrichedDocument.id, { dbSaveStatus: 'failed' });
    }
  };

  const addUploadedDocumentAndPersist = (document: UploadedDocument, noticeType: UploadNotice['type'], message: string) => {
    addUploadedDocument(document, noticeType, message);
    void persistUploadedDocumentSafely(document);
  };

  const addDbUploadedDocument = (document: UploadedDocument) => {
    setState((current) => ({
      ...current,
      dbUploadedDocuments: [...(current.dbUploadedDocuments ?? []), document],
    }));
  };

  const updateDbUploadedDocument = (documentId: string, patch: Partial<UploadedDocument>) => {
    setState((current) => ({
      ...current,
      dbUploadedDocuments: (current.dbUploadedDocuments ?? []).map((item) => (item.id === documentId ? enrichDocumentWithChunks({ ...item, ...patch }) : item)),
    }));
  };

  const persistDbUploadedDocumentSafely = async (document: UploadedDocument, partialTextSaved = false) => {
    const enrichedDocument = enrichDocumentWithChunks(document);

    updateDbUploadedDocument(enrichedDocument.id, { dbSaveStatus: 'saving' });

    try {
      const response = await postJson<PersistDocumentResponse>('/api/persist-document', {
        input: state.input,
        document: { ...enrichedDocument, dbSaveStatus: 'saving' },
        documentChunks: enrichedDocument.chunks ?? [],
      });
      const savedStatus = response.status === 'saved' && partialTextSaved ? 'partial' : response.status === 'disabled' ? 'disabled' : response.status === 'saved' ? 'saved' : response.status === 'partial' ? 'partial' : 'failed';

      updateDbUploadedDocument(enrichedDocument.id, {
        documentRole: response.role ?? enrichedDocument.documentRole,
        dbSaveStatus: savedStatus,
        dbProjectId: response.projectId,
        dbDocumentId: response.documentId,
        dbChunkCount: response.chunkCount,
      });
      setDbUploadNotice({
        type: savedStatus === 'saved' ? 'success' : savedStatus === 'partial' ? 'warning' : savedStatus === 'disabled' ? 'warning' : 'error',
        message: getDocumentDbSaveStatusLabel(savedStatus)?.label ?? 'DB upload failed',
      });
    } catch (err) {
      console.error('DB upload persist request failed; uploaded file remains separate from RFP analysis.', err);
      const message = getUploadErrorMessage(err, 'DB upload failed');
      updateDbUploadedDocument(enrichedDocument.id, { dbSaveStatus: 'failed', errorMessage: message });
      setDbUploadNotice({ type: 'error', message: isLargePayloadError(err) ? message : 'DB upload failed' });
    }
  };

  const createUploadedDocument = (
    file: File,
    extractionStatus: ExtractionStatus,
    extractedText = '',
    warningMessage?: string,
    options: Pick<UploadedDocument, 'ocrUsed' | 'ocrAvailable' | 'visionStatus' | 'visionUsed' | 'visionPageCount' | 'visionTotalPageCount' | 'totalPageCount' | 'documentAnalysisText' | 'visionAnalysis' | 'pageTextSources' | 'textExtractionPageNumbers' | 'visionPageNumbers' | 'failedChunks' | 'failedPages' | 'needsReview' | 'errorMessage' | 'documentRole' | 'dbSaveStatus'> = {},
  ): UploadedDocument => {
    const documentRole = options.documentRole ?? inferUploadedDocumentRole(file.name, options.documentAnalysisText || extractedText);

    return enrichDocumentWithChunks({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: file.name,
      fileType: getFileTypeLabel(file.name),
      documentRole,
      documentType: mapStorageRoleToDocumentType(documentRole),
      extractionStatus,
      extractedText,
      documentAnalysisText: options.documentAnalysisText,
      extractedCharCount: (options.documentAnalysisText || extractedText).length,
      visionStatus: options.visionStatus ?? 'unused',
      visionUsed: options.visionUsed ?? false,
      visionPageCount: options.visionPageCount,
      visionTotalPageCount: options.visionTotalPageCount,
      totalPageCount: options.totalPageCount,
      visionAnalysis: options.visionAnalysis,
      pageTextSources: options.pageTextSources,
      textExtractionPageNumbers: options.textExtractionPageNumbers,
      visionPageNumbers: options.visionPageNumbers,
      failedChunks: options.failedChunks,
      failedPages: options.failedPages,
      needsReview: options.needsReview,
      ocrUsed: options.ocrUsed ?? false,
      ocrAvailable: options.ocrAvailable ?? false,
      warningMessage,
      errorMessage: options.errorMessage,
      dbSaveStatus: options.dbSaveStatus ?? 'idle',
    });
  };

  const runAutomaticVisionAnalysis = async (documentId: string, file: File, textPrefix = '', qualityFallback = false) => {
    const processingMessage = qualityFallback
      ? [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE, VISION_FALLBACK_IN_PROGRESS_MESSAGE].join(' · ')
      : '빠른 Vision 분석 중 · 앞 3페이지를 먼저 분석합니다.'

    updateUploadedDocument(documentId, {
      extractionStatus: '빠른 Vision 분석 중',
      extractedText: '',
      documentAnalysisText: undefined,
      extractedCharCount: 0,
      visionStatus: 'quick_analyzing',
      visionUsed: true,
      visionPageCount: 0,
      visionTotalPageCount: DEFAULT_VISION_CHUNK_SIZE,
      totalPageCount: undefined,
      visionAnalysis: [],
      failedChunks: [],
      failedPages: [],
      needsReview: false,
      ocrAvailable: false,
      warningMessage: processingMessage,
      errorMessage: undefined,
    });
    setUploadNotice({ type: 'warning', message: processingMessage });
    setLoading(qualityFallback ? 'PDF 텍스트 품질 낮음 · Vision 분석으로 전환 중...' : 'PDF 빠른 Vision 분석 중...');
    console.info('vision chunked analysis started', { documentId, fileName: file.name, chunkSize: DEFAULT_VISION_CHUNK_SIZE });

    const accumulatedTexts: string[] = [];
    const accumulatedPages: VisionPageAnalysis[] = [];
    const successfulPageNumbers = new Set<number>();
    const failedChunks: NonNullable<UploadedDocument['failedChunks']> = [];
    const failedPages: NonNullable<UploadedDocument['failedPages']> = [];
    let totalPageCount: number | undefined;
    let processedThroughPage = 0;
    let pageStart = 1;
    let fastAnalysisReady = false;

    const getSuccessfulPageCount = () => successfulPageNumbers.size;

    const appendSuccessfulVisionResult = (visionText: string, pages: VisionPageAnalysis[] = [], successPageStart: number, successPageEnd: number) => {
      const validation = validateExtractedText(visionText);
      const normalizedVisionText = validation.ok ? validation.text : visionText.trim();
      accumulatedTexts.push(normalizedVisionText);
      accumulatedPages.push(...pages);

      if (pages.length) {
        pages.forEach((page) => successfulPageNumbers.add(page.pageNumber));
        return;
      }

      for (let pageNumber = successPageStart; pageNumber <= successPageEnd; pageNumber += 1) {
        successfulPageNumbers.add(pageNumber);
      }
    };

    const analyzeVisionRange = async (rangeStart: number, rangeEnd: number) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', DEFAULT_VISION_MODE);
      formData.append('pageStart', String(rangeStart));
      formData.append('pageEnd', String(rangeEnd));

      const response = await fetch('/api/vision-pdf', { method: 'POST', body: formData });
      const data = await parseJsonResponse<VisionPdfResponse>(response, 'Vision API');
      const nextTotalPageCount = data.pageCount ?? totalPageCount ?? rangeEnd;
      const normalizedRangeEnd = Math.min(data.pageEnd ?? rangeEnd, nextTotalPageCount);
      const visionText = data.documentAnalysisText || data.text || '';
      const hasUsableVisionText = Boolean(visionText.trim());
      const succeeded = response.ok && data.ok !== false && (data.status === 'success' || data.status === 'partial') && hasUsableVisionText;

      return {
        data,
        nextTotalPageCount,
        normalizedRangeEnd,
        visionText,
        succeeded,
        errorMessage: succeeded ? undefined : buildVisionErrorMessage(data, 'Vision 분석 실패'),
      };
    };

    const buildFailureSummary = () => [
      failedChunks.length ? `실패 구간: ${formatFailedChunks(failedChunks)}` : undefined,
      failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
    ].filter(Boolean).join(' · ');

    try {
      while (!totalPageCount || pageStart <= totalPageCount) {
        const pageEnd = totalPageCount
          ? Math.min(pageStart + DEFAULT_VISION_CHUNK_SIZE - 1, totalPageCount)
          : pageStart + DEFAULT_VISION_CHUNK_SIZE - 1;
        const isFastAnalysisChunk = !fastAnalysisReady && pageStart === 1;
        const chunkMessage = isFastAnalysisChunk
          ? (qualityFallback ? [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE, VISION_FALLBACK_IN_PROGRESS_MESSAGE].join(' · ') : '빠른 Vision 분석 중 · 앞 3페이지를 먼저 분석합니다.')
          : `전체 Vision 분석 중 · ${pageStart}~${pageEnd}p 분석 중`;

        updateUploadedDocument(documentId, {
          extractionStatus: isFastAnalysisChunk ? '빠른 Vision 분석 중' : '전체 Vision 분석 중',
          visionStatus: isFastAnalysisChunk ? 'quick_analyzing' : 'analyzing',
          visionPageCount: getSuccessfulPageCount(),
          visionTotalPageCount: totalPageCount ?? pageEnd,
          totalPageCount,
          warningMessage: chunkMessage,
          errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
        });
        setUploadNotice({ type: 'warning', message: chunkMessage });

        console.info('vision chunk request sent', { documentId, fileName: file.name, route: '/api/vision-pdf', pageStart, pageEnd });

        let normalizedPageEnd = pageEnd;
        try {
          const result = await analyzeVisionRange(pageStart, pageEnd);
          totalPageCount = result.nextTotalPageCount;
          normalizedPageEnd = result.normalizedRangeEnd;
          processedThroughPage = Math.max(processedThroughPage, normalizedPageEnd);

          if (result.succeeded) {
            appendSuccessfulVisionResult(result.visionText, result.data.pages ?? [], pageStart, normalizedPageEnd);
          } else {
            const failedChunk = { pageStart, pageEnd: normalizedPageEnd, errorMessage: result.errorMessage ?? 'Vision chunk 분석 실패' };
            failedChunks.push(failedChunk);
            console.warn('vision chunk failed; retrying single pages', { documentId, fileName: file.name, ...failedChunk });

            const retryMessage = `${failedChunk.pageStart}~${failedChunk.pageEnd}p chunk 실패, 1페이지 단위 재시도 중`;
            updateUploadedDocument(documentId, {
              extractionStatus: isFastAnalysisChunk ? '빠른 Vision 분석 중' : '전체 Vision 분석 중',
              extractedText: [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n'),
              documentAnalysisText: [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n') || undefined,
              extractedCharCount: [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n').length,
              visionStatus: isFastAnalysisChunk ? 'quick_analyzing' : 'analyzing',
              visionUsed: true,
              visionPageCount: getSuccessfulPageCount(),
              visionTotalPageCount: totalPageCount,
              totalPageCount,
              visionAnalysis: accumulatedPages,
              failedChunks: [...failedChunks],
              failedPages: [...failedPages],
              needsReview: false,
              ocrAvailable: false,
              warningMessage: retryMessage,
              errorMessage: undefined,
            });
            setUploadNotice({ type: 'warning', message: retryMessage });

            for (let retryPage = pageStart; retryPage <= normalizedPageEnd; retryPage += 1) {
              try {
                console.info('vision single-page retry sent', { documentId, fileName: file.name, pageStart: retryPage, pageEnd: retryPage });
                const retryResult = await analyzeVisionRange(retryPage, retryPage);
                totalPageCount = retryResult.nextTotalPageCount;
                processedThroughPage = Math.max(processedThroughPage, retryResult.normalizedRangeEnd);

                if (retryResult.succeeded) {
                  appendSuccessfulVisionResult(retryResult.visionText, retryResult.data.pages ?? [], retryPage, retryResult.normalizedRangeEnd);
                } else {
                  failedPages.push({ pageNumber: retryPage, errorMessage: retryResult.errorMessage ?? 'Vision 1페이지 재시도 실패' });
                }
              } catch (retryError) {
                const message = retryError instanceof Error ? retryError.message : 'Vision 1페이지 재시도 요청 실패';
                failedPages.push({ pageNumber: retryPage, errorMessage: message });
                console.error('vision single-page retry failed and recorded', { documentId, fileName: file.name, pageNumber: retryPage, error: message });
              }

              const retryCombinedText = [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n');
              const retryProgressMessage = failedPages.length
                ? `Vision 분석 중: ${getSuccessfulPageCount()}/${totalPageCount ?? normalizedPageEnd} · 재시도 후 실패 페이지: ${formatFailedPages(failedPages)}`
                : `Vision 분석 중: ${getSuccessfulPageCount()}/${totalPageCount ?? normalizedPageEnd}`;
              updateUploadedDocument(documentId, {
                extractionStatus: isFastAnalysisChunk ? '빠른 Vision 분석 중' : '전체 Vision 분석 중',
                extractedText: retryCombinedText,
                documentAnalysisText: retryCombinedText || undefined,
                extractedCharCount: retryCombinedText.length,
                visionStatus: isFastAnalysisChunk ? 'quick_analyzing' : 'analyzing',
                visionUsed: true,
                visionPageCount: getSuccessfulPageCount(),
                visionTotalPageCount: totalPageCount ?? normalizedPageEnd,
                totalPageCount: totalPageCount ?? normalizedPageEnd,
                visionAnalysis: accumulatedPages,
                failedChunks: [...failedChunks],
                failedPages: [...failedPages],
                needsReview: failedPages.length > 0,
                ocrAvailable: false,
                warningMessage: retryProgressMessage,
                errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
              });
              setUploadNotice({ type: 'warning', message: retryProgressMessage });
            }
          }
        } catch (chunkError) {
          const message = chunkError instanceof Error ? chunkError.message : 'Vision chunk 요청 실패';
          totalPageCount = totalPageCount ?? pageEnd;
          normalizedPageEnd = Math.min(pageEnd, totalPageCount);
          processedThroughPage = Math.max(processedThroughPage, normalizedPageEnd);
          const failedChunk = { pageStart, pageEnd: normalizedPageEnd, errorMessage: message };
          failedChunks.push(failedChunk);
          console.error('vision chunk request failed; retrying single pages', { documentId, fileName: file.name, ...failedChunk });

          const retryMessage = `${failedChunk.pageStart}~${failedChunk.pageEnd}p chunk 실패, 1페이지 단위 재시도 중`;
          updateUploadedDocument(documentId, {
            extractionStatus: isFastAnalysisChunk ? '빠른 Vision 분석 중' : '전체 Vision 분석 중',
            visionStatus: isFastAnalysisChunk ? 'quick_analyzing' : 'analyzing',
            visionPageCount: getSuccessfulPageCount(),
            visionTotalPageCount: totalPageCount,
            totalPageCount,
            failedChunks: [...failedChunks],
            failedPages: [...failedPages],
            warningMessage: retryMessage,
            errorMessage: undefined,
          });
          setUploadNotice({ type: 'warning', message: retryMessage });

          for (let retryPage = pageStart; retryPage <= normalizedPageEnd; retryPage += 1) {
            try {
              console.info('vision single-page retry sent', { documentId, fileName: file.name, pageStart: retryPage, pageEnd: retryPage });
              const retryResult = await analyzeVisionRange(retryPage, retryPage);
              totalPageCount = retryResult.nextTotalPageCount;
              processedThroughPage = Math.max(processedThroughPage, retryResult.normalizedRangeEnd);

              if (retryResult.succeeded) {
                appendSuccessfulVisionResult(retryResult.visionText, retryResult.data.pages ?? [], retryPage, retryResult.normalizedRangeEnd);
              } else {
                failedPages.push({ pageNumber: retryPage, errorMessage: retryResult.errorMessage ?? 'Vision 1페이지 재시도 실패' });
              }
            } catch (retryError) {
              const retryMessage = retryError instanceof Error ? retryError.message : 'Vision 1페이지 재시도 요청 실패';
              failedPages.push({ pageNumber: retryPage, errorMessage: retryMessage });
              console.error('vision single-page retry failed and recorded', { documentId, fileName: file.name, pageNumber: retryPage, error: retryMessage });
            }

            const retryCombinedText = [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n');
            const retryProgressMessage = failedPages.length
              ? `Vision 분석 중: ${getSuccessfulPageCount()}/${totalPageCount ?? normalizedPageEnd} · 재시도 후 실패 페이지: ${formatFailedPages(failedPages)}`
              : `Vision 분석 중: ${getSuccessfulPageCount()}/${totalPageCount ?? normalizedPageEnd}`;
            updateUploadedDocument(documentId, {
              extractionStatus: isFastAnalysisChunk ? '빠른 Vision 분석 중' : '전체 Vision 분석 중',
              extractedText: retryCombinedText,
              documentAnalysisText: retryCombinedText || undefined,
              extractedCharCount: retryCombinedText.length,
              visionStatus: isFastAnalysisChunk ? 'quick_analyzing' : 'analyzing',
              visionUsed: true,
              visionPageCount: getSuccessfulPageCount(),
              visionTotalPageCount: totalPageCount ?? normalizedPageEnd,
              totalPageCount: totalPageCount ?? normalizedPageEnd,
              visionAnalysis: accumulatedPages,
              failedChunks: [...failedChunks],
              failedPages: [...failedPages],
              needsReview: failedPages.length > 0,
              ocrAvailable: false,
              warningMessage: retryProgressMessage,
              errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
            });
            setUploadNotice({ type: 'warning', message: retryProgressMessage });
          }
        }

        const combinedText = [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n');
        const progressMessage = failedPages.length
          ? `${isFastAnalysisChunk ? '빠른 Vision 분석 완료' : '전체 Vision 분석 중'} · 페이지: ${getSuccessfulPageCount()}/${totalPageCount ?? processedThroughPage} · 재시도 후 실패 페이지: ${formatFailedPages(failedPages)}`
          : isFastAnalysisChunk
            ? `${qualityFallback ? '텍스트 추출 품질 낮음 → Vision 분석 완료' : '빠른 분석 완료'} · 페이지: ${getSuccessfulPageCount()}/${totalPageCount ?? processedThroughPage} · ${VISION_CHUNK_CREATION_MESSAGE} · AI 분석 가능 · 전체 문서 분석은 계속 진행 중`
            : getVisionProcessingMessage(getSuccessfulPageCount(), totalPageCount);
        const nextCombinedText = combinedText;
        const nextStatus = isFastAnalysisChunk ? '빠른 Vision 분석 완료' : '전체 Vision 분석 중';
        const nextVisionStatus = isFastAnalysisChunk ? 'quick_completed' : 'analyzing';
        updateUploadedDocument(documentId, {
          extractionStatus: nextStatus,
          extractedText: nextCombinedText,
          documentAnalysisText: nextCombinedText || undefined,
          extractedCharCount: nextCombinedText.length,
          visionStatus: nextVisionStatus,
          visionUsed: true,
          visionPageCount: getSuccessfulPageCount(),
          visionTotalPageCount: totalPageCount,
          totalPageCount,
          visionAnalysis: accumulatedPages,
          failedChunks: [...failedChunks],
          failedPages: [...failedPages],
          needsReview: failedPages.length > 0,
          ocrAvailable: false,
          warningMessage: progressMessage,
          errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
        });
        setUploadNotice({ type: 'warning', message: progressMessage });
        if (isFastAnalysisChunk) {
          fastAnalysisReady = true;
          setLoading('');
        }

        pageStart = normalizedPageEnd + 1;
      }

      const combinedText = [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n');
      const hasSuccessfulPages = Boolean(combinedText.trim()) && getSuccessfulPageCount() > 0;
      const finalStatus: ExtractionStatus = failedPages.length
        ? (hasSuccessfulPages ? 'Vision 일부 완료' : 'Vision 분석 실패')
        : '전체 Vision 분석 완료';
      const finalVisionStatus: UploadedDocument['visionStatus'] = finalStatus === '전체 Vision 분석 완료'
        ? 'completed'
        : finalStatus === 'Vision 일부 완료'
          ? 'partial'
          : 'failed';
      const failureSummary = buildFailureSummary();
      const finalPageCount = totalPageCount ?? processedThroughPage ?? getSuccessfulPageCount();
      const finalMessage = finalStatus === '전체 Vision 분석 완료'
        ? `${qualityFallback ? VISION_FALLBACK_COMPLETED_MESSAGE : '전체 Vision 분석 완료'} · ${VISION_CHUNK_CREATION_MESSAGE} · 페이지: ${getSuccessfulPageCount()}/${finalPageCount} · 글자 수: ${combinedText.length.toLocaleString()}자`
        : finalStatus === 'Vision 일부 완료'
          ? `Vision 일부 완료 · 페이지: ${getSuccessfulPageCount()}/${finalPageCount} · ${failureSummary}`
          : `Vision 분석 실패 · ${failureSummary || '분석 가능한 페이지가 없습니다.'}`;

      const finalPatch: Partial<UploadedDocument> = {
        extractionStatus: finalStatus,
        extractedText: hasSuccessfulPages ? combinedText : '',
        documentAnalysisText: hasSuccessfulPages ? combinedText : undefined,
        extractedCharCount: hasSuccessfulPages ? combinedText.length : 0,
        visionStatus: finalVisionStatus,
        visionUsed: true,
        visionPageCount: getSuccessfulPageCount(),
        visionTotalPageCount: finalPageCount,
        totalPageCount: finalPageCount,
        visionAnalysis: accumulatedPages,
        failedChunks: [...failedChunks],
        failedPages: [...failedPages],
        needsReview: failedPages.length > 0,
        ocrAvailable: false,
        warningMessage: finalStatus === 'Vision 일부 완료' ? finalMessage : undefined,
        errorMessage: finalStatus === 'Vision 분석 실패' ? finalMessage : failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
      };
      updateUploadedDocument(documentId, finalPatch);
      if (hasSuccessfulPages) {
        void persistUploadedDocumentSafely(enrichDocumentWithChunks({
          id: documentId,
          fileName: file.name,
          fileType: getFileTypeLabel(file.name),
          documentRole: inferUploadedDocumentRole(file.name, combinedText),
          documentType: mapStorageRoleToDocumentType(inferUploadedDocumentRole(file.name, combinedText)),
          extractionStatus: finalStatus,
          extractedText: combinedText,
          documentAnalysisText: combinedText,
          extractedCharCount: combinedText.length,
          ...finalPatch,
        }));
      }
      console.info('vision chunked analysis finished', { documentId, fileName: file.name, successfulPages: getSuccessfulPageCount(), processedThroughPage, totalPageCount, failedChunks: failedChunks.length, failedPages: failedPages.length, finalStatus });
      setUploadNotice({ type: finalStatus === '전체 Vision 분석 완료' ? 'success' : finalStatus === 'Vision 일부 완료' ? 'warning' : 'error', message: finalMessage });
      if (finalStatus === 'Vision 분석 실패') setError(finalMessage);
    } catch (err) {
      const message = err instanceof Error ? `Vision API 호출 실패: ${err.message}` : 'Vision API 호출 실패';
      const combinedText = [textPrefix.trim(), ...accumulatedTexts].filter(Boolean).join('\n\n');
      const hasSuccessfulPages = Boolean(combinedText.trim()) && getSuccessfulPageCount() > 0;
      const finalStatus: ExtractionStatus = hasSuccessfulPages ? 'Vision 일부 완료' : 'Vision 분석 실패';
      const fallbackPageEnd = totalPageCount ? Math.min(pageStart + DEFAULT_VISION_CHUNK_SIZE - 1, totalPageCount) : pageStart + DEFAULT_VISION_CHUNK_SIZE - 1;
      const nextFailedChunks = [...failedChunks, { pageStart, pageEnd: fallbackPageEnd, errorMessage: message }];
      const finalPageCount = totalPageCount ?? processedThroughPage;
      updateUploadedDocument(documentId, {
        extractionStatus: finalStatus,
        extractedText: hasSuccessfulPages ? combinedText : '',
        documentAnalysisText: hasSuccessfulPages ? combinedText : undefined,
        extractedCharCount: hasSuccessfulPages ? combinedText.length : 0,
        visionStatus: hasSuccessfulPages ? 'partial' : 'failed',
        visionUsed: true,
        visionPageCount: getSuccessfulPageCount(),
        visionTotalPageCount: finalPageCount || DEFAULT_VISION_CHUNK_SIZE,
        totalPageCount: finalPageCount,
        visionAnalysis: accumulatedPages,
        failedChunks: nextFailedChunks,
        failedPages: [...failedPages],
        needsReview: true,
        ocrAvailable: false,
        warningMessage: hasSuccessfulPages ? `Vision 일부 완료 · ${message}` : undefined,
        errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)} · ${message}` : message,
      });
      console.error('vision chunked analysis failed', { documentId, fileName: file.name, error: message });
      setUploadNotice({ type: hasSuccessfulPages ? 'warning' : 'error', message });
      if (!hasSuccessfulPages) setError(message);
    }
  };


  const runHybridPdfAnalysis = async (documentId: string, file: File, pages: ExtractedPdfPage[], pageQuality: ExtractedPageQuality[]) => {
    const visionPageNumbers = pageQuality.filter((page) => page.useVision).map((page) => page.pageNumber);
    const textPageSources = buildTextPageSources(pages, visionPageNumbers);
    const textPageNumbers = textPageSources.map((page) => page.pageNumber);
    const visionLabel = formatPageNumberList(visionPageNumbers);
    const textLabel = formatPageNumberList(textPageNumbers);
    const initialText = buildDocumentTextFromPageSources(textPageSources);
    const initialMessage = `텍스트 추출 + 일부 페이지 Vision 분석 · Vision 분석 페이지: ${visionLabel} · 텍스트 사용 페이지: ${textLabel}`;

    updateUploadedDocument(documentId, {
      extractionStatus: '하이브리드 PDF 분석 중',
      extractedText: initialText,
      documentAnalysisText: initialText || undefined,
      extractedCharCount: initialText.length,
      visionStatus: 'analyzing',
      visionUsed: true,
      visionPageCount: 0,
      visionTotalPageCount: visionPageNumbers.length,
      totalPageCount: pages.length,
      visionAnalysis: [],
      pageTextSources: textPageSources,
      textExtractionPageNumbers: textPageNumbers,
      visionPageNumbers,
      failedChunks: [],
      failedPages: [],
      needsReview: false,
      warningMessage: initialMessage,
      errorMessage: undefined,
    });
    setUploadNotice({ type: 'warning', message: initialMessage });
    setLoading('PDF 하이브리드 분석 중...');

    const accumulatedVisionPages: VisionPageAnalysis[] = [];
    const failedChunks: NonNullable<UploadedDocument['failedChunks']> = [];
    const failedPages: NonNullable<UploadedDocument['failedPages']> = [];
    const successfulVisionPages = new Set<number>();

    const updateHybridProgress = (message: string) => {
      const pageSources = mergeHybridPageSources(textPageSources, accumulatedVisionPages);
      const combinedText = buildDocumentTextFromPageSources(pageSources);
      updateUploadedDocument(documentId, {
        extractionStatus: '하이브리드 PDF 분석 중',
        extractedText: combinedText,
        documentAnalysisText: combinedText || undefined,
        extractedCharCount: combinedText.length,
        visionStatus: 'analyzing',
        visionUsed: true,
        visionPageCount: successfulVisionPages.size,
        visionTotalPageCount: visionPageNumbers.length,
        totalPageCount: pages.length,
        visionAnalysis: accumulatedVisionPages,
        pageTextSources: pageSources,
        textExtractionPageNumbers: textPageNumbers,
        visionPageNumbers,
        failedChunks: [...failedChunks],
        failedPages: [...failedPages],
        needsReview: failedPages.length > 0,
        ocrAvailable: false,
        warningMessage: message,
        errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
      });
      setUploadNotice({ type: 'warning', message });
    };

    const analyzeVisionRange = async (rangeStart: number, rangeEnd: number) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', DEFAULT_VISION_MODE);
      formData.append('pageStart', String(rangeStart));
      formData.append('pageEnd', String(rangeEnd));
      const response = await fetch('/api/vision-pdf', { method: 'POST', body: formData });
      const data = await parseJsonResponse<VisionPdfResponse>(response, 'Vision API');
      const visionText = data.documentAnalysisText || data.text || '';
      const succeeded = response.ok && data.ok !== false && (data.status === 'success' || data.status === 'partial') && Boolean(visionText.trim());
      return { data, visionText, succeeded, errorMessage: succeeded ? undefined : buildVisionErrorMessage(data, 'Vision 분석 실패') };
    };

    const appendVisionPages = (visionText: string, visionPages: VisionPageAnalysis[] = [], rangeStart: number, rangeEnd: number) => {
      if (visionPages.length) {
        accumulatedVisionPages.push(...visionPages.filter((page) => visionPageNumbers.includes(page.pageNumber)));
        visionPages.forEach((page) => successfulVisionPages.add(page.pageNumber));
        return;
      }
      const validation = validateExtractedText(visionText);
      const normalizedText = validation.ok ? validation.text : visionText.trim();
      accumulatedVisionPages.push({
        pageNumber: rangeStart,
        extractedText: normalizedText,
        visualSummary: '',
        detectedTables: [],
        detectedDiagrams: [],
        floorplanOrLayoutInfo: '',
        keyRequirements: [],
        constraints: [],
        scheduleInfo: [],
        operationInfo: [],
        designOrVisualReferences: [],
        confidence: 0.6,
        needsReview: rangeStart !== rangeEnd,
      });
      for (let pageNumber = rangeStart; pageNumber <= rangeEnd; pageNumber += 1) successfulVisionPages.add(pageNumber);
    };

    const ranges: Array<{ pageStart: number; pageEnd: number }> = [];
    for (const pageNumber of visionPageNumbers) {
      const previous = ranges[ranges.length - 1];
      if (previous && pageNumber === previous.pageEnd + 1 && previous.pageEnd - previous.pageStart + 1 < DEFAULT_VISION_CHUNK_SIZE) {
        previous.pageEnd = pageNumber;
      } else {
        ranges.push({ pageStart: pageNumber, pageEnd: pageNumber });
      }
    }

    try {
      for (const range of ranges) {
        const progressMessage = `텍스트 추출 + 일부 페이지 Vision 분석 · ${range.pageStart}~${range.pageEnd}p 분석 중 · Vision 분석 페이지: ${visionLabel} · 텍스트 사용 페이지: ${textLabel}`;
        updateHybridProgress(progressMessage);

        try {
          const result = await analyzeVisionRange(range.pageStart, range.pageEnd);
          if (result.succeeded) {
            appendVisionPages(result.visionText, result.data.pages ?? [], range.pageStart, range.pageEnd);
          } else {
            failedChunks.push({ pageStart: range.pageStart, pageEnd: range.pageEnd, errorMessage: result.errorMessage ?? 'Vision chunk 분석 실패' });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Vision chunk 요청 실패';
          failedChunks.push({ pageStart: range.pageStart, pageEnd: range.pageEnd, errorMessage: message });
        }

        const failedChunk = failedChunks.find((chunk) => chunk.pageStart === range.pageStart && chunk.pageEnd === range.pageEnd);
        if (failedChunk) {
          updateHybridProgress(`${range.pageStart}~${range.pageEnd}p chunk 실패, 필요한 페이지만 1페이지 단위 재시도 중`);
          for (let pageNumber = range.pageStart; pageNumber <= range.pageEnd; pageNumber += 1) {
            try {
              const retryResult = await analyzeVisionRange(pageNumber, pageNumber);
              if (retryResult.succeeded) {
                appendVisionPages(retryResult.visionText, retryResult.data.pages ?? [], pageNumber, pageNumber);
              } else {
                failedPages.push({ pageNumber, errorMessage: retryResult.errorMessage ?? 'Vision 1페이지 재시도 실패' });
              }
            } catch (retryError) {
              const message = retryError instanceof Error ? retryError.message : 'Vision 1페이지 재시도 요청 실패';
              failedPages.push({ pageNumber, errorMessage: message });
            }
            updateHybridProgress(`텍스트 추출 + 일부 페이지 Vision 분석 · 완료 ${successfulVisionPages.size}/${visionPageNumbers.length}p · Vision 분석 페이지: ${visionLabel} · 텍스트 사용 페이지: ${textLabel}`);
          }
        }
      }

      const pageSources = mergeHybridPageSources(textPageSources, accumulatedVisionPages);
      const combinedText = buildDocumentTextFromPageSources(pageSources);
      const finalStatus: ExtractionStatus = failedPages.length ? 'Vision 일부 완료' : '하이브리드 PDF 분석 완료';
      const finalMessage = failedPages.length
        ? `하이브리드 PDF 분석 일부 완료 · Vision 실패 페이지: ${formatFailedPages(failedPages)} · 텍스트 사용 페이지: ${textLabel}`
        : `텍스트 추출 + 일부 페이지 Vision 분석 완료 · Vision 분석 페이지: ${visionLabel} · 텍스트 사용 페이지: ${textLabel}`;

      const finalPatch: Partial<UploadedDocument> = {
        extractionStatus: finalStatus,
        extractedText: combinedText,
        documentAnalysisText: combinedText || undefined,
        extractedCharCount: combinedText.length,
        visionStatus: failedPages.length ? 'partial' : 'completed',
        visionUsed: true,
        visionPageCount: successfulVisionPages.size,
        visionTotalPageCount: visionPageNumbers.length,
        totalPageCount: pages.length,
        visionAnalysis: accumulatedVisionPages,
        pageTextSources: pageSources,
        textExtractionPageNumbers: textPageNumbers,
        visionPageNumbers,
        failedChunks: [...failedChunks],
        failedPages: [...failedPages],
        needsReview: failedPages.length > 0,
        ocrAvailable: false,
        warningMessage: failedPages.length ? finalMessage : undefined,
        errorMessage: failedPages.length ? `재시도 후 실패 페이지: ${formatFailedPages(failedPages)}` : undefined,
      };
      updateUploadedDocument(documentId, finalPatch);
      void persistUploadedDocumentSafely(enrichDocumentWithChunks({
        id: documentId,
        fileName: file.name,
        fileType: getFileTypeLabel(file.name),
        documentRole: inferUploadedDocumentRole(file.name, combinedText),
        documentType: mapStorageRoleToDocumentType(inferUploadedDocumentRole(file.name, combinedText)),
        extractionStatus: finalStatus,
        extractedText: combinedText,
        documentAnalysisText: combinedText || undefined,
        extractedCharCount: combinedText.length,
        ...finalPatch,
      }));
      setUploadNotice({ type: failedPages.length ? 'warning' : 'success', message: finalMessage });
    } catch (error) {
      const message = error instanceof Error ? `하이브리드 Vision 분석 실패: ${error.message}` : '하이브리드 Vision 분석 실패';
      updateHybridProgress(message);
      setError(message);
    }
  };

  const handleDbFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setDbUploadNotice(null);

    if (file.size > MAX_DB_UPLOAD_FILE_SIZE_BYTES) {
      setDbUploadNotice({ type: 'error', message: '파일 크기가 너무 큽니다. 100MB 이하 파일을 업로드해주세요.' });
      return;
    }

    const extension = getFileExtension(file.name);
    if (![...clientReadableExtensions, ...serverReadableExtensions].includes(extension)) {
      setDbUploadNotice({ type: 'error', message: '지원하지 않는 파일 형식입니다. PDF, PPTX, DOCX, TXT, MD 파일을 업로드해주세요.' });
      return;
    }

    setLoading('DB 업로드 저장 중...');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'db');

      const response = await fetch('/api/extract-text', { method: 'POST', body: formData });
      const data = await parseJsonResponse<ExtractTextResponse>(response, 'DB 업로드 텍스트 추출 API');

      if (!response.ok) {
        const message = data.error || data.warning || data.message || TEXT_EXTRACTION_FAILED_MESSAGE;
        console.error('DB upload text extraction failed.', { status: response.status, message });
        throw new Error(isLargePayloadError(message, response.status) ? LARGE_FILE_UPLOAD_GUIDANCE : message);
      }

      const text = (data.text ?? '').trim();

      if (!text) {
        const message = data.warning || data.error || TEXT_EXTRACTION_FAILED_MESSAGE;
        console.error('DB upload produced no text.', { fileName: file.name, message });
        const friendlyMessage = getUploadErrorMessage(message, 'DB upload failed');
        const failedDocument = createUploadedDocument(file, '추출 실패', '', friendlyMessage, { documentRole: dbUploadRole, dbSaveStatus: 'failed', errorMessage: friendlyMessage });
        addDbUploadedDocument(failedDocument);
        setDbUploadNotice({ type: 'error', message: isLargePayloadError(message) ? friendlyMessage : 'DB upload failed' });
        return;
      }

      const isPartial = data.status === 'partial' || Boolean(data.warning) || !response.ok;
      const document = createUploadedDocument(
        file,
        isPartial ? '일부 텍스트만 추출' : '텍스트 추출 완료',
        text,
        isPartial ? data.warning || data.message || 'Partial text saved' : undefined,
        {
          documentRole: dbUploadRole,
          dbSaveStatus: 'saving',
          totalPageCount: data.pageCount,
          pageTextSources: extension === 'pptx' && data.slides?.length ? buildSlideTextSources(data.slides) : undefined,
        },
      );

      addDbUploadedDocument(document);
      setDbUploadNotice({ type: 'warning', message: 'Uploading to DB' });
      await persistDbUploadedDocumentSafely(document, isPartial);
    } catch (err) {
      console.error('DB upload extract/upload failed.', err);
      const message = getUploadErrorMessage(err, TEXT_EXTRACTION_FAILED_MESSAGE);
      const failedDocument = createUploadedDocument(file, '추출 실패', '', message, { documentRole: dbUploadRole, dbSaveStatus: 'failed', errorMessage: message });
      addDbUploadedDocument(failedDocument);
      setDbUploadNotice({ type: 'error', message: isLargePayloadError(err) ? message : 'DB upload failed' });
    } finally {
      setLoading('');
    }
  };

  const handleBriefFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setUploadNotice(null);

    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setUploadNotice({ type: 'error', message: '파일 크기가 너무 큽니다. 10MB 이하 파일을 업로드해주세요.' });
      return;
    }

    const extension = getFileExtension(file.name);
    if (![...clientReadableExtensions, ...serverReadableExtensions].includes(extension)) {
      setUploadNotice({ type: 'error', message: '지원하지 않는 파일 형식입니다. PDF, PPTX, DOCX, TXT, MD 파일을 업로드해주세요.' });
      return;
    }

    setLoading('파일 텍스트 추출 중...');

    try {
      if (clientReadableExtensions.includes(extension)) {
        const validation = validateExtractedText(await file.text());
        if (!validation.ok) {
          addUploadedDocumentAndPersist(
            createUploadedDocument(file, '추출 실패', '', validation.message),
            validation.reason === 'short' ? 'warning' : 'error',
            validation.message,
          );
          return;
        }

        addUploadedDocumentAndPersist(
          createUploadedDocument(file, '텍스트 추출 완료', validation.text),
          'success',
          '파일에서 텍스트를 추출했습니다. 추출 원문은 화면에 표시하지 않고 AI 분석 입력에만 사용합니다.',
        );
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/extract-text', { method: 'POST', body: formData });
      const data = await parseJsonResponse<ExtractTextResponse>(response, '텍스트 추출 API');

      const pdfPageQualities = extension === 'pdf' ? (data.pageQuality ?? []) : [];
      const pdfPages = extension === 'pdf' ? (data.pages ?? []) : [];
      const pagesNeedingVision = pdfPageQualities.filter((page) => page.useVision).map((page) => page.pageNumber);

      if (extension === 'pdf' && pdfPages.length && pagesNeedingVision.length) {
        const textPageSources = buildTextPageSources(pdfPages, pagesNeedingVision);
        const textPageNumbers = textPageSources.map((page) => page.pageNumber);
        const initialText = buildDocumentTextFromPageSources(textPageSources);
        const message = `텍스트 추출 + 일부 페이지 Vision 분석 · Vision 분석 페이지: ${formatPageNumberList(pagesNeedingVision)} · 텍스트 사용 페이지: ${formatPageNumberList(textPageNumbers)}`;
        const document = createUploadedDocument(file, '하이브리드 PDF 분석 중', initialText, message, {
          visionStatus: 'analyzing',
          visionUsed: true,
          visionPageCount: 0,
          visionTotalPageCount: pagesNeedingVision.length,
          totalPageCount: data.pageCount ?? pdfPages.length,
          documentAnalysisText: initialText || undefined,
          pageTextSources: textPageSources,
          textExtractionPageNumbers: textPageNumbers,
          visionPageNumbers: pagesNeedingVision,
        });
        addUploadedDocumentAndPersist(document, 'warning', message);
        await runHybridPdfAnalysis(document.id, file, pdfPages, pdfPageQualities);
        return;
      }

      if (!response.ok || !data.text) {
        const qualityMessage = data.qualityReasons?.length ? ` 품질 판단: ${data.qualityReasons.join(', ')}` : '';
        const message = [data.warning || data.error || TEXT_EXTRACTION_FAILED_MESSAGE, extension === 'pdf' ? VISION_REQUIRED_MESSAGE : undefined]
          .filter(Boolean)
          .join(' ') + qualityMessage;
        const document = extension === 'pdf'
          ? createUploadedDocument(file, '텍스트 품질 낮음', '', [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE, VISION_FALLBACK_IN_PROGRESS_MESSAGE].join(' · '), {
              visionStatus: 'quick_analyzing',
              visionUsed: true,
              visionPageCount: 0,
              visionTotalPageCount: DEFAULT_VISION_CHUNK_SIZE,
            })
          : createUploadedDocument(file, '추출 실패', data.text ?? '', message);
        addUploadedDocumentAndPersist(document, extension === 'pdf' ? 'warning' : 'error', extension === 'pdf' ? [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE, VISION_FALLBACK_IN_PROGRESS_MESSAGE].join(' · ') : message);
        if (extension === 'pdf') {
          await runAutomaticVisionAnalysis(document.id, file, '', true);
        }
        return;
      }

      const validation = validateExtractedText(data.text);
      if (!validation.ok) {
        const message = [validation.message, extension === 'pdf' ? VISION_REQUIRED_MESSAGE : undefined]
          .filter(Boolean)
          .join(' ');
        const document = extension === 'pdf'
          ? createUploadedDocument(file, '텍스트 품질 낮음', '', [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE, VISION_FALLBACK_IN_PROGRESS_MESSAGE].join(' · '), {
              visionStatus: 'quick_analyzing',
              visionUsed: true,
              visionPageCount: 0,
              visionTotalPageCount: DEFAULT_VISION_CHUNK_SIZE,
            })
          : createUploadedDocument(file, '추출 실패', validation.text, message);
        addUploadedDocumentAndPersist(document, 'warning', extension === 'pdf' ? [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE, VISION_FALLBACK_IN_PROGRESS_MESSAGE].join(' · ') : message);
        if (extension === 'pdf') {
          await runAutomaticVisionAnalysis(document.id, file, '', true);
        }
        return;
      }

      const status: ExtractionStatus = data.status === 'partial' ? '일부 텍스트만 추출' : '텍스트 추출 완료';
      const serverMessage = data.message ?? (extension === 'pdf' ? PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE : undefined);
      const slideTextSources = extension === 'pptx' ? buildSlideTextSources(data.slides ?? []) : [];
      const documentText = slideTextSources.length ? buildDocumentTextFromPageSources(slideTextSources) : validation.text;
      const document = createUploadedDocument(file, status, documentText, data.status === 'partial' ? serverMessage : undefined, {
        totalPageCount: extension === 'pptx' ? data.pageCount ?? slideTextSources.length : data.pageCount,
        pageTextSources: slideTextSources.length ? slideTextSources : undefined,
        documentAnalysisText: documentText,
      });
      addUploadedDocumentAndPersist(
        document,
        data.status === 'partial' ? 'warning' : 'success',
        serverMessage || '파일에서 텍스트를 추출했습니다. 추출 원문은 화면에 표시하지 않고 AI 분석 입력에만 사용합니다.',
      );
    } catch (err) {
      const extractionErrorMessage = err instanceof Error ? `${TEXT_EXTRACTION_FAILED_MESSAGE} ${err.message}` : TEXT_EXTRACTION_FAILED_MESSAGE;
      if (extension === 'pdf') {
        const document = createUploadedDocument(file, '텍스트 추출 실패', '', '빠른 Vision 분석 대기 중', {
          visionStatus: 'quick_analyzing',
          visionUsed: true,
          visionPageCount: 0,
          visionTotalPageCount: DEFAULT_VISION_CHUNK_SIZE,
        });
        addUploadedDocumentAndPersist(document, 'warning', '텍스트 추출 실패 · 빠른 Vision 분석을 시작합니다.');
        await runAutomaticVisionAnalysis(document.id, file);
        return;
      }

      addUploadedDocumentAndPersist(createUploadedDocument(file, '추출 실패', '', extractionErrorMessage), 'error', extractionErrorMessage);
    } finally {
      setLoading('');
    }
  };

  const getCurrentAnalysisBasis = (): ProposalState['analysisBasis'] => {
    if (!hasPartialVisionAnalysisInput || !partialVisionAnalysisDocument) return { type: 'full', label: '전체 입력 기준' };

    const completedPageCount = partialVisionAnalysisDocument.visionPageCount ?? 0;
    const totalPageCount = partialVisionAnalysisDocument.totalPageCount ?? partialVisionAnalysisDocument.visionTotalPageCount;
    return {
      type: 'partial',
      label: `빠른 분석 ${completedPageCount}/${totalPageCount ?? '?'}p`,
      completedPageCount,
      totalPageCount,
    };
  };

  const persistAnalysisSafely = async (input: ProjectInput, analysis: AnalysisResult) => {
    setDbSaveStatus('saving');
    try {
      const response = await postJson<PersistAnalysisResponse>('/api/persist-analysis', {
        input,
        analysis,
        uploadedDocuments: uploadedDocuments.map(enrichDocumentWithChunks),
        documentChunks,
      });

      if (response.status === 'disabled') setDbSaveStatus('disabled');
      else if (response.status === 'saved') setDbSaveStatus('saved');
      else setDbSaveStatus('failed');
    } catch (err) {
      console.error('Analysis DB save request failed; analysis remains available.', err);
      setDbSaveStatus('failed');
    }
  };

  const runAnalyze = async () => {
    setError('');
    if (hasPartialVisionAnalysisInput) {
      setUploadNotice({
        type: 'warning',
        message: '현재 앞 3페이지 기준 빠른 분석 결과로 진행합니다. 전체 페이지 분석이 완료되면 더 정밀한 결과를 생성할 수 있습니다.',
      });
    }
    setLoading('RFP/브리프 분석 중...');
    try {
      const analysisBasis = getCurrentAnalysisBasis();
      const analysisResponse = await postJson<AnalysisApiResponse>('/api/analyze', { input: analysisInput, documentChunks });
      const { result: analysis, evidence } = parseAnalysisApiResponse(analysisResponse);
      setState((current) => ({ ...current, analysis, retrievalEvidence: evidence, analysisBasis, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, proposalNarrative: undefined, selectedConcept: undefined, outline: undefined, slides: undefined }));
      setStep('analysis');
      void persistAnalysisSafely(analysisInput, analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const rerunAnalyzeWithSupplementalInfo = async () => {
    const mergedInput = mergeInputWithSupplementalInfo(analysisInput, supplementalInfo);

    setError('');
    setLoading('추가 정보를 반영해 RFP/브리프 재분석 중...');
    try {
      const analysisBasis = getCurrentAnalysisBasis();
      const analysisResponse = await postJson<AnalysisApiResponse>('/api/analyze', { input: mergedInput, documentChunks });
      const { result: analysis, evidence } = parseAnalysisApiResponse(analysisResponse);
      setState((current) => ({ ...current, analysis, retrievalEvidence: evidence, analysisBasis, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, proposalNarrative: undefined, selectedConcept: undefined, outline: undefined, slides: undefined }));
      setStep('analysis');
      void persistAnalysisSafely(mergedInput, analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가 정보 반영 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const runConcepts = async () => {
    if (!state.analysis) return;
    setError('');
    setLoading('제안 내러티브 생성 중...');
    try {
      const proposalNarrative = await postJson<ProposalNarrative>('/api/narrative', { input: analysisInput, analysis: state.analysis, uploadedDocuments: state.uploadedDocuments, documentChunks });
      setLoading('콘셉트 후보 3안 생성 중...');
      const conceptResult = await postJson<ConceptCandidatesResult>('/api/concepts', { input: analysisInput, analysis: state.analysis, proposalNarrative, documentChunks });
      setState((current) => ({
        ...current,
        proposalNarrative,
        conceptDevelopmentLogic: conceptResult.conceptDevelopmentLogic,
        conceptCandidates: conceptResult.concepts,
        conceptRecommendation: conceptResult.recommendation,
        conceptGenerationResult: conceptResult,
        selectedConcept: undefined,
        outline: undefined,
        slides: undefined,
      }));
      setStep('concepts');
    } catch (err) {
      setError(err instanceof Error ? err.message : '콘셉트 후보 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const selectConcept = (concept: ConceptCandidate) => {
    setState((current) => ({ ...current, selectedConcept: concept, outline: undefined, slides: undefined }));
  };


  const renumberOutline = (outline: SlideOutline[]) => outline.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));

  const updateOutlineSlide = (slideNumber: number, field: keyof Pick<SlideOutline, 'slideTitle' | 'slidePurpose' | 'slideRole' | 'relationToThesis' | 'whyThisSlideExists' | 'keyMessage' | 'mainCopy'>, value: string) => {
    setState((current) => ({
      ...current,
      outline: current.outline?.map((slide) => (slide.slideNumber === slideNumber ? { ...slide, [field]: value } : slide)),
      slides: undefined,
    }));
  };

  const deleteOutlineSlide = (slideNumber: number) => {
    setState((current) => ({
      ...current,
      outline: current.outline ? renumberOutline(current.outline.filter((slide) => slide.slideNumber !== slideNumber)) : current.outline,
      slides: undefined,
    }));
  };

  const moveOutlineSlide = (slideNumber: number, direction: -1 | 1) => {
    setState((current) => {
      if (!current.outline) return current;
      const index = current.outline.findIndex((slide) => slide.slideNumber === slideNumber);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.outline.length) return current;
      const nextOutline = [...current.outline];
      [nextOutline[index], nextOutline[nextIndex]] = [nextOutline[nextIndex], nextOutline[index]];
      return { ...current, outline: renumberOutline(nextOutline), slides: undefined };
    });
  };

  const addOutlineSlide = () => {
    setState((current) => {
      const outline = current.outline ?? [];
      const nextSlide: SlideOutline = {
        slideNumber: outline.length + 1,
        slideType: 'Custom Slide',
        slideTitle: '새 슬라이드 제목',
        slidePurpose: 'Strategy',
        slideRole: '이 슬라이드가 제안서에서 수행할 역할을 입력하세요.',
        relationToThesis: '제안 명제와의 연결을 입력하세요.',
        whyThisSlideExists: '이 슬라이드가 필요한 이유를 입력하세요.',
        keyMessage: '핵심 메시지를 입력하세요.',
        mainCopy: '본문 방향 또는 주요 서술 문장을 입력하세요.',
        confirmNeededNote: '',
      };
      return { ...current, outline: [...outline, nextSlide], slides: undefined };
    });
  };

  const runOutline = async () => {
    if (!canGenerateProposalStructure || !state.analysis || !state.selectedConcept) return;
    setError('');
    setLoading('제안서 구조 생성 중...');
    try {
      const outline = await postJson<SlideOutline[]>('/api/outline', { input: analysisInput, analysis: state.analysis, selectedConcept: state.selectedConcept, conceptDevelopmentLogic: state.conceptDevelopmentLogic, conceptGenerationResult: state.conceptGenerationResult, proposalNarrative: state.proposalNarrative, documentChunks });
      setState((current) => ({ ...current, outline, slides: undefined }));
      setStep('outline');
    } catch (err) {
      setError(err instanceof Error ? err.message : '구조 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const runSlides = async () => {
    if (!state.analysis || !state.selectedConcept || !state.outline) return;
    setError('');
    setLoading('장표별 문안 생성 중...');
    try {
      const editableOutline = state.outline.map((slide) => ({ ...slide, mainCopy: slide.mainCopy ?? slide.keyMessage }));
      const slides = await postJson<SlideContent[]>('/api/slides', { input: analysisInput, analysis: state.analysis, selectedConcept: state.selectedConcept, outline: removeInternalConceptComparisonSlides(editableOutline), conceptDevelopmentLogic: state.conceptDevelopmentLogic, conceptGenerationResult: state.conceptGenerationResult, proposalNarrative: state.proposalNarrative, documentChunks });
      setState((current) => ({ ...current, slides }));
      setStep('slides');
    } catch (err) {
      setError(err instanceof Error ? err.message : '문안 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ input: initialInput, supplementalInfo: initialSupplementalInfo, uploadedDocuments: [], dbUploadedDocuments: [] });
    setStep('create');
    setError('');
    setUploadNotice(null);
    setDbUploadNotice(null);
    setIsDbUploadModalOpen(false);
  };

  return (
    <main className="min-h-screen px-5 py-8 md:px-10">
      <LoadingOverlay message={loading} />
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.35em] text-blue-600">MVP</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">AI Proposal Builder</h1>
            <p className="mt-3 max-w-2xl text-slate-600">RFP/프로젝트 브리프를 분석해 전시·브랜드 체험관 제안서 구조와 장표별 문안을 만들고 PPTX로 다운로드합니다.</p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <SecondaryButton onClick={() => setIsDbUploadModalOpen(true)}>DB 자료 업로드</SecondaryButton>
            {step !== 'home' && <SecondaryButton onClick={reset}>새 제안서 만들기</SecondaryButton>}
          </div>
        </header>

        {isDbUploadModalOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 px-5 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="db-upload-title">
            <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border border-white/30 bg-white p-6 shadow-2xl shadow-slate-950/30 md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Library upload</p>
                  <h2 id="db-upload-title" className="mt-2 text-2xl font-black text-slate-950">기존 제안서 / 레퍼런스 DB 업로드</h2>
                  <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">기존 제안서, 레퍼런스, 메모를 내부 RAG 자료로 저장합니다. 제안서 생성에는 아직 자동 반영되지 않습니다.</p>
                  <p className="mt-2 text-sm font-semibold text-slate-700">지원 형식: PDF, PPTX, DOCX, TXT, MD · 최대 100MB</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-amber-700">{DB_UPLOAD_SIZE_GUIDANCE}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDbUploadModalOpen(false)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50"
                  aria-label="DB 업로드 창 닫기"
                >
                  닫기
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">문서 유형</span>
                  <select
                    value={dbUploadRole}
                    onChange={(event) => setDbUploadRole(event.target.value as 'proposal' | 'reference' | 'memo')}
                    className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
                  >
                    <option value="proposal">기존 제안서 / Proposal</option>
                    <option value="reference">레퍼런스 / Reference</option>
                    <option value="memo">메모 / Memo</option>
                  </select>
                </label>
                <label className="inline-flex cursor-pointer items-center justify-center self-end rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700">
                  DB 파일 선택
                  <input
                    type="file"
                    accept=".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                    onChange={handleDbFileUpload}
                    disabled={Boolean(loading)}
                    className="sr-only"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm leading-6 text-slate-700">
                <p className="font-black text-emerald-900">업로드 상태</p>
                <p className="mt-1 font-semibold">DB upload disabled · Uploading to DB · Saved to DB · DB upload failed · Partial text saved</p>
                {latestDbUploadStatus && (
                  <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-black ${latestDbUploadStatus.tone}`} role="status" aria-live="polite">
                    {latestDbUploadedDocument?.dbSaveStatus === 'saving' && <span className="mr-2 h-1.5 w-1.5 animate-pulse self-center rounded-full bg-current" />}
                    {latestDbUploadStatus.label}{latestDbUploadedDocument?.dbChunkCount !== undefined ? ` · ${latestDbUploadedDocument.dbChunkCount} chunks` : ''}
                  </span>
                )}
              </div>

              <UploadedDocumentsList documents={dbUploadedDocuments} />
              {dbUploadNotice && (
                <div
                  className={`mt-4 rounded-2xl border p-4 text-sm font-semibold leading-6 ${
                    dbUploadNotice.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : dbUploadNotice.type === 'warning'
                        ? 'border-amber-200 bg-amber-50 text-amber-900'
                        : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  {dbUploadNotice.message}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 font-medium text-red-700">{error}</div>}

        {step === 'home' && (
          <section className="rounded-[2rem] bg-gradient-to-br from-blue-600 to-slate-950 p-8 text-white shadow-2xl shadow-blue-900/20 md:p-12">
            <p className="text-blue-100">전시/브랜드 체험관 제안서 자동 생성 MVP</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-black leading-tight md:text-6xl">브리프 입력부터 PPTX 초안까지 한 번에 생성하세요.</h2>
            <p className="mt-5 max-w-2xl text-lg text-blue-50">제안서 유형을 선택하고 자료를 업로드한 뒤 추가 메모를 입력하면 AI가 분석, 목차, 장표 문안, 시각화 지시문을 단계별로 생성합니다.</p>
            <button onClick={() => setStep('create')} className="mt-8 rounded-2xl bg-white px-6 py-4 font-bold text-blue-700 shadow-xl transition hover:bg-blue-50">
              새 제안서 만들기
            </button>
          </section>
        )}

        {step === 'create' && (
          <SectionCard title="프로젝트 생성">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">제안서 유형</span>
                <select value={state.input.proposalType} onChange={(event) => updateInput('proposalType', event.target.value as ProposalType)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-500">
                  {Object.entries(proposalTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">프로젝트명</span>
                <input value={state.input.projectName} onChange={(event) => updateInput('projectName', event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="예: EV 브랜드 체험관 제안" />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">클라이언트명</span>
                <input value={state.input.clientName} onChange={(event) => updateInput('clientName', event.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="예: Hyundai Motor Company" />
              </label>
              <div className="rounded-3xl border border-dashed border-blue-200 bg-blue-50/60 p-5 md:col-span-2">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-700">RFP / 전달자료 업로드</p>
                    <p className="mt-2 text-sm font-semibold text-slate-700">지원 형식: PDF, PPTX, DOCX, TXT, MD · 최대 10MB</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">업로드된 파일은 텍스트 추출/Vision 분석 요청에만 사용되며 원본 파일은 저장하지 않습니다.</p>
                    {hasVisionAnalysisInProgress && <p className="mt-1 text-sm leading-6 text-amber-700">{VISION_PROCESSING_GUIDANCE}</p>}
                    <p className="mt-1 text-xs font-bold text-blue-700">Vision 옵션: {VISION_FULL_CHUNKED_LABEL}</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-bold text-blue-700 shadow-sm ring-1 ring-blue-200 transition hover:bg-blue-50">
                    파일 선택
                    <input
                      type="file"
                      accept=".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                      onChange={handleBriefFileUpload}
                      disabled={Boolean(loading)}
                      className="sr-only"
                    />
                  </label>
                </div>
                <UploadedDocumentsList documents={uploadedDocuments} />
                {currentUploadNotice && (
                  <div
                    className={`mt-4 rounded-2xl border p-4 text-sm font-semibold leading-6 ${
                      currentUploadNotice.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : currentUploadNotice.type === 'warning'
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {currentUploadNotice.message}
                  </div>
                )}
              </div>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">추가 메모 / 보완 설명</span>
                <textarea value={state.input.briefText} onChange={(event) => updateInput('briefText', event.target.value)} className="min-h-72 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="업로드 자료에 없는 추가 요구사항, 배경 설명, 강조점만 직접 입력하세요." />
              </label>
              {shouldShowShortBriefGuidance && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900 md:col-span-2">
                  {shortBriefGuidance}
                </div>
              )}
            </div>
            <div className="mt-5">
              <InputQualityPanel quality={inputQuality} compact />
            </div>
            {hasPartialVisionAnalysisInput && (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
                현재 앞 3페이지 기준 빠른 분석 결과로 진행합니다. 전체 페이지 분석이 완료되면 더 정밀한 결과를 생성할 수 있습니다.
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton onClick={runAnalyze} disabled={!canAnalyze || Boolean(loading)}>업로드 자료와 메모로 AI 분석하기</PrimaryButton>
            </div>
          </SectionCard>
        )}

        {step === 'analysis' && state.analysis && (
          <SectionCard title="AI 분석 결과">
            <div className="space-y-5">
              {state.analysisBasis?.type === 'partial' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
                  <p className="font-black">부분 분석 기반</p>
                  <p>분석 기준: {state.analysisBasis.label}</p>
                  <p>추가 분석 완료 후 재분석 권장</p>
                </div>
              )}
              <DbSaveStatusIndicator status={dbSaveStatus} />
              <KeyValueList data={state.analysis} evidence={state.retrievalEvidence} />
              <RetrievalEvidencePanel evidence={state.retrievalEvidence} />
            </div>
            {hasConfirmationNeeds && (
              <>
                <div className="mt-6">
                  <AdditionalInfoRecommendationPanel confirmationInfo={confirmationInfo} />
                </div>
                <div className="mt-3 rounded-3xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-700">추가 정보 입력</p>
                    <h3 className="mt-2 text-xl font-black text-amber-950">부족한 정보를 입력하면 AI 분석을 다시 실행할 수 있습니다.</h3>
                    <p className="mt-2 text-sm leading-6 text-amber-900">
                      입력 정보가 부족하면 제안서가 일반적으로 생성될 수 있습니다. 아래 정보를 추가하면 결과 품질이 개선됩니다.
                    </p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">
                      모든 항목을 입력할 필요는 없습니다. 확인 가능한 정보만 입력해도 분석 품질이 개선됩니다.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-bold text-amber-900 shadow-sm">
                    확인 필요 {confirmationInfo.count}건
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {supplementalInfoFields.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-2 block text-sm font-bold text-slate-800">{field.label}</span>
                      <textarea
                        value={supplementalInfo[field.key]}
                        onChange={(event) => updateSupplementalInfo(field.key, event.target.value)}
                        className="min-h-28 w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}
                </div>
                </div>
              </>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('create')}>이전</SecondaryButton>
              {state.analysisBasis?.type === 'partial' && !hasFullVisionAnalysisInProgress && (
                <PrimaryButton onClick={runAnalyze} disabled={Boolean(loading)}>전체 분석 결과로 다시 AI 분석하기</PrimaryButton>
              )}
              {hasConfirmationNeeds ? (
                <>
                  <PrimaryButton onClick={rerunAnalyzeWithSupplementalInfo} disabled={Boolean(loading)}>추가 정보 반영하기</PrimaryButton>
                  <SecondaryButton onClick={runConcepts} disabled={Boolean(loading)}>콘셉트 생성</SecondaryButton>
                </>
              ) : (
                <PrimaryButton onClick={runConcepts} disabled={Boolean(loading)}>콘셉트 후보 생성</PrimaryButton>
              )}
            </div>
          </SectionCard>
        )}

        {step === 'concepts' && state.analysis && (state.conceptCandidates?.length || state.selectedConcept) && (
          <SectionCard title="콘셉트 후보 선택">
            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5 text-blue-950">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-700">Required Step</p>
              <h3 className="mt-2 text-xl font-black">제안서 구조 생성 전에 콘셉트 후보 3안 중 하나를 선택해주세요.</h3>
              <p className="mt-2 text-sm leading-6">
                선택한 콘셉트는 이후 제안서 구조, 장표별 문안, PPTX의 Core Concept / Key Experience Asset Concept / 공간·콘텐츠 / 미디어·인터랙션 장표 기준으로 저장됩니다.
              </p>
              {state.selectedConcept && (
                <p className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-black text-blue-800">
                  선택된 콘셉트: {getPresentationConceptName(state.selectedConcept)}
                </p>
              )}
            </div>
            <ProposalNarrativePanel narrative={state.proposalNarrative} />
            <ConceptDevelopmentLogicPanel logic={state.conceptDevelopmentLogic} />
            <ConceptRecommendationPanel recommendation={state.conceptRecommendation} />
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {(state.conceptCandidates ?? []).map((concept) => {
                const selected = state.selectedConcept?.conceptId === concept.conceptId;
                return (
                  <article key={concept.conceptId} className={`flex flex-col rounded-3xl border p-5 ${selected ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100' : 'border-slate-200 bg-white'}`}>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{concept.conceptId}</p>
                    <h3 className="mt-2 text-2xl font-black text-slate-950">{getPresentationConceptName(concept)}</h3>
                    <p className="text-lg font-bold text-blue-700">{getConceptTagline(concept)}</p>
                    {conceptRationaleRows(concept).length > 0 && (
                      <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-950">
                        <p className="font-black text-blue-800">왜 이 컨셉인가</p>
                        <dl className="mt-2 space-y-1">
                          {conceptRationaleRows(concept).map(([label, value]) => (
                            <div key={label}>
                              <dt className="inline font-black">{label}: </dt>
                              <dd className="inline">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                    <p className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-semibold leading-6 text-slate-700">{getConceptDefinition(concept)}</p>
                    <dl className="mt-4 flex-1 space-y-3 text-sm leading-6 text-slate-700">
                      <div><dt className="font-black text-slate-950">핵심 메시지</dt><dd>{concept.coreMessage}</dd></div>
                      <div><dt className="font-black text-slate-950">명제 증명</dt><dd>{concept.thesisProof || concept.whyThisWorks}</dd></div>
                      <div><dt className="font-black text-slate-950">경험 구조</dt><dd>{concept.experienceStructure || concept.experienceLogic}</dd></div>
                      <div><dt className="font-black text-slate-950">예상 핵심 체험 자산 방향</dt><dd>{concept.keyExperienceAssetDirection}</dd></div>
                      <div><dt className="font-black text-slate-950">강점</dt><dd>{concept.strengths?.length ? concept.strengths.join(' / ') : concept.whyThisWorks}</dd></div>
                      <div><dt className="font-black text-slate-950">리스크</dt><dd>{concept.risks?.length ? concept.risks.join(' / ') : concept.riskOrCaution}</dd></div>
                      <div><dt className="font-black text-slate-950">평가 점수 요약</dt><dd>{scoreSummary(concept)}</dd></div>
                    </dl>
                    <button
                      onClick={() => selectConcept(concept)}
                      className={`mt-5 rounded-2xl px-4 py-3 font-bold transition ${selected ? 'bg-blue-600 text-white' : 'bg-slate-950 text-white hover:bg-blue-700'}`}
                    >
                      {selected ? '선택됨' : '이 콘셉트 선택'}
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('analysis')}>분석 결과 보기</SecondaryButton>
              <SecondaryButton onClick={runConcepts} disabled={Boolean(loading)}>콘셉트 다시 생성</SecondaryButton>
              <PrimaryButton onClick={runOutline} disabled={Boolean(loading) || !canGenerateProposalStructure}>제안서 구조 생성</PrimaryButton>
            </div>
          </SectionCard>
        )}

        {step === 'outline' && state.outline && (
          <SectionCard title="제안서 구조 생성 결과">
            {state.selectedConcept && (
              <div className="mb-5 rounded-3xl border border-blue-100 bg-blue-50 p-4 text-sm font-black text-blue-800">
                선택된 콘셉트: {getPresentationConceptName(state.selectedConcept)}
              </div>
            )}
            <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900">
              이 구조는 최종 문안 생성과 PPTX 다운로드의 기준입니다. 내부 의사결정용 콘셉트 후보 비교 장표는 제외되며, 필요한 장표는 직접 수정·삭제·추가할 수 있습니다.
            </div>
            <div className="space-y-3">
              {state.outline.map((slide, index) => (
                <article key={slide.slideNumber} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-blue-600">SLIDE {String(slide.slideNumber).padStart(2, '0')}</p>
                      <div className="mt-1 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{slide.slideType}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => moveOutlineSlide(slide.slideNumber, -1)} disabled={index === 0} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">위로</button>
                      <button type="button" onClick={() => moveOutlineSlide(slide.slideNumber, 1)} disabled={index === state.outline!.length - 1} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">아래로</button>
                      <button type="button" onClick={() => deleteOutlineSlide(slide.slideNumber)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">삭제</button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700">
                      슬라이드 제목
                      <input value={slide.slideTitle} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'slideTitle', event.target.value)} className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500" />
                    </label>
                    <label className="text-sm font-bold text-slate-700">
                      핵심 메시지
                      <input value={slide.keyMessage} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'keyMessage', event.target.value)} className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500" />
                    </label>
                    <label className="text-sm font-bold text-slate-700">
                      슬라이드 목적
                      <select value={slide.slidePurpose} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'slidePurpose', event.target.value)} className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500">
                        {['Problem', 'Insight', 'Strategy', 'Concept', 'Experience', 'Content', 'Proof', 'Impact'].map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-bold text-slate-700">
                      슬라이드 역할
                      <input value={slide.slideRole ?? ''} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'slideRole', event.target.value)} className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500" />
                    </label>
                    <label className="text-sm font-bold text-slate-700 md:col-span-2">
                      제안 명제와의 연결
                      <textarea value={slide.relationToThesis ?? ''} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'relationToThesis', event.target.value)} className="mt-1 min-h-20 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500" />
                    </label>
                    <label className="text-sm font-bold text-slate-700 md:col-span-2">
                      이 슬라이드가 필요한 이유
                      <textarea value={slide.whyThisSlideExists ?? ''} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'whyThisSlideExists', event.target.value)} className="mt-1 min-h-20 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500" />
                    </label>
                    <label className="text-sm font-bold text-slate-700 md:col-span-2">
                      메인 카피 / 문안 방향
                      <textarea value={slide.mainCopy ?? ''} onChange={(event) => updateOutlineSlide(slide.slideNumber, 'mainCopy', event.target.value)} className="mt-1 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none focus:border-blue-500" />
                    </label>
                  </div>
                  {slide.confirmNeededNote && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Note: {slide.confirmNeededNote}</p>}
                </article>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('concepts')}>다른 콘셉트 선택</SecondaryButton>
              <SecondaryButton onClick={addOutlineSlide}>슬라이드 추가</SecondaryButton>
              <PrimaryButton onClick={runSlides} disabled={Boolean(loading) || !state.outline.length}>장표별 문안 생성</PrimaryButton>
            </div>
          </SectionCard>
        )}

        {step === 'slides' && state.slides && (
          <SectionCard title="장표별 문안 생성 결과">
            {state.selectedConcept && (
              <div className="mb-5 rounded-3xl border border-blue-100 bg-blue-50 p-4 text-sm font-black text-blue-800">
                선택된 콘셉트: {getPresentationConceptName(state.selectedConcept)}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {state.slides.map((slide) => (
                <article key={slide.slideNumber} className="rounded-3xl border border-slate-200 p-5">
                  <p className="text-xs font-bold text-blue-600">SLIDE {String(slide.slideNumber).padStart(2, '0')}</p>
                  <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{slide.slideType}</div>
                  <h3 className="mt-2 text-xl font-black text-slate-950">{slide.slideTitle}</h3>
                  <p className="mt-1 text-sm font-semibold text-blue-700">{slide.keyMessage}</p>
                  <div className="mt-3 grid gap-2 text-xs text-violet-900 md:grid-cols-2">
                    <div className="rounded-2xl bg-violet-50 p-3"><span className="font-black">Purpose</span><br />{slide.slidePurpose}</div>
                    <div className="rounded-2xl bg-violet-50 p-3"><span className="font-black">Role</span><br />{slide.slideRole}</div>
                    <div className="rounded-2xl bg-violet-50 p-3"><span className="font-black">Relation to Thesis</span><br />{slide.relationToThesis}</div>
                    <div className="rounded-2xl bg-violet-50 p-3"><span className="font-black">Why This Slide Exists</span><br />{slide.whyThisSlideExists}</div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{slide.mainCopy}</p>
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {slide.bodyBullets.map((bullet, index) => <li key={`${bullet}-${index}`}>{bullet}</li>)}
                  </ul>
                  <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
                    {hasText(slide.visitorAction) && <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Visitor Action</span><br />{slide.visitorAction}</div>}
                    {hasText(slide.contentMechanism) && <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Content Mechanism</span><br />{slide.contentMechanism}</div>}
                    {hasText(slide.spatialPlacement) && <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Spatial Placement</span><br />{slide.spatialPlacement}</div>}
                    {hasText(slide.mediaOrObject) && <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Media / Object</span><br />{slide.mediaOrObject}</div>}
                    {hasText(slide.outputOrReward) && <div className="rounded-2xl bg-slate-100 p-3 text-slate-600 md:col-span-2"><span className="font-bold">Output / Reward</span><br />{slide.outputOrReward}</div>}
                  </div>
                  {slide.keyExperienceAssets?.length > 0 && (
                    <div className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">
                      <span className="font-black">핵심 체험 자산 1~3</span>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {slide.keyExperienceAssets.slice(0, 3).map((asset) => <li key={asset.assetName}>{asset.assetName} · {asset.assetType} · {asset.visitorAction} → {asset.outputOrReward}</li>)}
                      </ul>
                    </div>
                  )}
                  {slide.productExperienceDetails?.length > 0 && (
                    <div className="mt-4 rounded-2xl bg-cyan-50 p-3 text-sm text-cyan-800">
                      <span className="font-black">제품/콘텐츠 단위별 체험 상세</span>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {slide.productExperienceDetails.map((product) => <li key={product.productCode}>{product.productCode} · {product.experienceTitle} · {product.visitorMission} → {product.outputOrReward}</li>)}
                      </ul>
                    </div>
                  )}
                  {slide.experienceScenarioSteps?.length > 0 && (
                    <div className="mt-4 rounded-2xl bg-orange-50 p-3 text-sm text-orange-800">
                      <span className="font-black">Experience Scenario Flow</span>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {slide.experienceScenarioSteps.map((step) => <li key={step.step}>{step.step}: {step.visitorAction} → {step.systemResponse} → {step.output}</li>)}
                      </ul>
                    </div>
                  )}
                  {hasText(slide.visualDirection) && <div className="mt-4 rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">비주얼 방향: {slide.visualDirection}</div>}
                  <div className="mt-2 rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">이미지: {getImagePlaceholder(slide)}</div>
                  {hasText(slide.speakerNote) && <div className="mt-2 rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-700">발표 노트: {slide.speakerNote}</div>}
                  {slide.confirmNeededNote && <div className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">확인 Note: {slide.confirmNeededNote}</div>}
                </article>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('outline')}>구조 보기</SecondaryButton>
              <PrimaryButton onClick={() => downloadPptx(state.input, state.slides || [], state.selectedConcept)}>PPTX 다운로드</PrimaryButton>
            </div>
          </SectionCard>
        )}
      </div>
    </main>
  );
}
