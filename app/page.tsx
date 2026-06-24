'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import pptxgen from 'pptxgenjs';
import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ConceptDevelopmentLogic, ConceptNameOption, ConceptNameOptionsResult, ConceptRecommendation, ExtractionStatus, ProjectInput, ProposalNarrative, OutcomeReasonType, ProposalOutcome, ProposalState, ProposalType, RetrievalEvidenceItem, SlideContent, SlideOutline, SupplementalInfo, UploadedDocument, VisionPageAnalysis, RfpDiagnosis, BrandProductIntelligence, DesignGuide } from '@/lib/types';
import { normalizeProposalType, proposalTypeLabels } from '@/lib/types';
import { assessInputQuality } from '@/lib/inputQuality';
import { sanitizeGeneratedSlides, sanitizeImagePlaceholderForPpt } from '@/lib/slideSanitizer';
import { buildDeckDesignGuide } from '@/lib/deckStructure';
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
  validateDirectTextInput,
  validateExtractedText,
} from '@/lib/extractedTextValidation';
import { DEFAULT_VISION_CHUNK_SIZE, DEFAULT_VISION_MODE } from '@/lib/visionConfig';
import { getConceptDefinition, getConceptTagline, getPresentationConceptName } from '@/lib/conceptNamingGuard';
import { conceptPromptVersion } from '@/lib/conceptPromptVersion';
import { createDocumentChunks, inferDocumentType } from '@/lib/rag';
import { inferUploadedDocumentRole, mapStorageRoleToDocumentType } from '@/lib/documentRoles';
import { uploadDbLibraryFileToStorage, type UploadedDbLibraryStorageFile } from '@/lib/supabaseStorageUpload';
import { getActiveMatrix, sanitizeConceptContextByRfpType } from '@/lib/conceptContextSanitizer';

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

type AnalysisApiResponse = AnalysisResult | { result: AnalysisResult; evidence?: RetrievalEvidenceItem[]; proposalStrategyDiagnosis?: RfpDiagnosis; diagnosis?: RfpDiagnosis; rfpDiagnosis?: RfpDiagnosis; winningDiagnosis?: RfpDiagnosis; victoryDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence };

type DbSaveStatus = 'idle' | 'disabled' | 'saving' | 'saved' | 'failed' | 'partial';

type PersistDocumentResponse = {
  status?: 'disabled' | 'saved' | 'failed' | 'partial';
  projectId?: string;
  documentId?: string;
  chunkCount?: number;
  role?: 'rfp' | 'proposal' | 'reference' | 'memo';
  proposalPatternStatus?: 'extracting' | 'extracted' | 'skipped' | 'failed';
  proposalPatternCount?: number;
  dbLibraryMetadata?: UploadedDocument['dbLibraryMetadata'];
};

type ExtractFromStorageResponse = {
  status?: 'saved' | 'partial' | 'failed';
  message?: string;
  error?: string;
  projectId?: string;
  documentId?: string;
  chunkCount?: number;
  role?: 'rfp' | 'proposal' | 'reference' | 'memo';
  warning?: string;
  extractionStatus?: ExtractionStatus;
  detail?: string;
  pageCount?: number;
  extractedPageCount?: number;
  bucket?: string;
  storagePath?: string;
  proposalPatternStatus?: 'extracting' | 'extracted' | 'skipped' | 'failed';
  proposalPatternCount?: number;
  dbLibraryMetadata?: UploadedDocument['dbLibraryMetadata'];
};

type PersistAnalysisResponse = {
  status?: 'disabled' | 'saved' | 'failed';
  projectId?: string;
  documentCount?: number;
  chunkCount?: number;
};

type BackfillProposalPatternsResponse = {
  status?: 'disabled' | 'completed' | 'failed';
  force?: boolean;
  processedCount?: number;
  extractedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  results?: Array<{
    documentId: string;
    projectId: string;
    fileName: string;
    status: 'extracted' | 'skipped' | 'failed';
    reason?: string;
    chunkCount: number;
    previousPatternCount: number;
    proposalPatternCount: number;
  }>;
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
const LARGE_FILE_UPLOAD_GUIDANCE = '파일 용량이 커서 직접 업로드 방식에 실패했습니다. Storage 업로드 방식으로 다시 시도해 주세요.';
const DB_STORAGE_UPLOAD_THRESHOLD_BYTES = 10 * 1024 * 1024;
const DB_UPLOAD_SIZE_GUIDANCE = '대용량 PDF/PPTX는 Supabase Storage에 먼저 업로드한 뒤 서버에서 추출/저장합니다.';
const DB_STORAGE_EXTRACTION_TIMEOUT_DETAIL = '파일 원본은 Storage에 저장되었지만, PDF 텍스트 추출이 시간 초과되었습니다. MD/TXT 변환본을 추가 업로드하면 구조 분석에 더 안정적으로 사용할 수 있습니다.';
const clientReadableExtensions = ['txt', 'md'];
const serverReadableExtensions = ['pdf', 'docx', 'pptx'];

const dbDocumentRoleLabels: Record<'rfp' | 'proposal' | 'reference' | 'memo', string> = {
  rfp: 'RFP / 제안요청서',
  proposal: '기존 제안서 / Proposal',
  reference: '레퍼런스 / Reference',
  memo: '메모 / Memo',
};

const proposalOutcomeLabels: Record<ProposalOutcome, string> = {
  won: '수주',
  lost: '미수주',
  unknown: '결과 모름',
};

const STORAGE_KEY = 'ai-proposal-builder-state';


const diagnosisFieldAdapters = {
  coreProposalThesis: 'coreWinningCondition',
  hiddenRequirement: 'hiddenNeed',
  strategicIssue: 'strategicTension',
  persuasionTask: 'proofBurden',
  genericProposalRisk: 'genericProposalFailureReason',
} as const;

type NewDiagnosisTextKey = keyof typeof diagnosisFieldAdapters;

const diagnosisFieldLabels: Array<[NewDiagnosisTextKey, string]> = [
  ['coreProposalThesis', '핵심 제안 명제'],
  ['hiddenRequirement', '숨은 요구'],
  ['strategicIssue', '전략적 쟁점'],
  ['persuasionTask', '설득 과제'],
  ['genericProposalRisk', '평범한 제안이 부족한 이유'],
];

function getDiagnosisText(diagnosis: RfpDiagnosis | undefined, key: NewDiagnosisTextKey) {
  if (!diagnosis) return '';
  const legacyKey = diagnosisFieldAdapters[key];
  return (diagnosis[key] || diagnosis[legacyKey] || '').trim();
}

function getDiagnosisList(diagnosis: RfpDiagnosis | undefined) {
  return diagnosis?.requiredPersuasionElements?.length ? diagnosis.requiredPersuasionElements : diagnosis?.requiredProofElements ?? [];
}

function withDiagnosisText(diagnosis: RfpDiagnosis, key: NewDiagnosisTextKey, value: string): RfpDiagnosis {
  const legacyKey = diagnosisFieldAdapters[key];
  return { ...diagnosis, [key]: value, [legacyKey]: value };
}

function withDiagnosisList(diagnosis: RfpDiagnosis, value: string): RfpDiagnosis {
  const items = value.split('\n').map((item) => item.trim()).filter(Boolean);
  return { ...diagnosis, requiredPersuasionElements: items, requiredProofElements: items };
}

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


type SupplementalInfoConfidence = 'RFP 근거 있음' | 'AI 보완' | '사용자 확인 권장' | '사용자 수정';

type SupplementalInfoDraft = {
  key: keyof SupplementalInfo;
  label: string;
  value: string;
  confidence: SupplementalInfoConfidence;
  evidenceLevel: 'confirmed' | 'assumption' | 'user';
  helper: string;
};

function compactValue(items: Array<string | undefined>, fallback = '') {
  const value = uniqueItems(items).join(' / ').trim();
  return value || fallback;
}

function hasMeaningfulValue(value: string) {
  return value.trim().length >= 2 && !/^(없음|미정|미확정|확인 필요|n\/a|na|tbd)$/i.test(value.trim());
}

function buildSupplementalInfoDrafts(analysis: AnalysisResult | undefined, quality: ReturnType<typeof assessInputQuality>, currentInfo: SupplementalInfo): SupplementalInfoDraft[] {
  const fieldMap = new Map(supplementalInfoFields.map((field) => [field.key, field]));
  const presentKeys = new Set(quality.presentItems.map((item) => item.key === 'target' ? 'targetCustomer' : item.key));
  const missingKeys = new Set(quality.missingItems.map((item) => item.key === 'target' ? 'targetCustomer' : item.key));

  const analysisDrafts: Record<keyof SupplementalInfo, string> = {
    projectPurpose: compactValue([
      analysis?.clientChallenge,
      ...(analysis?.kpiObjectives ?? []),
      ...(analysis?.clientTask?.rfpFact ?? []),
    ], 'RFP 과제와 제안 목적을 기준으로 설득 메시지를 보완합니다.'),
    spaceLocationScale: compactValue([
      analysis?.spatialCondition,
      ...(analysis?.targetSpaceContentOperation?.rfpFact ?? []),
      ...(analysis?.constraints ?? []),
    ], 'RFP의 공간/동선 조건을 기준으로 적용 가능한 규모를 가정합니다.'),
    targetCustomer: compactValue([
      analysis?.targetInfo,
      ...(analysis?.clientTask?.rfpFact ?? []),
    ], 'RFP 맥락상 주요 의사결정자와 방문객을 함께 고려합니다.'),
    experienceElements: compactValue([
      analysis?.contentCondition,
      ...(analysis?.requiredItems ?? []),
      ...(analysis?.requiredDeliverables ?? []),
      ...(analysis?.scopeOfWork ?? []),
    ], '필수 산출물과 콘텐츠 조건을 바탕으로 핵심 체험 요소를 보완합니다.'),
    brandMessage: compactValue([
      ...(analysis?.productInfo ?? []),
      ...(analysis?.productFeatures?.map((feature) => `${feature.product}: ${feature.valueProposition || feature.keyFeature}`) ?? []),
      ...(analysis?.rfpRequirements?.rfpFact ?? []),
    ], '브랜드/제품 정보가 제한적이므로 RFP 과제 중심 메시지로 보완합니다.'),
    schedule: compactValue([
      ...(analysis?.schedule ?? []),
      ...(analysis?.kpiScheduleConstraints ?? []),
      ...(analysis?.kpiTimelineConstraints?.rfpFact ?? []),
    ], '상세 일정은 발주처 확인 전제로 단계별 준비/제작/운영 흐름을 가정합니다.'),
    budgetScope: compactValue([
      ...(analysis?.scopeOfWork ?? []),
      ...(analysis?.requiredScope ?? []),
      ...(analysis?.requiredDeliverables ?? []),
    ], '명시 예산이 없으면 제안 범위 중심으로 제작/운영 포함 범위를 가정합니다.'),
    designTone: compactValue([
      ...(analysis?.referenceOnly ?? []),
      ...(analysis?.existingAssets ?? []),
      ...(analysis?.targetSpaceContentOperation?.aiProposal ?? []),
    ], 'RFP의 브랜드/레퍼런스/공간 맥락에 맞춰 톤앤매너를 보완합니다.'),
    exclusions: compactValue([
      ...(analysis?.doNotTreatAsScope ?? []),
      ...(analysis?.constraints ?? []),
      ...(analysis?.referenceOnly ?? []),
    ], 'RFP 제약과 제외 범위를 기준으로 과도한 확장을 방지합니다.'),
  };

  return supplementalInfoFields.map((field) => {
    const userValue = currentInfo[field.key]?.trim() ?? '';
    const aiValue = analysisDrafts[field.key];
    const isUserEdited = hasMeaningfulValue(userValue) && userValue !== aiValue;
    const hasRfpEvidence = presentKeys.has(field.key) && hasMeaningfulValue(aiValue);
    const isHighRiskMissing = missingKeys.has(field.key) && !hasMeaningfulValue(aiValue);
    const confidence: SupplementalInfoConfidence = isUserEdited
      ? '사용자 수정'
      : hasRfpEvidence
        ? 'RFP 근거 있음'
        : isHighRiskMissing
          ? '사용자 확인 권장'
          : 'AI 보완';

    return {
      key: field.key,
      label: fieldMap.get(field.key)?.label ?? field.label,
      value: userValue || aiValue,
      confidence,
      evidenceLevel: isUserEdited ? 'user' : hasRfpEvidence ? 'confirmed' : 'assumption',
      helper: confidence === 'RFP 근거 있음' ? 'RFP 분석에서 확인된 사실입니다.' : confidence === '사용자 수정' ? '사용자가 수정한 값입니다.' : 'RFP 맥락을 바탕으로 AI가 보완한 가정값입니다.',
    };
  });
}

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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    cache: 'no-store',
    body: JSON.stringify(body),
  });

  const data = await parseJsonResponse<{ error?: string; message?: string }>(response, url);
  if (!response.ok) {
    throw new Error(data.error || data.message || '요청 처리 중 오류가 발생했습니다.');
  }

  return data as T;
}

// Detect a timeout-class failure (route timeout reason code, platform 504/FUNCTION_INVOCATION_TIMEOUT, or a
// non-JSON gateway body) so the UI can show a clear "keep your work and retry" message instead of a generic error.
const TIMEOUT_MESSAGE_PATTERN = /analysis_timeout|model_timeout|empty_response|FUNCTION_INVOCATION_TIMEOUT|timeout|timed out|aborted|non-JSON response|\b504\b|시간 초과/i;
function isTimeoutMessage(message?: string) {
  return TIMEOUT_MESSAGE_PATTERN.test(message || '');
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


function CompactAccordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-black text-slate-800">
        <span>{title}</span>
        <span className="text-slate-500">{open ? '⌄' : '›'}</span>
      </button>
      {open && <div className="border-t border-slate-100 px-3 py-3 text-sm font-semibold leading-6 text-slate-700">{children}</div>}
    </div>
  );
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


