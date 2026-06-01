'use client';

import { useEffect, useMemo, useState } from 'react';
import pptxgen from 'pptxgenjs';
import type { AnalysisResult, ExtractionStatus, ProjectInput, ProposalState, ProposalType, SlideContent, SlideOutline, SupplementalInfo, UploadedDocument } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { assessInputQuality } from '@/lib/inputQuality';
import {
  OCR_UNSUPPORTED_MESSAGE,
  PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE,
  TEXT_EXTRACTION_FAILED_MESSAGE,
  validateExtractedText,
} from '@/lib/extractedTextValidation';

type Step = 'home' | 'create' | 'analysis' | 'outline' | 'slides';

type UploadNotice = {
  type: 'success' | 'warning' | 'error';
  message: string;
};

type ExtractTextResponse = {
  text?: string;
  status?: 'success' | 'partial';
  message?: string;
  warning?: string;
  error?: string;
  ocrNotice?: string;
};

const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const clientReadableExtensions = ['txt', 'md'];
const serverReadableExtensions = ['pdf', 'docx'];

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

const sampleBrief = `현대 모빌리티 브랜드의 신규 전기차 라인업을 소개하는 4주간의 브랜드 체험관을 제안해 주세요.
목표는 2030 고객에게 지속가능한 라이프스타일과 기술 혁신 이미지를 전달하는 것입니다.
서울 성수동 150평 내외 팝업 공간을 가정하며, 시승 예약, 인터랙티브 미디어월, 굿즈 존, SNS 공유 이벤트가 필요합니다.
예산은 중간 규모이며, 오픈 전 6주 내 기획/디자인/시공/운영 준비가 완료되어야 합니다.`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
  }

  return data as T;
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
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : 'border-emerald-200 bg-emerald-50 text-emerald-950';

  return (
    <div className={`rounded-3xl border p-5 ${tone}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-black">입력 정보 충분도: {levelLabels[quality.level]}</p>
          <h3 className="mt-2 text-xl font-black">{quality.isInsufficient ? '추가 정보 입력 권장' : '입력 정보 품질 양호'}</h3>
          <p className="mt-2 text-sm leading-6">{quality.guidance}</p>
        </div>
        <div className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-semibold shadow-sm">
          브리프 {quality.briefLength.toLocaleString()}자 · 확인된 정보 {quality.presentItems.length}/9
        </div>
      </div>

      {quality.aiMissingInfo.length > 0 && (
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


function UploadedDocumentsList({ documents }: { documents: UploadedDocument[] }) {
  const statusTone: Record<ExtractionStatus, string> = {
    '텍스트 추출 완료': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    '일부 텍스트만 추출': 'bg-amber-50 text-amber-800 ring-amber-200',
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
        <span className="col-span-5">파일명</span>
        <span className="col-span-2">형식</span>
        <span className="col-span-3">추출 상태</span>
        <span className="col-span-2 text-right">글자 수</span>
      </div>
      <div className="divide-y divide-slate-100">
        {documents.map((document, index) => (
          <div key={`${document.fileName}-${index}`} className="grid grid-cols-12 gap-3 px-4 py-4 text-sm text-slate-700">
            <div className="col-span-12 font-bold text-slate-950 md:col-span-5">{document.fileName}</div>
            <div className="col-span-3 md:col-span-2">{document.fileType}</div>
            <div className="col-span-6 md:col-span-3">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusTone[document.extractionStatus]}`}>
                {document.extractionStatus}
              </span>
              {document.warningMessage && <p className="mt-2 text-xs leading-5 text-slate-500">{document.warningMessage}</p>}
            </div>
            <div className="col-span-3 text-right font-semibold tabular-nums md:col-span-2">
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

function KeyValueList({ data }: { data: AnalysisResult }) {
  const rows = [
    ['프로젝트 개요', data.projectOverview],
    ['클라이언트 과제', data.clientChallenge],
    ['타깃 정보', data.targetInfo],
    ['공간 조건', data.spatialCondition],
    ['콘텐츠 조건', data.contentCondition],
    ['운영 조건', data.operationCondition],
  ];

  return (
    <div className="space-y-4">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-blue-700">{label}</p>
          <p className="mt-1 text-slate-800">{value}</p>
        </div>
      ))}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['필수 항목', data.requiredItems],
          ['제약 조건', data.constraints],
          ['KPI/일정/제약', data.kpiScheduleConstraints],
          ['추가 확인 필요', data.missingInfo],
        ].map(([label, items]) => (
          <div key={label as string} className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-blue-700">{label as string}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {(items as string[]).map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <AnalysisSectionPanel title="RFP 요구사항 / 제안 방향 / 확인 Note" section={data.rfpRequirements} />
      <AnalysisSectionPanel title="클라이언트 과제" section={data.clientTask} />
      <AnalysisSectionPanel title="타깃·공간·콘텐츠·운영 조건" section={data.targetSpaceContentOperation} />
      <AnalysisSectionPanel title="KPI·일정·제약 조건" section={data.kpiTimelineConstraints} />
    </div>
  );
}


