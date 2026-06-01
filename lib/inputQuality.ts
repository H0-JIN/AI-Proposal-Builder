import type { AnalysisResult, ProjectInput } from './types';

export type MissingInfoKey =
  | 'projectPurpose'
  | 'spaceLocationScale'
  | 'target'
  | 'experienceElements'
  | 'brandMessage'
  | 'schedule'
  | 'budgetScope'
  | 'designTone'
  | 'exclusions';

export interface MissingInfoItem {
  key: MissingInfoKey;
  label: string;
  description: string;
}

export interface InputQualityResult {
  level: 'low' | 'medium' | 'high';
  score: number;
  briefLength: number;
  isInsufficient: boolean;
  missingItems: MissingInfoItem[];
  presentItems: MissingInfoItem[];
  aiMissingInfo: string[];
  guidance: string;
}

const REQUIRED_INFO_ITEMS: MissingInfoItem[] = [
  {
    key: 'projectPurpose',
    label: '프로젝트 목적',
    description: '브랜드/제품이 이번 제안서로 달성해야 하는 목표, 해결 과제, KPI',
  },
  {
    key: 'spaceLocationScale',
    label: '공간 위치 및 규모',
    description: '도시/상권/행사 장소, 면적, 예상 동선, 운영 기간 또는 공간 조건',
  },
  {
    key: 'target',
    label: '타깃 고객층',
    description: '핵심 방문자/고객군, 연령대, 관심사, 초청 대상 또는 페르소나',
  },
  {
    key: 'experienceElements',
    label: '필수 체험 요소',
    description: '반드시 포함해야 하는 콘텐츠, 프로그램, 인터랙션, 이벤트, 전시 요소',
  },
  {
    key: 'brandMessage',
    label: '제품 및 브랜드 핵심 메시지',
    description: '전달해야 하는 브랜드 가치, 제품 USP, 캠페인 슬로건, 커뮤니케이션 메시지',
  },
  {
    key: 'schedule',
    label: '일정',
    description: '오픈일, 준비 기간, 운영 기간, 주요 마일스톤, 납품 일정',
  },
  {
    key: 'budgetScope',
    label: '예산 및 제작 범위',
    description: '예산 수준, 포함/제외 제작 범위, 운영 범위, 산출물 범위',
  },
  {
    key: 'designTone',
    label: '디자인 톤앤매너',
    description: '브랜드 무드, 레퍼런스, 컬러/소재/공간 연출 방향, 지양할 스타일',
  },
  {
    key: 'exclusions',
    label: '제외 사항',
    description: '제안서에서 다루지 말아야 할 영역, 금지 표현, 제외 예산/업무/콘텐츠',
  },
];

const KEYWORD_GROUPS: Record<MissingInfoKey, RegExp[]> = {
  projectPurpose: [/목표|목적|과제|해결|달성|KPI|성과|인지|전환|브랜딩|런칭|홍보/i],
  spaceLocationScale: [/위치|장소|공간|면적|규모|평|㎡|제곱|상권|동선|팝업|체험관|전시|매장|부스/i],
  target: [/타깃|타겟|대상|고객|방문객|소비자|페르소나|MZ|2030|3040|B2B|VIP|가족|팬/i],
  experienceElements: [/체험|콘텐츠|프로그램|존|미디어|인터랙티브|이벤트|시승|굿즈|포토|워크숍|데모|게임|AR|VR/i],
  brandMessage: [/메시지|핵심|USP|제품|브랜드|슬로건|가치|비전|차별화|기술|혁신|지속가능|프리미엄/i],
  schedule: [/일정|기간|오픈|마감|납기|운영|주간|개월|월\s*\d+일|\d+주|\d+개월|D-\d+/i],
  budgetScope: [/예산|비용|규모|범위|제작|시공|운영|포함|견적|원|만원|억원|중간 규모|저예산|고예산/i],
  designTone: [/톤|톤앤매너|무드|디자인|스타일|컬러|소재|프리미엄|미니멀|미래|따뜻|고급|레퍼런스/i],
  exclusions: [/제외|지양|금지|불가|하지 않|미포함|제약|주의|리스크|없어야|제한/i],
};

const AI_MISSING_MATCHERS: Record<MissingInfoKey, RegExp[]> = {
  projectPurpose: [/목적|목표|과제|KPI|성과|왜|배경/i],
  spaceLocationScale: [/위치|장소|공간|규모|면적|동선|입지/i],
  target: [/타깃|타겟|대상|고객|방문객|페르소나/i],
  experienceElements: [/체험|콘텐츠|프로그램|구성|필수|요소/i],
  brandMessage: [/메시지|브랜드|제품|USP|핵심|가치|슬로건/i],
  schedule: [/일정|기간|오픈|마일스톤|납기|운영 기간/i],
  budgetScope: [/예산|범위|제작|운영|비용|산출물/i],
  designTone: [/톤|톤앤매너|무드|디자인|스타일|레퍼런스/i],
  exclusions: [/제외|지양|금지|불가|제약|주의/i],
};

export const inputQualityChecklist = REQUIRED_INFO_ITEMS;

function normalizeText(input: ProjectInput) {
  return [input.projectName, input.clientName, input.briefText].filter(Boolean).join('\n');
}

function getAiMissingKeys(missingInfo: string[]) {
  const keys = new Set<MissingInfoKey>();

  missingInfo.forEach((item) => {
    Object.entries(AI_MISSING_MATCHERS).forEach(([key, patterns]) => {
      if (patterns.some((pattern) => pattern.test(item))) {
        keys.add(key as MissingInfoKey);
      }
    });
  });

  return keys;
}

export function assessInputQuality(input: ProjectInput, analysis?: AnalysisResult): InputQualityResult {
  const text = normalizeText(input);
  const briefLength = input.briefText.trim().replace(/\s+/g, ' ').length;
  const aiMissingInfo = analysis?.missingInfo?.filter(Boolean) ?? [];
  const aiMissingKeys = getAiMissingKeys(aiMissingInfo);

  const presentItems = REQUIRED_INFO_ITEMS.filter((item) => {
    const hasKeywordEvidence = KEYWORD_GROUPS[item.key].some((pattern) => pattern.test(text));
    return hasKeywordEvidence && !aiMissingKeys.has(item.key);
  });

  const missingItems = REQUIRED_INFO_ITEMS.filter((item) => !presentItems.some((present) => present.key === item.key));
  const coverageScore = presentItems.length / REQUIRED_INFO_ITEMS.length;
  const lengthScore = Math.min(1, briefLength / 450);
  const score = Math.round((coverageScore * 0.75 + lengthScore * 0.25) * 100);
  const level: InputQualityResult['level'] = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';
  const isInsufficient = briefLength < 220 || missingItems.length >= 4 || level === 'low' || aiMissingInfo.length >= 4;

  return {
    level,
    score,
    briefLength,
    isInsufficient,
    missingItems,
    presentItems,
    aiMissingInfo,
    guidance: isInsufficient
      ? '입력 정보가 부족하면 결과물이 일반적으로 생성될 수 있습니다. 아래 항목을 보완하면 더 구체적인 제안서가 생성됩니다.'
      : '핵심 정보가 비교적 충분합니다. 누락 항목은 생성 결과에서 확인 필요로 표시됩니다.',
  };
}
