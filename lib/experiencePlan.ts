import type { SlideOutline } from '@/lib/types';

export const experienceDetailFields = [
  'slideTitle',
  'keyMessage',
  'mainCopy',
  'visitorAction',
  'contentMechanism',
  'spatialPlacement',
  'mediaOrObject',
  'outputOrReward',
  'imagePlaceholder',
  'visualPrompt',
  'diagramSuggestion',
] as const;

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
    slideTitle: 'Zone Detail 01',
    slidePurpose: '첫 번째 핵심 체험 존의 관람객 행동, 콘텐츠 장치, 산출물을 상세화한다.',
    keyMessage: '핵심 체험 단위별로 공간 배치와 콘텐츠 메커니즘을 분리해 실행 가능한 존 기획으로 전개한다.',
  },
  {
    slideType: 'Spatial / Content Plan - Zone Detail 02',
    slideTitle: 'Zone Detail 02',
    slidePurpose: '두 번째 핵심 체험 존의 관람객 행동, 콘텐츠 장치, 산출물을 상세화한다.',
    keyMessage: '후속 체험 존은 앞선 경험의 감정과 데이터를 이어받아 더 깊은 참여 또는 공유 행동으로 연결한다.',
  },
  {
    slideType: 'Spatial / Content Plan - Experience Scenario',
    slideTitle: 'Experience Scenario',
    slidePurpose: 'Entry, Attention, Interaction, Feedback, Output, Share 단계의 관람객 흐름을 정리한다.',
    keyMessage: '관람객 여정은 진입부터 공유까지 끊기지 않는 행동-반응-보상 구조로 설계한다.',
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
    slidePurpose: '대표 미디어 장면과 이미지 생성용 프롬프트를 제시한다.',
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
    confirmNeededNote: base?.confirmNeededNote ?? '',
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

export function expandExperiencePlanOutline(outline: SlideOutline[]) {
  let hasSpatial = false;
  let hasMedia = false;
  const expanded: SlideOutline[] = [];

  outline.forEach((slide) => {
    if (isSpatialPlan(slide)) {
      if (!hasSpatial) {
        expanded.push(...spatialPlanSlides.map((template) => buildExpandedSlide(slide, template)));
        hasSpatial = true;
      }
      return;
    }

    if (isMediaPlan(slide)) {
      if (!hasMedia) {
        expanded.push(...mediaPlanSlides.map((template) => buildExpandedSlide(slide, template)));
        hasMedia = true;
      }
      return;
    }

    expanded.push(slide);
  });

  let completed = expanded;
  if (!hasSpatial) {
    completed = insertBeforeMediaOrClosing(completed, spatialPlanSlides.map((template) => buildExpandedSlide(undefined, template)));
  }
  if (!hasMedia) {
    const closingIndex = completed.findIndex((slide) => /closing|마무리|expected|effect|기대|operation|운영/i.test(`${slide.slideType} ${slide.slideTitle}`));
    const insertIndex = closingIndex >= 0 ? closingIndex : completed.length;
    completed = [...completed.slice(0, insertIndex), ...mediaPlanSlides.map((template) => buildExpandedSlide(undefined, template)), ...completed.slice(insertIndex)];
  }

  return renumber(completed);
}
