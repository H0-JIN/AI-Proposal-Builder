import type { SlideContent, SlideOutline } from '@/lib/types';

const internalConceptComparisonPattern = /concept candidates|concept candidates comparison|콘셉트 후보|컨셉 후보|3개 콘셉트|3안 비교|콘셉트.*비교표|컨셉.*비교표|선택되지 않은 콘셉트|내부 평가|평가 점수표|why not others/i;
const forbiddenFinalPptxPattern = /선택된 콘셉트|콘셉트 후보|콘셉트 도출 과정|후보 비교|추천 콘셉트|확정되지 않은 수치는 목표 KPI로 쓰지 않고 확인 필요 항목과 측정 체계로 분리합니다\.?|RFP에 명확히 targetKPI로 확정된 정량 목표는 현재 확인되지 않았습니다\.?|기존 성과와 레슨런드는 목표 KPI가 아니라 실행 기준을 보정하는 배경 인사이트로만 활용합니다\.?|\bC\s?[123]\b/gi;

const internalFieldLabelMap: Record<string, string> = {
  corechallenge: 'Challenge',
  targetinsight: 'Insight',
  brandorproductvalue: 'Opportunity',
  experienceopportunity: 'Opportunity',
  strategicapproach: 'Approach',
  conceptnecessity: 'Approach',
  conceptnamekr: 'Concept Name',
  conceptnameen: 'Concept Name',
  onelinedefinition: 'Concept Statement',
  coremessage: 'Core Message',
  experiencelogic: 'Experience Logic',
  roleinproposal: 'Why This Concept',
  selectedconceptreason: 'Why This Concept',
  keyexperienceassetdirection: 'Experience Structure',
  targetrelevance: 'Why This Concept',
  spatialapplication: 'Spatial Zone',
  mediainteractionpotential: 'Media / Signage',
  viralpotential: 'Photo / Viral Spot',
  whythisworks: 'Why This Concept',
  visitoraction: 'Visitor Action',
  contentmechanism: 'Mechanism',
  spatialplacement: 'Placement',
  mediaorobject: 'Media / Object',
  outputorreward: 'Output / Reward',
  visitormission: 'Mission',
  systemresponse: 'System Response',
  snssharepoint: 'SNS Share Point',
  assettype: 'Experience Asset',
};
const internalFieldLabelPattern = /\b(winningStrategyBrief|proposalThesis|coreChallenge|targetInsight|brandOrProductValue|experienceOpportunity|strategicApproach|conceptNecessity|conceptNameKR|conceptNameEN|oneLineDefinition|coreMessage|experienceLogic|roleInProposal|selectedConceptReason|keyExperienceAssetDirection|targetRelevance|spatialApplication|mediaInteractionPotential|viralPotential|whyThisWorks|visitorAction|contentMechanism|spatialPlacement|mediaOrObject|outputOrReward|visitorMission|systemResponse|snsSharePoint|assetType)\s*:\s*/gi;
const assetTypeListPattern = /^(?:Output\s*\/\s*Share|Output\s*\/\s*Reward)?\s*:?\s*(?:Spatial Zone|Interactive Experience|Media Content|Photo\s*\/\s*Viral Spot|Product Trial Kit|Exhibition Object|Digital Signage|Operation Program|Brand Experience Module|Monument|Briefing Space|Immersive Room|Hands-on Demo|Visitor Participation Content)(?:\s*,\s*(?:Spatial Zone|Interactive Experience|Media Content|Photo\s*\/\s*Viral Spot|Product Trial Kit|Exhibition Object|Digital Signage|Operation Program|Brand Experience Module|Monument|Briefing Space|Immersive Room|Hands-on Demo|Visitor Participation Content)){1,}\.?$/i;
const outputShareFallback = 'Output / Share: 체험 결과를 셀피 콘텐츠, 개인화 메시지, SNS 공유 이미지로 전환해 방문 경험이 온라인 버즈로 확장되도록 설계합니다.';


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

  const normalizedValue = value.trim();
  if (assetTypeListPattern.test(normalizedValue)) return outputShareFallback;

  return value
    .replace(internalFieldLabelPattern, (match, fieldName: string) => {
      const displayName = internalFieldLabelMap[fieldName.toLowerCase()];
      return displayName ? `${displayName}: ` : '';
    })
    .replace(/선택된 콘셉트/g, '핵심 콘셉트')
    .replace(/콘셉트 후보/g, '콘셉트')
    .replace(/콘셉트 도출 과정/g, '경험 설계 접근')
    .replace(/후보 비교/g, '전략 검토')
    .replace(/추천 콘셉트/g, '핵심 콘셉트')
    .replace(/확정되지 않은 수치는 목표 KPI로 쓰지 않고 확인 필요 항목과 측정 체계로 분리합니다\.?/g, 'RFP에 별도 정량 KPI가 없는 경우, 운영 품질을 측정할 수 있는 관리 지표를 제안합니다.')
    .replace(/RFP에 명확히 targetKPI로 확정된 정량 목표는 현재 확인되지 않았습니다\.?/g, 'RFP에 별도 정량 KPI가 없는 경우, 운영 품질을 측정할 수 있는 관리 지표를 제안합니다.')
    .replace(/기존 성과와 레슨런드는 목표 KPI가 아니라 실행 기준을 보정하는 배경 인사이트로만 활용합니다\.?/g, '운영 성과는 등록 처리 속도, 세션 운영 안정성, 참석자 만족도, 네트워킹 참여도, 현장 이슈 대응률을 중심으로 측정합니다.')
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
