import type { AnalysisResult, ConceptDevelopmentLogic, ProjectInput, ReferenceInsight, SlideContent, SlideOutline } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';

const referenceContextPattern = /참고|예시|사례|레퍼런스|벤치마크|reference|lesson\s*learned|기존|별첨|등/i;
const referenceSlidePattern = /reference|benchmark|case\s*study|design\s*reference|reference\s*insight|레퍼런스|참고\s*사례|참고\s*방향\s*및\s*레퍼런스\s*인사이트|참고\s*방향|벤치마크|사례\s*분석|디자인\s*참고/i;
const caseInsightTitlePattern = /case\s*insight|benchmark\s*insight|experience\s*case\s*insight|유사\s*사례\s*인사이트|컨셉\s*도출을\s*위한\s*사례\s*인사이트|콘셉트\s*도출을\s*위한\s*사례\s*인사이트|사례\s*인사이트/i;
const forbiddenReferenceTitlePattern = /참고\s*방향\s*및\s*레퍼런스\s*인사이트|reference\s*insight|레퍼런스\s*모음|참고\s*사례\s*정리/i;
const conceptSupportPattern = /concept|rationale|thesis|strategy|strategic|opportunity|principle|implication|current\s*project|콘셉트|컨셉|전략|기회|명제|원칙|적용|도출|필연|제안/i;
const blockedUnrelatedReferenceTerms = ['FF7', 'MDW', 'SFF', 'SAFE', 'Samsung Foundry', 'Galaxy', 'teamLab', 'Delight'];
const explicitReferenceSlideRequestPattern = /(?:reference|benchmark|case\s*study|레퍼런스|참고\s*사례|벤치마크|사례\s*분석|디자인\s*참고)\s*(?:slide|page|deck|장표|페이지)|(?:slide|page|deck|장표|페이지)\s*(?:reference|benchmark|case\s*study|레퍼런스|참고\s*사례|벤치마크|사례\s*분석|디자인\s*참고)|레퍼런스\s*인사이트|reference\s*insight/i;

type ReferenceGuardOptions = {
  allowReferenceSlides?: boolean;
};

