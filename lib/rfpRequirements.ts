import type { AnalysisResult, RfpRequirementCoverage, SlideOutline } from './types';

type RequirementSourceCategory = RfpRequirementCoverage['sourceCategory'];

const MAX_REQUIREMENT_SLIDES = 12;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\-_/|:;,.()[\]{}]+/g, ' ')
    .replace(/[^\u3131-\ud79d\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalize(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractRequirements(analysis: AnalysisResult) {
  return [
    ...unique([
      ...(analysis.requiredDeliverables ?? []),
      ...(analysis.requiredItems ?? []),
      ...(analysis.taskSections?.flatMap((section) => section.requiredDeliverables ?? []) ?? []),
    ]).map((requirement) => ({ requirement, sourceCategory: 'requiredDeliverables' as const })),
    ...unique([
      ...(analysis.scopeOfWork ?? []),
      ...(analysis.requiredScope ?? []),
      ...(analysis.taskSections?.flatMap((section) => section.keyRequirements ?? []) ?? []),
    ]).map((requirement) => ({ requirement, sourceCategory: 'scopeOfWork' as const })),
    ...unique([...(analysis.evaluationCriteria ?? []), ...(analysis.kpiObjectives ?? [])]).map((requirement) => ({ requirement, sourceCategory: 'evaluationCriteria' as const })),
    ...unique([...(analysis.constraints ?? []), ...(analysis.schedule ?? []), ...(analysis.kpiScheduleConstraints ?? [])]).map((requirement) => ({ requirement, sourceCategory: 'constraints' as const })),
  ];
}

function slideSearchText(slide: SlideOutline) {
  return normalize([slide.slideTitle, slide.slideType, slide.slidePurpose, slide.keyMessage, slide.mainCopy, slide.confirmNeededNote].join(' '));
}

function mapRequirementToSlide(requirement: string, slides: SlideOutline[]) {
  const normalizedRequirement = normalize(requirement);
  if (!normalizedRequirement) return undefined;

  const direct = slides.find((slide) => slideSearchText(slide).includes(normalizedRequirement));
  if (direct) return direct;

  const tokens = normalizedRequirement.split(' ').filter((token) => token.length >= 2);
  if (!tokens.length) return undefined;

  let best: { slide: SlideOutline; score: number } | undefined;
  slides.forEach((slide) => {
    const text = slideSearchText(slide);
    const score = tokens.filter((token) => text.includes(token)).length / tokens.length;
    if (score >= 0.65 && (!best || score > best.score)) best = { slide, score };
  });
  return best?.slide;
}

export function buildRequirementCoverageCheck(analysis: AnalysisResult, slides: SlideOutline[]): RfpRequirementCoverage[] {
  return extractRequirements(analysis).map(({ requirement, sourceCategory }) => {
    const mappedSlide = mapRequirementToSlide(requirement, slides);
    return {
      requirement,
      sourceCategory,
      mappedSlideTitle: mappedSlide?.slideTitle ?? '',
      coverageStatus: mappedSlide ? 'covered' : 'missing',
      note: mappedSlide
        ? `${mappedSlide.slideTitle} 장표에서 요구사항을 대응합니다.`
        : '아웃라인에 직접 대응 장표가 없어 자동 보완 대상입니다.',
    };
  });
}

function makeResponseMatrixSlide(slideNumber: number, coverage: RfpRequirementCoverage[]): SlideOutline {
  const priorityCoverage = coverage.filter((item) => item.sourceCategory === 'requiredDeliverables' || item.sourceCategory === 'scopeOfWork');
  const coveredCount = priorityCoverage.filter((item) => item.coverageStatus !== 'missing').length;
  const sampleRows = priorityCoverage
    .slice(0, 8)
    .map((item) => `${item.requirement} → ${item.mappedSlideTitle || '자동 보완 장표'}`)
    .join(' / ');

  return {
    slideNumber,
    slideType: 'RFP Requirement Response',
    slideTitle: 'RFP Requirement Response / 과업 대응표',
    slidePurpose: 'RFP 필수 항목과 과업 범위가 제안서 어디에서 대응되는지 한눈에 확인시키는 요구사항 대응표 장표입니다.',
    keyMessage: `필수 항목과 주요 과업 ${coveredCount}/${priorityCoverage.length}건을 장표 단위로 연결해 누락 없이 대응합니다.`,
    mainCopy: `RFP 요구사항, 대응 장표, 제안 방향, 비고 컬럼으로 필수 항목과 과업 범위를 검수합니다.${sampleRows ? ` 주요 대응: ${sampleRows}` : ''}`,
    confirmNeededNote: '최종 제출 전 발주처 원문 요구사항명과 대응 장표명을 대조하십시오.',
  };
}

function makeRequirementSlide(slideNumber: number, item: RfpRequirementCoverage): SlideOutline {
  const titlePrefix: Record<RequirementSourceCategory, string> = {
    requiredDeliverables: 'Required Deliverable Response',
    scopeOfWork: 'Scope Response',
    evaluationCriteria: 'Evaluation Criteria Response',
    constraints: 'Constraint Response',
  };
  const actionDirection = item.sourceCategory === 'scopeOfWork'
    ? '운영 계획, 제작 범위, 공간 구성, 시스템 계획, 일정, 예산, 인력 운영 중 적절한 실행 계획으로 구체화합니다.'
    : '제안서 필수 포함 내용으로 독립 섹션 또는 장표에서 제안 방향과 산출 형식을 명확히 제시합니다.';

  return {
    slideNumber,
    slideType: titlePrefix[item.sourceCategory],
    slideTitle: `${titlePrefix[item.sourceCategory]}: ${item.requirement}`,
    slidePurpose: `${item.sourceCategory} 요구사항 “${item.requirement}”이 누락되지 않도록 대응 방향을 제시합니다.`,
    keyMessage: `RFP 요구사항 “${item.requirement}”을 제안서 실행 계획에 직접 반영합니다.`,
    mainCopy: `${item.requirement}에 대한 대응 범위, 실행 방식, 산출물 형태를 명확히 제시합니다. ${actionDirection}`,
    confirmNeededNote: 'RFP 원문 표현과 최종 제안 범위의 일치 여부를 확인하십시오.',
  };
}

function renumber(slides: SlideOutline[]) {
  return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function ensureRfpRequirementCoverage(outline: SlideOutline[], analysis: AnalysisResult) {
  let slides = renumber(outline);
  let coverage = buildRequirementCoverageCheck(analysis, slides);
  const priorityItems = coverage.filter((item) => item.sourceCategory === 'requiredDeliverables' || item.sourceCategory === 'scopeOfWork');

  if (priorityItems.length && !slides.some((slide) => /requirement response|과업 대응표|scope response matrix/i.test(`${slide.slideTitle} ${slide.slideType}`))) {
    slides = renumber([slides[0], makeResponseMatrixSlide(2, coverage), ...slides.slice(1)]);
  }

  coverage = buildRequirementCoverageCheck(analysis, slides);
  const missingPriorityItems = coverage
    .filter((item) => (item.sourceCategory === 'requiredDeliverables' || item.sourceCategory === 'scopeOfWork') && item.coverageStatus === 'missing')
    .slice(0, MAX_REQUIREMENT_SLIDES);

  if (missingPriorityItems.length) {
    slides = renumber([...slides, ...missingPriorityItems.map((item, index) => makeRequirementSlide(slides.length + index + 1, item))]);
  }

  return slides;
}
