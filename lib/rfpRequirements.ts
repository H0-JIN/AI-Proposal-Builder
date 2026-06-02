import type { AnalysisResult, RfpRequirementCoverage, SlideOutline } from './types';

type RequirementSourceCategory = RfpRequirementCoverage['sourceCategory'];

const MAX_SUPPLEMENT_SLIDES = 6;
const MATRIX_ROWS_PER_SLIDE = 10;

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

function sourceLabel(sourceCategory: RequirementSourceCategory) {
  const labels: Record<RequirementSourceCategory, string> = {
    requiredDeliverables: '필수 산출물',
    scopeOfWork: '과업 범위',
    evaluationCriteria: '평가/성과',
    constraints: '제약/일정',
  };
  return labels[sourceCategory];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function makeResponseMatrixSlide(slideNumber: number, coverage: RfpRequirementCoverage[], pageIndex: number, totalPages: number): SlideOutline {
  const priorityCoverage = coverage.filter((item) => item.sourceCategory === 'requiredDeliverables' || item.sourceCategory === 'scopeOfWork');
  const coveredCount = priorityCoverage.filter((item) => item.coverageStatus !== 'missing').length;
  const pageRows = chunk(priorityCoverage, MATRIX_ROWS_PER_SLIDE)[pageIndex] ?? [];
  const rows = pageRows
    .map((item) => `[${sourceLabel(item.sourceCategory)}] ${item.requirement} → ${item.mappedSlideTitle || '본문 장표/보완 섹션에 통합'}`)
    .join(' / ');

  return {
    slideNumber,
    slideType: 'RFP Requirement Response',
    slideTitle: totalPages > 1 ? `RFP Requirement Response / 과업 대응표 ${pageIndex + 1}` : 'RFP Requirement Response / 과업 대응표',
    slidePurpose: 'RFP 필수 항목과 과업 범위는 개별 체크리스트 장표로 분산하지 않고 본문 섹션 및 대응표 안에서 누락 없이 연결합니다.',
    keyMessage: `필수 항목과 주요 과업 ${coveredCount}/${priorityCoverage.length}건을 본문 섹션과 대응표로 연결해 과도한 단독 장표 생성을 방지합니다.`,
    mainCopy: `RFP 요구사항, 대응 섹션, 제안 방향, 비고 컬럼으로 과업을 검수합니다.${rows ? ` 대응 항목: ${rows}` : ''}`,
    confirmNeededNote: '최종 제출 전 발주처 원문 요구사항명과 대응 섹션명을 대조하십시오.',
  };
}

const supplementGroups: Array<{ title: string; pattern: RegExp; direction: string }> = [
  { title: 'Portfolio / Organization', pattern: /포트폴리오|실적|조직|전담|인력|회사|수행사|팀|organization|portfolio/i, direction: '수행 실적, 전담 조직, 역할 분담과 책임 체계를 한 섹션에서 제시합니다.' },
  { title: 'Budget & Scope', pattern: /예산|견적|비용|금액|범위|scope|budget|제외|포함/i, direction: '포함/제외 범위, 견적 요약, 과업 경계를 명확히 정리합니다.' },
  { title: 'System / Equipment', pattern: /시스템|장비|LED|음향|조명|프롬프터|키오스크|등록|equipment|system/i, direction: '현장 시스템과 장비 운영 기준, 백업 운영 방식을 통합 제시합니다.' },
  { title: 'Setup / Dismantling', pattern: /설치|철거|셋업|반입|반출|시공|전환|dismantling|setup/i, direction: '설치, 전환, 철거 일정과 현장 반입·반출 계획을 묶어 관리합니다.' },
  { title: 'Content Production', pattern: /콘텐츠|영상|디자인|제작|KV|PPT|템플릿|content|production/i, direction: '제작물의 역할, 산출 형식, 검수 기준을 콘텐츠 제작 계획으로 통합합니다.' },
  { title: 'Hospitality / Reception', pattern: /의전|리셉션|접수|안내|케이터링|만찬|네트워킹|hospitality|reception/i, direction: '등록, 안내, 의전, 케이터링과 네트워킹 운영을 참석자 경험 관점에서 정리합니다.' },
  { title: 'Compliance / Exclusions', pattern: /법규|안전|보안|개인정보|보험|준수|제외|리스크|compliance|risk/i, direction: '준수 사항, 리스크, 제외 조건과 확인 필요 범위를 명확히 분리합니다.' },
];

function groupMissingItems(items: RfpRequirementCoverage[]) {
  const grouped = new Map<string, RfpRequirementCoverage[]>();
  items.forEach((item) => {
    const group = supplementGroups.find((candidate) => candidate.pattern.test(item.requirement));
    const title = group?.title ?? (item.sourceCategory === 'scopeOfWork' ? 'Budget & Scope' : 'Content Production');
    grouped.set(title, [...(grouped.get(title) ?? []), item]);
  });
  return Array.from(grouped.entries()).slice(0, MAX_SUPPLEMENT_SLIDES);
}

function makeSupplementSlide(slideNumber: number, title: string, items: RfpRequirementCoverage[]): SlideOutline {
  const group = supplementGroups.find((candidate) => candidate.title === title);
  const requirements = items.map((item) => `[${sourceLabel(item.sourceCategory)}] ${item.requirement}`).join(' / ');

  return {
    slideNumber,
    slideType: 'RFP Requirement Supplement',
    slideTitle: `${title} 대응 보완`,
    slidePurpose: '기존 본문 장표와 과업 대응표에 직접 매핑하기 어려운 유사 요구사항을 하나의 보완 섹션으로 묶어 처리합니다.',
    keyMessage: `${title} 관련 RFP 요구사항을 항목별 단독 장표가 아니라 통합 실행 계획으로 보완합니다.`,
    mainCopy: `${group?.direction ?? '유사 요구사항을 하나의 실행 계획으로 묶어 대응합니다.'} 대응 요구사항: ${requirements}`,
    confirmNeededNote: '보완 섹션의 상세 범위와 최종 산출 형식은 RFP 원문 및 발주처 질의응답 기준으로 확인하십시오.',
  };
}

function reinforceExistingSlides(slides: SlideOutline[], missingItems: RfpRequirementCoverage[]) {
  const updated = slides.map((slide) => ({ ...slide }));
  const stillMissing: RfpRequirementCoverage[] = [];

  missingItems.forEach((item) => {
    const group = supplementGroups.find((candidate) => candidate.pattern.test(item.requirement));
    const target = updated.find((slide) => {
      const text = `${slide.slideType} ${slide.slideTitle} ${slide.slidePurpose} ${slide.keyMessage}`;
      return group?.pattern.test(text) || mapRequirementToSlide(group?.title ?? item.requirement, [slide]);
    });

    if (!target) {
      stillMissing.push(item);
      return;
    }

    const note = `RFP 보완 반영: ${item.requirement}`;
    if (!target.mainCopy.includes(item.requirement)) {
      target.mainCopy = `${target.mainCopy} ${note}`.trim();
    }
    target.confirmNeededNote = [target.confirmNeededNote, note].filter(Boolean).join('\n');
  });

  return { slides: updated, stillMissing };
}

function hasMatrixSlide(slides: SlideOutline[]) {
  return slides.some((slide) => /requirement response|과업 대응표|scope response matrix/i.test(`${slide.slideTitle} ${slide.slideType}`));
}

function renumber(slides: SlideOutline[]) {
  return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function ensureRfpRequirementCoverage(outline: SlideOutline[], analysis: AnalysisResult) {
  let slides = renumber(outline);
  let coverage = buildRequirementCoverageCheck(analysis, slides);
  const priorityItems = coverage.filter((item) => item.sourceCategory === 'requiredDeliverables' || item.sourceCategory === 'scopeOfWork');

  if (priorityItems.length && !hasMatrixSlide(slides)) {
    const matrixPageCount = Math.min(2, Math.max(1, Math.ceil(priorityItems.length / MATRIX_ROWS_PER_SLIDE)));
    const matrixSlides = Array.from({ length: matrixPageCount }, (_, index) => makeResponseMatrixSlide(index + 2, coverage, index, matrixPageCount));
    slides = renumber([slides[0], ...matrixSlides, ...slides.slice(1)]);
  }

  coverage = buildRequirementCoverageCheck(analysis, slides);
  const missingPriorityItems = coverage.filter(
    (item) => (item.sourceCategory === 'requiredDeliverables' || item.sourceCategory === 'scopeOfWork') && item.coverageStatus === 'missing',
  );

  if (missingPriorityItems.length) {
    const reinforced = reinforceExistingSlides(slides, missingPriorityItems);
    slides = renumber(reinforced.slides);

    if (reinforced.stillMissing.length) {
      const supplementSlides = groupMissingItems(reinforced.stillMissing).map(([title, items], index) => makeSupplementSlide(slides.length + index + 1, title, items));
      slides = renumber([...slides, ...supplementSlides]);
    }
  }

  return slides;
}
