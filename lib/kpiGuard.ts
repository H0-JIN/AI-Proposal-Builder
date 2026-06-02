import type { AnalysisResult, SlideContent } from '@/lib/types';

function isKpiSlide(slide: SlideContent) {
  const text = `${slide.slideType} ${slide.slideTitle} ${slide.slidePurpose}`;
  return /KPI|Expected Effect|성과|효과|목표|측정/i.test(text);
}

function normalizeItems(items?: string[]) {
  return (items ?? []).map((item) => item.trim()).filter(Boolean);
}

function isUncertainMetric(item: string) {
  return /확인\s*필요|미확정|불확실|추정|예상|가정|협의|TBD|OCR|추출|판독|식별\s*불가|불명확|모호/i.test(item);
}

function padBullets(items: string[]) {
  const uniqueItems = Array.from(new Set(items)).slice(0, 7);
  while (uniqueItems.length < 3) {
    uniqueItems.push('RFP에 명확히 확정된 추가 목표 KPI는 확인 후 반영합니다.');
  }
  return uniqueItems;
}

export function sanitizeKpiSlides(slides: SlideContent[], analysis: AnalysisResult) {
  const numericInfo = analysis.numericInfo;
  const rawTargetKpiItems = normalizeItems(numericInfo?.targetKPI);
  const targetKpiItems = rawTargetKpiItems.filter((item) => !isUncertainMetric(item));
  const uncertainTargetItems = rawTargetKpiItems.filter(isUncertainMetric);
  const proposedMeasurementItems = normalizeItems(numericInfo?.proposedMeasurement).filter((item) => !isUncertainMetric(item));
  const backgroundMetricItems = normalizeItems([
    ...(numericInfo?.pastPerformance ?? []),
    ...(numericInfo?.lessonLearned ?? []),
    ...(numericInfo?.referenceMetric ?? []),
  ]);
  const confirmNeededItems = normalizeItems([
    ...uncertainTargetItems,
    ...(numericInfo?.currentIssue ?? []).filter(isUncertainMetric),
    ...(analysis.confirmNeeded ?? []).filter((item) => /수치|KPI|목표|성과|OCR|추출|확인/i.test(item)),
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
          'RFP에 명확히 targetKPI로 확정된 정량 목표는 현재 확인되지 않았습니다.',
          ...(proposedMeasurementItems.length
            ? proposedMeasurementItems.map((item) => `측정 항목 제안: ${item}`)
            : ['측정 항목 제안: 방문/참여/공유/만족도 등 운영 데이터 항목을 협의 후 정의합니다.']),
          '기존 성과와 레슨런드는 목표 KPI가 아니라 실행 기준을 보정하는 배경 인사이트로만 활용합니다.',
        ]);

    const speakerNoteParts = [
      slide.speakerNote,
      backgroundMetricItems.length ? `배경 인사이트(목표 KPI 제외): ${backgroundMetricItems.join(' / ')}` : '',
      confirmNeededItems.length ? `확인 필요 수치(목표 KPI 미사용): ${confirmNeededItems.join(' / ')}` : '',
    ].filter(Boolean);

    const confirmNeededNote = [slide.confirmNeededNote, ...confirmNeededItems.map((item) => `확인 필요: ${item}`)]
      .filter(Boolean)
      .join('\n');

    return {
      ...slide,
      keyMessage: hasTargetKpi
        ? 'RFP에서 targetKPI로 확정된 수치만 목표로 제시하고, 그 외 수치는 배경 인사이트로 분리합니다.'
        : '확정되지 않은 수치는 목표 KPI로 쓰지 않고 확인 필요 항목과 측정 체계로 분리합니다.',
      mainCopy: hasTargetKpi
        ? '제안 운영 성과는 RFP에서 명확히 목표 KPI로 분류된 수치와 현장에서 수집 가능한 측정 방식만 연결해 관리합니다.'
        : '본 장표는 임의 목표 수치를 만들지 않고, 확정 KPI 확인 전까지 운영 데이터 기반의 측정 항목과 확인 필요 수치를 분리해 제시합니다.',
      bodyBullets,
      speakerNote: speakerNoteParts.join('\n'),
      confirmNeededNote,
    };
  });
}