function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function normalizeEvidenceList(value?: string | string[]) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function hasSourceEvidence(value?: string | string[]) {
  return normalizeEvidenceList(value).length > 0;
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

export function isReferenceSlideExplicitlyRequested(input?: ProjectInput) {
  return explicitReferenceSlideRequestPattern.test([input?.briefText, input?.projectName, input?.clientName].filter(Boolean).join(' '));
}

function blockedTermsNotInEvidence(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const evidence = currentEvidenceText(analysis, chunks);
  return blockedUnrelatedReferenceTerms.filter((term) => !termInEvidence(term, evidence));
}

function normalizeCaseInsightTitle(title: string) {
  if (!title || forbiddenReferenceTitlePattern.test(title) || /reference|레퍼런스/i.test(title)) return 'Case Insight';
  if (caseInsightTitlePattern.test(title)) return title;
  return title;
}

function stripInvalidReferenceNames(text: string | undefined, blockedTerms: string[]) {
  if (!text) return text ?? '';
  return blockedTerms.reduce((current, term) => current.replace(new RegExp(escapeRegExp(term), 'gi'), '유사 사례'), text);
}

function asCaseInsightSlide<T extends SlideOutline | SlideContent>(slide: T, blockedTerms: string[] = []): T {
  const insightSummary = stripInvalidReferenceNames(slide.keyMessage, blockedTerms) || '유사 사례의 공통 원칙을 현재 프로젝트의 콘셉트 전략으로 번역합니다.';
  const implicationForCurrentProject = stripInvalidReferenceNames(slide.mainCopy, blockedTerms) || '현재 RFP의 관람객 이해 장벽과 브랜드 메시지를 연결하는 경험 원칙으로 적용합니다.';
  return {
    ...slide,
    slideType: 'Case Insight',
    slideTitle: stripInvalidReferenceNames(normalizeCaseInsightTitle(slide.slideTitle), blockedTerms),
    slidePurpose: 'Insight',
    slideRole: stripInvalidReferenceNames(slide.slideRole, blockedTerms) || `insightSummary: ${insightSummary}`,
    relationToThesis: stripInvalidReferenceNames(slide.relationToThesis, blockedTerms) || `relationToThesis: 유사 사례에서 확인한 경험 원칙이 제안 명제와 선택 콘셉트를 뒷받침한다.`,
    whyThisSlideExists: stripInvalidReferenceNames(slide.whyThisSlideExists, blockedTerms) || `whyThisSlideExists: Concept Rationale 전에 사례에서 얻은 전략 원칙을 설명해 콘셉트 선택의 필연성을 강화한다.`,
    keyMessage: insightSummary,
    mainCopy: `insightSummary: ${insightSummary}
implicationForCurrentProject: ${implicationForCurrentProject}
connectionToConcept: 이 원칙을 선택 콘셉트의 경험 구조와 핵심 장면으로 연결한다.`,
    sourceEvidence: normalizeEvidenceList(slide.sourceEvidence),
    referenceAllowed: normalizeEvidenceList(slide.sourceEvidence).length > 0,
  };
}

function asReferenceInsightTitle(slide: SlideOutline | SlideContent, sourceEvidence = '') {
  return {
    ...slide,
    slideType: 'Reference Insight',
    slideTitle: referenceContextPattern.test(slide.slideTitle) ? slide.slideTitle : `${slide.slideTitle} 참고 방향`,
    slidePurpose: '참고 사례를 신규 과업이나 체험 모듈로 오해하지 않도록 현재 프로젝트 근거 기반 벤치마크 인사이트와 적용 원칙만 정리한다.',
    keyMessage: normalizeText(slide.keyMessage) || '레퍼런스는 실행 범위가 아니라 콘셉트와 공간·콘텐츠 설계의 참고 원칙으로만 활용합니다.',
    mainCopy: '본 장표는 현재 업로드된 RFP/제안 자료에 명시된 참고 사례의 학습 포인트를 정리하고, 신규 제작 범위나 제품 체험 단위로 확장하지 않는 적용 원칙을 명확히 합니다.',
    sourceEvidence: normalizeEvidenceList(sourceEvidence),
    referenceAllowed: hasSourceEvidence(sourceEvidence),
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

function isCaseInsightSlide(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage' | 'mainCopy'>) {
  const text = [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage, slide.mainCopy].join(' ');
  return caseInsightTitlePattern.test(text) || (slide.slidePurpose === 'Insight' && /case|benchmark|사례|벤치마크/i.test(text) && conceptSupportPattern.test(text));
}

function isReferenceSlide(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage' | 'mainCopy'>) {
  const text = [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage, slide.mainCopy].join(' ');
  return referenceSlidePattern.test(text) && !isCaseInsightSlide(slide);
}

function slideMentionsBlockedUnrelatedReference(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage' | 'mainCopy'>, blockedTerms: string[]) {
  const text = [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage, slide.mainCopy].join(' ');
  return isReferenceTerm(text, blockedTerms);
}

function sanitizeCaseInsightReferences<T extends SlideOutline | SlideContent>(slide: T, analysis: AnalysisResult, chunks: DocumentChunk[], blockedTerms: string[]): T {
  if (!isCaseInsightSlide(slide)) return slide;
  const text = [slide.slideTitle, slide.keyMessage, slide.mainCopy, slide.slideRole, slide.relationToThesis, slide.whyThisSlideExists].filter(Boolean).join(' ');
  const invalidNames = blockedTerms.filter((term) => isReferenceTerm(text, [term]));
  return asCaseInsightSlide(slide, invalidNames.length ? invalidNames : blockedTerms.filter((term) => !findSourceEvidence(term, analysis, chunks)));
}

export function buildReferenceGuardInstruction(analysis: AnalysisResult, chunks: DocumentChunk[] = []) {
  const terms = compactReferenceTerms(analysis).slice(0, 20);
  const allowedTerms = terms.filter((term) => termInEvidence(term, currentEvidenceText(analysis, chunks)));
  const blockedTerms = blockedTermsNotInEvidence(analysis, chunks);
  const referenceList = allowedTerms.length ? allowedTerms.join(' / ') : '현재 업로드된 RFP/제안 자료에서 명시적으로 확인된 레퍼런스 없음';

  return [
    `Reference Guard: only these current-project reference terms are allowed for named references: ${referenceList}.`,
    'Separate Reference Slide from Case Insight Slide. Reference Slides list or summarize projects/images/examples as standalone references and must not be generated by default.',
    'Case Insight Slides are allowed only before Concept Rationale/Concept when they strengthen concept rationale by explaining what similar cases show, the strategic lesson, how it applies to the current RFP, and how it leads to the selected concept.',
    'Case Insight Slides must use titles such as Case Insight, 유사 사례 인사이트, Benchmark Insight, 컨셉 도출을 위한 사례 인사이트, or Experience Case Insight. Avoid Reference Insight, 참고 방향 및 레퍼런스 인사이트, 레퍼런스 모음, 참고 사례 정리.',
    'For Case Insight, do not create a gallery or numbered reference list. Use abstract strategic principles when no current-project evidence validates a case name.',
    'Every Case Insight slide must explicitly cover insightSummary, implicationForCurrentProject, connectionToConcept, relationToThesis, and whyThisSlideExists in the slide fields or copy.',
    'Do not generate Reference slides by default. Do not create “참고 방향 및 레퍼런스 인사이트” unless the user explicitly asks for reference slides.',
    'Treat referenceOnly chunks and RFP-provided references as background context only; do not use them as proposal slide content or default proposal pages.',
    'Generate Reference slides only when the user explicitly requests reference slides, or when a proposed content/media mechanism/spatial experience truly needs additional explanation or validation from current-project evidence. Do not use previous projects, other RFPs, old test documents, generated memory, unrelated uploaded files, example prompts, or internal sample data.',
    `Blocked unless present in current evidence: ${blockedUnrelatedReferenceTerms.join(' / ')}${blockedTerms.length ? `. Currently blocked: ${blockedTerms.join(' / ')}` : ''}.`,
    'If no current-project reference evidence exists, remove Reference slides, do not invent reference names, do not create Reference Insight slides. Abstract Case Insight slides remain allowed only when they support concept rationale without naming projects.',
    'Every reference slide must carry sourceEvidence with exact current-project evidence and referenceAllowed true. If referenceAllowed is false, remove the slide before final output.',
    'Every reference slide must answer: which proposed content it explains, what specific mechanism or experience principle is referenced, and how it strengthens the proposal.',
    'Reference Guard 항목을 requiredDeliverables, requiredScope, productInfo, Product Experience Detail, 신규 체험 모듈, Hero/Sub Content의 핵심 산출물, KPI 또는 운영 범위로 승격하지 말라.',
  ].join('\n');
}

export function applyReferenceGuardToOutline(slides: SlideOutline[], analysis: AnalysisResult, chunks: DocumentChunk[] = [], options: ReferenceGuardOptions = {}) {
  const terms = compactReferenceTerms(analysis);
  const evidenceText = currentEvidenceText(analysis, chunks);
  const allowedTerms = terms.filter((term) => termInEvidence(term, evidenceText));
  const blockedTerms = blockedTermsNotInEvidence(analysis, chunks);
  const hasReferenceEvidence = hasCurrentReferenceEvidence(analysis, chunks);
  const allowReferenceSlides = Boolean(options.allowReferenceSlides) && hasReferenceEvidence;

  return slides
    .map((slide) => sanitizeCaseInsightReferences(slide, analysis, chunks, blockedTerms))
    .filter((slide) => !slideMentionsBlockedUnrelatedReference(slide, blockedTerms))
    .filter((slide) => !isReferenceSlide(slide) || (allowReferenceSlides && allowedTerms.some((term) => isReferenceTerm([slide.slideTitle, slide.slidePurpose, slide.keyMessage, slide.mainCopy].join(' '), [term]))))
    .map((slide) => {
      const matchedAllowedTerm = allowedTerms.find((term) => isReferenceTerm(slide.slideTitle, [term]) || isReferenceTerm(slide.keyMessage, [term]));
      if (!allowReferenceSlides || !slideHasExperienceDetailIntent(slide) || !matchedAllowedTerm) return slide;
      return asReferenceInsightTitle(slide, findSourceEvidence(matchedAllowedTerm, analysis, chunks)) as SlideOutline;
    })
    .map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}


function referenceSlideHasCurrentEvidenceAndExplanation(slide: SlideContent) {
  const hasAllowedInsightEvidence = (slide.referenceInsights ?? []).some((reference) => reference.referenceAllowed && normalizeText(reference.sourceEvidence));
  const answersRequiredQuestions = (slide.referenceInsights ?? []).some((reference) =>
    normalizeText(reference.whatToLearn) && normalizeText(reference.howToApply) && normalizeText(reference.caution)
  );
  const explainsProposedMechanism = /content|media|spatial|experience|mechanism|principle|콘텐츠|미디어|공간|체험|메커니즘|원리|원칙|강화|검증/i.test([
    slide.slidePurpose,
    slide.keyMessage,
    slide.mainCopy,
    slide.contentMechanism,
    slide.spatialPlacement,
    slide.mediaOrObject,
  ].join(' '));

  return hasAllowedInsightEvidence && answersRequiredQuestions && explainsProposedMechanism;
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

export function applyReferenceGuardToSlides(slides: SlideContent[], analysis: AnalysisResult, chunks: DocumentChunk[] = [], options: ReferenceGuardOptions = {}) {
  const terms = compactReferenceTerms(analysis);
  const evidenceText = currentEvidenceText(analysis, chunks);
  const allowedTerms = terms.filter((term) => termInEvidence(term, evidenceText));
  const blockedTerms = blockedTermsNotInEvidence(analysis, chunks);
  const hasReferenceEvidence = hasCurrentReferenceEvidence(analysis, chunks);
  const allowReferenceSlides = Boolean(options.allowReferenceSlides) && hasReferenceEvidence;

  return slides
    .map((slide) => sanitizeCaseInsightReferences(slide, analysis, chunks, blockedTerms))
    .filter((slide) => !slideMentionsBlockedUnrelatedReference(slide, blockedTerms))
    .map((slide) => {
      const guardedInsights = guardReferenceInsights(slide.referenceInsights, analysis, chunks);
      const matchedAllowedTerm = allowedTerms.find((term) => isReferenceTerm(slide.slideTitle, [term]) || isReferenceTerm(slide.keyMessage, [term]));

      if (!allowReferenceSlides || !slideHasExperienceDetailIntent(slide) || !matchedAllowedTerm) {
        return { ...slide, referenceInsights: guardedInsights };
      }

      const sourceEvidence = findSourceEvidence(matchedAllowedTerm, analysis, chunks);
      const guarded = asReferenceInsightTitle(slide, sourceEvidence) as SlideContent;
      if (!guarded.referenceAllowed) return { ...slide, referenceInsights: guardedInsights };
      return {
        ...guarded,
        productExperienceDetails: [],
        keyExperienceAssets: slide.keyExperienceAssets ?? [],
        referenceInsights: guardedInsights.length ? guardedInsights : [{
          referenceName: matchedAllowedTerm,
          referenceType: '현재 RFP 명시 참고 사례 / 기존 자산',
          whatToLearn: '현재 프로젝트 자료에 언급된 레퍼런스가 어떤 제안 콘텐츠를 설명하는지와 시각적·경험적 원칙을 학습합니다.',
          howToApply: '신규 과업 범위가 아니라 제안 콘텐츠의 미디어 메커니즘, 공간 연출 원리, 완성도 검증 기준에만 반영해 제안 설득력을 강화합니다.',
          caution: '참고 사례명을 신규 체험 모듈명, 제품 단위, 필수 제작 범위로 사용하지 않습니다.',
          sourceEvidence,
          referenceAllowed: true,
        }],
      };
    })
    .filter((slide) => !isReferenceSlide(slide) || (allowReferenceSlides && referenceSlideHasCurrentEvidenceAndExplanation(slide)) || referenceSlideHasCurrentEvidenceAndExplanation(slide))
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
