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
    uniqueItems.push('운영 품질을 측정할 수 있는 관리 지표를 제안합니다.');
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
          'RFP에 별도 정량 KPI가 없는 경우, 운영 품질을 측정할 수 있는 관리 지표를 제안합니다.',
          ...(proposedMeasurementItems.length
            ? proposedMeasurementItems.map((item) => `측정 항목 제안: ${item}`)
            : ['측정 항목 제안: 등록 처리 속도, 세션 운영 안정성, 참석자 만족도, 네트워킹 참여도, 현장 이슈 대응률을 중심으로 정의합니다.']),
          '운영 성과는 등록 처리 속도, 세션 운영 안정성, 참석자 만족도, 네트워킹 참여도, 현장 이슈 대응률을 중심으로 측정합니다.',
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
        : 'RFP에 별도 정량 KPI가 없는 경우, 운영 품질을 측정할 수 있는 관리 지표를 제안합니다.',
      mainCopy: hasTargetKpi
        ? '제안 운영 성과는 RFP에서 명확히 목표 KPI로 분류된 수치와 현장에서 수집 가능한 측정 방식만 연결해 관리합니다.'
        : '운영 성과는 등록 처리 속도, 세션 운영 안정성, 참석자 만족도, 네트워킹 참여도, 현장 이슈 대응률을 중심으로 측정합니다.',
      bodyBullets,
      speakerNote: speakerNoteParts.join('\n'),
      confirmNeededNote,
    };
  });
}
