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
          '방문객 수, 체험 참여율, SNS 버즈량을 중심으로 운영 성과를 측정합니다.',
          ...(proposedMeasurementItems.length
            ? proposedMeasurementItems.map((item) => `측정 항목 제안: ${item}`)
            : ['측정 항목 제안: 방문/참여/공유/만족도 등 운영 데이터 항목을 협의 후 정의합니다.']),
          '기존 성과와 레슨런드는 실행 기준을 보정하는 배경 인사이트로 활용합니다.',
        ]);

    const speakerNoteParts = [
      slide.speakerNote,
      backgroundMetricItems.length ? `배경 인사이트: ${backgroundMetricItems.join(' / ')}` : '',
    ].filter(Boolean);

    return {
      ...slide,
      keyMessage: hasTargetKpi
        ? '방문객 수, 체험 참여율, SNS 버즈량을 중심으로 운영 성과를 측정합니다.'
        : '명시된 목표 수치가 없는 항목은 운영 데이터 기반의 측정 체계로 관리합니다.',
      mainCopy: hasTargetKpi
        ? '제안 운영 성과는 확인된 목표 지표와 현장에서 수집 가능한 참여·확산 데이터를 연결해 관리합니다.'
        : '방문객 행동과 콘텐츠 반응, 공유 데이터를 중심으로 실행 후 관리할 측정 항목을 제안합니다.',
      bodyBullets,
      speakerNote: speakerNoteParts.join('\n'),
    };
  });
}
