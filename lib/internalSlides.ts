import type { SlideContent, SlideOutline } from '@/lib/types';

const internalConceptComparisonPattern = /concept candidates|concept candidates comparison|콘셉트 후보|컨셉 후보|3개 콘셉트|3안 비교|콘셉트.*비교표|컨셉.*비교표|선택되지 않은 콘셉트|내부 평가|평가 점수표|why not others/i;

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
