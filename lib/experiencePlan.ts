import type { AnalysisResult, ConceptCandidate, ConceptDevelopmentLogic, ConceptRecommendation, ProjectInput, SlideOutline } from '@/lib/types';
import { removeInternalConceptComparisonSlides } from '@/lib/internalSlides';
import { isTaskScopeExpression, sanitizeOutlineSlides } from '@/lib/slideSanitizer';
import { getPresentationConceptName } from '@/lib/conceptNamingGuard';

export const experienceDetailFields = [
  'productCode',
  'productRole',
  'coreValue',
  'experienceTitle',
  'oneLineExperience',
  'visitorMission',
  'visitorAction',
  'systemResponse',
  'mediaOrObject',
  'spatialPlacement',
  'outputOrReward',
  'snsSharePoint',
  'visualDirection',
  'imagePlaceholder',
  'diagramSuggestion',
] as const;

export const keyExperienceAssetFields = [
  'assetName',
  'assetType',
  'roleInProposal',
  'visitorAction',
  'experienceMechanism',
  'spatialPlacement',
  'mediaOrObject',
  'outputOrReward',
  'whyItMatters',
  'visualDirection',
] as const;

export const experienceScenarioSteps = ['Entry', 'Select', 'Experience', 'Generate', 'Share', 'Exit'] as const;

const productDetailSlideType = 'Spatial / Content Plan - Product Experience Detail';
const experienceApproachSlideType = 'Experience Approach';
const coreConceptSlideType = 'Core Concept';
const experienceStructureSlideType = 'Experience Structure';
const referenceInsightSlideType = 'Reference Insight';
const eventOperationTypes = new Set(['mice_event_operation', 'conference_forum']);

type ExperiencePlanContext = { input?: ProjectInput; analysis?: AnalysisResult; selectedConcept?: ConceptCandidate; conceptDevelopmentLogic?: ConceptDevelopmentLogic; conceptCandidates?: ConceptCandidate[]; conceptRecommendation?: ConceptRecommendation };

function isEventOperationContext(context?: ExperiencePlanContext) {
  const proposalType = context?.analysis?.inferredProposalType ?? context?.input?.proposalType;
  return Boolean(proposalType && eventOperationTypes.has(proposalType));
}

