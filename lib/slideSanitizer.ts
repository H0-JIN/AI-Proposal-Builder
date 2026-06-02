import type { ProductExperienceDetail, SlideContent, SlideOutline } from '@/lib/types';

const productDetailPattern = /product experience detail|체험 상세|체험 개요|체험 시나리오|챌린지|체험존 상세/i;
const taskScopePattern = /제작|개발|운영|구성|기획|제안|범위|시공|설계|납품|관리|대행|디스플레이 개발|모듈 개발/i;
const internalInstructionPattern = /RFP에 명시된 목표 KPI와 측정 방식만 정량 목표로 제시합니다\.?|Background insight only:?|Visual Prompt:?|cover_image_placeholder|[a-z0-9]+(?:_[a-z0-9]+)+_placeholder/gi;
const fileNamePlaceholderPattern = /^[a-z0-9]+(?:_[a-z0-9]+)+_placeholder$/i;
const reservedCodes = new Set(['AI', 'AR', 'VR', 'XR', 'LED', 'LCD', 'OLED', 'SNS', 'KPI', 'RFP', 'VIP', 'UGC', 'QR']);
const maxProductDetailSlidesPerProduct = 2;
const duplicateMechanismPattern = /content mechanism|콘텐츠\s*작동\s*원리|작동\s*원리\s*및\s*메커니즘|콘텐츠\s*메커니즘/i;

function normalizeText(value?: string) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function removeInternalInstructionText(value?: string) {
  return normalizeText(value).replace(internalInstructionPattern, '').replace(/\s{2,}/g, ' ').trim();
}

function matchProductCodes(text: string) {
  const matches = text.match(/\b[A-Z]{1,3}\d{1,3}[A-Z]?\b/g) ?? [];
  return Array.from(new Set(matches.filter((code) => !reservedCodes.has(code))));
}

function firstProductCodeFromSlide(slide: Pick<SlideOutline | SlideContent, 'slideTitle' | 'slideType' | 'keyMessage' | 'mainCopy'>) {
  return matchProductCodes([slide.slideTitle, slide.slideType, slide.keyMessage, slide.mainCopy].join(' '))[0];
}

function experienceTopicFromSlide(slide: Pick<SlideOutline | SlideContent, 'slideTitle' | 'slidePurpose' | 'keyMessage' | 'mainCopy'>) {
  const title = normalizeText(slide.slideTitle)
    .replace(/^(COMMON|공통)\s*/i, '')
    .replace(/^(핵심\s*)?체험\s*(상세|개요|시나리오)\s*\d*$/i, '')
    .trim();
  if (title) return title.replace(/\s*(체험 상세|체험 개요|체험 시나리오)$/i, '');

  const text = [slide.slidePurpose, slide.keyMessage, slide.mainCopy].map(normalizeText).find(Boolean) ?? '';
  const cue = text.match(/([가-힣A-Za-z0-9 /·-]*(셀피존|포토존|데모|시연|챌린지|공유|미션|체험존|체험)[가-힣A-Za-z0-9 /·-]*)/i)?.[1];
  return normalizeText(cue).slice(0, 28) || '핵심';
}

function productKeyFromSlide(slide: Pick<SlideOutline | SlideContent, 'slideTitle' | 'slideType' | 'slidePurpose' | 'keyMessage' | 'mainCopy'>) {
  return firstProductCodeFromSlide(slide) ?? experienceTopicFromSlide(slide);
}

function hasDuplicateMechanismSlide(slide: Pick<SlideOutline | SlideContent, 'slideTitle' | 'slideType' | 'slidePurpose'>) {
  return duplicateMechanismPattern.test([slide.slideType, slide.slideTitle, slide.slidePurpose].join(' '));
}

function firstProductCodeFromDetail(detail: ProductExperienceDetail) {
  return matchProductCodes([detail.productCode, detail.productRole, detail.experienceTitle, detail.oneLineExperience].join(' '))[0] ?? normalizeText(detail.productCode);
}

