import type { AnalysisResult, ConceptDevelopmentLogic, SlideContent, SlideOutline } from '@/lib/types';

const referenceContextPattern = /참고|예시|사례|레퍼런스|벤치마크|reference|lesson\s*learned|기존|별첨|등/i;

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

function isReferenceTerm(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return terms.some((term) => {
    const escaped = escapeRegExp(term);
    return new RegExp(escaped, 'i').test(normalized) || normalized.includes(term);
  });
}

function asReferenceInsightTitle(slide: SlideOutline | SlideContent) {
  return {
    ...slide,
    slideType: 'Reference Insight',
    slideTitle: referenceContextPattern.test(slide.slideTitle) ? slide.slideTitle : `${slide.slideTitle} 참고 방향`,
    slidePurpose: '참고 사례를 신규 과업이나 체험 모듈로 오해하지 않도록 벤치마크 인사이트와 적용 원칙만 정리한다.',
    keyMessage: normalizeText(slide.keyMessage) || '레퍼런스는 실행 범위가 아니라 콘셉트와 공간·콘텐츠 설계의 참고 원칙으로만 활용합니다.',
    mainCopy: '본 장표는 RFP에 언급된 참고 사례의 학습 포인트를 정리하고, 신규 제작 범위나 제품 체험 단위로 확장하지 않는 적용 원칙을 명확히 합니다.',
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

export function buildReferenceGuardInstruction(analysis: AnalysisResult) {
  const terms = compactReferenceTerms(analysis).slice(0, 20);
  const referenceList = terms.length ? terms.join(' / ') : '분석 결과의 referenceOnly, doNotTreatAsScope, existingAssets, taskSections.referenceMentions';

  return [
    `Reference Guard: ${referenceList} 항목은 참고 사례/기존 자산/벤치마크로만 사용한다.`,
    'Reference Guard 항목을 requiredDeliverables, requiredScope, productInfo, Product Experience Detail, 신규 체험 모듈, Hero/Sub Content의 핵심 산출물, KPI 또는 운영 범위로 승격하지 말라.',
    'Reference Guard 항목을 장표로 다룰 때는 Reference Insight, Design Reference Direction, Reference Application Principle처럼 명명하고 whatToLearn/howToApply/caution 관점으로만 정리하라.',
  ].join('\n');
}

export function applyReferenceGuardToOutline(slides: SlideOutline[], analysis: AnalysisResult) {
  const terms = compactReferenceTerms(analysis);
  if (!terms.length) return slides;

  return slides.map((slide) => {
    if (!slideHasExperienceDetailIntent(slide) || !isReferenceTerm(slide.slideTitle, terms)) return slide;
    return asReferenceInsightTitle(slide) as SlideOutline;
  });
}

export function applyReferenceGuardToSlides(slides: SlideContent[], analysis: AnalysisResult) {
  const terms = compactReferenceTerms(analysis);
  if (!terms.length) return slides;

  return slides.map((slide) => {
    if (!slideHasExperienceDetailIntent(slide) || !isReferenceTerm(slide.slideTitle, terms)) return slide;
    const guarded = asReferenceInsightTitle(slide) as SlideContent;
    return {
      ...guarded,
      productExperienceDetails: [],
      keyExperienceAssets: slide.keyExperienceAssets ?? [],
      referenceInsights: slide.referenceInsights?.length ? slide.referenceInsights : [{
        referenceName: slide.slideTitle,
        referenceType: '참고 사례 / 기존 자산',
        whatToLearn: 'RFP에 언급된 레퍼런스의 강점과 시각적·경험적 원칙을 학습합니다.',
        howToApply: '신규 과업 범위가 아니라 콘셉트 톤, 공간 연출 방향, 콘텐츠 완성도 기준에만 반영합니다.',
        caution: '참고 사례명을 신규 체험 모듈명, 제품 단위, 필수 제작 범위로 사용하지 않습니다.',
      }],
    };
  });
}

export function strategicMessageFieldsFromLogic(logic?: ConceptDevelopmentLogic) {
  return [
    logic?.clientIntent ? `Client Intent: ${logic.clientIntent}` : '',
    logic?.audienceTakeaway ? `Audience Takeaway: ${logic.audienceTakeaway}` : '',
    logic?.strategicTension ? `Strategic Tension: ${logic.strategicTension}` : '',
    logic?.conceptSeed ? `Concept Seed: ${logic.conceptSeed}` : '',
  ].filter(Boolean).join('\n');
}
