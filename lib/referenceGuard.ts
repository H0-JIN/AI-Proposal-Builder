import type { AnalysisResult, ConceptDevelopmentLogic, ReferenceInsight, SlideContent, SlideOutline } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';

const referenceContextPattern = /참고|예시|사례|레퍼런스|벤치마크|reference|lesson\s*learned|기존|별첨|등/i;
const referenceSlidePattern = /reference|benchmark|case\s*study|design\s*reference|reference\s*insight|레퍼런스|참고\s*사례|벤치마크|사례\s*분석|디자인\s*참고|참고\s*방향/i;
const blockedUnrelatedReferenceTerms = ['FF7', 'MDW', 'SFF', 'SAFE', 'Samsung Foundry', 'Galaxy', 'teamLab', 'Delight'];

function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactReferenceTerms(analysis: AnalysisResult) {
  return Array.from(new Set([
    ...(analysis.referenceOnly ?? []),
    ...(analysis.doNotTreatAsScope ?? []),
    ...(analysis.existingAssets ?? []),
    ...(analysis.taskSections ?? []).flatMap((section) => section.referenceMentions ?? []),
  ]
    .map(normalizeText)
    .filter((item) => item.length >= 2)))
    .slice(0, 80);
}

function currentEvidenceItems(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const analysisItems = [
    analysis.projectOverview,
    analysis.clientChallenge,
    ...(analysis.requiredDeliverables ?? []),
    ...(analysis.scopeOfWork ?? []),
    ...(analysis.requiredItems ?? []),
    ...(analysis.requiredScope ?? []),
    ...(analysis.referenceOnly ?? []),
    ...(analysis.existingAssets ?? []),
    ...(analysis.doNotTreatAsScope ?? []),
    ...(analysis.productInfo ?? []),
    ...(analysis.constraints ?? []),
    analysis.spatialCondition,
    analysis.contentCondition,
    analysis.operationCondition,
    ...(analysis.taskSections ?? []).flatMap((section) => [section.taskTitle, ...section.requiredDeliverables, ...section.keyRequirements, ...section.referenceMentions, ...section.existingAssets, ...section.constraints]),
  ];
  const chunkItems = chunks.map((chunk) => [chunk.documentName, chunk.sectionTitle, chunk.chunkText, chunk.visualSummary].filter(Boolean).join(' '));
  return [...analysisItems, ...chunkItems].map(normalizeText).filter(Boolean);
}

function currentEvidenceText(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  return currentEvidenceItems(analysis, chunks).join('\n');
}

function termInEvidence(term: string, evidenceText: string) {
  const normalized = normalizeText(term);
  if (!normalized) return false;
  return new RegExp(escapeRegExp(normalized), 'i').test(evidenceText);
}

function isReferenceTerm(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return terms.some((term) => {
    const escaped = escapeRegExp(term);
    return new RegExp(escaped, 'i').test(normalized) || normalized.includes(term);
  });
}

function findSourceEvidence(term: string, analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return '';
  return currentEvidenceItems(analysis, chunks).find((item) => termInEvidence(normalizedTerm, item)) ?? '';
}

function hasCurrentReferenceEvidence(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const evidence = currentEvidenceText(analysis, chunks);
  return compactReferenceTerms(analysis).some((term) => termInEvidence(term, evidence));
}

function blockedTermsNotInEvidence(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const evidence = currentEvidenceText(analysis, chunks);
  return blockedUnrelatedReferenceTerms.filter((term) => !termInEvidence(term, evidence));
}