function hasAnalysisConfirmationNeeds(analysis?: AnalysisResult) {
  if (!analysis) return false;

  const valuesToCheck = [
    analysis.projectOverview,
    analysis.clientChallenge,
    analysis.targetInfo,
    analysis.spatialCondition,
    analysis.contentCondition,
    ...analysis.requiredItems,
    ...analysis.constraints,
    ...(analysis.kpiScheduleConstraints ?? []),
    ...analysis.missingInfo,
  ];

  return analysis.missingInfo.length > 0 || valuesToCheck.some((value) => value.includes('확인 필요'));
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

function getSuccessfulUploadedDocuments(documents: UploadedDocument[] = []) {
  return documents.filter((document) =>
    (document.extractionStatus === '텍스트 추출 완료' || document.extractionStatus === '일부 텍스트만 추출') &&
    document.extractedText.trim(),
  );
}

function buildAnalysisBriefText(input: ProjectInput, documents: UploadedDocument[] = []) {
  const documentBlocks = getSuccessfulUploadedDocuments(documents).map((document, index) =>
    `[업로드 자료 ${index + 1}: ${document.fileName}]\n${document.extractedText.trim()}`,
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
    outline: undefined,
    slides: undefined,
  });
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'proposal';
}

async function downloadPptx(input: ProjectInput, slides: SlideContent[]) {
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

  slides.forEach((slideData) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: '2563EB' }, line: { color: '2563EB' } });
    slide.addText(String(slideData.slideNumber).padStart(2, '0'), { x: 0.55, y: 0.35, w: 0.7, h: 0.3, fontSize: 11, color: '2563EB', bold: true });
    slide.addText(slideData.slideTitle, { x: 0.55, y: 0.7, w: 5.8, h: 0.55, fontSize: 24, bold: true, color: '111827', breakLine: false });
    slide.addText(slideData.keyMessage, { x: 0.58, y: 1.28, w: 5.8, h: 0.45, fontSize: 12, color: '475569' });
    slide.addShape(pptx.ShapeType.rect, { x: 6.75, y: 0.72, w: 5.9, h: 3.6, fill: { color: 'E5E7EB' }, line: { color: 'CBD5E1', transparency: 20 } });
    slide.addText(slideData.imagePlaceholder, { x: 7.05, y: 2.0, w: 5.3, h: 0.7, align: 'center', valign: 'middle', fontSize: 14, color: '64748B', bold: true });
    const detailLines = [
      `Visitor Action: ${slideData.visitorAction ?? '해당 없음'}`,
      `Mechanism: ${slideData.contentMechanism ?? '해당 없음'}`,
      `Placement: ${slideData.spatialPlacement ?? '해당 없음'}`,
      `Media/Object: ${slideData.mediaOrObject ?? '해당 없음'}`,
      `Output/Reward: ${slideData.outputOrReward ?? '해당 없음'}`,
    ];
    slide.addText(slideData.bodyBullets.map((bullet) => `• ${bullet}`).join('\n'), { x: 0.75, y: 1.9, w: 5.55, h: 2.0, fontSize: 13, color: '111827', breakLine: false, fit: 'shrink', valign: 'top' });
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.72, y: 4.05, w: 5.8, h: 1.0, rectRadius: 0.08, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } });
    slide.addText(detailLines.join('\n'), { x: 0.95, y: 4.17, w: 5.35, h: 0.75, fontSize: 7.8, color: '334155', fit: 'shrink', valign: 'top' });
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 5.15, w: 11.95, h: 1.05, rectRadius: 0.08, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE' } });
    slide.addText(`Visual: ${slideData.visualDirection}`, { x: 0.95, y: 5.27, w: 5.65, h: 0.24, fontSize: 8.5, color: '1D4ED8', fit: 'shrink' });
    slide.addText(`Prompt: ${slideData.visualPrompt ?? slideData.imagePlaceholder}`, { x: 6.75, y: 5.27, w: 5.65, h: 0.24, fontSize: 8.5, color: '1D4ED8', fit: 'shrink' });
    slide.addText(`Diagram: ${slideData.diagramSuggestion}`, { x: 0.95, y: 5.65, w: 11.45, h: 0.28, fontSize: 8.5, color: '1D4ED8', fit: 'shrink' });
    slide.addText(`${input.clientName} · ${proposalTypeLabels[input.proposalType]}`, { x: 0.55, y: 6.95, w: 5, h: 0.2, fontSize: 8, color: '94A3B8' });
  });

  await pptx.writeFile({ fileName: `${safeFileName(input.projectName)}_proposal.pptx` });
}

