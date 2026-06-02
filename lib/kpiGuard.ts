import type { AnalysisResult, SlideContent } from '@/lib/types';

function isKpiSlide(slide: SlideContent) {
  const text = `${slide.slideType} ${slide.slideTitle} ${slide.slidePurpose}`;
  return /KPI|Expected Effect|성과|효과|목표|측정/i.test(text);
}

function normalizeItems(items?: string[]) {
  return (items ?? []).map((item) => item.trim()).filter(Boolean);
}

function padBullets(items: string[]) {
  const uniqueItems = Array.from(new Set(items)).slice(0, 7);
  while (uniqueItems.length < 3) {
    uniqueItems.push('RFP에 명시된 추가 정량 목표는 확인 후 반영합니다.');
  }
  return uniqueItems;
}

export function sanitizeKpiSlides(slides: SlideContent[], analysis: AnalysisResult) {
  const numericInfo = analysis.numericInfo;
  const targetKpiItems = normalizeItems(numericInfo?.targetKPI?.length ? numericInfo.targetKPI : analysis.kpiObjectives);
  const proposedMeasurementItems = normalizeItems(numericInfo?.proposedMeasurement);
  const backgroundMetricItems = normalizeItems([
    ...(numericInfo?.pastPerformance ?? []),
    ...(numericInfo?.lessonLearned ?? []),
    ...(numericInfo?.referenceMetric ?? []),
  ]);

  return slides.map((slide) => {
    if (!isKpiSlide(slide)) return slide;

    const hasTargetKpi = targetKpiItems.length > 0;
    const bodyBullets = hasTargetKpi
      ? padBullets([
          ...targetKpiItems.map((item) => `목표 KPI: ${item}`),
          ...proposedMeasurementItems.map((item) => `측정 방식: ${item}`),
        ])
      : padBullets([
          'RFP에 명시된 목표 KPI 수치가 없어 임의 목표값을 설정하지 않습니다.',
          ...(proposedMeasurementItems.length
            ? proposedMeasurementItems.map((item) => `측정 항목 제안: ${item}`)
            : ['측정 항목 제안: 방문/참여/공유/만족도 등 운영 데이터 항목을 협의 후 정의합니다.']),
          '기존 성과 수치와 레슨런드 수치는 목표가 아닌 배경 인사이트 장표에서만 활용합니다.',
        ]);

    const speakerNoteParts = [
      slide.speakerNote,
      backgroundMetricItems.length ? `Background insight only: ${backgroundMetricItems.join(' / ')}` : '',
    ].filter(Boolean);

    return {
      ...slide,
      keyMessage: hasTargetKpi
        ? 'RFP에 명시된 목표 KPI와 측정 방식만 정량 목표로 제시합니다.'
        : 'RFP에 명시된 목표 KPI 수치가 없어 측정 항목 제안 중심으로 정리합니다.',
      mainCopy: hasTargetKpi
        ? '아래 수치는 RFP에서 목표 KPI로 명확히 제시된 항목만 반영한 것입니다.'
        : '기존 성과나 레퍼런스 수치를 목표로 전환하지 않고, 실행 후 관리할 측정 항목을 제안합니다.',
      bodyBullets,
      speakerNote: speakerNoteParts.join('\n'),
    };
  });
}