function asReferenceInsightTitle(slide: SlideOutline | SlideContent, sourceEvidence = '') {
  return {
    ...slide,
    slideType: 'Reference Insight',
    slideTitle: referenceContextPattern.test(slide.slideTitle) ? slide.slideTitle : `${slide.slideTitle} 참고 방향`,
    slidePurpose: '참고 사례를 신규 과업이나 체험 모듈로 오해하지 않도록 현재 프로젝트 근거 기반 벤치마크 인사이트와 적용 원칙만 정리한다.',
    keyMessage: normalizeText(slide.keyMessage) || '레퍼런스는 실행 범위가 아니라 콘셉트와 공간·콘텐츠 설계의 참고 원칙으로만 활용합니다.',
    mainCopy: '본 장표는 현재 업로드된 RFP/제안 자료에 명시된 참고 사례의 학습 포인트를 정리하고, 신규 제작 범위나 제품 체험 단위로 확장하지 않는 적용 원칙을 명확히 합니다.',
    sourceEvidence,
    referenceAllowed: Boolean(sourceEvidence),
  };
}

function slideHasExperienceDetailIntent(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>) {
  return /product\s*experience|experience\s*detail|체험\s*(상세|개요|시나리오|모듈)|콘텐츠\s*(상세|개요|시나리오|모듈)|모듈|hero\s*content|sub\s*content/i.test([
    slide.slideType,
    slide.slideTitle,
    slide.slidePurpose,
    slide.keyMessage,
  ].join(' '));
}

function isReferenceSlide(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>) {
  return referenceSlidePattern.test([slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage].join(' '));
}

function slideMentionsBlockedUnrelatedReference(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage' | 'mainCopy'>, blockedTerms: string[]) {
  const text = [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage, slide.mainCopy].join(' ');
  return isReferenceTerm(text, blockedTerms);
}

export function buildReferenceGuardInstruction(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const terms = compactReferenceTerms(analysis).slice(0, 20);
  const allowedTerms = terms.filter((term) => termInEvidence(term, currentEvidenceText(analysis, chunks)));
  const blockedTerms = blockedTermsNotInEvidence(analysis, chunks);
  const referenceList = allowedTerms.length ? allowedTerms.join(' / ') : '현재 업로드된 RFP/제안 자료에서 명시적으로 확인된 레퍼런스 없음';

  return [
    `Reference Guard: only these current-project reference terms are allowed: ${referenceList}.`,
    'Generate Reference slides only if the current uploaded RFP/proposal evidence explicitly contains reference material. Do not use previous projects, other RFPs, old test documents, generated memory, unrelated uploaded files, example prompts, or internal sample data.',
    `Blocked unless present in current evidence: ${blockedUnrelatedReferenceTerms.join(' / ')}${blockedTerms.length ? `. Currently blocked: ${blockedTerms.join(' / ')}` : ''}.`,
    'If no current-project reference evidence exists, remove Reference slides, do not invent reference names, do not create Reference Insight slides, and use a project-grounded proof slide only when needed.',
    'Every reference slide must carry sourceEvidence with exact current-project evidence and referenceAllowed true. If referenceAllowed is false, remove the slide before final output.',
    'Reference Guard 항목을 requiredDeliverables, requiredScope, productInfo, Product Experience Detail, 신규 체험 모듈, Hero/Sub Content의 핵심 산출물, KPI 또는 운영 범위로 승격하지 말라.',
  ].join('\n');
}