function appendKoreanTopicParticle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '핵심 콘셉트는';
  const last = trimmed[trimmed.length - 1];
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${trimmed}는`;
  return `${trimmed}${(code - 0xac00) % 28 === 0 ? '는' : '은'}`;
}

const scopeCuePattern = /참고 사례|참고|예시|예:|예를 들어|등|기존|기존 운영|기존 사례|상반기|하반기 lesson learned|lesson learned|사례|벤치마크|레퍼런스|활용 가능|유사 사례|이전 캠페인|보유 재원|기존 집기|기존 공간|기존 콘텐츠/i;

const spatialPlanSlides = [
  {
    slideType: 'Spatial / Content Plan - Spatial Overview',
    slideTitle: 'Spatial Overview',
    slidePurpose: '전체 공간 구조와 콘텐츠 역할을 한 장에서 조망한다.',
    keyMessage: '공간은 단순 동선이 아니라 관람객이 브랜드 메시지를 단계적으로 체감하는 경험 시퀀스로 설계한다.',
  },
  {
    slideType: 'Spatial / Content Plan - Main Experience Image',
    slideTitle: 'Main Experience Image',
    slidePurpose: '대표 체험 장면을 이미지 생성 가능한 수준으로 정의한다.',
    keyMessage: '제안의 핵심 장면을 하나의 Hero Image로 제시해 공간 톤, 스케일, 몰입감을 즉시 이해시키도록 한다.',
  },
  {
    slideType: 'Spatial / Content Plan - Zone Detail 01',
    slideTitle: '핵심 체험 상세 01',
    slidePurpose: '첫 번째 핵심 체험 존의 관람객 행동, 콘텐츠 장치, 산출물을 상세화한다.',
    keyMessage: '핵심 체험 단위별로 공간 배치와 콘텐츠 메커니즘을 분리해 실행 가능한 존 기획으로 전개한다.',
  },
  {
    slideType: 'Spatial / Content Plan - Zone Detail 02',
    slideTitle: '핵심 체험 상세 02',
    slidePurpose: '두 번째 핵심 체험 존의 관람객 행동, 콘텐츠 장치, 산출물을 상세화한다.',
    keyMessage: '후속 체험 존은 앞선 경험의 감정과 데이터를 이어받아 더 깊은 참여 또는 공유 행동으로 연결한다.',
  },
  {
    slideType: 'Spatial / Content Plan - Experience Scenario',
    slideTitle: 'Experience Scenario',
    slidePurpose: 'Entry, Select, Experience, Generate, Share, Exit 단계의 관람객 행동과 시스템 반응을 플로우로 정리한다.',
    keyMessage: '관람객 여정은 진입부터 공유와 퇴장까지 끊기지 않는 행동-반응-보상 구조로 설계한다.',
  },
] as const;

const mediaPlanSlides = [
  {
    slideType: 'Media / Interactive Plan - Media Experience Overview',
    slideTitle: 'Media Experience Overview',
    slidePurpose: '미디어와 인터랙션 요소의 전체 역할과 시스템 구조를 설명한다.',
    keyMessage: '미디어는 배경 장식이 아니라 관람객 행동을 감지하고 반응을 생성하는 경험 엔진으로 작동한다.',
  },
  {
    slideType: 'Media / Interactive Plan - Key Media Scene',
    slideTitle: 'Key Media Scene',
    slidePurpose: '대표 미디어 장면과 이미지 삽입 방향을 제시한다.',
    keyMessage: '핵심 미디어 장면은 공간의 첫인상, 체류 이유, 촬영 욕구를 동시에 만드는 시그니처 씬이 되어야 한다.',
  },
  {
    slideType: 'Media / Interactive Plan - Interactive Flow',
    slideTitle: 'Interactive Flow',
    slidePurpose: '관람객 행동 → 센서/입력 → 미디어 반응 → 결과물 → 공유의 흐름을 구조화한다.',
    keyMessage: '인터랙션은 관람객의 작은 행동이 즉각적인 시스템 반응과 개인화된 결과물로 돌아오는 순환 구조로 설계한다.',
  },
  {
    slideType: 'Media / Interactive Plan - Content Mechanism',
    slideTitle: 'Content Mechanism',
    slidePurpose: '콘텐츠 생성, 변형, 축적, 표출 방식의 작동 원리를 설명한다.',
    keyMessage: '콘텐츠 메커니즘은 브랜드 메시지를 데이터, 비주얼, 사운드, 오브젝트 반응으로 번역하는 규칙이다.',
  },
  {
    slideType: 'Media / Interactive Plan - Output & Share',
    slideTitle: 'Output & Share',
    slidePurpose: '체험 결과물과 공유/확산 구조를 정리한다.',
    keyMessage: '방문객이 가져가고 공유할 수 있는 산출물을 설계해 체험의 기억과 캠페인 확산을 동시에 만든다.',
  },
] as const;

function isSpatialPlan(slide: SlideOutline) {
  const text = `${slide.slideType} ${slide.slideTitle}`.toLowerCase();
  return (text.includes('spatial') || text.includes('공간')) && (text.includes('content') || text.includes('콘텐츠') || text.includes('구성'));
}

function isMediaPlan(slide: SlideOutline) {
  const text = `${slide.slideType} ${slide.slideTitle}`.toLowerCase();
  return text.includes('media') || text.includes('interactive') || text.includes('미디어') || text.includes('인터랙티브') || text.includes('인터랙션');
}

function buildExpandedSlide(base: SlideOutline | undefined, template: (typeof spatialPlanSlides | typeof mediaPlanSlides)[number]): SlideOutline {
  return {
    slideNumber: 0,
    slideType: template.slideType,
    slideTitle: template.slideTitle,
    slidePurpose: template.slidePurpose,
    keyMessage: template.keyMessage,
    mainCopy: base?.mainCopy ?? template.keyMessage,
    confirmNeededNote: base?.confirmNeededNote ?? '',
  };
}

function buildProductDetailSlide(productCode: string): SlideOutline {
  return {
    slideNumber: 0,
    slideType: productDetailSlideType,
    slideTitle: `${productCode} 체험 상세`,
    slidePurpose: `${productCode} 단위에서 방문객이 수행할 미션, 행동, 반응형 콘텐츠, 결과물을 실제 체험 장표로 상세화한다.`,
    keyMessage: `${productCode}는 단순 제품 설명이 아니라 방문객이 직접 시도하고 결과를 얻는 개별 체험 모듈로 설계한다.`,
    mainCopy: `${productCode} 경험은 핵심 콘셉트의 메시지를 방문객 행동, 반응형 콘텐츠, 결과물로 전환하는 구체 실행 단위로 전개한다.`,
    confirmNeededNote: '',
  };
}



function buildExperienceApproachSlide(context?: ExperiencePlanContext): SlideOutline {
  const eventMode = isEventOperationContext(context);
  return {
    slideNumber: 0,
    slideType: eventMode ? 'Strategic Approach' : experienceApproachSlideType,
    slideTitle: eventMode ? 'Strategic Approach' : 'Experience Approach',
    slidePurpose: eventMode
      ? '행사 목적, 브랜드 메시지, 파트너십, 기술 공유, 비즈니스 기회를 운영 전략으로 연결한다.'
      : '핵심 과제를 해결하기 위한 제안 접근을 Challenge, Insight, Opportunity, Approach 흐름의 전략 문장으로 설명한다.',
    keyMessage: eventMode
      ? '행사의 정체성과 목적을 등록, 세션, 파트너 전시, 네트워킹, 현장 운영 체계로 일관되게 구현합니다.'
      : '핵심 과제와 타깃 인사이트를 해결하려면 브랜드/제품 가치를 방문객 행동과 공유 가능한 결과물로 전환하는 경험 접근이 필요하다.',
    mainCopy: eventMode
      ? '본 제안은 운영 효율만이 아니라 행사의 메시지와 관계 형성 목적이 현장의 모든 접점에서 선명하게 드러나도록 설계합니다.'
      : '과제 정의에서 출발해 타깃 인사이트와 브랜드/제품 가치를 연결하고, 현장에서 작동할 경험 기회와 전략 접근을 제시해 핵심 콘셉트의 필연성을 설득한다.',
    confirmNeededNote: '',
  };
}

function buildCoreConceptSlide(selectedConcept?: ConceptCandidate): SlideOutline {
  const displayConceptName = getPresentationConceptName(selectedConcept);
  const titleSuffix = displayConceptName ? `: ${displayConceptName}` : '';
  const conceptName = displayConceptName || '핵심 콘셉트';

  return {
    slideNumber: 0,
    slideType: coreConceptSlideType,
    slideTitle: `Core Concept${titleSuffix}`,
    slidePurpose: '핵심 콘셉트 하나를 전시 주제 선언처럼 Concept Name, Concept Statement, Core Message, Experience Logic, Why This Concept 구조로 제시한다.',
    keyMessage: `${appendKoreanTopicParticle(conceptName)} 프로젝트 과제 해결을 위한 전략 기준이자 실행 구조를 통합하는 제안의 중심축입니다.`,
    mainCopy: '본 장표는 최종 제안의 기준이 되는 핵심 콘셉트를 전시 주제 선언으로 제시하고, 왜 이 콘셉트가 과제와 타깃 인사이트를 해결하는지 명확히 정리한다.',
    confirmNeededNote: '',
  };
}

function buildExperienceStructureSlide(context?: ExperiencePlanContext): SlideOutline {
  if (isEventOperationContext(context)) {
    return {
      slideNumber: 0,
      slideType: 'Operation Framework',
      slideTitle: 'Operation Framework',
      slidePurpose: '행사 운영 구조를 등록, 세션, 파트너 부스, 네트워킹, 동선, 인력, 리스크 관리 관점으로 통합 제시한다.',
      keyMessage: '행사 목적과 브랜드 메시지를 안정적으로 전달하기 위해 모든 현장 접점을 하나의 운영 프레임워크로 연결합니다.',
      mainCopy: '참석자 진입부터 세션 참여, 파트너 교류, 네트워킹, 퇴장까지 운영 기준과 책임 체계를 명확히 설정합니다.',
      confirmNeededNote: '',
    };
  }

  return {
    slideNumber: 0,
    slideType: experienceStructureSlideType,
    slideTitle: 'Experience Structure',
    slidePurpose: '핵심 콘셉트가 Spatial Zone, Hands-on Demo / Interactive Experience, Media / Signage, Photo / Viral Spot, Output / Share 구조로 확장되는 방식을 보여준다.',
    keyMessage: '핵심 콘셉트는 공간, 참여형 체험, 미디어/사이니지, 촬영/바이럴, 산출/공유 구조로 확장될 때 실제 방문 경험으로 완성된다.',
    mainCopy: '공간에 진입한 방문객이 직접 체험하고, 미디어 반응을 확인하며, 촬영 가능한 장면과 공유 가능한 결과물까지 이어지는 실행 구조를 제시한다.',
    confirmNeededNote: '',
  };
}

function buildReferenceInsightSlide(): SlideOutline {
  return {
    slideNumber: 0,
    slideType: referenceInsightSlideType,
    slideTitle: 'Reference Insight',
    slidePurpose: 'RFP에 언급된 참고 사례를 실제 과업 범위가 아닌 설계 원칙과 주의점으로 정리한다.',
    keyMessage: '참고 사례는 신규 체험 모듈명이 아니라 임팩트, 참여 방식, 확산 구조를 도출하기 위한 레퍼런스 인사이트로만 활용한다.',
    mainCopy: '레퍼런스는 제안 범위를 대체하지 않고 선택 콘셉트의 연출 강도, 참여 방식, 확산 구조를 보정하는 설계 원칙으로만 반영한다.',
    confirmNeededNote: '',
  };
}

function renumber(slides: SlideOutline[]) {
  return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

function insertBeforeMediaOrClosing(slides: SlideOutline[], additions: SlideOutline[]) {
  const mediaIndex = slides.findIndex(isMediaPlan);
  const closingIndex = slides.findIndex((slide) => /closing|마무리|expected|effect|기대|operation|운영/i.test(`${slide.slideType} ${slide.slideTitle}`));
  const insertIndex = mediaIndex >= 0 ? mediaIndex : closingIndex >= 0 ? closingIndex : slides.length;
  return [...slides.slice(0, insertIndex), ...additions, ...slides.slice(insertIndex)];
}

function collectContextText(context?: ExperiencePlanContext) {
  if (!context) return '';
  return [context.input, context.analysis, context.selectedConcept]
    .map((item) => (item ? JSON.stringify(item) : ''))
    .join('\n');
}

function collectScopedText(context?: ExperiencePlanContext) {
  const analysis = context?.analysis;
  if (!analysis) return collectContextText(context);

  const taskDeliverables = analysis.taskSections?.flatMap((section) => section.requiredDeliverables ?? []) ?? [];
  const scopedParts = [
    ...(analysis.requiredDeliverables ?? []),
    ...taskDeliverables,
    ...(analysis.scopeOfWork ?? []),
    ...(analysis.requiredScope ?? []),
    ...(analysis.productInfo ?? []),
    ...(analysis.productFeatures?.flatMap((feature) => [feature.product, feature.keyFeature, feature.valueProposition]) ?? []),
    ...(analysis.requiredItems ?? []),
  ];

  if (!scopedParts.length) return collectContextText(context);

  return scopedParts.join('\n');
}

function collectExcludedScopeText(context?: ExperiencePlanContext) {
  const analysis = context?.analysis;
  if (!analysis) return '';

  const taskReferences = analysis.taskSections?.flatMap((section) => section.referenceMentions ?? []) ?? [];
  const taskExistingAssets = analysis.taskSections?.flatMap((section) => section.existingAssets ?? []) ?? [];

  return [
    ...taskReferences,
    ...taskExistingAssets,
    ...(analysis.referenceOnly ?? []),
    ...(analysis.doNotTreatAsScope ?? []),
    ...(analysis.existingAssets ?? []),
  ].join('\n');
}

function matchProductCodes(text: string) {
  const reserved = new Set(['AI', 'AR', 'VR', 'XR', 'LED', 'LCD', 'OLED', 'SNS', 'KPI', 'RFP', 'VIP', 'UGC', 'QR']);
  const matches = text.match(/\b[A-Z]{1,3}\d{1,3}[A-Z]?\b/g) ?? [];
  return Array.from(new Set(matches.filter((code) => !reserved.has(code))));
}

function normalizeProductUnit(value: string) {
  return value
    .replace(/^[\s•\-–—*·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeProductUnit(value: string) {
  const text = normalizeProductUnit(value);
  if (!text || text.length > 80) return false;
  if (scopeCuePattern.test(text)) return false;
  if (isTaskScopeExpression(text)) return false;
  return /[A-Z]{1,3}\d{1,3}[A-Z]?|제품|서비스|모델|디바이스|기기|콘텐츠|체험|데모|시연|솔루션|앱|플랫폼|fold|galaxy|watch|buds|tab|phone/i.test(text);
}

function extractNamedProductUnits(context?: ExperiencePlanContext) {
  const analysis = context?.analysis;
  if (!analysis) return [];

  const explicitCandidates = [
    ...(analysis.productInfo ?? []),
    ...(analysis.productFeatures?.map((feature) => [feature.product, feature.keyFeature, feature.valueProposition].filter(Boolean).join(' · ')) ?? []),
    ...(analysis.requiredDeliverables ?? []).filter(looksLikeProductUnit),
    ...(analysis.scopeOfWork ?? []).filter(looksLikeProductUnit),
    ...(analysis.requiredScope ?? []).filter(looksLikeProductUnit),
    ...(analysis.taskSections?.flatMap((section) => section.requiredDeliverables ?? []).filter(looksLikeProductUnit) ?? []),
  ];

  const excludedText = collectExcludedScopeText(context);
  const excludedCodes = new Set(matchProductCodes(excludedText));

  return explicitCandidates
    .map(normalizeProductUnit)
    .filter((unit) => unit && !scopeCuePattern.test(unit) && !isTaskScopeExpression(unit))
    .filter((unit) => matchProductCodes(unit).length <= 1)
    .filter((unit) => matchProductCodes(unit).every((code) => !excludedCodes.has(code)))
    .filter((unit, index, array) => array.indexOf(unit) === index)
    .slice(0, 8);
}

export function extractProductCodes(context?: ExperiencePlanContext) {
  const scopedText = collectScopedText(context);
  const excludedText = collectExcludedScopeText(context);
  const productInfoText = context?.analysis?.productInfo?.join('\n') ?? '';
  const productFeaturesText = context?.analysis?.productFeatures?.map((feature) => [feature.product, feature.keyFeature, feature.valueProposition].filter(Boolean).join(' · ')).join('\n') ?? '';
  const requiredScopeText = context?.analysis?.requiredScope?.join('\n') ?? '';
  const requiredDeliverablesText = context?.analysis?.requiredDeliverables?.join('\n') ?? '';
  const scopeOfWorkText = context?.analysis?.scopeOfWork?.join('\n') ?? '';
  const taskDeliverablesText = context?.analysis?.taskSections?.flatMap((section) => section.requiredDeliverables ?? []).join('\n') ?? '';
  const explicitScopeText = [taskDeliverablesText, requiredDeliverablesText, scopeOfWorkText, productInfoText, productFeaturesText, requiredScopeText].join('\n');
  const explicitCodes = new Set(matchProductCodes(explicitScopeText));
  const excludedCodes = new Set(matchProductCodes(excludedText));
  const namedUnits = extractNamedProductUnits(context);
  const codeUnits = matchProductCodes(scopedText).filter((code) => explicitCodes.has(code) || !excludedCodes.has(code));
  const uniqueCodeUnits = codeUnits.filter((unit, index, array) => array.indexOf(unit) === index);
  const productUnits = uniqueCodeUnits.length ? uniqueCodeUnits : namedUnits;

  return productUnits
    .filter((unit, index, array) => array.indexOf(unit) === index)
    .slice(0, 8);
}

function shouldIncludeReferenceInsight(context?: ExperiencePlanContext) {
  const references = context?.analysis?.referenceOnly ?? [];
  const taskReferences = context?.analysis?.taskSections?.flatMap((section) => section.referenceMentions ?? []) ?? [];
  if (references.length > 0 || taskReferences.length > 0) return true;
  const text = context?.input?.briefText ?? '';
  return scopeCuePattern.test(text);
}

function hasReferenceInsight(slides: SlideOutline[]) {
  return slides.some((slide) => /reference insight|design reference direction|레퍼런스|참고/i.test(`${slide.slideType} ${slide.slideTitle}`));
}



function isCanonicalConceptFlowSlide(slide: SlideOutline) {
  return /experience approach|경험 설계 접근|strategic approach|our approach|제안 접근 방향|concept development logic|컨셉 도출|콘셉트 도출|selected concept rationale|selected concept|선택.*콘셉트|선정 콘셉트|^core concept|핵심 콘셉트|experience structure/i.test(`${slide.slideType} ${slide.slideTitle}`);
}

function insertConceptDevelopmentSlides(slides: SlideOutline[], context?: ExperiencePlanContext) {
  if (!context?.conceptDevelopmentLogic && !context?.conceptCandidates?.length && !context?.selectedConcept) return slides;

  const retainedSlides = slides.filter((slide) => !isCanonicalConceptFlowSlide(slide));
  const additions: SlideOutline[] = [
    buildExperienceApproachSlide(context),
    buildCoreConceptSlide(context.selectedConcept),
    buildExperienceStructureSlide(context),
  ];

  const insertIndex = retainedSlides.findIndex((slide) => /experience strategy|key challenge|전략|과제/i.test(`${slide.slideType} ${slide.slideTitle}`));
  const targetIndex = insertIndex >= 0 ? insertIndex + 1 : Math.min(3, retainedSlides.length);
  return [...retainedSlides.slice(0, targetIndex), ...additions, ...retainedSlides.slice(targetIndex)];
}

const eventForbiddenSlidePattern = /Experience Structure|Main Experience Image|Key Experience Asset|Visitor Action|Interactive Flow|Content Mechanism|Output & Share|Viral Communication Strategy|Media Experience Overview|Key Media Scene|Photo\s*\/\s*Viral Spot|Hands-on Demo|Spatial \/ Content Plan|Media \/ Interactive Plan|체험 구조|핵심 체험|인터랙티브|바이럴|포토존|데모/i;

const eventOperationDefaultSlides: Array<Omit<SlideOutline, 'slideNumber'>> = [
  { slideType: 'Program Overview', slideTitle: 'Program Overview', slidePurpose: '행사 목적과 주요 프로그램 흐름을 한눈에 정리한다.', keyMessage: '프로그램 구조는 행사 메시지, 세션 목적, 참석자 교류를 명확히 연결합니다.', mainCopy: '공식 프로그램, 파트너 프로그램, 네트워킹 접점을 시간대별로 정리해 참석자가 행사 가치를 자연스럽게 경험하도록 설계합니다.', confirmNeededNote: '' },
  { slideType: 'Registration & Entry Plan', slideTitle: 'Registration & Entry Plan', slidePurpose: '사전 등록, 현장 등록, 입장 안내, 대기 동선을 통합 운영한다.', keyMessage: '등록과 입장은 첫 인상을 결정하는 핵심 운영 접점으로 안정성과 속도를 동시에 관리합니다.', mainCopy: '사전 DB, 현장 확인, 키오스크/데스크 운영, 안내 인력 배치를 연결해 혼잡을 줄이고 참석자 흐름을 안정화합니다.', confirmNeededNote: '' },
  { slideType: 'Session System Operation', slideTitle: 'Session System Operation', slidePurpose: '세션 진행, 발표 시스템, 무대 기술 운영 기준을 제시한다.', keyMessage: '발표 LED, 음향, 조명, 프롬프터와 진행 큐시트가 하나의 세션 운영 체계로 작동합니다.', mainCopy: '연사 리허설, 발표 자료 확인, 무대 전환, 기술 백업을 사전에 체계화해 세션 안정성을 확보합니다.', confirmNeededNote: '' },
  { slideType: 'Partner Pavilion Plan', slideTitle: 'Partner Pavilion Plan', slidePurpose: '파트너 부스 및 전시 공간 운영 원칙을 제시한다.', keyMessage: '파트너 공간은 브랜드 노출과 비즈니스 교류가 동시에 일어나는 행사 가치 확장 접점입니다.', mainCopy: '부스 배치, 안내 사인, 상주 인력, 상담 흐름을 정리해 파트너와 참석자의 접점을 효율적으로 운영합니다.', confirmNeededNote: '' },
  { slideType: 'Networking / Catering Plan', slideTitle: 'Networking / Catering Plan', slidePurpose: '네트워킹, 케이터링, 만찬 운영 방향을 정리한다.', keyMessage: '네트워킹과 케이터링은 참석자 관계 형성과 행사 만족도를 높이는 운영 경험입니다.', mainCopy: '휴식 시간, 식음 서비스, 만찬 흐름, 교류 공간을 프로그램과 연동해 자연스러운 대화와 비즈니스 기회를 만듭니다.', confirmNeededNote: '' },
  { slideType: 'Moving Line Plan', slideTitle: 'Moving Line Plan', slidePurpose: '참석자, 연사, VIP, 운영 인력 동선을 구분해 관리한다.', keyMessage: '동선 계획은 혼잡을 줄이고 세션 전환과 네트워킹 흐름을 안정화하는 핵심 운영 기준입니다.', mainCopy: '입장, 세션 이동, 휴식, 파트너 부스, 퇴장 동선을 구분하고 병목 구간에는 안내 인력과 사인을 집중 배치합니다.', confirmNeededNote: '' },
  { slideType: 'Setup / Conversion Plan', slideTitle: 'Setup / Conversion Plan', slidePurpose: '설치, 리허설, 전환, 철거 계획을 단계별로 제시한다.', keyMessage: '셋업과 전환 계획은 현장 완성도와 일정 리스크를 좌우하는 실행 관리 체계입니다.', mainCopy: '반입, 설치, 시스템 테스트, 리허설, 운영 중 전환, 철거까지 단계별 책임과 체크포인트를 설정합니다.', confirmNeededNote: '' },
  { slideType: 'Staffing Plan', slideTitle: 'Staffing Plan', slidePurpose: '운영 인력 구성과 역할 분담을 제시한다.', keyMessage: '명확한 역할과 보고 체계가 현장 이슈 대응 속도와 운영 품질을 높입니다.', mainCopy: 'PM, 무대/시스템, 등록, 안내, 부스, 케이터링, 안전 담당의 역할과 커뮤니케이션 라인을 정리합니다.', confirmNeededNote: '' },
  { slideType: 'Risk Management', slideTitle: 'Risk Management', slidePurpose: '현장 리스크와 대응 프로토콜을 정리한다.', keyMessage: '예상 이슈를 사전에 정의하고 대응 기준을 마련해 행사 운영 안정성을 확보합니다.', mainCopy: '등록 지연, 장비 오류, 세션 지연, 혼잡, 안전 이슈별 대응 프로세스와 보고 체계를 마련합니다.', confirmNeededNote: '' },
  { slideType: 'Budget Summary', slideTitle: 'Budget Summary', slidePurpose: '예산 항목과 과업 범위의 연결 기준을 요약한다.', keyMessage: '예산은 프로그램, 시스템, 공간, 인력, 식음, 리스크 대응 범위를 기준으로 투명하게 구성합니다.', mainCopy: '항목별 포함 범위와 변동 가능 요소를 구분해 발주처가 과업과 견적의 연결성을 쉽게 검토할 수 있도록 합니다.', confirmNeededNote: '' },
];

function isEventForbiddenSlide(slide: SlideOutline) {
  return eventForbiddenSlidePattern.test(`${slide.slideType} ${slide.slideTitle} ${slide.slidePurpose}`);
}

function ensureEventOperationSlides(slides: SlideOutline[], context?: ExperiencePlanContext) {
  if (!isEventOperationContext(context)) return slides;
  const retained = slides.filter((slide) => !isEventForbiddenSlide(slide));
  const additions = eventOperationDefaultSlides
    .filter((template) => !retained.some((slide) => new RegExp(template.slideType.replace(/[\/]/g, '\\$&'), 'i').test(`${slide.slideType} ${slide.slideTitle}`)))
    .map((template) => ({ slideNumber: 0, ...template }));
  if (!additions.length) return retained;
  const insertIndex = retained.findIndex((slide) => /schedule|budget|closing|마무리|일정|예산/i.test(`${slide.slideType} ${slide.slideTitle}`));
  const targetIndex = insertIndex >= 0 ? insertIndex : retained.length;
  return [...retained.slice(0, targetIndex), ...additions, ...retained.slice(targetIndex)];
}

function insertReferenceInsight(slides: SlideOutline[], context?: ExperiencePlanContext) {
  if (!shouldIncludeReferenceInsight(context) || hasReferenceInsight(slides)) return slides;
  const insertIndex = slides.findIndex((slide) => /experience strategy|core concept|전략|콘셉트/i.test(`${slide.slideType} ${slide.slideTitle}`));
  const targetIndex = insertIndex >= 0 ? insertIndex : Math.min(3, slides.length);
  return [...slides.slice(0, targetIndex), buildReferenceInsightSlide(), ...slides.slice(targetIndex)];
}

export function expandExperiencePlanOutline(outline: SlideOutline[], context?: ExperiencePlanContext) {
  const eventMode = isEventOperationContext(context);
  let hasSpatial = false;
  let hasMedia = false;
  const productCodes = extractProductCodes(context);
  const productSlides = productCodes.map(buildProductDetailSlide);
  const expanded: SlideOutline[] = [];

  outline.forEach((slide) => {
    if (!eventMode && isSpatialPlan(slide)) {
      if (!eventMode && !hasSpatial) {
        const baseSlides = spatialPlanSlides.map((template) => buildExpandedSlide(slide, template));
        expanded.push(...baseSlides.slice(0, 2), ...productSlides, ...baseSlides.slice(2));
        hasSpatial = true;
      }
      return;
    }

    if (!eventMode && isMediaPlan(slide)) {
      if (!eventMode && !hasMedia) {
        expanded.push(...mediaPlanSlides.map((template) => buildExpandedSlide(slide, template)));
        hasMedia = true;
      }
      return;
    }

    expanded.push(slide);
  });

  let completed = ensureEventOperationSlides(insertConceptDevelopmentSlides(insertReferenceInsight(expanded, context), context), context);
  if (!eventMode && !hasSpatial) {
    const baseSlides = spatialPlanSlides.map((template) => buildExpandedSlide(undefined, template));
    completed = insertBeforeMediaOrClosing(completed, [...baseSlides.slice(0, 2), ...productSlides, ...baseSlides.slice(2)]);
  }
  if (!eventMode && !hasMedia) {
    const closingIndex = completed.findIndex((slide) => /closing|마무리|expected|effect|기대|operation|운영/i.test(`${slide.slideType} ${slide.slideTitle}`));
    const insertIndex = closingIndex >= 0 ? closingIndex : completed.length;
    completed = [...completed.slice(0, insertIndex), ...mediaPlanSlides.map((template) => buildExpandedSlide(undefined, template)), ...completed.slice(insertIndex)];
  }

  return sanitizeOutlineSlides(renumber(removeInternalConceptComparisonSlides(completed)));
}
