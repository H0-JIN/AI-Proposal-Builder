import type { SlideContent, SlideOutline } from '@/lib/types';

const internalConceptComparisonPattern = /concept candidates|concept candidates comparison|콘셉트 후보|컨셉 후보|3개 콘셉트|3안 비교|콘셉트.*비교표|컨셉.*비교표|선택되지 않은 콘셉트|내부 평가|평가 점수표|why not others/i;
const forbiddenFinalPptxPattern = /선택된 콘셉트|콘셉트 후보|콘셉트 도출 과정|후보 비교|추천 콘셉트|\bC\s?[123]\b/gi;
const internalFieldLabelPattern = /\b(?:coreChallenge|targetInsight|brandOrProductValue|experienceOpportunity|strategicApproach|conceptNecessity|conceptNameKR|conceptNameEN|oneLineDefinition|roleInProposal)\s*:\s*/gi;

export function isInternalConceptComparisonSlide(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>) {
  return internalConceptComparisonPattern.test([
    slide.slideType,
    slide.slideTitle,
    slide.slidePurpose,
    slide.keyMessage,
  ].join(' '));
}

export function removeInternalConceptComparisonSlides<T extends SlideOutline | SlideContent>(slides: T[]) {
  return slides
    .filter((slide) => !isInternalConceptComparisonSlide(slide))
    .map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function sanitizeFinalPptxText(value?: string) {
  if (!value) return '';

  return value
    .replace(internalFieldLabelPattern, '')
    .replace(/선택된 콘셉트/g, '핵심 콘셉트')
    .replace(/콘셉트 후보/g, '콘셉트')
    .replace(/콘셉트 도출 과정/g, '경험 설계 접근')
    .replace(/후보 비교/g, '전략 검토')
    .replace(/추천 콘셉트/g, '핵심 콘셉트')
    .replace(/\bC\s?[123]\b/g, 'Concept')
    .replace(forbiddenFinalPptxPattern, '핵심 콘셉트')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeStringArray(values?: string[]) {
  return values?.map((value) => sanitizeFinalPptxText(value)).filter(Boolean) ?? [];
}

export function sanitizeFinalPptxSlides(slides: SlideContent[]) {
  return slides.map((slide, index) => ({
    ...slide,
    slideNumber: index + 1,
    slideType: sanitizeFinalPptxText(slide.slideType),
    slideTitle: sanitizeFinalPptxText(slide.slideTitle),
    slidePurpose: sanitizeFinalPptxText(slide.slidePurpose),
    keyMessage: sanitizeFinalPptxText(slide.keyMessage),
    mainCopy: sanitizeFinalPptxText(slide.mainCopy),
    bodyBullets: sanitizeStringArray(slide.bodyBullets),
    visualDirection: sanitizeFinalPptxText(slide.visualDirection),
    visitorAction: sanitizeFinalPptxText(slide.visitorAction),
    contentMechanism: sanitizeFinalPptxText(slide.contentMechanism),
    spatialPlacement: sanitizeFinalPptxText(slide.spatialPlacement),
    mediaOrObject: sanitizeFinalPptxText(slide.mediaOrObject),
    outputOrReward: sanitizeFinalPptxText(slide.outputOrReward),
    imagePlaceholder: sanitizeFinalPptxText(slide.imagePlaceholder),
    visualPrompt: sanitizeFinalPptxText(slide.visualPrompt),
    diagramSuggestion: sanitizeFinalPptxText(slide.diagramSuggestion),
    speakerNote: sanitizeFinalPptxText(slide.speakerNote),
    confirmNeededNote: sanitizeFinalPptxText(slide.confirmNeededNote),
    productExperienceDetails: slide.productExperienceDetails?.map((detail) => ({
      ...detail,
      productCode: sanitizeFinalPptxText(detail.productCode),
      productRole: sanitizeFinalPptxText(detail.productRole),
      coreValue: sanitizeFinalPptxText(detail.coreValue),
      experienceTitle: sanitizeFinalPptxText(detail.experienceTitle),
      oneLineExperience: sanitizeFinalPptxText(detail.oneLineExperience),
      visitorMission: sanitizeFinalPptxText(detail.visitorMission),
      visitorAction: sanitizeFinalPptxText(detail.visitorAction),
      systemResponse: sanitizeFinalPptxText(detail.systemResponse),
      mediaOrObject: sanitizeFinalPptxText(detail.mediaOrObject),
      spatialPlacement: sanitizeFinalPptxText(detail.spatialPlacement),
      outputOrReward: sanitizeFinalPptxText(detail.outputOrReward),
      snsSharePoint: sanitizeFinalPptxText(detail.snsSharePoint),
      visualDirection: sanitizeFinalPptxText(detail.visualDirection),
      imagePlaceholder: sanitizeFinalPptxText(detail.imagePlaceholder),
      diagramSuggestion: sanitizeFinalPptxText(detail.diagramSuggestion),
    })) ?? [],
    keyExperienceAssets: slide.keyExperienceAssets?.map((asset) => ({
      ...asset,
      assetName: sanitizeFinalPptxText(asset.assetName),
      assetType: sanitizeFinalPptxText(asset.assetType),
      roleInProposal: sanitizeFinalPptxText(asset.roleInProposal),
      visitorAction: sanitizeFinalPptxText(asset.visitorAction),
      experienceMechanism: sanitizeFinalPptxText(asset.experienceMechanism),
      spatialPlacement: sanitizeFinalPptxText(asset.spatialPlacement),
      mediaOrObject: sanitizeFinalPptxText(asset.mediaOrObject),
      outputOrReward: sanitizeFinalPptxText(asset.outputOrReward),
      whyItMatters: sanitizeFinalPptxText(asset.whyItMatters),
      visualDirection: sanitizeFinalPptxText(asset.visualDirection),
    })) ?? [],
    experienceScenarioSteps: slide.experienceScenarioSteps?.map((step) => ({
      ...step,
      visitorAction: sanitizeFinalPptxText(step.visitorAction),
      systemResponse: sanitizeFinalPptxText(step.systemResponse),
      mediaOrObject: sanitizeFinalPptxText(step.mediaOrObject),
      output: sanitizeFinalPptxText(step.output),
      designNote: sanitizeFinalPptxText(step.designNote),
    })) ?? [],
    referenceInsights: slide.referenceInsights?.map((reference) => ({
      ...reference,
      referenceName: sanitizeFinalPptxText(reference.referenceName),
      referenceType: sanitizeFinalPptxText(reference.referenceType),
      whatToLearn: sanitizeFinalPptxText(reference.whatToLearn),
      howToApply: sanitizeFinalPptxText(reference.howToApply),
      caution: sanitizeFinalPptxText(reference.caution),
    })) ?? [],
  }));
}