export function applyReferenceGuardToOutline(slides: SlideOutline[], analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const terms = compactReferenceTerms(analysis);
  const evidenceText = currentEvidenceText(analysis, chunks);
  const allowedTerms = terms.filter((term) => termInEvidence(term, evidenceText));
  const blockedTerms = blockedTermsNotInEvidence(analysis, chunks);
  const hasReferenceEvidence = hasCurrentReferenceEvidence(analysis, chunks);

  return slides
    .filter((slide) => !slideMentionsBlockedUnrelatedReference(slide, blockedTerms))
    .filter((slide) => hasReferenceEvidence || !isReferenceSlide(slide))
    .map((slide) => {
      const matchedAllowedTerm = allowedTerms.find((term) => isReferenceTerm(slide.slideTitle, [term]) || isReferenceTerm(slide.keyMessage, [term]));
      if (!slideHasExperienceDetailIntent(slide) || !matchedAllowedTerm) return slide;
      return asReferenceInsightTitle(slide, findSourceEvidence(matchedAllowedTerm, analysis, chunks)) as SlideOutline;
    })
    .map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

function guardReferenceInsights(insights: ReferenceInsight[] = [], analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  return insights
    .map((insight) => {
      const sourceEvidence = findSourceEvidence(insight.referenceName, analysis, chunks);
      return {
        ...insight,
        sourceEvidence,
        referenceAllowed: Boolean(sourceEvidence),
      };
    })
    .filter((insight) => insight.referenceAllowed);
}

export function applyReferenceGuardToSlides(slides: SlideContent[], analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const terms = compactReferenceTerms(analysis);
  const evidenceText = currentEvidenceText(analysis, chunks);
  const allowedTerms = terms.filter((term) => termInEvidence(term, evidenceText));
  const blockedTerms = blockedTermsNotInEvidence(analysis, chunks);
  const hasReferenceEvidence = hasCurrentReferenceEvidence(analysis, chunks);

  return slides
    .filter((slide) => !slideMentionsBlockedUnrelatedReference(slide, blockedTerms))
    .filter((slide) => hasReferenceEvidence || !isReferenceSlide(slide))
    .map((slide) => {
      const guardedInsights = guardReferenceInsights(slide.referenceInsights, analysis, chunks);
      const matchedAllowedTerm = allowedTerms.find((term) => isReferenceTerm(slide.slideTitle, [term]) || isReferenceTerm(slide.keyMessage, [term]));

      if (!slideHasExperienceDetailIntent(slide) || !matchedAllowedTerm) {
        return { ...slide, referenceInsights: guardedInsights };
      }

      const sourceEvidence = findSourceEvidence(matchedAllowedTerm, analysis, chunks);
      const guarded = asReferenceInsightTitle(slide, sourceEvidence) as SlideContent & { sourceEvidence?: string; referenceAllowed?: boolean };
      if (!guarded.referenceAllowed) return { ...slide, referenceInsights: guardedInsights };
      return {
        ...guarded,
        productExperienceDetails: [],
        keyExperienceAssets: slide.keyExperienceAssets ?? [],
        referenceInsights: guardedInsights.length ? guardedInsights : [{
          referenceName: matchedAllowedTerm,
          referenceType: '현재 RFP 명시 참고 사례 / 기존 자산',
          whatToLearn: '현재 프로젝트 자료에 언급된 레퍼런스의 강점과 시각적·경험적 원칙을 학습합니다.',
          howToApply: '신규 과업 범위가 아니라 콘셉트 톤, 공간 연출 방향, 콘텐츠 완성도 기준에만 반영합니다.',
          caution: '참고 사례명을 신규 체험 모듈명, 제품 단위, 필수 제작 범위로 사용하지 않습니다.',
          sourceEvidence,
          referenceAllowed: true,
        }],
      };
    })
    .map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function strategicMessageFieldsFromLogic(logic?: ConceptDevelopmentLogic) {
  return [
    logic?.winningStrategyBrief ? `Winning Strategy Brief: ${logic.winningStrategyBrief}` : '',
    logic?.proposalThesis ? `Proposal Thesis: ${logic.proposalThesis}` : '',
    logic?.experienceLogic ? `Experience Logic: ${logic.experienceLogic}` : '',
    logic?.clientIntent ? `Client Intent: ${logic.clientIntent}` : '',
    logic?.audienceTakeaway ? `Audience Takeaway: ${logic.audienceTakeaway}` : '',
    logic?.strategicTension ? `Strategic Tension: ${logic.strategicTension}` : '',
    logic?.conceptSeed ? `Concept Seed: ${logic.conceptSeed}` : '',
  ].filter(Boolean).join('\n');
}