function getProposalPatternStatusLabel(status?: UploadedDocument['proposalPatternStatus'], count = 0) {
  const statusConfig: Record<NonNullable<UploadedDocument['proposalPatternStatus']>, { label: string; tone: string }> = {
    extracting: { label: '패턴 추출 중', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
    extracted: { label: '패턴 추출 완료', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    skipped: { label: count > 0 ? '패턴 추출 완료' : '패턴 없음', tone: count > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600' },
    failed: { label: '패턴 추출 실패', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  };

  return status ? statusConfig[status] : count > 0 ? statusConfig.extracted : null;
}

function getDocumentDbSaveStatusLabel(status?: UploadedDocument['dbSaveStatus']) {
  const statusConfig: Record<Exclude<DbSaveStatus, 'idle'>, { label: string; tone: string }> = {
    disabled: { label: '대기', tone: 'border-slate-200 bg-slate-50 text-slate-600' },
    saving: { label: 'DB 저장 중', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
    saved: { label: '저장 성공', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    failed: { label: '저장 실패', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
    partial: { label: '일부 저장', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
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
    '원본 저장 / 텍스트 추출 실패': 'bg-amber-50 text-amber-800 ring-amber-200',
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
              {(() => {
                const patternStatus = getProposalPatternStatusLabel(document.proposalPatternStatus, document.proposalPatternCount ?? 0);
                return patternStatus ? (
                  <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${patternStatus.tone}`}>
                    {patternStatus.label}{document.proposalPatternCount ? ` · ${document.proposalPatternCount} patterns` : ''}
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


function DbLibraryUploadedDocumentsList({
  documents,
  onBackfillDocument,
}: {
  documents: UploadedDocument[];
  onBackfillDocument?: (document: UploadedDocument, force: boolean) => void;
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
    '원본 저장 / 텍스트 추출 실패': 'bg-amber-50 text-amber-800 ring-amber-200',
  };

  if (!documents.length) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-emerald-200 bg-white/70 p-4 text-sm font-semibold text-slate-600">
        아직 등록된 라이브러리 파일이 없습니다. 문서 유형과 메타데이터를 입력한 뒤 DB에 업로드해 주세요.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-100 bg-white">
      <div className="grid grid-cols-12 gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
        <span className="col-span-3">파일명</span>
        <span className="col-span-2">문서 유형</span>
        <span className="col-span-1">결과</span>
        <span className="col-span-2">이유</span>
        <span className="col-span-2">상태</span>
        <span className="col-span-2 text-right">패턴</span>
      </div>
      <div className="divide-y divide-slate-100">
        {documents.map((document, index) => {
          const role = document.documentRole ?? inferUploadedDocumentRole(document.fileName, document.documentAnalysisText || document.extractedText);
          const outcome = role === 'proposal' ? document.dbLibraryMetadata?.outcome : undefined;
          const outcomeReason = role === 'proposal' ? document.dbLibraryMetadata?.outcomeReason?.trim() : '';
          const dbStatus = getDocumentDbSaveStatusLabel(document.dbSaveStatus);

          return (
            <div key={document.id || `${document.fileName}-${index}`} className="grid grid-cols-12 gap-3 px-4 py-4 text-sm text-slate-700">
              <div className="col-span-12 font-bold text-slate-950 md:col-span-3">{document.fileName}</div>
              <div className="col-span-4 text-xs font-bold md:col-span-2">{dbDocumentRoleLabels[role as 'rfp' | 'proposal' | 'reference' | 'memo'] ?? role}</div>
              <div className="col-span-3 text-xs font-bold md:col-span-1">{outcome ? proposalOutcomeLabels[outcome] : '-'}</div>
              <div className="col-span-9 text-xs leading-5 text-slate-600 md:col-span-2">{outcomeReason || '-'}</div>
              <div className="col-span-12 md:col-span-2">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusTone[document.extractionStatus]}`}>
                  {document.extractionStatus}
                </span>
                {dbStatus ? (
                  <span className={`ml-2 mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${dbStatus.tone}`}>
                    {document.dbSaveStatus === 'saving' && <span className="mr-2 h-1.5 w-1.5 animate-pulse self-center rounded-full bg-current" />}
                    {dbStatus.label}
                  </span>
                ) : null}
                {document.warningMessage && <p className="mt-2 text-xs leading-5 text-slate-500">{document.warningMessage}</p>}
                {document.errorMessage && document.errorMessage !== document.warningMessage && <p className="mt-2 text-xs font-semibold leading-5 text-red-600">{document.errorMessage}</p>}
              </div>
              <div className="col-span-12 flex flex-col items-start gap-2 md:col-span-2 md:items-end">
                {(() => {
                  const hasChunks = (document.dbChunkCount ?? (document.chunks ?? []).length) > 0;
                  const hasPatterns = (document.proposalPatternCount ?? 0) > 0;
                  const patternStatus = getProposalPatternStatusLabel(document.proposalPatternStatus, document.proposalPatternCount ?? 0);
                  const canExtract = role === 'proposal' && Boolean(document.dbDocumentId) && hasChunks && document.proposalPatternStatus !== 'extracting';

                  if (role !== 'proposal') return <span className="text-xs font-bold text-slate-400">-</span>;

                  return (
                    <>
                      <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${!hasChunks ? 'border-slate-200 bg-slate-50 text-slate-500' : patternStatus?.tone ?? 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        {!hasChunks ? '텍스트 없음' : patternStatus?.label ?? '패턴 없음'}{hasChunks && document.proposalPatternCount ? ` · ${document.proposalPatternCount}개` : ''}
                      </span>
                      <button
                        type="button"
                        disabled={!canExtract}
                        onClick={() => onBackfillDocument?.(document, hasPatterns)}
                        className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-black text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {document.proposalPatternStatus === 'extracting' ? '패턴 추출 중' : hasPatterns ? '패턴 재추출' : '패턴 추출'}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
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
          <h3 className="mt-2 text-xl font-black">검색 기반 근거</h3>
          <p className="mt-2 text-sm font-bold text-cyan-800">
            근거 {evidence.length}건 · 중요 근거 {highImportanceCount}건 · {categorySummary ? `${categorySummary} 중심` : 'category 미분류'}
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

function AdditionalInfoReviewPanel({ drafts, confirmationInfo, supplementalInfo, onChange }: { drafts: SupplementalInfoDraft[]; confirmationInfo: ConfirmationInfo; supplementalInfo: SupplementalInfo; onChange: <K extends keyof SupplementalInfo>(key: K, value: SupplementalInfo[K]) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const highRiskCount = drafts.filter((draft) => draft.confidence === '사용자 확인 권장').length;
  const confirmedCount = drafts.filter((draft) => draft.evidenceLevel === 'confirmed').length;
  const assumptionCount = drafts.filter((draft) => draft.evidenceLevel === 'assumption').length;
  const badgeClass = (confidence: SupplementalInfoConfidence) => confidence === 'RFP 근거 있음'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : confidence === '사용자 수정'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : confidence === '사용자 확인 권장'
        ? 'border-amber-300 bg-amber-100 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">추가 정보 검토</p>
          <h3 className="mt-1 text-lg font-black">AI가 보완한 가정값을 확인하고 필요 시 수정하세요.</h3>
          <p className="mt-1 text-sm leading-6 text-amber-900">AI가 RFP를 바탕으로 보완한 가정값입니다. 필요하면 수정 후 반영하세요.</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-white/80 px-3 py-1 text-emerald-700">RFP 근거 있음 {confirmedCount}개</span>
            <span className="rounded-full bg-white/80 px-3 py-1 text-slate-700">AI 보완 {assumptionCount}개</span>
            {highRiskCount > 0 && <span className="rounded-full bg-amber-200 px-3 py-1 text-amber-900">확인이 필요한 항목 {highRiskCount}개</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm font-black text-amber-800 transition hover:bg-amber-100 md:w-auto"
          aria-expanded={isExpanded}
        >
          {isExpanded ? '가정값 접기' : '가정값 확인 / 수정'}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {confirmationInfo.aiMissingInfo.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-sm leading-6 text-amber-900">
              <span className="font-black">AI 확인 메모</span> · {confirmationInfo.aiMissingInfo.join(' / ')}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            {drafts.map((draft) => (
              <label key={draft.key} className="block rounded-2xl border border-amber-100 bg-white/90 p-3 shadow-sm">
                <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-black text-slate-900">
                  {draft.label}
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badgeClass(draft.confidence)}`}>{draft.confidence}</span>
                </span>
                <textarea
                  value={supplementalInfo[draft.key] || draft.value}
                  onChange={(event) => onChange(draft.key, event.target.value)}
                  className="mt-2 min-h-16 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-blue-500"
                  placeholder={draft.value || '필요 시 확인 내용을 입력하세요.'}
                />
                <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">{draft.helper}</span>
              </label>
            ))}
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
        <p className="mt-1 text-slate-800">{data.inferredProposalType ? proposalTypeLabels[normalizeProposalType(data.inferredProposalType)] : '해당 없음'} · {data.proposalTypeReasoning}</p>
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






function conciseText(value = '', maxLength = 120) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function conceptKeywordChips(concept: ConceptCandidate) {
  const keywords = concept.conceptKeywords?.length ? concept.conceptKeywords : concept.keywordExecutionGuide?.map((guide) => guide.keyword) ?? [];
  return keywords.filter(Boolean).slice(0, 3);
}

function conceptRfpFitBullets(concept: ConceptCandidate) {
  const bullets = [
    ...(concept.rfpGrounding ?? []),
    concept.whyThisNameFitsRfp,
    concept.whyThisIsNotJustPoetic,
  ]
    .map((item) => item?.trim())
    .filter(Boolean) as string[];

  const seen = new Set<string>();
  return bullets.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function conceptMechanismRows(concept: ConceptCandidate) {
  const mechanism = concept.conceptMechanism;
  if (!mechanism) return [];

  return [
    ['경험', mechanism.experienceMechanism],
    ['공간', mechanism.spatialMechanism],
    ['콘텐츠/미디어', mechanism.contentMechanism],
    ['상호작용', mechanism.interactionMechanism],
    ['인지 방식', mechanism.recognitionLogic],
    ['방문자 변화', mechanism.visitorOrAudienceTransformation],
    ['설득 포인트', mechanism.proofMechanism],
  ].filter(([, value]) => Boolean(value?.trim()));
}


function conceptMetaphorSourceRows(concept: ConceptCandidate) {
  const source = concept.conceptMetaphorSource;
  if (!source) return [];

  return [
    ['Seed', source.metaphorSeed],
    ['Image', source.symbolicImage],
    ['World', source.proposalWorld],
    ['Title reason', source.whyThisCanBecomeAConceptTitle],
  ].filter(([, value]) => Boolean(value?.trim()));
}

function executionKeywordRows(concept: ConceptCandidate) {
  return (concept.keywordExecutionGuide ?? []).slice(0, 3).map((guide) => ({
    keyword: guide.keyword,
    details: [
      guide.spatialUXImplication && `공간/UX: ${guide.spatialUXImplication}`,
      guide.designImplication && `디자인: ${guide.designImplication}`,
      (guide.contentOrMediaImplication || guide.contentImplication) && `콘텐츠/미디어: ${guide.contentOrMediaImplication || guide.contentImplication}`,
      guide.operationImplication && `운영: ${guide.operationImplication}`,
    ].filter(Boolean),
  })).filter((row) => row.keyword || row.details.length);
}

function antiPatternRows(concept: ConceptCandidate) {
  const validation = concept.antiPatternValidation;
  if (!validation) return [];

  return [
    ['Risk to avoid', validation.riskToAvoid || concept.riskOrCaution],
    ['How it avoids it', validation.howThisConceptAvoidsIt || validation.validationSummary],
    ['Validation check', validation.validationCheck || validation.validationCriteria?.[0]],
  ].filter(([, value]) => Boolean(value?.trim()));
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


function EntityDifferentiationMatrixPanel({ matrix, matrixType, primaryRfpConceptType }: { matrix?: ConceptCandidatesResult['entityDifferentiationMatrix']; matrixType?: ConceptCandidatesResult['matrixType']; primaryRfpConceptType?: ConceptCandidatesResult['primaryRfpConceptType'] }) {
  if (matrixType !== 'entityDifferentiationMatrix' || primaryRfpConceptType !== 'multi_entity_pavilion' || !matrix?.length) return null;

  return (
    <div className="mt-6 rounded-3xl border border-emerald-100 bg-emerald-50 p-5 text-emerald-950">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-700">Entity Differentiation Matrix</p>
      <h3 className="mt-2 text-xl font-black">콘셉트 생성 전 역할·메시지 차별화</h3>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white/85">
        <table className="min-w-full text-left text-xs leading-5">
          <thead className="bg-emerald-100 text-emerald-900">
            <tr>
              {['대상', '역할', '관람객 인식', '메시지', '설득 포인트', '작동 방식'].map((header) => (
                <th key={header} className="whitespace-nowrap px-3 py-2 font-black">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.slice(0, 8).map((entity, index) => (
              <tr key={`${entity.entityName}-${index}`} className="border-t border-emerald-100 align-top">
                <td className="px-3 py-2 font-black text-emerald-900">{entity.entityName}<br /><span className="font-semibold text-emerald-700">{entity.entityType}</span></td>
                <td className="px-3 py-2">{entity.roleInProject}</td>
                <td className="px-3 py-2">{entity.audienceTakeaway}</td>
                <td className="px-3 py-2">{entity.distinctMessage}</td>
                <td className="px-3 py-2">{entity.proofPoint}</td>
                <td className="px-3 py-2">{entity.experienceMechanism || entity.spatialOrContentRole}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BrandExperienceMatrixPanel({ matrix, matrixType }: { matrix?: ConceptCandidatesResult['brandExperienceMatrix']; matrixType?: ConceptCandidatesResult['matrixType'] }) {
  if (matrixType !== 'brandExperienceMatrix' || !matrix?.length) return null;
  return (
    <div className="mt-6 rounded-3xl border border-sky-100 bg-sky-50 p-5 text-sky-950">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-sky-700">브랜드 경험 설계</p>
      <h3 className="mt-2 text-xl font-black">브랜드 경험 설계 매트릭스</h3>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-white/85">
        <table className="min-w-full text-left text-xs leading-5">
          <thead className="bg-sky-100 text-sky-900">
            <tr>{['브랜드 의미', '방문자 질문', '단계', '확인 장면', '공간 순간', '감각 단서', '기억'].map((header) => <th key={header} className="whitespace-nowrap px-3 py-2 font-black">{header}</th>)}</tr>
          </thead>
          <tbody>
            {matrix.slice(0, 8).map((item, index) => (
              <tr key={`${item.experienceStage}-${index}`} className="border-t border-sky-100 align-top">
                <td className="px-3 py-2 font-black text-sky-900">{item.brandMeaning}</td>
                <td className="px-3 py-2">{item.visitorQuestion}</td>
                <td className="px-3 py-2">{item.experienceStage}</td>
                <td className="px-3 py-2">{item.processOrProofPoint}</td>
                <td className="px-3 py-2">{item.spatialMoment}</td>
                <td className="px-3 py-2">{item.sensoryOrEmotionalCue}</td>
                <td className="px-3 py-2">{item.memoryAfterVisit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function entityDifferentiationUseRows(concept: ConceptCandidate) {
  const use = concept.entityDifferentiationUse;
  if (!use) return [];
  return [
    ['통합 프레임', use.unifyingFrame],
    ['개별 역할', use.distinctEntityRoles],
    ['인지 로직', use.visitorRecognitionLogic],
    ['Entity별 증거', use.proofByEntity],
    ['과잉 통합 리스크', use.riskCheck],
  ].filter(([, value]) => Boolean(value?.trim()));
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
      <h3 className="mt-2 text-xl font-black">AI 추천 방향: {recommendation.recommendedDirectionLabel || recommendation.recommendedConceptId}</h3>
      <p className="mt-3 text-sm leading-6"><span className="font-black">왜 이 방향이 맞는가</span><br />{recommendation.recommendationReason}</p>
      {(recommendation.otherDirectionsUsefulness || recommendation.whyNotOthers) && (
        <p className="mt-3 text-sm leading-6"><span className="font-black">다른 방향의 활용성</span><br />{recommendation.otherDirectionsUsefulness || recommendation.whyNotOthers}</p>
      )}
      {recommendation.tradeOffSummary && (
        <p className="mt-3 text-sm leading-6"><span className="font-black">선택 간 트레이드오프</span><br />{recommendation.tradeOffSummary}</p>
      )}
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

function parseAnalysisApiResponse(response: AnalysisApiResponse): { result: AnalysisResult; evidence?: RetrievalEvidenceItem[]; diagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence } {
  if ('result' in response) {
    return {
      ...response,
      diagnosis: response.proposalStrategyDiagnosis ?? response.diagnosis ?? response.rfpDiagnosis ?? response.winningDiagnosis ?? response.victoryDiagnosis,
    };
  }
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

// Every project-specific generated field, set to undefined. Spread this into ANY new-RFP / new-analysis reset so a
// previous RFP's analysis, diagnosis, brand intelligence, strategic directions, concept names, and — critically —
// the per-direction name cache and selected final name can never bleed into the next RFP. Does NOT touch
// input / supplementalInfo / uploadedDocuments / dbUploadedDocuments (those are stable inputs handled separately).
const CLEARED_PROJECT_GENERATED_STATE = {
  analysis: undefined,
  analysisBasis: undefined,
  retrievalEvidence: undefined,
  rfpDiagnosis: undefined,
  brandProductIntelligence: undefined,
  conceptDevelopmentLogic: undefined,
  conceptCandidates: undefined,
  conceptRecommendation: undefined,
  conceptGenerationResult: undefined,
  proposalNarrative: undefined,
  selectedStrategicDirection: undefined,
  selectedDirectionIndex: undefined,
  selectedConcept: undefined,
  conceptNameOptions: undefined,
  conceptNameOptionsByDirection: undefined,
  selectedFinalConceptNameOption: undefined,
  outline: undefined,
  slides: undefined,
} satisfies Partial<ProposalState>;

function appendUploadedDocument(document: UploadedDocument) {
  return (current: ProposalState): ProposalState => ({
    ...current,
    uploadedDocuments: [...(current.uploadedDocuments ?? []), document],
    ...CLEARED_PROJECT_GENERATED_STATE,
  });
}

// Brand/product intelligence is an OPTIONAL enrichment for direction generation. When it is missing (skipped after a
// partial analysis), pass this empty object so the user is never hard-blocked from generating strategic directions.
function buildFallbackBrandProductIntelligence(): BrandProductIntelligence {
  return { clientOrBrandRole: '', productOrServiceMeaning: '', categoryContext: '', audiencePerceptionGap: '', brandSpecificVocabulary: [], wordsToAvoid: [], toneGuidance: '', strategyImplication: '', namingImplication: '' };
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'proposal';
}

function hasText(value?: string) {
  return Boolean(value?.trim());
}

function getStrategicDirectionLabel(concept?: ConceptCandidate) {
  return concept?.strategicDirectionLabel || concept?.directionLabel || concept?.proposalCoreConceptName || concept?.conceptName || concept?.conceptId || '전략 방향';
}

function getStrategicDirectionId(concept?: ConceptCandidate) {
  return concept?.conceptId || getStrategicDirectionLabel(concept);
}

function getStrategicDirectionKey(concept?: ConceptCandidate) {
  return [concept?.conceptId, concept?.directionAxis, concept?.strategicDirectionLabel || concept?.directionLabel].filter(Boolean).join('::') || getStrategicDirectionId(concept);
}
// Per-direction concept-name cache key. Prefixing with the direction INDEX (0/1/2) guarantees the three current
// directions never collide on one bucket even when their content-derived key is identical, and the content key keeps
// regenerated directions (new content at the same index) from inheriting a stale bucket. Falls back to the content
// key alone for older persisted state that has no index yet.
function getDirectionCacheKey(index: number | undefined, concept?: ConceptCandidate) {
  return [typeof index === 'number' ? `dir${index}` : undefined, getStrategicDirectionKey(concept)].filter(Boolean).join('::');
}
// Stable identity of the current RFP/project. Changes when the uploaded document, project name, client, or brief change,
// so concept-name candidates stamped with an old project key are never rendered or reused against a new RFP.
function buildCurrentProjectKey(input?: ProjectInput, documents?: UploadedDocument[]) {
  const docKey = (documents ?? []).map((document) => document.dbDocumentId || document.dbProjectId || document.fileName || document.id).filter(Boolean).join(',');
  return [input?.projectName?.trim(), input?.clientName?.trim(), String((input?.briefText ?? '').trim().length), docKey].filter(Boolean).join('::') || 'no-project';
}


const INVALID_DIRECTION_LABEL_PATTERN = /(KINTEX|2025|12월|2,?520㎡|Hero\s*콘텐츠\s*40%|콘텐츠\s*60%|B2B\s*대상|전시\s*목표|콘텐츠\s*개발|운영\s*구성|실체\s*Proof\s*장면|Proof\s*장면|\d{4}|\d+%|\d+㎡|킨텍스)/i;
const INTERNAL_DIRECTION_AXIS_PATTERN = /\b(?:category_shift|audience_perception_change|representative_position|technology_reality_proof|product_value_proof|process_trust|ecosystem_proof|system\/ecosystem_proof|spatial_journey|brand_memory|operational_confidence|evaluator_clarity|emotional_affinity|signature_scene|audience_understanding|directionAxis|proof|evidence)\b/gi;
const AXIS_USER_LABELS: Record<string, string> = { category_shift: '카테고리 관점 전환', audience_perception_change: '관람객 인식 전환', representative_position: '대표 포지션 각인', technology_reality_proof: '기술 현실감 설득', product_value_proof: '제품 가치 체감', process_trust: '과정 신뢰 형성', ecosystem_proof: '생태계 설득', 'system/ecosystem_proof': '생태계 설득', spatial_journey: '공간 여정 설계', brand_memory: '브랜드 기억 형성', operational_confidence: '운영 확신 설계', evaluator_clarity: '심사 이해도 강화', emotional_affinity: '정서적 친밀감 형성', signature_scene: '대표 장면 각인', audience_understanding: '관람 이해 전환', proof: '설득 포인트', evidence: '근거' };
function userFacingDirectionCopy(value = '', fallback = '') {
  const clean = (value || fallback).replace(INTERNAL_DIRECTION_AXIS_PATTERN, (term) => AXIS_USER_LABELS[term] || '전략 관점').replace(/\s*:\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

const REQUIREMENT_SUMMARY_PATTERN = /(일정|장소|부스|규모|평가|배점|납품|제출|착수|완료|대상|운영\s*구성|콘텐츠\s*개발)/;

type NormalizedStrategicDirection = Pick<ConceptCandidate, 'conceptId' | 'strategicDirectionLabel' | 'directionAxis' | 'oneLineStrategicBet' | 'conceptLeap' | 'signatureProofIdea' | 'mainRisk'> & {
  winningThesis?: ConceptCandidate['winningThesisUse'];
  representativePersuasionScene: string;
  whenToChooseThisDirection?: string;
  whyThisDirectionExists?: string;
  rfpConceptType?: ConceptCandidate['rfpConceptType'];
  secondaryRfpConceptTypes?: ConceptCandidate['secondaryRfpConceptTypes'];
};

function isValidStrategicDirectionLabel(label?: string) {
  const value = (label || '').trim();
  if (!value || INVALID_DIRECTION_LABEL_PATTERN.test(value)) return false;
  const words = value.split(/[\s/·|]+/).filter(Boolean);
  if (words.length > 8) return false;
  if (REQUIREMENT_SUMMARY_PATTERN.test(value) && words.length > 4) return false;
  return true;
}

function normalizeSelectedDirectionForNaming(concept?: ConceptCandidate): NormalizedStrategicDirection | undefined {
  if (!concept) return undefined;
  const aliasSource = concept as ConceptCandidate & { representativePersuasionScene?: string; signatureExperienceIdea?: string | ConceptCandidate['signatureProofIdea']; winningThesis?: ConceptCandidate['winningThesisUse']; id?: string };
  const signatureProofIdea = concept.signatureProofIdea || (typeof aliasSource.signatureExperienceIdea === 'object' ? aliasSource.signatureExperienceIdea : undefined) || {
    signatureScene: typeof aliasSource.representativePersuasionScene === 'string' ? aliasSource.representativePersuasionScene : '',
    signatureContent: typeof aliasSource.signatureExperienceIdea === 'string' ? aliasSource.signatureExperienceIdea : '',
    signatureSpatialMove: '',
    signatureMediaOrInteraction: '',
    whyThisProvesTheConcept: '',
    whyThisIsNotGeneric: '',
  };
  const representativePersuasionScene = shortText(
    aliasSource.representativePersuasionScene ||
    signatureProofIdea.signatureScene ||
    signatureProofIdea.signatureContent ||
    signatureProofIdea.signatureSpatialMove ||
    signatureProofIdea.signatureMediaOrInteraction ||
    concept.keyExperienceAssetDirection,
    140,
  ) || '대표 설득 장면을 짧고 명확하게 제시합니다.';
  return {
    conceptId: concept.conceptId || aliasSource.id || getStrategicDirectionId(concept),
    strategicDirectionLabel: isValidStrategicDirectionLabel(concept.strategicDirectionLabel) ? concept.strategicDirectionLabel : getStrategicDirectionLabel({ ...concept, strategicDirectionLabel: concept.directionAxis || concept.strategicDirectionType || '전략 방향' }),
    directionAxis: concept.directionAxis || concept.strategicDirectionType || concept.whatThisDirectionEmphasizes || concept.strategicDirectionLabel,
    oneLineStrategicBet: userFacingDirectionCopy(getStrategicBet(concept)),
    winningThesis: concept.winningThesisUse || aliasSource.winningThesis,
    conceptLeap: concept.conceptLeap,
    signatureProofIdea: { ...signatureProofIdea, signatureScene: signatureProofIdea.signatureScene || representativePersuasionScene },
    representativePersuasionScene: userFacingDirectionCopy(representativePersuasionScene),
    mainRisk: concept.mainRisk || concept.risks?.[0] || concept.riskOrCaution || '이 방향의 대표 장면이 약하면 차별성이 낮아질 수 있습니다.',
    whenToChooseThisDirection: userFacingDirectionCopy(concept.whenToChooseThisDirection || '', '이 전략 관점이 심사자의 선택 이유를 가장 선명하게 만들 때 선택합니다.'),
    whyThisDirectionExists: concept.whyThisDirectionExists,
    rfpConceptType: concept.rfpConceptType,
    secondaryRfpConceptTypes: concept.secondaryRfpConceptTypes,
  };
}

function validateStrategicDirectionForDisplay(concept: ConceptCandidate) {
  const normalized = normalizeSelectedDirectionForNaming(concept);
  const missingFields = [
    ['strategicDirectionLabel', normalized?.strategicDirectionLabel],
    ['directionAxis', normalized?.directionAxis],
    ['oneLineStrategicBet', normalized?.oneLineStrategicBet],
    ['representativePersuasionScene', normalized?.representativePersuasionScene],
  ].filter(([, value]) => !String(value || '').trim()).map(([key]) => key).filter((key): key is string => Boolean(key));
  const hasValidStrategicLabel = isValidStrategicDirectionLabel(normalized?.strategicDirectionLabel);
  const joined = [normalized?.strategicDirectionLabel, normalized?.oneLineStrategicBet, normalized?.representativePersuasionScene].join(' ');
  const notRequirementSummary = !REQUIREMENT_SUMMARY_PATTERN.test(normalized?.strategicDirectionLabel || '');
  const notScheduleVenueScaleFact = !INVALID_DIRECTION_LABEL_PATTERN.test(joined);
  return {
    hasValidStrategicLabel,
    labelIsNotRfpFact: !INVALID_DIRECTION_LABEL_PATTERN.test(normalized?.strategicDirectionLabel || ''),
    hasDirectionAxis: Boolean(normalized?.directionAxis),
    hasOneLineStrategicBet: Boolean(normalized?.oneLineStrategicBet),
    hasRepresentativePersuasionScene: Boolean(normalized?.representativePersuasionScene),
    notRequirementSummary,
    notScheduleVenueScaleFact,
    canGenerateConceptNames: Boolean(normalized && hasValidStrategicLabel && normalized.directionAxis && normalized.oneLineStrategicBet && normalized.representativePersuasionScene),
    missingFields,
  };
}

function optionDuplicateKey(option: ConceptNameOption) {
  return [option.conceptName, option.oneLineSlogan, option.shortMeaning, option.strategicClaim, option.whyItFitsRfp || option.whyItFits].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9가-힣]+/gi, ' ').trim();
}

function uniqueConceptNameOptions(options: ConceptNameOption[], blocked: ConceptNameOption[] = []) {
  const seenNames = new Set(blocked.map((option) => (option.conceptName || '').toLowerCase().replace(/[^a-z0-9가-힣]/gi, '')));
  const seenClaims = new Set(blocked.map(optionDuplicateKey).filter(Boolean));
  return options.filter((option) => {
    const nameKey = (option.conceptName || '').toLowerCase().replace(/[^a-z0-9가-힣]/gi, '');
    const claimKey = optionDuplicateKey(option);
    if (!nameKey || seenNames.has(nameKey) || (claimKey && seenClaims.has(claimKey))) return false;
    seenNames.add(nameKey);
    if (claimKey) seenClaims.add(claimKey);
    return true;
  });
}


function shortText(value: string | undefined, max = 120) {
  const text = (value || '').trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max).replace(/[,.·;:\s]+$/g, '')}`;
}

function getStrategicBet(concept: ConceptCandidate) {
  return userFacingDirectionCopy(shortText(concept.oneLineStrategicBet || concept.oneLineSummary || concept.whatThisDirectionEmphasizes || concept.coreMessage || getConceptTagline(concept), 150), '이 방향은 현재 RFP의 핵심 근거를 통해 평가자의 선택 이유를 설득하는 전략입니다.');
}

function getSignatureProofSummary(concept: ConceptCandidate) {
  return shortText(concept.signatureProofIdea?.signatureScene || concept.signatureProofIdea?.signatureContent || concept.signatureProofIdea?.signatureSpatialMove || concept.signatureProofIdea?.signatureMediaOrInteraction || concept.keyExperienceAssetDirection, 110) || '대표 설득 장면을 짧고 명확하게 제시합니다.';
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

async function downloadPptx(input: ProjectInput, slides: SlideContent[], selectedConcept?: ConceptCandidate, designGuide?: DesignGuide) {
  const exportSlides = sanitizeFinalPptxSlides(sanitizeGeneratedSlides(removeInternalConceptComparisonSlides(slides)));
  const guide = designGuide ?? buildDeckDesignGuide(input);
  const FONT = guide.fontPrimary || 'Pretendard';
  const C_MAIN = guide.colorMain || '111827';
  const C_SUB = guide.colorSub || '2563EB';
  const C_ACCENT = guide.colorAccent || 'F59E0B';
  const C_INK = '1F2937';
  const C_MUTE = '64748B';
  const proposalLabel = proposalTypeLabels[normalizeProposalType(input.proposalType)];
  const W = 13.333;
  const H = 7.5;

  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AI Proposal Builder';
  pptx.subject = `${input.clientName} ${input.projectName}`;
  pptx.title = input.projectName;
  pptx.company = input.clientName;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const addFooter = (slide: pptxgen.Slide, n: number) => {
    slide.addText(`${input.clientName} · ${proposalLabel}`, { x: 0.55, y: 7.06, w: 9, h: 0.22, fontSize: 8, color: '94A3B8', fontFace: FONT });
    slide.addText(String(n).padStart(2, '0'), { x: 12.2, y: 7.06, w: 0.6, h: 0.22, fontSize: 8, color: '94A3B8', align: 'right', fontFace: FONT });
  };
  // Module-detail lines belong only on after-concept content/detail pages — never on cover/toc/overview/approach.
  const contentBullets = (slideData: SlideContent, includeModules: boolean) => {
    const base = (slideData.bodyBullets ?? []).filter(Boolean);
    return includeModules ? [...base, ...buildStructuredSlideLines(slideData)].filter(Boolean) : base;
  };

  exportSlides.forEach((slideData, idx) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const section = slideData.slideSection;
    const num = slideData.slideNumber || idx + 1;
    const kicker = (slideData.pageSubtitle || '').trim();
    const heroCopy = (slideData.keyCopy || slideData.keyMessage || '').trim();
    if (hasText(slideData.speakerNote)) slide.addNotes(slideData.speakerNote);

    // ===== COVER: clean title page, no number badge / image box / bullets =====
    if (section === 'cover') {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: C_MAIN }, line: { color: C_MAIN } });
      slide.addText((kicker || `${input.clientName} · ${proposalLabel}`).toUpperCase(), { x: 1.0, y: 2.3, w: 11.2, h: 0.4, fontSize: 13, color: C_SUB, bold: true, charSpacing: 2, fontFace: FONT });
      slide.addText(slideData.slideTitle, { x: 0.95, y: 2.78, w: 11.4, h: 1.7, fontSize: 44, bold: true, color: C_MAIN, fontFace: FONT, valign: 'top' });
      slide.addShape(pptx.ShapeType.rect, { x: 1.0, y: 4.55, w: 2.2, h: 0.06, fill: { color: C_ACCENT }, line: { color: C_ACCENT } });
      if (heroCopy && heroCopy !== slideData.slideTitle) slide.addText(heroCopy, { x: 1.0, y: 4.78, w: 10.8, h: 1.0, fontSize: 18, color: C_MUTE, fontFace: FONT, valign: 'top' });
      return;
    }

    // ===== TABLE OF CONTENTS =====
    if (section === 'toc') {
      slide.addText('CONTENTS', { x: 0.9, y: 0.85, w: 6, h: 0.4, fontSize: 13, color: C_SUB, bold: true, charSpacing: 2, fontFace: FONT });
      slide.addText('목차', { x: 0.85, y: 1.25, w: 8, h: 0.9, fontSize: 34, bold: true, color: C_MAIN, fontFace: FONT });
      const lines = (slideData.mainCopy || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const tocList = lines.length ? lines : (slideData.bodyBullets ?? []);
      slide.addText(tocList.join('\n'), { x: 0.95, y: 2.5, w: 11, h: 4.1, fontSize: 20, color: C_INK, fontFace: FONT, lineSpacingMultiple: 1.5, valign: 'top' });
      addFooter(slide, num);
      return;
    }

    // ---- Shared header for all section pages ----
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.16, fill: { color: C_SUB }, line: { color: C_SUB } });
    if (kicker) slide.addText(kicker.toUpperCase(), { x: 0.6, y: 0.44, w: 11, h: 0.3, fontSize: 11, color: C_SUB, bold: true, charSpacing: 1.5, fontFace: FONT });
    slide.addText(slideData.slideTitle, { x: 0.58, y: 0.76, w: 11.6, h: 0.7, fontSize: 26, bold: true, color: C_MAIN, fontFace: FONT, breakLine: false });

    // ===== CONCEPT REVEAL / CLOSING: hero statement =====
    if (section === 'concept' || section === 'closing') {
      slide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.45, w: 11.5, h: 0.08, fill: { color: C_ACCENT }, line: { color: C_ACCENT } });
      slide.addText(heroCopy, { x: 1.0, y: 2.85, w: 11.3, h: 2.4, fontSize: 34, bold: true, color: C_MAIN, fontFace: FONT, valign: 'top' });
      const support = slideData.keyMessage && slideData.keyMessage !== heroCopy ? slideData.keyMessage : (slideData.mainCopy || '').split('\n')[0];
      if (hasText(support)) slide.addText(support, { x: 1.0, y: 5.35, w: 11.3, h: 1.2, fontSize: 15, color: C_MUTE, fontFace: FONT, valign: 'top' });
      addFooter(slide, num);
      return;
    }

    // ===== CONTENT / CONTENT DETAIL: visual-first =====
    if (section === 'content' || section === 'contentDetail') {
      const ratio = slideData.layoutRatio;
      const imgFull = ratio === 'full-bleed-visual';
      const imgLeft = ratio === 'visual-left-text-right';
      const imgX = imgFull ? 0 : imgLeft ? 0.5 : 6.6;
      const imgW = imgFull ? W : 6.2;
      slide.addShape(pptx.ShapeType.rect, { x: imgX, y: imgFull ? 1.65 : 1.6, w: imgW, h: imgFull ? 5.0 : 5.0, fill: { color: 'E5E7EB' }, line: { color: 'CBD5E1' } });
      slide.addText((getImagePlaceholder(slideData) || 'HERO VISUAL').toUpperCase(), { x: imgX, y: imgFull ? 5.4 : 3.8, w: imgW, h: 0.6, align: 'center', valign: 'middle', fontSize: 12, color: imgFull ? 'F1F5F9' : '94A3B8', bold: true, fontFace: FONT });
      const textX = imgLeft ? 7.0 : 0.6;
      const textW = imgFull ? 11.5 : 5.7;
      if (hasText(heroCopy)) slide.addText(heroCopy, { x: imgFull ? 0.8 : textX, y: imgFull ? 1.95 : 1.7, w: textW, h: 0.9, fontSize: imgFull ? 20 : 18, bold: true, color: imgFull ? '0F172A' : C_MAIN, fontFace: FONT, valign: 'top' });
      if (!imgFull) {
        const bullets = contentBullets(slideData, true).slice(0, section === 'contentDetail' ? 6 : 3);
        if (bullets.length) slide.addText(bullets.map((b) => `• ${b}`).join('\n'), { x: textX, y: 2.75, w: textW, h: 3.7, fontSize: 12, color: C_INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.2, fit: 'shrink' });
      }
      if (hasText(slideData.visualDirection)) slide.addText(`Visual · ${slideData.visualDirection}`, { x: 0.6, y: 6.78, w: 11.5, h: 0.22, fontSize: 8.5, color: C_SUB, fontFace: FONT, fit: 'shrink' });
      addFooter(slide, num);
      return;
    }

    // ===== DEFAULT text-led (overview / approach / operation) — clean, no image card, no module dump =====
    if (hasText(slideData.keyMessage)) slide.addText(slideData.keyMessage, { x: 0.58, y: 1.36, w: 11.7, h: 0.5, fontSize: 13, color: C_SUB, bold: true, fontFace: FONT });
    const cap = slideData.textDensity === 'low' ? 3 : slideData.textDensity === 'high' ? 7 : 5;
    const bullets = contentBullets(slideData, false).slice(0, cap);
    if (bullets.length) slide.addText(bullets.map((b) => `• ${b}`).join('\n'), { x: 0.62, y: 2.1, w: 11.8, h: 4.3, fontSize: 14, color: C_INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.25, fit: 'shrink' });
    else if (hasText(slideData.mainCopy)) slide.addText(slideData.mainCopy, { x: 0.62, y: 2.1, w: 11.8, h: 4.3, fontSize: 14, color: C_INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.25, fit: 'shrink' });
    addFooter(slide, num);
  });

  await pptx.writeFile({ fileName: `${safeFileName(input.projectName)}_proposal.pptx` });
}

export default function Home() {
  const [step, setStep] = useState<Step>('home');
  const [state, setState] = useState<ProposalState>({ input: initialInput, supplementalInfo: initialSupplementalInfo, uploadedDocuments: [], dbUploadedDocuments: [] });
  const [loading, setLoading] = useState<string>('');
  const [error, setError] = useState<string>('');
  const conceptGenerationAttemptRef = useRef(0);
  const [conceptRetryVisible, setConceptRetryVisible] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null);
  const [dbSaveStatus, setDbSaveStatus] = useState<DbSaveStatus>('idle');
  const [dbUploadRole, setDbUploadRole] = useState<'rfp' | 'proposal' | 'reference' | 'memo'>('proposal');
  const [dbUploadFile, setDbUploadFile] = useState<File | null>(null);
  const [dbUploadOutcome, setDbUploadOutcome] = useState<ProposalOutcome>('unknown');
  const [dbUploadOutcomeReason, setDbUploadOutcomeReason] = useState('');
  const [dbUploadOutcomeReasonType, setDbUploadOutcomeReasonType] = useState<OutcomeReasonType>('unknown');
  const [dbUploadNotice, setDbUploadNotice] = useState<UploadNotice | null>(null);
  const [isDbUploadModalOpen, setIsDbUploadModalOpen] = useState(false);
  const [finalNamingError, setFinalNamingError] = useState('');
  const [finalNamingDebug, setFinalNamingDebug] = useState<{ responseStatus?: number; responseErrorMessage?: string; selectedDirectionKey?: string; missingFields?: string[] }>({});

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
  const selectedStrategicDirection = state.selectedStrategicDirection ?? state.selectedConcept?.selectedDirection;
  const selectedStrategicDirectionId = getStrategicDirectionId(selectedStrategicDirection);
  const selectedStrategicDirectionLabel = getStrategicDirectionLabel(selectedStrategicDirection);
  const selectedStrategicDirectionExists = Boolean(selectedStrategicDirection);
  const finalNamingLoading = loading === '컨셉명 후보 생성 중';
  const selectedDirectionKey = getDirectionCacheKey(state.selectedDirectionIndex, selectedStrategicDirection);
  const currentProjectKey = buildCurrentProjectKey(state.input, uploadedDocuments);
  // The naming section is scoped to exactly one (project, direction) pair at a time.
  const activeNamingContextKey = selectedStrategicDirectionExists ? `${currentProjectKey}::${selectedDirectionKey}` : '';
  // STRICT: render ONLY candidates whose stamp matches the current project AND the current selected direction, and ONLY
  // when a definite direction index is set. Without a numeric index the `dir{index}` key prefix collapses, so two
  // directions with a colliding content key would share a bucket AND collide on their stamps — the filter could not tell
  // them apart. Requiring the index (always set by a card click) closes that path; any un-stamped/cross-direction/stale
  // candidate is never shown and the user regenerates for the current direction.
  const directionConceptNameOptions = ((typeof state.selectedDirectionIndex === 'number' && selectedDirectionKey) ? (state.conceptNameOptionsByDirection?.[selectedDirectionKey] ?? []) : [])
    .filter((option) => option.projectKey === currentProjectKey && option.directionKey === selectedDirectionKey);
  const visibleStrategicDirections = useMemo(() => (state.conceptCandidates ?? []).slice(0, 3), [state.conceptCandidates]);
  const finalNameOptionsCount = directionConceptNameOptions.length;
  const finalConceptNameSelected = Boolean(state.selectedConcept?.finalConceptName?.trim());
  const canGenerateProposalStructure = Boolean(selectedStrategicDirectionExists && finalConceptNameSelected && state.analysis && hasUploadedDocumentOrRfp);
  const activeVisionDocument = uploadedDocuments.find((document) => document.visionStatus === 'quick_analyzing' || document.visionStatus === 'analyzing' || document.extractionStatus === 'Vision 분석 중' || document.extractionStatus === '빠른 Vision 분석 중' || document.extractionStatus === '전체 Vision 분석 중' || document.extractionStatus === '하이브리드 PDF 분석 중');
  const currentUploadNotice = activeVisionDocument?.warningMessage
    ? { type: 'warning' as const, message: activeVisionDocument.warningMessage }
    : uploadNotice;
  const inputQuality = useMemo(() => assessInputQuality(analysisInput, step === 'analysis' ? state.analysis : undefined), [analysisInput, state.analysis, step]);
  const supplementalInfoDrafts = useMemo(() => buildSupplementalInfoDrafts(state.analysis, inputQuality, supplementalInfo), [inputQuality, state.analysis, supplementalInfo]);
  const documentChunks = useMemo(() => getAllDocumentChunks(uploadedDocuments.map(enrichDocumentWithChunks)), [uploadedDocuments]);
  const confirmationInfo = useMemo(() => getConfirmationInfo(state.analysis, inputQuality), [state.analysis, inputQuality]);
  const hasConfirmationNeeds = confirmationInfo.count > 0;
  const shouldShowShortBriefGuidance = analysisInput.briefText.trim().length > 0 && analysisInput.briefText.trim().length < 220;

  const updateInput = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => {
    setState((current) => ({ ...current, input: { ...current.input, [key]: value }, ...CLEARED_PROJECT_GENERATED_STATE }));
  };

  const updateSupplementalInfo = <K extends keyof SupplementalInfo>(key: K, value: SupplementalInfo[K]) => {
    setState((current) => ({
      ...current,
      supplementalInfo: { ...(current.supplementalInfo ?? initialSupplementalInfo), [key]: value },
    }));
  };

  useEffect(() => {
    if (!state.analysis) return;
    setState((current) => {
      const currentSupplementalInfo = current.supplementalInfo ?? initialSupplementalInfo;
      const nextSupplementalInfo = { ...currentSupplementalInfo };
      let changed = false;

      buildSupplementalInfoDrafts(current.analysis, assessInputQuality(analysisInput, current.analysis), currentSupplementalInfo).forEach((draft) => {
        if (!nextSupplementalInfo[draft.key] && draft.value) {
          nextSupplementalInfo[draft.key] = draft.value;
          changed = true;
        }
      });

      return changed ? { ...current, supplementalInfo: nextSupplementalInfo } : current;
    });
  }, [analysisInput, state.analysis]);


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
        proposalPatternStatus: response.proposalPatternStatus,
        proposalPatternCount: response.proposalPatternCount,
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
        proposalPatternStatus: response.proposalPatternStatus,
        proposalPatternCount: response.proposalPatternCount,
      });
      setDbUploadNotice({
        type: savedStatus === 'saved' ? 'success' : savedStatus === 'partial' ? 'warning' : savedStatus === 'disabled' ? 'warning' : 'error',
        message: getDocumentDbSaveStatusLabel(savedStatus)?.label ?? '저장 실패',
      });
    } catch (err) {
      console.error('DB upload persist request failed; uploaded file remains separate from RFP analysis.', err);
      const message = getUploadErrorMessage(err, '저장 실패');
      updateDbUploadedDocument(enrichedDocument.id, { dbSaveStatus: 'failed', errorMessage: message });
      setDbUploadNotice({ type: 'error', message: isLargePayloadError(err) ? message : '저장 실패' });
    }
  };

  const applyBackfillResultsToDbDocuments = (results: BackfillProposalPatternsResponse['results'] = []) => {
    if (!results.length) return;
    setState((current) => ({
      ...current,
      dbUploadedDocuments: (current.dbUploadedDocuments ?? []).map((document) => {
        const result = results.find((item) => item.documentId === document.dbDocumentId);
        if (!result) return document;

        return {
          ...document,
          proposalPatternStatus: result.status === 'extracted' ? 'extracted' : result.status === 'failed' ? 'failed' : 'skipped',
          proposalPatternCount: result.proposalPatternCount,
          dbChunkCount: result.chunkCount,
        };
      }),
    }));
  };

  const handleBackfillProposalPatternsForDocument = async (document: UploadedDocument, force: boolean) => {
    if (!document.dbDocumentId) {
      setDbUploadNotice({ type: 'warning', message: 'DB에 저장된 문서만 패턴을 추출할 수 있습니다.' });
      return;
    }

    updateDbUploadedDocument(document.id, { proposalPatternStatus: 'extracting', errorMessage: undefined });
    setDbUploadNotice({ type: 'warning', message: '패턴 추출 중' });

    try {
      const response = await postJson<BackfillProposalPatternsResponse>('/api/backfill-proposal-patterns', {
        documentId: document.dbDocumentId,
        force,
      });
      applyBackfillResultsToDbDocuments(response.results);
      const result = response.results?.find((item) => item.documentId === document.dbDocumentId);
      const status = result?.status === 'extracted' ? '패턴 추출 완료' : result?.status === 'failed' ? '패턴 추출 실패' : '패턴 없음';
      setDbUploadNotice({ type: result?.status === 'failed' ? 'error' : result?.status === 'skipped' ? 'warning' : 'success', message: `${status}${result ? ` · ${result.proposalPatternCount}개` : ''}` });
    } catch (err) {
      console.error('Proposal pattern backfill failed.', err);
      updateDbUploadedDocument(document.id, { proposalPatternStatus: 'failed', errorMessage: getUploadErrorMessage(err, '패턴 추출 실패') });
      setDbUploadNotice({ type: 'error', message: '패턴 추출 실패' });
    }
  };

  const handleBackfillAllProposalPatterns = async () => {
    const eligibleDocuments = dbUploadedDocuments.filter((document) => {
      const role = document.documentRole ?? inferUploadedDocumentRole(document.fileName, document.documentAnalysisText || document.extractedText);
      const hasChunks = (document.dbChunkCount ?? (document.chunks ?? []).length) > 0;
      return role === 'proposal' && Boolean(document.dbDocumentId) && hasChunks;
    });

    setState((current) => ({
      ...current,
      dbUploadedDocuments: (current.dbUploadedDocuments ?? []).map((document) => (
        eligibleDocuments.some((item) => item.id === document.id)
          ? { ...document, proposalPatternStatus: 'extracting' }
          : document
      )),
    }));
    setDbUploadNotice({ type: 'warning', message: '기존 제안서 패턴 일괄 추출 중' });

    try {
      const response = await postJson<BackfillProposalPatternsResponse>('/api/backfill-proposal-patterns', { force: false });
      applyBackfillResultsToDbDocuments(response.results);
      setDbUploadNotice({
        type: response.failedCount ? 'warning' : 'success',
        message: `기존 제안서 패턴 일괄 추출 완료 · 추출 ${response.extractedCount ?? 0}건 · 건너뜀 ${response.skippedCount ?? 0}건 · 실패 ${response.failedCount ?? 0}건`,
      });
    } catch (err) {
      console.error('Proposal pattern bulk backfill failed.', err);
      setState((current) => ({
        ...current,
        dbUploadedDocuments: (current.dbUploadedDocuments ?? []).map((document) => (
          document.proposalPatternStatus === 'extracting' ? { ...document, proposalPatternStatus: 'failed' } : document
        )),
      }));
      setDbUploadNotice({ type: 'error', message: '패턴 추출 실패' });
    }
  };

  const createUploadedDocument = (
    file: File,
    extractionStatus: ExtractionStatus,
    extractedText = '',
    warningMessage?: string,
    options: Pick<UploadedDocument, 'ocrUsed' | 'ocrAvailable' | 'visionStatus' | 'visionUsed' | 'visionPageCount' | 'visionTotalPageCount' | 'totalPageCount' | 'documentAnalysisText' | 'visionAnalysis' | 'pageTextSources' | 'textExtractionPageNumbers' | 'visionPageNumbers' | 'failedChunks' | 'failedPages' | 'needsReview' | 'errorMessage' | 'documentRole' | 'dbSaveStatus' | 'proposalPatternStatus' | 'proposalPatternCount' | 'dbLibraryMetadata'> = {},
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
      proposalPatternStatus: options.proposalPatternStatus,
      proposalPatternCount: options.proposalPatternCount,
      dbLibraryMetadata: options.dbLibraryMetadata,
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

  const shouldUseStorageForDbUpload = (file: File, extension: string) => (
    file.size > DB_STORAGE_UPLOAD_THRESHOLD_BYTES && ['pdf', 'pptx', 'docx'].includes(extension)
  );

  const buildDbLibraryMetadata = (file: File): UploadedDocument['dbLibraryMetadata'] => ({
    ...(dbUploadRole === 'proposal' ? { outcome: dbUploadOutcome, outcomeReason: dbUploadOutcomeReason.trim(), ...(dbUploadOutcome === 'lost' ? { outcomeReasonType: dbUploadOutcomeReasonType } : {}) } : {}),
    originalFileName: file.name,
    uploadedVia: 'db_library_upload',
  });

  const uploadDbFileThroughStorage = async (file: File, extension: string, dbLibraryMetadata: UploadedDocument['dbLibraryMetadata']) => {
    setLoading('업로드 중');
    setDbUploadNotice({ type: 'warning', message: '업로드 중' });
    const storageFile: UploadedDbLibraryStorageFile = await uploadDbLibraryFileToStorage({ file, role: dbUploadRole });

    const pendingDocument = createUploadedDocument(
      file,
      '텍스트 추출 중',
      '',
      '텍스트 추출 중',
      { documentRole: dbUploadRole, dbSaveStatus: 'saving', dbLibraryMetadata },
    );
    addDbUploadedDocument(pendingDocument);

    setLoading('텍스트 추출 중');
    setDbUploadNotice({ type: 'warning', message: '텍스트 추출 중' });

    let storageResponse: Response;
    let response: ExtractFromStorageResponse;
    try {
      storageResponse = await fetch('/api/extract-from-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: state.input,
          ...storageFile,
          dbLibraryMetadata,
        }),
      });
      response = await parseJsonResponse<ExtractFromStorageResponse>(storageResponse, 'Storage DB 업로드 API');
    } catch (storageError) {
      console.error('DB storage extraction failed after original file upload.', storageError);
      const partialDocument = { ...pendingDocument, extractionStatus: '원본 저장 / 텍스트 추출 실패' as const, warningMessage: DB_STORAGE_EXTRACTION_TIMEOUT_DETAIL, dbLibraryMetadata };
      await persistDbUploadedDocumentSafely(partialDocument, true);
      updateDbUploadedDocument(pendingDocument.id, {
        extractionStatus: '원본 저장 / 텍스트 추출 실패',
        warningMessage: DB_STORAGE_EXTRACTION_TIMEOUT_DETAIL,
        errorMessage: getUploadErrorMessage(storageError, DB_STORAGE_EXTRACTION_TIMEOUT_DETAIL),
        dbSaveStatus: 'partial',
        dbChunkCount: 0,
      });
      setDbUploadNotice({ type: 'warning', message: DB_STORAGE_EXTRACTION_TIMEOUT_DETAIL });
      return;
    }

    const savedStatus = storageResponse.ok && response.status === 'saved' ? 'saved' : storageResponse.ok && response.status === 'partial' ? 'partial' : 'failed';
    updateDbUploadedDocument(pendingDocument.id, {
      documentRole: response.role ?? dbUploadRole,
      extractionStatus: response.extractionStatus ?? (savedStatus === 'failed' ? '추출 실패' : savedStatus === 'partial' ? '일부 텍스트만 추출' : '텍스트 추출 완료'),
      warningMessage: savedStatus === 'partial' ? response.detail || response.warning || response.message || '일부 저장' : undefined,
      errorMessage: savedStatus === 'failed' ? response.error || response.message || '저장 실패' : undefined,
      dbSaveStatus: savedStatus,
      dbProjectId: response.projectId,
      dbDocumentId: response.documentId,
      dbChunkCount: response.chunkCount,
      totalPageCount: response.pageCount,
      proposalPatternStatus: response.proposalPatternStatus,
      proposalPatternCount: response.proposalPatternCount,
    });

    setLoading('DB 저장 중');
    setDbUploadNotice({
      type: savedStatus === 'saved' ? 'success' : savedStatus === 'partial' ? 'warning' : 'error',
      message: response.detail || (savedStatus === 'saved' ? '저장 성공' : savedStatus === 'partial' ? '일부 저장' : '저장 실패'),
    });

    if (savedStatus === 'failed') {
      console.error('DB storage upload failed', {
        fileName: file.name,
        status: storageResponse.status,
        error: response.error || response.message,
        bucket: storageFile.bucket,
        storagePath: storageFile.storagePath,
      });
      return;
    }

    console.info('DB storage upload completed', {
      fileName: file.name,
      extension,
      bucket: storageFile.bucket,
      storagePath: storageFile.storagePath,
      sentRawFileBodyToApi: false,
    });
  };

  const handleDbFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setDbUploadNotice(null);

    if (!file) {
      setDbUploadFile(null);
      return;
    }

    if (file.size > MAX_DB_UPLOAD_FILE_SIZE_BYTES) {
      setDbUploadFile(null);
      setDbUploadNotice({ type: 'error', message: '파일 크기가 너무 큽니다. 100MB 이하 파일을 업로드해주세요.' });
      return;
    }

    const extension = getFileExtension(file.name);
    if (![...clientReadableExtensions, ...serverReadableExtensions].includes(extension)) {
      setDbUploadFile(null);
      setDbUploadNotice({ type: 'error', message: '지원하지 않는 파일 형식입니다. PDF, PPTX, DOCX, TXT, MD 파일을 업로드해주세요.' });
      return;
    }

    setDbUploadFile(file);
  };

  const handleDbUploadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = dbUploadFile;
    if (!file) {
      setDbUploadNotice({ type: 'warning', message: '업로드할 파일을 먼저 선택해 주세요.' });
      return;
    }

    setError('');
    setDbUploadNotice(null);

    const extension = getFileExtension(file.name);
    const dbLibraryMetadata = buildDbLibraryMetadata(file);

    setLoading('DB 저장 중');

    try {
      if (shouldUseStorageForDbUpload(file, extension)) {
        await uploadDbFileThroughStorage(file, extension, dbLibraryMetadata);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'db');

      const response = await fetch('/api/extract-text', { method: 'POST', body: formData });
      const data = await parseJsonResponse<ExtractTextResponse>(response, 'DB 업로드 텍스트 추출 API');

      if (!response.ok) {
        const message = data.error || data.warning || data.message || TEXT_EXTRACTION_FAILED_MESSAGE;
        console.error('DB upload text extraction failed.', { status: response.status, message });
        if (isLargePayloadError(message, response.status)) {
          await uploadDbFileThroughStorage(file, extension, dbLibraryMetadata);
          return;
        }
        throw new Error(message);
      }

      const text = (data.text ?? '').trim();

      if (!text) {
        const message = data.warning || data.error || TEXT_EXTRACTION_FAILED_MESSAGE;
        console.error('DB upload produced no text.', { fileName: file.name, message });
        const friendlyMessage = getUploadErrorMessage(message, '저장 실패');
        const failedDocument = createUploadedDocument(file, '추출 실패', '', friendlyMessage, { documentRole: dbUploadRole, dbSaveStatus: 'failed', errorMessage: friendlyMessage, dbLibraryMetadata });
        addDbUploadedDocument(failedDocument);
        setDbUploadNotice({ type: 'error', message: isLargePayloadError(message) ? friendlyMessage : '저장 실패' });
        return;
      }

      const isPartial = data.status === 'partial' || Boolean(data.warning) || !response.ok;
      const document = createUploadedDocument(
        file,
        isPartial ? '일부 텍스트만 추출' : '텍스트 추출 완료',
        text,
        isPartial ? data.warning || data.message || '일부 저장' : undefined,
        {
          documentRole: dbUploadRole,
          dbSaveStatus: 'saving',
          dbLibraryMetadata,
          totalPageCount: data.pageCount,
          pageTextSources: extension === 'pptx' && data.slides?.length ? buildSlideTextSources(data.slides) : undefined,
        },
      );

      addDbUploadedDocument(document);
      setDbUploadNotice({ type: 'warning', message: 'DB 저장 중' });
      await persistDbUploadedDocumentSafely(document, isPartial);
    } catch (err) {
      if (isLargePayloadError(err)) {
        try {
          await uploadDbFileThroughStorage(file, extension, dbLibraryMetadata);
          return;
        } catch (storageErr) {
          console.error('DB upload Storage retry failed.', storageErr);
          const message = getUploadErrorMessage(storageErr, LARGE_FILE_UPLOAD_GUIDANCE);
          const failedDocument = createUploadedDocument(file, '추출 실패', '', message, { documentRole: dbUploadRole, dbSaveStatus: 'failed', errorMessage: message, dbLibraryMetadata });
          addDbUploadedDocument(failedDocument);
          setDbUploadNotice({ type: 'error', message });
          return;
        }
      }

      console.error('DB upload extract/upload failed.', err);
      const message = getUploadErrorMessage(err, TEXT_EXTRACTION_FAILED_MESSAGE);
      const failedDocument = createUploadedDocument(file, '추출 실패', '', message, { documentRole: dbUploadRole, dbSaveStatus: 'failed', errorMessage: message, dbLibraryMetadata });
      addDbUploadedDocument(failedDocument);
      setDbUploadNotice({ type: 'error', message: isLargePayloadError(err) ? message : '저장 실패' });
    } finally {
      setLoading('');
      setDbUploadFile(null);
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
        const validation = validateDirectTextInput(await file.text());
        if (!validation.ok) {
          addUploadedDocumentAndPersist(
            createUploadedDocument(file, '추출 실패', '', validation.message),
            validation.reason === 'short' ? 'warning' : 'error',
            validation.message,
          );
          return;
        }

        addUploadedDocumentAndPersist(
          createUploadedDocument(file, '텍스트 추출 완료', validation.text, undefined, { documentAnalysisText: validation.text }),
          'success',
          'MD/TXT 직접 읽기 완료',
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

  // Deferred initial-analysis steps. Run AFTER /api/analyze succeeds and the analysis is already in state, so a
  // timeout here never discards the completed RFP analysis — the user can regenerate just these from the analysis view.
  const runInitialDiagnosisAndBrand = async (input: ProjectInput, analysis: AnalysisResult) => {
    try {
      setLoading('제안 전략 진단 생성 중...');
      const diagnosis = (await postJson<{ result: RfpDiagnosis }>('/api/diagnosis', { input, analysis })).result;
      setState((current) => ({ ...current, rfpDiagnosis: diagnosis }));
      setLoading('브랜드/제품 이해 생성 중...');
      const brandProductIntelligence = (await postJson<{ result: BrandProductIntelligence }>('/api/brand-product-intelligence', { input, analysis, rfpDiagnosis: diagnosis, uploadedDocuments: state.uploadedDocuments, additionalInfo: supplementalInfo })).result;
      setState((current) => ({ ...current, brandProductIntelligence }));
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '제안 전략 진단/브랜드 이해 생성 중 오류가 발생했습니다.';
      setError(isTimeoutMessage(rawMessage)
        ? 'RFP 분석은 완료되었습니다. 제안 전략 진단·브랜드 이해 생성 시간이 초과되어, 아래에서 해당 단계만 다시 생성할 수 있습니다.'
        : `RFP 분석은 완료되었습니다. 다음 단계 생성 중 오류가 발생했습니다: ${rawMessage}`);
    }
  };

  // Continuation CTA for a partial analysis where diagnosis is missing: generate the (lightweight) diagnosis via the
  // existing /api/diagnosis route, then OPTIONALLY the brand/product layer (never blocking on it). Once diagnosis is
  // set, the strategic direction button enables. Reuses the existing diagnosis endpoint — no full re-analysis.
  const continueStrategyDiagnosis = async () => {
    if (!state.analysis) return;
    const analysis = state.analysis;
    setError('');
    setLoading('제안 전략 진단 생성 중...');
    try {
      const diagnosis = (await postJson<{ result: RfpDiagnosis }>('/api/diagnosis', { input: analysisInput, analysis })).result;
      setState((current) => ({ ...current, rfpDiagnosis: diagnosis }));
      try {
        setLoading('브랜드/제품 이해 생성 중...');
        const brandProductIntelligence = (await postJson<{ result: BrandProductIntelligence }>('/api/brand-product-intelligence', { input: analysisInput, analysis, rfpDiagnosis: diagnosis, uploadedDocuments: state.uploadedDocuments, additionalInfo: supplementalInfo })).result;
        setState((current) => ({ ...current, brandProductIntelligence }));
      } catch {
        // Brand/product intelligence is optional — diagnosis alone is enough to generate strategic directions.
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '전략 진단 생성 중 오류가 발생했습니다.';
      // Diagnosis is REQUIRED for directions — do NOT fall back to shallow direction generation. Ask the user to retry.
      setError(isTimeoutMessage(rawMessage)
        ? '전략 진단 생성이 지연되었습니다. 다시 시도해 주세요.'
        : `전략 진단 생성이 지연되었습니다. 다시 시도해 주세요. (${rawMessage})`);
    } finally {
      setLoading('');
    }
  };

  // One analysis attempt: core RFP analysis (full or lite) committed to state first, then the deferred (fail-open)
  // diagnosis + brand steps. Only the /api/analyze call can throw out of here (the deferred steps swallow their own errors).
  const performAnalysis = async (input: ProjectInput, mode: 'full' | 'lite') => {
    const analysisBasis = getCurrentAnalysisBasis();
    const analysisResponse = await postJson<AnalysisApiResponse>('/api/analyze', { input, documentChunks, analysisMode: mode });
    const { result: analysis, evidence } = parseAnalysisApiResponse(analysisResponse);
    setState((current) => ({ ...current, ...CLEARED_PROJECT_GENERATED_STATE, analysis, retrievalEvidence: evidence, analysisBasis }));
    setStep('analysis');
    void persistAnalysisSafely(input, analysis);
    await runInitialDiagnosisAndBrand(input, analysis);
  };

  // Fail-open analysis: try full; if it TIMES OUT, fall back ONCE to lite (core-only) so the user still reaches the
  // next step. A non-timeout error is surfaced as-is. The uploaded file / extracted text is never reset here.
  const runAnalyzeWithFallback = async (input: ProjectInput) => {
    // Clear ALL previous project-specific generated state up front so old strategy cards / concept names never stay
    // visible while a new analysis is pending, and are never silently reused if the new analysis fails (cross-RFP
    // isolation, fail-closed). performAnalysis re-commits fresh analysis on success.
    setState((current) => ({ ...current, ...CLEARED_PROJECT_GENERATED_STATE }));
    try {
      setLoading('RFP/브리프 분석 중...');
      await performAnalysis(input, 'full');
    } catch (fullErr) {
      const fullMessage = fullErr instanceof Error ? fullErr.message : '분석 중 오류가 발생했습니다.';
      if (!isTimeoutMessage(fullMessage)) { setError(fullMessage); return; }
      try {
        setLoading('전체 분석이 길어 핵심 분석만 빠르게 진행 중...');
        await performAnalysis(input, 'lite');
        setError('전체 분석 시간이 초과되어 핵심 분석만 먼저 완료했습니다. 아래 버튼으로 전략 진단과 방향 생성을 이어서 진행할 수 있습니다.');
      } catch (liteErr) {
        const liteMessage = liteErr instanceof Error ? liteErr.message : '핵심 분석 중 오류가 발생했습니다.';
        setError(isTimeoutMessage(liteMessage)
          ? '핵심 RFP 분석도 시간 초과되었습니다. 파일 크기 또는 텍스트 추출량을 줄인 뒤 다시 시도해 주세요.'
          : liteMessage);
      }
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
    try {
      await runAnalyzeWithFallback(analysisInput);
    } finally {
      setLoading('');
    }
  };

  const rerunAnalyzeWithSupplementalInfo = async () => {
    const mergedInput = mergeInputWithSupplementalInfo(analysisInput, supplementalInfo);
    setError('');
    try {
      await runAnalyzeWithFallback(mergedInput);
    } finally {
      setLoading('');
    }
  };

  const runDiagnosis = async () => {
    if (!state.analysis) return;
    setError('');
    setLoading('제안 전략 진단 중...');
    try {
      const response = await postJson<{ result: RfpDiagnosis }>('/api/diagnosis', { input: analysisInput, analysis: state.analysis });
      setState((current) => ({ ...current, rfpDiagnosis: response.result, brandProductIntelligence: undefined, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, selectedStrategicDirection: undefined, selectedDirectionIndex: undefined, selectedConcept: undefined, conceptNameOptions: undefined, conceptNameOptionsByDirection: undefined, outline: undefined, slides: undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '진단 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const updateDiagnosisField = (key: NewDiagnosisTextKey, value: string) => {
    setState((current) => current.rfpDiagnosis ? ({ ...current, rfpDiagnosis: withDiagnosisText(current.rfpDiagnosis, key, value), brandProductIntelligence: undefined, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, selectedStrategicDirection: undefined, selectedDirectionIndex: undefined, selectedConcept: undefined, conceptNameOptions: undefined, conceptNameOptionsByDirection: undefined, outline: undefined, slides: undefined }) : current);
  };

  const updateDiagnosisProofElements = (value: string) => {
    setState((current) => current.rfpDiagnosis ? ({ ...current, rfpDiagnosis: withDiagnosisList(current.rfpDiagnosis, value), brandProductIntelligence: undefined, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, selectedStrategicDirection: undefined, selectedDirectionIndex: undefined, selectedConcept: undefined, conceptNameOptions: undefined, conceptNameOptionsByDirection: undefined, outline: undefined, slides: undefined }) : current);
  };


  const runBrandProductIntelligence = async () => {
    if (!state.analysis || !state.rfpDiagnosis) return;
    setError('');
    setLoading('브랜드/제품 이해 정리 중...');
    try {
      const response = await postJson<{ result: BrandProductIntelligence }>('/api/brand-product-intelligence', { input: analysisInput, analysis: state.analysis, rfpDiagnosis: state.rfpDiagnosis, uploadedDocuments: state.uploadedDocuments, additionalInfo: supplementalInfo });
      setState((current) => ({ ...current, brandProductIntelligence: response.result, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, selectedStrategicDirection: undefined, selectedDirectionIndex: undefined, selectedConcept: undefined, conceptNameOptions: undefined, conceptNameOptionsByDirection: undefined, outline: undefined, slides: undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '브랜드/제품 이해 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const updateBrandProductIntelligenceField = (key: keyof BrandProductIntelligence, value: string) => {
    setState((current) => current.brandProductIntelligence ? ({ ...current, brandProductIntelligence: { ...current.brandProductIntelligence, [key]: value }, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, selectedStrategicDirection: undefined, selectedDirectionIndex: undefined, selectedConcept: undefined, conceptNameOptions: undefined, conceptNameOptionsByDirection: undefined, outline: undefined, slides: undefined }) : current);
  };

  const updateBrandProductIntelligenceList = (key: 'brandSpecificVocabulary' | 'wordsToAvoid', value: string) => {
    setState((current) => current.brandProductIntelligence ? ({ ...current, brandProductIntelligence: { ...current.brandProductIntelligence, [key]: value.split('\n').map((item) => item.trim()).filter(Boolean) }, conceptDevelopmentLogic: undefined, conceptCandidates: undefined, conceptRecommendation: undefined, conceptGenerationResult: undefined, selectedStrategicDirection: undefined, selectedDirectionIndex: undefined, selectedConcept: undefined, conceptNameOptions: undefined, conceptNameOptionsByDirection: undefined, outline: undefined, slides: undefined }) : current);
  };

  const runConcepts = async (options: { retryLight?: boolean } = {}) => {
    if (!state.analysis) return;
    // Strategic directions REQUIRE a real proposal strategy diagnosis. Never generate from a synthetic fallback —
    // that degrades directions to shallow template labels. The continuation CTA generates the diagnosis first.
    // Brand/product intelligence stays OPTIONAL (empty fallback object so it alone never blocks generation).
    if (!state.rfpDiagnosis) {
      setError('전략 방향 생성을 위해 제안 전략 진단을 먼저 생성해 주세요.');
      return;
    }
    const effectiveBrand = state.brandProductIntelligence ?? buildFallbackBrandProductIntelligence();
    const generationAttempt = conceptGenerationAttemptRef.current + 1;
    conceptGenerationAttemptRef.current = generationAttempt;
    const requestedAt = new Date().toISOString();
    const regenerationId = `${requestedAt}-${generationAttempt}-${crypto.randomUUID()}`;

    setError('');
    setConceptRetryVisible(false);
    setStep('concepts');
    setLoading('새 후보 생성 중...');
    setState((current) => ({
      ...current,
      conceptDevelopmentLogic: undefined,
      conceptCandidates: undefined,
      conceptRecommendation: undefined,
      conceptGenerationResult: undefined,
      selectedStrategicDirection: undefined,
      selectedDirectionIndex: undefined,
      selectedConcept: undefined,
      conceptNameOptions: undefined,
      conceptNameOptionsByDirection: undefined,
      selectedFinalConceptNameOption: undefined,
      outline: undefined,
      slides: undefined,
    }));

    try {
      const proposalNarrative = await postJson<ProposalNarrative>('/api/narrative', { input: analysisInput, analysis: state.analysis, uploadedDocuments: state.uploadedDocuments, documentChunks });
      setLoading(options.retryLight ? '가벼운 새 후보 생성 중...' : '새 후보 생성 중...');
      const conceptResult = await postJson<ConceptCandidatesResult>('/api/concepts', {
        input: analysisInput,
        analysis: state.analysis,
        proposalNarrative,
        rfpDiagnosis: state.rfpDiagnosis,
        brandProductIntelligence: effectiveBrand,
        conceptPromptVersion,
        regenerationId,
        timestamp: requestedAt,
        attempt: generationAttempt,
        options: { maxCandidates: 3, retryLight: options.retryLight },
      });
      setState((current) => ({
        ...current,
        proposalNarrative,
        conceptDevelopmentLogic: conceptResult.conceptDevelopmentLogic,
        conceptCandidates: conceptResult.concepts,
        conceptRecommendation: conceptResult.recommendation,
        conceptGenerationResult: conceptResult,
        selectedConcept: undefined,
        conceptNameOptions: undefined,
        outline: undefined,
        slides: undefined,
      }));
      setStep('concepts');
    } catch (err) {
      setConceptRetryVisible(true);
      setStep('analysis');
      const rawMessage = err instanceof Error ? err.message : '콘셉트 후보 생성 중 오류가 발생했습니다.';
      const friendlyMessage = isTimeoutMessage(rawMessage)
        ? '전략 방향 생성 시간이 초과되었습니다. RFP 분석 결과는 유지되며, 전략 방향만 다시 생성할 수 있습니다.'
        : rawMessage;
      setError(friendlyMessage);
    } finally {
      setLoading('');
    }
  };

  const selectConcept = (concept: ConceptCandidate, index?: number) => {
    setFinalNamingError('');
    setFinalNamingDebug({});
    const selectedDirection = { ...concept };
    // Changing the selected direction always clears the final naming section (name, slogan, selected option) and only
    // surfaces candidates that belong to THIS exact direction bucket; conceptFrameSynthesis is route-rebuilt per request.
    setState((current) => ({
      ...current,
      selectedStrategicDirection: selectedDirection,
      selectedDirectionIndex: index,
      selectedConcept: {
        ...selectedDirection,
        finalConceptName: '',
        finalConceptSlogan: '',
        finalConceptNameOption: undefined,
        selectedDirection,
      },
      conceptNameOptions: current.conceptNameOptionsByDirection?.[getDirectionCacheKey(index, selectedDirection)] ?? undefined,
      selectedFinalConceptNameOption: undefined,
      outline: undefined,
      slides: undefined,
    }));
  };

  const runConceptNames = async (options: { append?: boolean } = {}) => {
    if (!state.analysis || !selectedStrategicDirection) return;
    setError('');
    setFinalNamingError('');
    setLoading('컨셉명 후보 생성 중');
    try {
      const selectedDirection = selectedStrategicDirection;
      const directionKey = getDirectionCacheKey(state.selectedDirectionIndex, selectedDirection);
      // Request identity for async-race protection: a response is only allowed to update the VISIBLE candidates if the
      // user is still on this exact project + direction when it returns.
      const requestProjectKey = currentProjectKey;
      const generationBatchId = crypto.randomUUID ? crypto.randomUUID() : `${directionKey}-${requestProjectKey}`;
      const directionValidation = validateStrategicDirectionForDisplay(selectedDirection);
      const selectedDirectionForNaming = normalizeSelectedDirectionForNaming(selectedDirection);
      setFinalNamingDebug({ selectedDirectionKey: directionKey, missingFields: directionValidation.missingFields });
      if (!selectedDirectionForNaming || !directionValidation.canGenerateConceptNames) throw new Error(`missing_fields=${directionValidation.missingFields.join(',') || 'invalid_direction'}`);
      const currentDirectionOptions = state.conceptNameOptionsByDirection?.[directionKey] ?? [];
      const otherDirectionOptions = Object.entries(state.conceptNameOptionsByDirection ?? {}).filter(([key]) => key !== directionKey).flatMap(([, value]) => value);
      const sanitizedNamingContext = sanitizeConceptContextByRfpType({
        primaryRfpConceptType: selectedDirection.rfpConceptType || state.conceptGenerationResult?.primaryRfpConceptType || state.analysis.primaryRfpConceptType || 'unknown',
        rawPrimaryRfpConceptType: state.conceptGenerationResult?.rawPrimaryRfpConceptType ?? state.analysis.primaryRfpConceptType,
        matrixType: state.conceptGenerationResult?.matrixType ?? state.analysis.matrixType,
        rawMatrixType: state.conceptGenerationResult?.rawMatrixType ?? state.analysis.matrixType,
        entityDifferentiationMatrix: state.conceptGenerationResult?.entityDifferentiationMatrix ?? state.proposalNarrative?.entityDifferentiationMatrix,
        brandExperienceMatrix: state.conceptGenerationResult?.brandExperienceMatrix,
      });
      const activeRelevantMatrix = getActiveMatrix(sanitizedNamingContext) ?? undefined;
      const namingPayload = { input: analysisInput, analysis: state.analysis, analysisSummary: state.analysis.projectOverview, selectedDirection: selectedDirectionForNaming, selectedStrategicDirection: selectedDirectionForNaming, selectedStrategicDirectionKey: directionKey, selectedStrategicDirectionId: selectedDirectionForNaming.conceptId, selectedStrategicDirectionConceptId: selectedDirectionForNaming.conceptId, directionAxis: selectedDirectionForNaming.directionAxis, strategicDirectionLabel: selectedDirectionForNaming.strategicDirectionLabel, oneLineStrategicBet: selectedDirectionForNaming.oneLineStrategicBet, representativePersuasionScene: selectedDirectionForNaming.representativePersuasionScene, generationNonce: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), primaryRfpConceptType: sanitizedNamingContext.primaryRfpConceptType, winningThesis: selectedDirectionForNaming.winningThesis, conceptLeap: selectedDirectionForNaming.conceptLeap, signatureProofIdea: selectedDirectionForNaming.signatureProofIdea, matrixType: sanitizedNamingContext.matrixType, activeMatrix: activeRelevantMatrix, currentRfpOnlyMode: state.conceptGenerationResult?.currentRfpOnlyMode, rfpDiagnosis: state.rfpDiagnosis, brandProductIntelligence: state.brandProductIntelligence, conceptDevelopmentLogic: state.conceptDevelopmentLogic, languageMode: 'bilingual', proposalNarrative: state.proposalNarrative, recentNameOptions: currentDirectionOptions.map((option) => option.conceptName), existingNamesForSelectedDirection: currentDirectionOptions.map((option) => option.conceptName), blockedOtherDirectionNames: otherDirectionOptions.map((option) => option.conceptName) };
      const namingResponse = await fetch('/api/concept-names', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, cache: 'no-store', body: JSON.stringify(namingPayload) });
      setFinalNamingDebug((current) => ({ ...current, responseStatus: namingResponse.status }));
      const result = await parseJsonResponse<ConceptNameOptionsResult & { ok?: boolean; nameOptions?: ConceptNameOption[]; warning?: string; error?: string; details?: string }> (namingResponse, '/api/concept-names');
      if (!namingResponse.ok) throw new Error(result.details ? `${result.error || '컨셉명 생성 실패'} (${result.details})` : (result.error || '컨셉명 생성 중 오류가 발생했습니다.'));
      const blockedOptions = [...currentDirectionOptions, ...otherDirectionOptions];
      // Stamp every candidate with its project + direction provenance so the render filter can never show it under a
      // different project/direction, even if it lands in state after the user has moved on.
      const nameOptions = uniqueConceptNameOptions(result.nameOptions ?? result.options ?? [], blockedOptions)
        .map((option) => ({ ...option, projectKey: requestProjectKey, directionKey, generationBatchId }));
      if (result.ok === false) throw new Error(result.error || '컨셉명 생성 중 오류가 발생했습니다.');
      if (!nameOptions.length) throw new Error('컨셉명 후보가 비어 있습니다.');
      if (result.warning) setFinalNamingError(`컨셉명 생성 경고: ${result.warning}`);
      setState((current) => {
        const currentKey = getDirectionCacheKey(current.selectedDirectionIndex, current.selectedStrategicDirection ?? current.selectedConcept?.selectedDirection);
        const stillCurrent = currentKey === directionKey && buildCurrentProjectKey(current.input, current.uploadedDocuments) === requestProjectKey;
        const latestDirectionOptions = current.conceptNameOptionsByDirection?.[directionKey] ?? [];
        const nextOptions = options.append ? uniqueConceptNameOptions([...latestDirectionOptions, ...nameOptions]) : nameOptions;
        const nextByDirection = { ...(current.conceptNameOptionsByDirection ?? {}), [directionKey]: nextOptions };
        // Stale response (direction/project changed while in flight): keep the captured direction's bucket up to date for
        // when the user returns, but do NOT overwrite the currently visible candidates or final selection.
        if (!stillCurrent) return { ...current, conceptNameOptionsByDirection: nextByDirection };
        return { ...current, conceptNameOptions: nextOptions, conceptNameOptionsByDirection: nextByDirection, selectedFinalConceptNameOption: options.append ? current.selectedFinalConceptNameOption : undefined, outline: undefined, slides: undefined };
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '컨셉명 후보 생성 중 오류가 발생했습니다.';
      const message = isTimeoutMessage(rawMessage)
        ? '컨셉명 생성 시간이 초과되었습니다. 선택한 전략 방향은 유지되며, 컨셉명만 다시 생성할 수 있습니다.'
        : '선택한 전략 방향에 맞는 충분히 구체적인 컨셉명을 생성하지 못했습니다. 전략 방향을 다시 선택하거나 컨셉명을 다시 생성해 주세요.';
      setFinalNamingError(message);
      setFinalNamingDebug((current) => ({ ...current, responseErrorMessage: rawMessage }));
      setError(message);
    } finally {
      setLoading('');
    }
  };

  const selectConceptNameOption = (option: ConceptNameOption) => {
    setState((current) => current.selectedConcept ? ({
      ...current,
      selectedConcept: {
        ...current.selectedConcept,
        finalConceptName: option.conceptName,
        finalConceptSlogan: option.oneLineSlogan || option.shortMeaning,
        finalConceptNameOption: option,
        selectedDirection: current.selectedStrategicDirection ?? current.selectedConcept.selectedDirection ?? current.selectedConcept,
      },
      selectedFinalConceptNameOption: option,
      outline: undefined,
      slides: undefined,
    }) : current);
  };

  const updateFinalConceptField = (field: 'finalConceptName' | 'finalConceptSlogan', value: string) => {
    setState((current) => current.selectedConcept ? ({ ...current, selectedConcept: { ...current.selectedConcept, [field]: value }, outline: undefined, slides: undefined }) : current);
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
      // Scope proposal_patterns to THIS project's own uploaded reference proposals (its DB project/document ids). When
      // nothing is persisted these are empty and the server skips the global pattern read.
      const scopedDocuments = [...(state.uploadedDocuments ?? []), ...(state.dbUploadedDocuments ?? [])];
      const projectId = scopedDocuments.find((document) => document.dbProjectId)?.dbProjectId ?? null;
      const documentIds = Array.from(new Set(scopedDocuments.map((document) => document.dbDocumentId).filter((id): id is string => Boolean(id))));
      const outlineResponse = await postJson<{ slides: SlideOutline[]; designGuide?: DesignGuide } | SlideOutline[]>('/api/outline', { input: analysisInput, analysis: state.analysis, selectedConcept: state.selectedConcept, selectedStrategicDirection: state.selectedStrategicDirection, rfpDiagnosis: state.rfpDiagnosis, conceptDevelopmentLogic: state.conceptDevelopmentLogic, conceptGenerationResult: state.conceptGenerationResult, proposalNarrative: state.proposalNarrative, documentChunks, projectId, documentIds });
      const outline = Array.isArray(outlineResponse) ? outlineResponse : outlineResponse.slides;
      const designGuide = Array.isArray(outlineResponse) ? undefined : outlineResponse.designGuide;
      setState((current) => ({ ...current, outline, designGuide, slides: undefined }));
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
                  <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">RFP, 기존 제안서, 레퍼런스, 메모를 내부 RAG 자료로 저장합니다. 수주/미수주 사유 유형은 제안서 구조 학습과 회피 규칙에 반영됩니다.</p>
                  <p className="mt-2 text-sm font-semibold text-slate-700">지원 형식: PDF, PPTX, DOCX, TXT, MD · 최대 100MB</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-amber-700">{DB_UPLOAD_SIZE_GUIDANCE}</p>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                  <button
                    type="button"
                    onClick={handleBackfillAllProposalPatterns}
                    disabled={Boolean(loading) || dbUploadedDocuments.some((document) => document.proposalPatternStatus === 'extracting')}
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    기존 제안서 패턴 일괄 추출
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDbUploadModalOpen(false)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50"
                    aria-label="DB 업로드 창 닫기"
                  >
                    닫기
                  </button>
                </div>
              </div>

              <form className="mt-6 space-y-5" onSubmit={handleDbUploadSubmit}>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">문서 유형</span>
                  <select
                    value={dbUploadRole}
                    onChange={(event) => setDbUploadRole(event.target.value as 'rfp' | 'proposal' | 'reference' | 'memo')}
                    className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
                  >
                    <option value="rfp">RFP / 제안요청서</option>
                    <option value="proposal">기존 제안서 / Proposal</option>
                    <option value="reference">레퍼런스 / Reference</option>
                    <option value="memo">메모 / Memo</option>
                  </select>
                </label>

                {dbUploadRole === 'proposal' && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">결과</span>
                      <select
                        value={dbUploadOutcome}
                        onChange={(event) => setDbUploadOutcome(event.target.value as ProposalOutcome)}
                        className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
                      >
                        <option value="won">수주</option>
                        <option value="lost">미수주</option>
                        <option value="unknown">결과 모름</option>
                      </select>
                    </label>
                    {dbUploadOutcome === 'lost' && (
                      <label className="block">
                        <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">미수주 사유 유형 <span className="text-slate-400">(선택)</span></span>
                        <select
                          value={dbUploadOutcomeReasonType}
                          onChange={(event) => setDbUploadOutcomeReasonType(event.target.value as OutcomeReasonType)}
                          className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
                        >
                          <option value="external">예산/외부 요인</option>
                          <option value="quality">제안 품질 요인</option>
                          <option value="mixed">복합 요인</option>
                          <option value="unknown">모르겠음</option>
                        </select>
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">수주/미수주 이유 <span className="text-slate-400">(선택, 권장)</span></span>
                      <textarea
                        value={dbUploadOutcomeReason}
                        onChange={(event) => setDbUploadOutcomeReason(event.target.value)}
                        rows={3}
                        placeholder="예: 기술 연출 차별성, 예산 적합성, 클라이언트 니즈 부합, 레퍼런스 신뢰도, 제안 범위 차이 등"
                        className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold leading-6 text-slate-700 outline-none focus:border-emerald-500"
                      />
                    </label>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                    <p className="font-black text-slate-950">파일명 권장 형식</p>
                    <p className="mt-1 font-semibold">[클라이언트]_[프로젝트명]_[문서유형].pdf 형식을 권장합니다.</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-semibold text-slate-600">
                      <li>[Client]_[Project]_[proposal].pdf</li>
                      <li>NAVERCloud_LEAP2025_proposal.pdf</li>
                      <li>Hyundai_WorldHydrogenEXPO_RFP.pdf</li>
                      <li>Samsung_GalaxyStudio_reference.pdf</li>
                    </ul>
                    <p className="mt-2 text-xs font-bold text-amber-700">한글 파일명도 가능하지만, 검색과 관리 안정성을 위해 영문+언더바 형식을 권장합니다.</p>
                    {dbUploadFile && <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-black text-emerald-700">선택된 파일: {dbUploadFile.name}</p>}
                  </div>
                  <div className="flex flex-col gap-3 self-end">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-emerald-200 bg-white px-5 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50">
                      파일 선택
                      <input
                        type="file"
                        accept=".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                        onChange={handleDbFileSelect}
                        disabled={Boolean(loading)}
                        className="sr-only"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={Boolean(loading) || !dbUploadFile}
                      className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      DB에 업로드
                    </button>
                  </div>
                </div>
              </form>

              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm leading-6 text-slate-700">
                <p className="font-black text-emerald-900">업로드 상태</p>
                <p className="mt-1 font-semibold">대기 · 업로드 중 · 텍스트 추출 중 · DB 저장 중 · 저장 성공 · 일부 저장 · 저장 실패 · 원본 저장 / 텍스트 추출 실패</p>
                {latestDbUploadStatus && (
                  <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-black ${latestDbUploadStatus.tone}`} role="status" aria-live="polite">
                    {latestDbUploadedDocument?.dbSaveStatus === 'saving' && <span className="mr-2 h-1.5 w-1.5 animate-pulse self-center rounded-full bg-current" />}
                    {latestDbUploadStatus.label}
                  </span>
                )}
              </div>

              <DbLibraryUploadedDocumentsList documents={dbUploadedDocuments} onBackfillDocument={handleBackfillProposalPatternsForDocument} />
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
              {conceptRetryVisible && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
                  <p>컨셉 생성 시간이 초과되었습니다. 분석 결과는 유지됩니다.</p>
                  <button onClick={() => runConcepts({ retryLight: true })} disabled={Boolean(loading)} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 font-black text-white transition hover:bg-amber-700 disabled:opacity-50">가볍게 다시 생성</button>
                </div>
              )}
              <RetrievalEvidencePanel evidence={state.retrievalEvidence} />
              <details className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5">
                <summary className="flex cursor-pointer list-none flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-2xl font-black text-indigo-950">제안 전략 진단</h3>
                    <p className="mt-2 text-sm font-semibold leading-6 text-indigo-900">AI가 RFP를 기준으로 이번 제안에서 반드시 설득해야 할 핵심 전략을 정리했습니다. 필요하면 확인·수정 후 전략 방향을 생성하세요.</p>
                    {state.rfpDiagnosis ? (
                      <div className="mt-4 grid gap-2 text-sm font-bold text-indigo-950">
                        {getDiagnosisText(state.rfpDiagnosis, 'coreProposalThesis') && <p><span className="text-indigo-700">핵심 제안 명제</span> · {getDiagnosisText(state.rfpDiagnosis, 'coreProposalThesis')}</p>}
                        {getDiagnosisText(state.rfpDiagnosis, 'strategicIssue') && <p><span className="text-indigo-700">전략적 쟁점</span> · {getDiagnosisText(state.rfpDiagnosis, 'strategicIssue')}</p>}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-indigo-900">전략 방향 생성 전에 제안 전략 진단이 필요합니다. 아래 ‘전략 진단 계속 생성’ 버튼으로 이어서 생성할 수 있습니다.</p>
                    )}
                  </div>
                  <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-indigo-700 shadow-sm">진단 내용 보기·수정</span>
                </summary>
                {state.rfpDiagnosis && (
                  <div className="mt-5 grid gap-4">
                    {diagnosisFieldLabels.map(([key, label]) => (
                      <label key={key} className="block">
                        <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-indigo-700">{label}</span>
                        <textarea value={getDiagnosisText(state.rfpDiagnosis, key)} onChange={(event) => updateDiagnosisField(key, event.target.value)} className="min-h-20 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-indigo-500" />
                      </label>
                    ))}
                    <label className="block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-indigo-700">필수 설득 요소</span>
                      <textarea value={getDiagnosisList(state.rfpDiagnosis).join('\n')} onChange={(event) => updateDiagnosisProofElements(event.target.value)} className="min-h-32 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-indigo-500" />
                    </label>
                    <details className="rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-xs font-semibold text-indigo-900">
                      <summary className="cursor-pointer font-black">개발/검증 정보 보기</summary>
                      <pre className="mt-3 whitespace-pre-wrap">{JSON.stringify({ rfpEvidenceAnchors: state.rfpDiagnosis.rfpEvidenceAnchors, decisionMakerConcern: state.rfpDiagnosis.decisionMakerConcern, evaluatorDecisionRisk: state.rfpDiagnosis.evaluatorDecisionRisk, clientUniquePosition: state.rfpDiagnosis.clientUniquePosition }, null, 2)}</pre>
                    </details>
                  </div>
                )}
              </details>

              {state.rfpDiagnosis && (
                <details className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
                  <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-2xl font-black text-sky-950">브랜드/제품 이해</h3>
                      <p className="mt-2 text-sm font-semibold leading-6 text-sky-900">RFP와 업로드 자료를 기준으로 정리됩니다.</p>
                    </div>
                    <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-sky-700 shadow-sm">브랜드/제품 이해 보기</span>
                  </summary>
                  {state.brandProductIntelligence ? (
                    <div className="mt-4 rounded-2xl border border-sky-200 bg-white p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        {([['clientOrBrandRole', '클라이언트/브랜드 역할'], ['productOrServiceMeaning', '제품/서비스 의미'], ['categoryContext', '카테고리 맥락'], ['audiencePerceptionGap', '관람객 인식 장벽'], ['toneGuidance', '톤 가이드'], ['strategyImplication', '전략 반영 방향'], ['namingImplication', '네이밍 반영 방향']] as const).map(([key, label]) => (
                          <label key={key} className="block">
                            <span className="mb-2 block text-xs font-black text-sky-700">{label}</span>
                            <textarea value={state.brandProductIntelligence?.[key] ?? ''} onChange={(event) => updateBrandProductIntelligenceField(key, event.target.value)} className="min-h-20 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-sky-500" />
                          </label>
                        ))}
                        <label className="block">
                          <span className="mb-2 block text-xs font-black text-sky-700">핵심 어휘</span>
                          <textarea value={state.brandProductIntelligence.brandSpecificVocabulary.join('\n')} onChange={(event) => updateBrandProductIntelligenceList('brandSpecificVocabulary', event.target.value)} className="min-h-20 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-sky-500" />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-black text-sky-700">피해야 할 표현</span>
                          <textarea value={state.brandProductIntelligence.wordsToAvoid.join('\n')} onChange={(event) => updateBrandProductIntelligenceList('wordsToAvoid', event.target.value)} className="min-h-20 w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-sky-500" />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-sky-900">RFP 분석 완료 시 자동 생성됩니다. 추가 정보 반영 후 다시 분석하면 함께 갱신됩니다.</p>
                  )}
                  {state.brandProductIntelligence && <div className="mt-4"><SecondaryButton onClick={runBrandProductIntelligence} disabled={Boolean(loading) || !state.rfpDiagnosis}>다시 정리</SecondaryButton></div>}
                </details>
              )}
            </div>
            {hasConfirmationNeeds && (
              <div className="mt-6">
                <AdditionalInfoReviewPanel drafts={supplementalInfoDrafts} confirmationInfo={confirmationInfo} supplementalInfo={supplementalInfo} onChange={updateSupplementalInfo} />
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('create')}>이전</SecondaryButton>
              {state.analysisBasis?.type === 'partial' && !hasFullVisionAnalysisInProgress && (
                <PrimaryButton onClick={runAnalyze} disabled={Boolean(loading)}>전체 분석 결과로 다시 AI 분석하기</PrimaryButton>
              )}
              {hasConfirmationNeeds && (
                <PrimaryButton onClick={rerunAnalyzeWithSupplementalInfo} disabled={Boolean(loading)}>추가 정보 반영하기</PrimaryButton>
              )}
              {state.rfpDiagnosis ? (
                <PrimaryButton onClick={() => runConcepts()} disabled={Boolean(loading) || !state.analysis}>전략 방향 생성</PrimaryButton>
              ) : (
                <PrimaryButton onClick={continueStrategyDiagnosis} disabled={Boolean(loading) || !state.analysis}>전략 진단 계속 생성</PrimaryButton>
              )}
            </div>
            {!state.rfpDiagnosis && (
              <p className="mt-3 text-sm font-semibold leading-6 text-indigo-800">핵심 분석은 완료되었습니다. 전략 방향 생성을 위해 제안 전략 진단을 먼저 완료해야 합니다.</p>
            )}
            {state.rfpDiagnosis && !state.brandProductIntelligence && (
              <p className="mt-3 text-sm font-semibold leading-6 text-sky-800">브랜드/제품 이해는 선택 분석 항목입니다. 현재 전략 진단을 기준으로 전략 방향을 생성할 수 있습니다.</p>
            )}
          </SectionCard>
        )}

        {step === 'concepts' && state.analysis && (state.conceptCandidates?.length || state.selectedConcept || loading.includes('새 후보')) && (
          <SectionCard title="전략 방향 선택">
            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5 text-blue-950">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-700">Required Step</p>
              <h3 className="mt-2 text-xl font-black">제안서 구조 생성 전에 전략 방향 3개 중 하나를 선택해주세요.</h3>
              <p className="mt-2 text-sm leading-6">
                먼저 전략 방향을 선택한 뒤, 선택한 방향을 바탕으로 최종 컨셉명을 생성하세요. 방향명은 최종 컨셉명이 아니며 구조/PPT 생성에는 확정된 컨셉명을 사용합니다.
              </p>
              <p className="mt-3 text-xs font-bold text-blue-700">
                prompt {state.conceptGenerationResult?.conceptPromptVersion || conceptPromptVersion} · attempt {(state.conceptGenerationResult?.generationAttempt ?? conceptGenerationAttemptRef.current) || '-'} · generated {state.conceptGenerationResult?.generatedAt || (loading.includes('새 후보') ? 'generating...' : '-')}
              </p>
              <details className="mt-3 rounded-2xl border border-blue-100 bg-white/70 px-3 py-2 text-[11px] font-bold text-slate-500">
                <summary className="cursor-pointer font-black text-blue-700">근거/검증 정보 보기</summary>
                <p className="mt-2 leading-5">
                  rawPrimaryRfpConceptType: {state.conceptGenerationResult?.rawPrimaryRfpConceptType || state.analysis.primaryRfpConceptType || 'unknown'} · primaryRfpConceptType: {state.conceptGenerationResult?.primaryRfpConceptType || state.analysis.primaryRfpConceptType || state.conceptCandidates?.[0]?.rfpConceptType || 'unknown'} · rawMatrixType: {state.conceptGenerationResult?.rawMatrixType || state.analysis.matrixType || 'none'} · matrixType: {state.conceptGenerationResult?.matrixType || state.analysis.matrixType || 'none'} · activeMatrixType: {state.conceptGenerationResult?.activeMatrixType || state.conceptGenerationResult?.matrixType || 'none'} · entityMatrixActive: {String(state.conceptGenerationResult?.entityMatrixActive ?? (state.conceptGenerationResult?.matrixType === 'entityDifferentiationMatrix'))} · brandMatrixActive: {String(state.conceptGenerationResult?.brandMatrixActive ?? (state.conceptGenerationResult?.matrixType === 'brandExperienceMatrix'))} · classificationConfidence: {state.conceptGenerationResult?.classificationConfidence || state.analysis.classificationConfidence || 'unknown'} · classificationReason: {state.conceptGenerationResult?.classificationReason || state.analysis.classificationReason || 'none'} · multiEntityEvidenceCount: {state.conceptGenerationResult?.multiEntityEvidenceCount ?? state.analysis.multiEntityEvidenceCount ?? 0} · singleBrandVisitorRoomEvidenceCount: {state.conceptGenerationResult?.singleBrandVisitorRoomEvidenceCount ?? state.analysis.singleBrandVisitorRoomEvidenceCount ?? 0} · sanitizerApplied: {String(state.conceptGenerationResult?.sanitizerApplied ?? false)} · sanitizerReason: {state.conceptGenerationResult?.sanitizerReason || 'none'} · selectedDirectionLensSet: {(state.conceptGenerationResult?.selectedDirectionLensSet ?? state.analysis.selectedDirectionLensSet ?? []).join(' / ') || 'unknown'} · activeMatrixSummary: {state.conceptGenerationResult?.activeMatrixSummary || 'none'} · proposalPatternsUsedForDirections: {String(state.conceptGenerationResult?.proposalPatternsUsedForDirections ?? false)} · currentRfpOnlyMode: {String(state.conceptGenerationResult?.currentRfpOnlyMode ?? ((state.conceptGenerationResult?.primaryRfpConceptType || state.analysis.primaryRfpConceptType) !== 'multi_entity_pavilion'))} · contaminationCheckPassed: {String(state.conceptGenerationResult?.contaminationCheckPassed ?? true)} · blockedTerms: {state.conceptGenerationResult?.blockedTerms?.join(' / ') || 'none'}
                </p>
              </details>
              {selectedStrategicDirectionExists && (
                <p className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-black text-blue-800">
                  선택된 전략 방향: {selectedStrategicDirectionLabel}
                </p>
              )}
            </div>
            {loading.includes('새 후보') && !(state.conceptCandidates?.length) && (
              <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-4 text-sm font-bold text-blue-800">
                이전 콘셉트 후보를 비우고 새 /api/concepts 응답을 기다리는 중입니다.
              </div>
            )}
            {state.conceptGenerationResult?.namingGuardNotice && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
                {state.conceptGenerationResult.namingGuardNotice.message}
              </div>
            )}
            <ProposalNarrativePanel narrative={state.proposalNarrative} />
            <ConceptDevelopmentLogicPanel logic={state.conceptDevelopmentLogic} />
            <EntityDifferentiationMatrixPanel matrix={state.conceptGenerationResult?.entityDifferentiationMatrix ?? state.proposalNarrative?.entityDifferentiationMatrix} matrixType={state.conceptGenerationResult?.matrixType} primaryRfpConceptType={state.conceptGenerationResult?.primaryRfpConceptType || state.analysis.primaryRfpConceptType} />
            <BrandExperienceMatrixPanel matrix={state.conceptGenerationResult?.brandExperienceMatrix} matrixType={state.conceptGenerationResult?.matrixType} />
            <ConceptRecommendationPanel recommendation={state.conceptRecommendation} />
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {visibleStrategicDirections.map((concept, index) => {
                const selected = typeof state.selectedDirectionIndex === 'number' ? state.selectedDirectionIndex === index : selectedStrategicDirectionId === getStrategicDirectionId(concept);
                return (
                  <article key={`direction-card-${index}`} className={`flex flex-col rounded-3xl border p-5 ${selected ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100' : 'border-slate-200 bg-white'}`}>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{concept.conceptId}</p>
                    <h3 className="mt-2 text-2xl font-black leading-tight text-slate-950">{getStrategicDirectionLabel(concept)}</h3>
                    <div className="mt-4 grid gap-3 text-sm font-bold leading-6 text-slate-700">
                      <p><b className="text-slate-950">어떻게 설득하는가</b> {getStrategicBet(concept)}</p>
                      <p><b className="text-indigo-700">선택 기준</b> {userFacingDirectionCopy(concept.whenToChooseThisDirection || '', '이 전략 관점이 심사자의 선택 이유를 가장 선명하게 만들 때 선택합니다.')}</p>
                      <p><b className="text-blue-700">대표 설득 장면</b> {userFacingDirectionCopy(getSignatureProofSummary(concept))}</p>
                      <p><b className="text-rose-700">주요 리스크</b> {shortText(concept.mainRisk || concept.risks?.[0] || concept.riskOrCaution, 130) || '-'}</p>
                    </div>
                    <div className="mt-4 flex-1 space-y-2">
                      <CompactAccordion title="상세 보기">
                        <p>{concept.whatThisDirectionEmphasizes || concept.coreMessage || concept.strategicApproach || getConceptTagline(concept)}</p>
                        {conceptKeywordChips(concept).length > 0 && <div className="mt-2 flex flex-wrap gap-2">{conceptKeywordChips(concept).map((keyword) => <span key={keyword} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{keyword}</span>)}</div>}
                      </CompactAccordion>
                      <CompactAccordion title="근거 보기">
                        <p><b>핵심 판단</b> {concept.winningThesisUse?.winningClaim || concept.coreMessage || concept.strategicApproach}</p>
                        <p className="mt-2"><b>전환 포인트</b> {concept.conceptLeap?.conceptLeap || concept.conceptLeap?.corePromise || getConceptDefinition(concept)}</p>
                        <p className="mt-2"><b>설득 과제</b> {concept.winningThesisUse?.whatMustBeProven || concept.signatureProofIdea?.whyThisProvesTheConcept}</p>
                        <p className="mt-2"><b>필수 설득 요소</b> {concept.requiredProofElementsAddressed?.join(' · ') || '-'}</p>
                      </CompactAccordion>
                      <CompactAccordion title="개발 정보 보기">
                        <p>primaryRfpConceptType: {concept.rfpConceptType || 'unknown'} · secondaryRfpConceptTypes: {concept.secondaryRfpConceptTypes?.join(' / ') || 'none'} · matrixType: {state.conceptGenerationResult?.matrixType || 'none'}</p>
                        <p className="mt-2">directionSource: {concept.directionSource?.rfpEvidence || '현재 RFP 근거'} · validationStatus: {concept.strategicDirectionQualityValidation?.validationReason || 'none'}</p>
                        <p className="mt-2">debug: {concept.directionDebug?.source || 'none'} · sanitizer/debug logs are hidden from the main card.</p>
                      </CompactAccordion>
                    </div>
                    <button
                      onClick={() => selectConcept(concept, index)}
                      className={`mt-5 rounded-2xl px-4 py-3 font-bold transition ${selected ? 'bg-blue-600 text-white' : 'bg-slate-950 text-white hover:bg-blue-700'}`}
                    >
                      {selected ? '이 방향 선택됨' : '이 방향 선택'}
                    </button>
                    {selected && state.selectedConcept && (
                      <div className="mt-5 rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm font-bold text-blue-900">
                        <p>선택된 방향입니다. 아래 ‘최종 컨셉명 후보’ 섹션에서 컨셉명을 생성하고 비교하세요.</p>
                        <button type="button" onClick={() => runConceptNames()} disabled={Boolean(loading) || !selectedStrategicDirectionExists} className="mt-3 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50">{finalNamingLoading ? '컨셉명 후보 생성 중' : '컨셉명 생성하기'}</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {selectedStrategicDirectionExists && state.selectedConcept && (
              <section key={activeNamingContextKey || 'no-active-direction'} className="mt-8 rounded-[2rem] border border-indigo-100 bg-white p-5 shadow-sm md:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-indigo-700">Final naming step</p>
                    <h3 className="mt-2 text-2xl font-black text-slate-950">최종 컨셉명 후보</h3>
                    <p className="mt-2 text-sm font-bold leading-6 text-indigo-900">선택한 전략 방향을 바탕으로 생성된 컨셉명 후보입니다.</p>
                    <p className="mt-3 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-bold leading-6 text-indigo-950">선택한 전략 방향: <b>{selectedStrategicDirectionLabel}</b><br />{getStrategicBet(selectedStrategicDirection!)}<br /><span className="text-blue-800">대표 설득 장면: {getSignatureProofSummary(selectedStrategicDirection!)}</span></p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <PrimaryButton onClick={() => runConceptNames()} disabled={Boolean(loading) || !selectedStrategicDirectionExists}>{finalNamingLoading ? '컨셉명 후보 생성 중' : (directionConceptNameOptions.length ? '컨셉명 다시 생성' : '컨셉명 생성')}</PrimaryButton>
                    {finalNamingError && <button type="button" onClick={() => runConceptNames()} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">다시 시도</button>}
                  </div>
                </div>
                {finalNamingError && (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                    <p>{finalNamingError}</p>
                    {(finalNamingDebug.responseStatus || finalNamingDebug.responseErrorMessage) && (
                      <p className="mt-1 text-xs font-bold text-red-500">{finalNamingDebug.responseStatus ? `status ${finalNamingDebug.responseStatus}` : '네트워크 오류'}{finalNamingDebug.responseErrorMessage ? ` · 원인: ${shortText(finalNamingDebug.responseErrorMessage, 180)}` : ''}</p>
                    )}
                  </div>
                )}
                <details className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-black text-indigo-900"><summary className="cursor-pointer">개발 정보 보기</summary><p className="mt-2">selectedStrategicDirectionExists: {String(selectedStrategicDirectionExists)} · selectedStrategicDirectionLabel: {selectedStrategicDirectionLabel} · finalNamingLoading: {String(finalNamingLoading)} · finalNameOptionsCount: {finalNameOptionsCount} · finalConceptNameSelected: {String(finalConceptNameSelected)} · finalConceptName: {state.selectedConcept.finalConceptName || 'none'} · finalNamingError: {finalNamingError || 'none'} · responseStatus: {finalNamingDebug.responseStatus || 'none'} · responseErrorMessage: {finalNamingDebug.responseErrorMessage || 'none'} · selectedDirectionIndex: {state.selectedDirectionIndex ?? 'none'} · selectedDirectionKey: {finalNamingDebug.selectedDirectionKey || selectedDirectionKey || 'none'} · indexScopedCandidates: {String(typeof state.selectedDirectionIndex === 'number')} · activeNamingContextKey: {activeNamingContextKey || 'none'} · candidatesMatchCurrentDirection: {String(directionConceptNameOptions.every((option) => option.directionKey === selectedDirectionKey && option.projectKey === currentProjectKey))} · otherDirectionBuckets: {Object.keys(state.conceptNameOptionsByDirection ?? {}).filter((key) => key !== selectedDirectionKey).length} · missingFields: {finalNamingDebug.missingFields?.join(', ') || 'none'}</p></details>
                {directionConceptNameOptions.length ? (
                  <>
                  <div className="mt-5 grid gap-4 xl:grid-cols-3">
                    {directionConceptNameOptions.map((option) => {
                      const optionSelected = state.selectedFinalConceptNameOption?.id ? state.selectedFinalConceptNameOption.id === option.id : state.selectedConcept?.finalConceptName === option.conceptName;
                      return (
                        <article key={option.id || option.conceptName} className={`rounded-3xl border p-5 text-left transition ${optionSelected ? 'border-indigo-500 bg-indigo-50 shadow-lg shadow-indigo-100' : 'border-indigo-100 bg-white hover:border-indigo-300'}`}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <h5 className="text-xl font-black leading-snug text-slate-950">{option.conceptName}</h5>
                            <span className="w-fit rounded-full bg-indigo-100 px-2 py-1 text-[11px] font-black text-indigo-700">{option.languageMode}</span>
                          </div>
                          {option.koreanSubtitle && <p className="mt-1 text-sm font-black leading-6 text-slate-500">{option.koreanSubtitle}</p>}
                          <p className="mt-2 text-sm font-bold leading-6 text-indigo-700">{option.oneLineSlogan}</p>
                          <div className="mt-3 space-y-3 text-sm font-semibold leading-6 text-slate-700">
                            <p><b className="text-slate-950">의미</b> {option.shortMeaning}</p>
                            <p><b className="text-indigo-700">선택 방향 적합성</b> {option.whyItFitsRfp || option.whyItFits}</p>
                            <p><b className="text-rose-700">주요 리스크</b> {option.mainRisk || option.risk}</p>
                            <CompactAccordion title="점수 보기">
                              <p>Cover {option.coverReadinessScore ?? option.coverTitleScore} · Memory {option.memorabilityScore} · RFP {option.specificityScore ?? option.rfpSpecificityScore} · Expand {option.expandabilityScore}</p>
                              <p className="mt-2">Style: {option.namingStyle}</p>
                            </CompactAccordion>
                            {option.expandableTo && (
                              <CompactAccordion title="확장 가능성 보기">
                                <p><b>공간</b> {option.expandableTo.space}</p>
                                <p className="mt-2"><b>콘텐츠</b> {option.expandableTo.content}</p>
                                <p className="mt-2"><b>미디어</b> {option.expandableTo.media}</p>
                                <p className="mt-2"><b>운영</b> {option.expandableTo.operation}</p>
                              </CompactAccordion>
                            )}
                            <CompactAccordion title="근거 보기">
                              {option.strategicClaim && <p><b>전략적 주장</b> {option.strategicClaim}</p>}
                              <p className="mt-2">상세 rationale: {option.whyItFitsRfp || option.whyItFits}</p>
                              <p className="mt-2">개발 리스크: {option.risk}</p>
                              {(option.validation || option.koreanConceptSeed) && <CompactAccordion title="개발 정보 보기"><p>{option.koreanConceptSeed ? `internal Korean concept seed: ${option.koreanConceptSeed}` : ''}</p>{option.validation && <p className="mt-1">{Object.entries(option.validation).filter(([, value]) => value).map(([key]) => key).join(' · ')}</p>}</CompactAccordion>}
                            </CompactAccordion>
                          </div>
                          <button type="button" onClick={() => selectConceptNameOption(option)} className={`mt-4 inline-flex rounded-xl px-4 py-2 text-sm font-black ${optionSelected ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-white'}`}>{optionSelected ? '선택됨' : '이 이름 선택'}</button>
                        </article>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => runConceptNames({ append: true })} disabled={Boolean(loading) || !selectedStrategicDirectionExists} className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50">추가 컨셉 보기</button>
                  </>
                ) : <p className="mt-5 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50 px-4 py-5 text-sm font-bold text-indigo-900">{selectedStrategicDirectionExists ? '선택한 전략 방향에 맞는 컨셉명을 다시 생성해 주세요.' : '컨셉명을 생성하면 후보 카드가 이 영역에 표시됩니다.'}</p>}
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-black text-slate-800">최종 컨셉명 수동 편집
                    <input value={state.selectedConcept.finalConceptName ?? ''} onChange={(event) => updateFinalConceptField('finalConceptName', event.target.value)} placeholder="최종 컨셉명을 입력하거나 후보를 선택하세요" className="mt-2 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-bold text-slate-900 outline-none focus:border-indigo-500" />
                  </label>
                  <label className="block text-sm font-black text-slate-800">최종 컨셉 슬로건 수동 편집
                    <input value={state.selectedConcept.finalConceptSlogan ?? ''} onChange={(event) => updateFinalConceptField('finalConceptSlogan', event.target.value)} placeholder="한 줄 슬로건을 입력하세요" className="mt-2 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 font-bold text-slate-900 outline-none focus:border-indigo-500" />
                  </label>
                </div>
              </section>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('analysis')}>분석 결과 보기</SecondaryButton>
              <SecondaryButton onClick={() => runConcepts()} disabled={Boolean(loading)}>{loading.includes('새 후보') ? '새 후보 생성 중' : '콘셉트 다시 생성'}</SecondaryButton>
              <PrimaryButton onClick={runOutline} disabled={Boolean(loading) || !canGenerateProposalStructure}>제안서 구조 생성</PrimaryButton>
              {selectedStrategicDirectionExists && !finalConceptNameSelected && <p className="w-full text-sm font-bold text-slate-500">최종 컨셉명을 선택하면 제안서 구조를 생성할 수 있습니다.</p>}
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
                        {['Problem', 'Insight', 'Strategy', 'Concept', 'Experience', 'Content', 'Proof', 'Impact'].map((purpose) => <option key={purpose} value={purpose}>{purpose === 'Proof' ? '설득/근거' : purpose}</option>)}
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
              <PrimaryButton onClick={() => downloadPptx(state.input, state.slides || [], state.selectedConcept, state.designGuide)}>PPTX 다운로드</PrimaryButton>
            </div>
          </SectionCard>
        )}
      </div>
    </main>
  );
}