export default function Home() {
  const [step, setStep] = useState<Step>('home');
  const [state, setState] = useState<ProposalState>({ input: initialInput, supplementalInfo: initialSupplementalInfo, uploadedDocuments: [] });
  const [loading, setLoading] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ProposalState;
        setState(parsed);
        if (parsed.slides?.length) setStep('slides');
        else if (parsed.outline?.length) setStep('outline');
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
  const analysisInput = useMemo(() => ({ ...state.input, briefText: buildAnalysisBriefText(state.input, uploadedDocuments) }), [state.input, uploadedDocuments]);
  const canAnalyze = useMemo(() => Boolean(state.input.projectName && state.input.clientName && analysisInput.briefText), [state.input.clientName, state.input.projectName, analysisInput.briefText]);
  const inputQuality = useMemo(() => assessInputQuality(analysisInput, step === 'analysis' ? state.analysis : undefined), [analysisInput, state.analysis, step]);
  const hasConfirmationNeeds = useMemo(() => hasAnalysisConfirmationNeeds(state.analysis), [state.analysis]);
  const shouldShowShortBriefGuidance = analysisInput.briefText.trim().length > 0 && analysisInput.briefText.trim().length < 220;

  const updateInput = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => {
    setState((current) => ({ ...current, input: { ...current.input, [key]: value }, analysis: undefined, outline: undefined, slides: undefined }));
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

  const createUploadedDocument = (
    file: File,
    extractionStatus: ExtractionStatus,
    extractedText = '',
    warningMessage?: string,
  ): UploadedDocument => ({
    fileName: file.name,
    fileType: getFileTypeLabel(file.name),
    extractionStatus,
    extractedText,
    extractedCharCount: extractedText.length,
    warningMessage,
  });

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
      setUploadNotice({ type: 'error', message: '지원하지 않는 파일 형식입니다. PDF, DOCX, TXT, MD 파일을 업로드해주세요.' });
      return;
    }

    setLoading('파일 텍스트 추출 중...');

    try {
      if (clientReadableExtensions.includes(extension)) {
        const validation = validateExtractedText(await file.text());
        if (!validation.ok) {
          const status: ExtractionStatus = validation.reason === 'short' ? '이미지 중심 문서 / OCR 필요' : '추출 실패';
          addUploadedDocument(
            createUploadedDocument(file, status, '', validation.message),
            validation.reason === 'short' ? 'warning' : 'error',
            validation.message,
          );
          return;
        }

        addUploadedDocument(
          createUploadedDocument(file, '텍스트 추출 완료', validation.text),
          'success',
          '파일에서 텍스트를 추출했습니다. 추출 원문은 화면에 표시하지 않고 AI 분석 입력에만 사용합니다.',
        );
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/extract-text', { method: 'POST', body: formData });
      const data = (await response.json()) as ExtractTextResponse;

      if (!response.ok || !data.text) {
        const message = [data.warning || data.error || TEXT_EXTRACTION_FAILED_MESSAGE, data.ocrNotice]
          .filter(Boolean)
          .join(' ');
        const status: ExtractionStatus = data.warning ? '이미지 중심 문서 / OCR 필요' : '추출 실패';
        addUploadedDocument(createUploadedDocument(file, status, '', message), data.warning ? 'warning' : 'error', message);
        return;
      }

      const validation = validateExtractedText(data.text);
      if (!validation.ok) {
        const message = [validation.message, extension === 'pdf' ? OCR_UNSUPPORTED_MESSAGE : undefined]
          .filter(Boolean)
          .join(' ');
        const status: ExtractionStatus = validation.reason === 'short' ? '이미지 중심 문서 / OCR 필요' : '추출 실패';
        addUploadedDocument(createUploadedDocument(file, status, '', message), validation.reason === 'short' ? 'warning' : 'error', message);
        return;
      }

      const status: ExtractionStatus = data.status === 'partial' ? '일부 텍스트만 추출' : '텍스트 추출 완료';
      const serverMessage = [data.message ?? (extension === 'pdf' ? PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE : undefined), data.ocrNotice]
        .filter(Boolean)
        .join(' ');
      addUploadedDocument(
        createUploadedDocument(file, status, validation.text, data.status === 'partial' ? serverMessage : undefined),
        data.status === 'partial' ? 'warning' : 'success',
        serverMessage || '파일에서 텍스트를 추출했습니다. 추출 원문은 화면에 표시하지 않고 AI 분석 입력에만 사용합니다.',
      );
    } catch {
      addUploadedDocument(createUploadedDocument(file, '추출 실패', '', TEXT_EXTRACTION_FAILED_MESSAGE), 'error', TEXT_EXTRACTION_FAILED_MESSAGE);
    } finally {
      setLoading('');
    }
  };

  const runAnalyze = async () => {
    setError('');
    setLoading('RFP/브리프 분석 중...');
    try {
      const analysis = await postJson<AnalysisResult>('/api/analyze', analysisInput);
      setState((current) => ({ ...current, analysis, outline: undefined, slides: undefined }));
      setStep('analysis');
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
      const analysis = await postJson<AnalysisResult>('/api/analyze', mergedInput);
      setState((current) => ({ ...current, analysis, outline: undefined, slides: undefined }));
      setStep('analysis');
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가 정보 반영 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const runOutline = async () => {
    if (!state.analysis) return;
    setError('');
    setLoading('제안서 구조 생성 중...');
    try {
      const outline = await postJson<SlideOutline[]>('/api/outline', { input: analysisInput, analysis: state.analysis });
      setState((current) => ({ ...current, outline, slides: undefined }));
      setStep('outline');
    } catch (err) {
      setError(err instanceof Error ? err.message : '구조 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const runSlides = async () => {
    if (!state.analysis || !state.outline) return;
    setError('');
    setLoading('장표별 문안 생성 중...');
    try {
      const slides = await postJson<SlideContent[]>('/api/slides', { input: analysisInput, analysis: state.analysis, outline: state.outline });
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
    setState({ input: initialInput, supplementalInfo: initialSupplementalInfo, uploadedDocuments: [] });
    setStep('create');
    setError('');
    setUploadNotice(null);
  };

  return (
    <main className="min-h-screen px-5 py-8 md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.35em] text-blue-600">MVP</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">AI Proposal Builder</h1>
            <p className="mt-3 max-w-2xl text-slate-600">RFP/프로젝트 브리프를 분석해 전시·브랜드 체험관 제안서 구조와 장표별 문안을 만들고 PPTX로 다운로드합니다.</p>
          </div>
          {step !== 'home' && <SecondaryButton onClick={reset}>새 제안서 만들기</SecondaryButton>}
        </header>

        {error && <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 font-medium text-red-700">{error}</div>}
        {loading && <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 font-medium text-blue-700">{loading}</div>}

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
                    <p className="mt-2 text-sm font-semibold text-slate-700">지원 형식: PDF, DOCX, TXT, MD</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">업로드된 파일은 텍스트 추출에만 사용되며 원본 파일은 저장하지 않습니다.</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-bold text-blue-700 shadow-sm ring-1 ring-blue-200 transition hover:bg-blue-50">
                    파일 선택
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                      onChange={handleBriefFileUpload}
                      disabled={Boolean(loading)}
                      className="sr-only"
                    />
                  </label>
                </div>
                <UploadedDocumentsList documents={uploadedDocuments} />
                {uploadNotice && (
                  <div
                    className={`mt-4 rounded-2xl border p-4 text-sm font-semibold leading-6 ${
                      uploadNotice.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : uploadNotice.type === 'warning'
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {uploadNotice.message}
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
            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton onClick={runAnalyze} disabled={!canAnalyze || Boolean(loading)}>업로드 자료와 메모로 AI 분석하기</PrimaryButton>
              <SecondaryButton onClick={() => updateInput('briefText', sampleBrief)}>샘플 메모 채우기</SecondaryButton>
            </div>
          </SectionCard>
        )}

        {step === 'analysis' && state.analysis && (
          <SectionCard title="AI 분석 결과">
            <div className="space-y-5">
              <InputQualityPanel quality={inputQuality} />
              <KeyValueList data={state.analysis} />
            </div>
            {hasConfirmationNeeds && (
              <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5">
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
                    확인 필요 {state.analysis.missingInfo.length}건
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
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('create')}>입력 수정</SecondaryButton>
              {hasConfirmationNeeds ? (
                <>
                  <PrimaryButton onClick={rerunAnalyzeWithSupplementalInfo} disabled={Boolean(loading)}>추가 정보 반영하기</PrimaryButton>
                  <SecondaryButton onClick={runOutline} disabled={Boolean(loading)}>정보 부족하지만 계속 생성하기</SecondaryButton>
                </>
              ) : (
                <PrimaryButton onClick={runOutline} disabled={Boolean(loading)}>제안서 구조 생성</PrimaryButton>
              )}
            </div>
          </SectionCard>
        )}

        {step === 'outline' && state.outline && (
          <SectionCard title="제안서 구조 생성 결과">
            <div className="space-y-3">
              {state.outline.map((slide) => (
                <article key={slide.slideNumber} className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-bold text-blue-600">SLIDE {String(slide.slideNumber).padStart(2, '0')}</p>
                  <h3 className="mt-1 text-lg font-bold text-slate-950">{slide.slideTitle}</h3>
                  <p className="mt-1 text-sm text-slate-600">목적: {slide.slidePurpose}</p>
                  <p className="mt-2 font-medium text-slate-800">{slide.keyMessage}</p>
                  {slide.confirmNeededNote && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Note: {slide.confirmNeededNote}</p>}
                </article>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <SecondaryButton onClick={() => setStep('analysis')}>분석 결과 보기</SecondaryButton>
              <PrimaryButton onClick={runSlides} disabled={Boolean(loading)}>장표별 문안 생성</PrimaryButton>
            </div>
          </SectionCard>
        )}

        {step === 'slides' && state.slides && (
          <SectionCard title="장표별 문안 생성 결과">
            <div className="grid gap-4 md:grid-cols-2">
              {state.slides.map((slide) => (
                <article key={slide.slideNumber} className="rounded-3xl border border-slate-200 p-5">
                  <p className="text-xs font-bold text-blue-600">SLIDE {String(slide.slideNumber).padStart(2, '0')}</p>
                  <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{slide.slideType}</div>
                  <h3 className="mt-2 text-xl font-black text-slate-950">{slide.slideTitle}</h3>
                  <p className="mt-1 text-sm font-semibold text-blue-700">{slide.keyMessage}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{slide.mainCopy}</p>
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {slide.bodyBullets.map((bullet, index) => <li key={`${bullet}-${index}`}>{bullet}</li>)}
                  </ul>
                  <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Visitor Action</span><br />{slide.visitorAction}</div>
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Content Mechanism</span><br />{slide.contentMechanism}</div>
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Spatial Placement</span><br />{slide.spatialPlacement}</div>
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><span className="font-bold">Media / Object</span><br />{slide.mediaOrObject}</div>
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-600 md:col-span-2"><span className="font-bold">Output / Reward</span><br />{slide.outputOrReward}</div>
                  </div>
                  <div className="mt-4 rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">비주얼 방향: {slide.visualDirection}</div>
                  <div className="mt-2 rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">이미지: {slide.imagePlaceholder}</div>
                  <div className="mt-2 rounded-2xl bg-purple-50 p-3 text-sm text-purple-700">Visual Prompt: {slide.visualPrompt}</div>
                  <div className="mt-2 rounded-2xl bg-blue-50 p-3 text-sm text-blue-700">다이어그램: {slide.diagramSuggestion}</div>
                  <div className="mt-2 rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-700">발표 노트: {slide.speakerNote}</div>
                  {slide.confirmNeededNote && <div className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">확인 Note: {slide.confirmNeededNote}</div>}
                </article>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <SecondaryButton onClick={() => setStep('outline')}>구조 보기</SecondaryButton>
              <PrimaryButton onClick={() => downloadPptx(state.input, state.slides || [])}>PPTX 다운로드</PrimaryButton>
            </div>
          </SectionCard>
        )}
      </div>
    </main>
  );
}
