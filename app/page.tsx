'use client';

import { useEffect, useMemo, useState } from 'react';
import pptxgen from 'pptxgenjs';
import type { AnalysisResult, ProjectInput, ProposalState, ProposalType, SlideContent, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';

type Step = 'home' | 'create' | 'analysis' | 'outline' | 'slides';

const STORAGE_KEY = 'ai-proposal-builder-state';

const initialInput: ProjectInput = {
  proposalType: 'basic',
  projectName: '',
  clientName: '',
  briefText: '',
};

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

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50">
      {children}
    </button>
  );
}

function KeyValueList({ data }: { data: AnalysisResult }) {
  const rows = [
    ['프로젝트 개요', data.projectOverview],
    ['클라이언트 과제', data.clientChallenge],
    ['타깃 정보', data.targetInfo],
    ['공간 조건', data.spatialCondition],
    ['콘텐츠 조건', data.contentCondition],
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
    </div>
  );
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
    slide.addText(slideData.title, { x: 0.55, y: 0.7, w: 5.8, h: 0.55, fontSize: 24, bold: true, color: '111827', breakLine: false });
    slide.addText(slideData.subtitle, { x: 0.58, y: 1.28, w: 5.8, h: 0.45, fontSize: 12, color: '475569' });
    slide.addShape(pptx.ShapeType.rect, { x: 6.75, y: 0.72, w: 5.9, h: 3.6, fill: { color: 'E5E7EB' }, line: { color: 'CBD5E1', transparency: 20 } });
    slide.addText(slideData.imagePlaceholder, { x: 7.05, y: 2.0, w: 5.3, h: 0.7, align: 'center', valign: 'middle', fontSize: 14, color: '64748B', bold: true });
    slide.addText(slideData.bodyBullets.map((bullet) => `• ${bullet}`).join('\n'), { x: 0.75, y: 2.05, w: 5.55, h: 2.7, fontSize: 14, color: '111827', breakLine: false, fit: 'shrink', valign: 'top' });
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 5.25, w: 11.95, h: 0.82, rectRadius: 0.08, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE' } });
    slide.addText(`Diagram: ${slideData.diagramSuggestion}`, { x: 0.95, y: 5.47, w: 11.45, h: 0.35, fontSize: 11, color: '1D4ED8', fit: 'shrink' });
    slide.addText(`${input.clientName} · ${proposalTypeLabels[input.proposalType]}`, { x: 0.55, y: 6.95, w: 5, h: 0.2, fontSize: 8, color: '94A3B8' });
  });

  await pptx.writeFile({ fileName: `${safeFileName(input.projectName)}_proposal.pptx` });
}

export default function Home() {
  const [step, setStep] = useState<Step>('home');
  const [state, setState] = useState<ProposalState>({ input: initialInput });
  const [loading, setLoading] = useState<string>('');
  const [error, setError] = useState<string>('');

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

  const canAnalyze = useMemo(() => state.input.projectName && state.input.clientName && state.input.briefText, [state.input]);

  const updateInput = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => {
    setState((current) => ({ ...current, input: { ...current.input, [key]: value } }));
  };

  const runAnalyze = async () => {
    setError('');
    setLoading('RFP/브리프 분석 중...');
    try {
      const analysis = await postJson<AnalysisResult>('/api/analyze', state.input);
      setState((current) => ({ ...current, analysis, outline: undefined, slides: undefined }));
      setStep('analysis');
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading('');
    }
  };

  const runOutline = async () => {
    if (!state.analysis) return;
    setError('');
    setLoading('제안서 구조 생성 중...');
    try {
      const outline = await postJson<SlideOutline[]>('/api/outline', { input: state.input, analysis: state.analysis });
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
      const slides = await postJson<SlideContent[]>('/api/slides', { input: state.input, analysis: state.analysis, outline: state.outline });
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
    setState({ input: initialInput });
    setStep('create');
    setError('');
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
            <p className="mt-5 max-w-2xl text-lg text-blue-50">제안서 유형을 선택하고 RFP를 붙여넣으면 AI가 분석, 목차, 장표 문안, 시각화 지시문을 단계별로 생성합니다.</p>
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
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">RFP / 프로젝트 브리프</span>
                <textarea value={state.input.briefText} onChange={(event) => updateInput('briefText', event.target.value)} className="min-h-72 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder={sampleBrief} />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton onClick={runAnalyze} disabled={!canAnalyze || Boolean(loading)}>AI로 분석하기</PrimaryButton>
              <SecondaryButton onClick={() => updateInput('briefText', sampleBrief)}>샘플 브리프 채우기</SecondaryButton>
            </div>
          </SectionCard>
        )}

        {step === 'analysis' && state.analysis && (
          <SectionCard title="AI 분석 결과">
            <KeyValueList data={state.analysis} />
            <div className="mt-6 flex gap-3">
              <SecondaryButton onClick={() => setStep('create')}>입력 수정</SecondaryButton>
              <PrimaryButton onClick={runOutline} disabled={Boolean(loading)}>제안서 구조 생성</PrimaryButton>
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
                  <h3 className="mt-2 text-xl font-black text-slate-950">{slide.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{slide.subtitle}</p>
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {slide.bodyBullets.map((bullet, index) => <li key={`${bullet}-${index}`}>{bullet}</li>)}
                  </ul>
                  <div className="mt-4 rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">이미지: {slide.imagePlaceholder}</div>
                  <div className="mt-2 rounded-2xl bg-blue-50 p-3 text-sm text-blue-700">다이어그램: {slide.diagramSuggestion}</div>
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