function isProductDetailSlide(slide: Pick<SlideOutline | SlideContent, 'slideTitle' | 'slideType' | 'slidePurpose'>) {
  return productDetailPattern.test([slide.slideType, slide.slideTitle, slide.slidePurpose].join(' '));
}

function isTaskScopeOnlyExperience(value?: string) {
  const text = normalizeText(value);
  if (!text) return false;
  const hasProductCode = matchProductCodes(text).length > 0;
  const hasVisitorContentCue = /방문객|관람객|참여|미션|반응|결과물|공유|챌린지|셀피|데모|시연|촬영|생성|선택/i.test(text);
  return taskScopePattern.test(text) && !hasProductCode && !hasVisitorContentCue;
}

function detailExperienceSignature(detail: ProductExperienceDetail) {
  return normalizeText([
    detail.experienceTitle,
    detail.visitorMission,
    detail.visitorAction,
    detail.systemResponse,
    detail.outputOrReward,
  ].join(' '))
    .replace(/체험|상세|개요|시나리오|존|챌린지|모듈/g, '')
    .toLowerCase();
}

function slideExperienceSignature(slide: SlideOutline | SlideContent) {
  return normalizeText([
    slide.slideTitle,
    slide.slidePurpose,
    slide.keyMessage,
    slide.mainCopy,
  ].join(' '))
    .replace(/체험|상세|개요|시나리오|존|챌린지|모듈|멀티태스킹/g, '')
    .toLowerCase();
}

