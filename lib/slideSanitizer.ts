import type { ProductExperienceDetail, SlideContent, SlideOutline } from '@/lib/types';

const productDetailPattern = /product experience detail|체험 상세|체험 개요|체험 시나리오|챌린지|체험존 상세/i;
const taskScopePattern = /제작|개발|운영|구성|기획|제안|범위|시공|설계|납품|관리|대행|디스플레이 개발|모듈 개발/i;
const internalInstructionPattern = /RFP에 명시된 목표 KPI와 측정 방식만 정량 목표로 제시합니다\.?|Background insight only:?|Visual Prompt:?|cover_image_placeholder|[a-z0-9]+(?:_[a-z0-9]+)+_placeholder/gi;
const fileNamePlaceholderPattern = /^[a-z0-9]+(?:_[a-z0-9]+)+_placeholder$/i;
const reservedCodes = new Set(['AI', 'AR', 'VR', 'XR', 'LED', 'LCD', 'OLED', 'SNS', 'KPI', 'RFP', 'VIP', 'UGC', 'QR']);
const maxProductDetailSlidesPerProduct = 2;

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

export function sanitizeImagePlaceholderForPpt(value?: string) {
  return sanitizeImagePlaceholder(value);
}

export function sanitizeGeneratedSlides(slides: SlideContent[]) {
  const detailSlideCounts = new Map<string, number>();
  const detailSlideSignatures = new Map<string, Set<string>>();
  const sanitized: SlideContent[] = [];

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
      const productCode = firstProductCodeFromSlide(baseSlide) ?? 'COMMON';
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
    }

    sanitized.push(baseSlide);
  });

  return sanitized.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function sanitizeOutlineSlides(slides: SlideOutline[]) {
  const detailSlideCounts = new Map<string, number>();
  const detailSlideSignatures = new Map<string, Set<string>>();
  const sanitized: SlideOutline[] = [];

  slides.forEach((slide) => {
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
      const productCode = firstProductCodeFromSlide(slide) ?? 'COMMON';
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