function sanitizeImagePlaceholder(value?: string) {
  const text = normalizeText(value);
  if (!text || fileNamePlaceholderPattern.test(text) || /visual prompt/i.test(text)) return '대표 이미지 삽입 영역';
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

function sanitizeBullets(items: string[]) {
  const cleaned = items
    .map(removeInternalInstructionText)
    .filter(Boolean)
    .filter((item) => !fileNamePlaceholderPattern.test(item));
  return Array.from(new Set(cleaned)).slice(0, 7);
}

function sanitizeProductDetails(details: ProductExperienceDetail[]) {
  const productCounts = new Map<string, number>();
  const signaturesByProduct = new Map<string, Set<string>>();

  return details.filter((detail) => {
    if (isTaskScopeOnlyExperience([detail.productCode, detail.productRole, detail.experienceTitle, detail.oneLineExperience].join(' '))) return false;
    if (!normalizeText(detail.visitorAction) || !normalizeText(detail.systemResponse) || !normalizeText(detail.outputOrReward)) return false;

    const productCode = firstProductCodeFromDetail(detail);
    const count = productCounts.get(productCode) ?? 0;
    if (count >= maxProductDetailSlidesPerProduct) return false;

    const signature = detailExperienceSignature(detail);
    const signatures = signaturesByProduct.get(productCode) ?? new Set<string>();
    if (signature && Array.from(signatures).some((seen) => seen.includes(signature) || signature.includes(seen))) return false;

    signatures.add(signature);
    signaturesByProduct.set(productCode, signatures);
    productCounts.set(productCode, count + 1);
    return true;
  }).map((detail) => ({
    ...detail,
    imagePlaceholder: sanitizeImagePlaceholder(detail.imagePlaceholder),
  }));
}


function buildFallbackProductDetailSlide(productCode: string): SlideContent {
  return {
    slideNumber: 0,
    slideType: 'Spatial / Content Plan - Product Experience Detail',
    slideTitle: `${productCode} 체험 상세`,
    slidePurpose: `${productCode} 단위의 방문객 미션, 행동, 시스템 반응, 결과물, SNS 공유 포인트를 제품별로 복구해 제시한다.`,
    keyMessage: `${productCode}는 포괄 모듈로 합치지 않고 개별 제품 특성에 맞춘 체험 흐름으로 설계합니다.`,
    mainCopy: `${productCode} 체험은 선택 콘셉트의 메시지를 제품별 미션과 즉각적인 체험 결과물로 전환해 방문객이 직접 이해하고 공유할 수 있게 합니다.`,
    bodyBullets: [
      `visitorMission: ${productCode}의 핵심 가치를 직접 확인하는 미션을 수행합니다.`,
      `visitorAction: 방문객은 ${productCode}를 조작·비교·촬영하며 차별점을 체험합니다.`,
      `systemResponse: 입력 행동에 맞춰 데모 화면, 미디어 반응, 안내 메시지가 즉시 제공됩니다.`,
      `outputOrReward: 개인화 결과물 또는 체험 완료 리워드를 제공합니다.`,
      `snsSharePoint: ${productCode} 체험 결과가 사진/영상 공유 포인트로 이어지게 합니다.`,
    ],
    visualDirection: `${productCode} 제품과 방문객 행동이 한 화면에 보이는 체험 상세 레이아웃`,
    visitorAction: `${productCode}를 직접 조작하고 결과물을 확인합니다.`,
    contentMechanism: '방문객 입력을 제품 데모 화면과 개인화 결과물로 연결하는 반응형 체험 구조',
    spatialPlacement: '제품별 체험 테이블 또는 데모 스테이션',
    mediaOrObject: `${productCode} 제품, 안내 UI, 반응형 디스플레이`,
    outputOrReward: '개인화 체험 결과물 또는 공유 가능한 인증 콘텐츠',
    imagePlaceholder: '대표 이미지 삽입 영역',
    visualPrompt: '',
    diagramSuggestion: 'visitorMission → visitorAction → systemResponse → outputOrReward → snsSharePoint 흐름도',
    productExperienceDetails: [
      {
        productCode,
        productRole: `${productCode} 개별 제품 체험 모듈`,
        coreValue: 'RFP에 명시된 제품별 핵심 가치 확인 필요',
        experienceTitle: `${productCode} 제품별 미션 체험`,
        oneLineExperience: `${productCode}의 차별점을 방문객 행동과 결과물로 전환하는 체험`,
        visitorMission: `${productCode}의 핵심 기능 또는 메시지를 직접 확인합니다.`,
        visitorAction: `${productCode}를 조작·비교·촬영하며 체험 미션을 수행합니다.`,
        systemResponse: '방문객 입력에 맞춰 데모 화면, 미디어 반응, 안내 메시지가 제공됩니다.',
        mediaOrObject: `${productCode} 제품, 데모 UI, 반응형 디스플레이`,
        spatialPlacement: '제품별 체험 테이블 또는 데모 스테이션',
        outputOrReward: '개인화 결과물 또는 체험 완료 리워드',
        snsSharePoint: `${productCode} 체험 결과를 사진/영상으로 공유하는 인증 포인트`,
        visualDirection: `${productCode} 제품과 방문객 행동 중심의 상세 장표`,
        imagePlaceholder: '대표 이미지 삽입 영역',
        diagramSuggestion: '미션-행동-반응-결과-공유 단계 비교표',
      },
    ],
    keyExperienceAssets: [],
    experienceScenarioSteps: [],
    referenceInsights: [],
    speakerNote: 'AI 생성 결과에서 누락된 RFP 명시 제품 단위를 안전하게 복구한 장표입니다. 제품별 기능·수치가 불확실한 경우 목표 KPI로 전환하지 않고 확인 필요로 유지합니다.',
    confirmNeededNote: `${productCode}의 구체 기능, 데모 콘텐츠, 리워드 정책은 RFP 원문 기준으로 확인 필요`,
  };
}

export function sanitizeImagePlaceholderForPpt(value?: string) {
  return sanitizeImagePlaceholder(value);
}

export function sanitizeGeneratedSlides(slides: SlideContent[], expectedProductUnits: string[] = []) {
  const detailSlideCounts = new Map<string, number>();
  const detailSlideSignatures = new Map<string, Set<string>>();
  const sanitized: SlideContent[] = [];
  let hasMechanismSlide = false;

  slides.forEach((slide) => {
    const baseSlide: SlideContent = {
      ...slide,
      keyMessage: removeInternalInstructionText(slide.keyMessage) || slide.keyMessage,
      mainCopy: removeInternalInstructionText(slide.mainCopy) || slide.mainCopy,
      bodyBullets: sanitizeBullets(slide.bodyBullets ?? []),
      imagePlaceholder: sanitizeImagePlaceholder(slide.imagePlaceholder),
      productExperienceDetails: sanitizeProductDetails(slide.productExperienceDetails ?? []),
      speakerNote: normalizeText(slide.speakerNote).replace(/Background insight only:/gi, '배경 인사이트:'),
    };

    if (hasDuplicateMechanismSlide(baseSlide)) {
      if (hasMechanismSlide) return;
      hasMechanismSlide = true;
    }

    if (isTaskScopeOnlyExperience(baseSlide.slideTitle) && isProductDetailSlide(baseSlide)) {
      sanitized.push({
        ...baseSlide,
        slideType: 'Execution Plan - Production Scope',
        slideTitle: '제작 범위 및 실행 계획',
        slidePurpose: '체험 콘텐츠명이 아닌 과업 범위 항목을 제작·실행 계획 관점으로 정리한다.',
        productExperienceDetails: [],
      });
      return;
    }

    if (isProductDetailSlide(baseSlide)) {
      const productCode = productKeyFromSlide(baseSlide);
      const count = detailSlideCounts.get(productCode) ?? 0;
      if (count >= maxProductDetailSlidesPerProduct) return;

      const signature = slideExperienceSignature(baseSlide);
      const signatures = detailSlideSignatures.get(productCode) ?? new Set<string>();
      if (signature && Array.from(signatures).some((seen) => seen.includes(signature) || signature.includes(seen))) return;

      detailSlideCounts.set(productCode, count + 1);
      signatures.add(signature);
      detailSlideSignatures.set(productCode, signatures);

      if (count === 1 && /체험 상세$/.test(baseSlide.slideTitle)) {
        sanitized.push({ ...baseSlide, slideTitle: `${productCode} 체험 시나리오` });
        return;
      }
      if (!firstProductCodeFromSlide(baseSlide) && /^(COMMON|공통)\s/i.test(baseSlide.slideTitle)) {
        sanitized.push({ ...baseSlide, slideTitle: `${experienceTopicFromSlide(baseSlide)} 체험 시나리오` });
        return;
      }
    }

    sanitized.push(baseSlide);
  });

  const existingProductUnits = new Set(sanitized.filter(isProductDetailSlide).map(productKeyFromSlide));
  expectedProductUnits
    .filter((unit) => normalizeText(unit) && !existingProductUnits.has(unit))
    .forEach((unit) => {
      sanitized.push(buildFallbackProductDetailSlide(unit));
      existingProductUnits.add(unit);
    });

  return sanitized.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function sanitizeOutlineSlides(slides: SlideOutline[]) {
  const detailSlideCounts = new Map<string, number>();
  const detailSlideSignatures = new Map<string, Set<string>>();
  const sanitized: SlideOutline[] = [];
  let hasMechanismSlide = false;

  slides.forEach((slide) => {
    if (hasDuplicateMechanismSlide(slide)) {
      if (hasMechanismSlide) return;
      hasMechanismSlide = true;
    }
    if (isTaskScopeOnlyExperience(slide.slideTitle) && isProductDetailSlide(slide)) {
      sanitized.push({
        ...slide,
        slideType: 'Execution Plan - Production Scope',
        slideTitle: '제작 범위 및 실행 계획',
        slidePurpose: '체험 콘텐츠명이 아닌 과업 범위 항목을 제작·실행 계획 관점으로 정리한다.',
      });
      return;
    }

    if (isProductDetailSlide(slide)) {
      const productCode = productKeyFromSlide(slide);
      const count = detailSlideCounts.get(productCode) ?? 0;
      if (count >= maxProductDetailSlidesPerProduct) return;

      const signature = slideExperienceSignature(slide);
      const signatures = detailSlideSignatures.get(productCode) ?? new Set<string>();
      if (signature && Array.from(signatures).some((seen) => seen.includes(signature) || signature.includes(seen))) return;

      detailSlideCounts.set(productCode, count + 1);
      signatures.add(signature);
      detailSlideSignatures.set(productCode, signatures);
    }

    sanitized.push(slide);
  });

  return sanitized.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function isTaskScopeExpression(value?: string) {
  return isTaskScopeOnlyExperience(value);
}
