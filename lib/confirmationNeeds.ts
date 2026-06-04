import type { AnalysisResult } from './types';
import type { ChunkCategory, DocumentChunk } from './rag';

const MAX_CONFIRMATION_NEEDS = 12;

const evidenceCategories = new Set<ChunkCategory>([
  'requiredDeliverables',
  'kpi',
  'performanceGoal',
  'schedule',
  'evaluationCriteria',
  'constraints',
  'existingAsset',
  'venue',
  'referenceOnly',
  'designDirection',
  'operationDirection',
  'backgroundInsight',
]);

const protectedInformationDefinitions = [
  { label: 'KPI', aliases: ['kpi', '성과 지표', '달성 목표', 'performance goal'], categories: ['kpi', 'performanceGoal'] as ChunkCategory[] },
  { label: '일정', aliases: ['일정', '제안서 제출', '대면 보고', '업체 선정', '마감', '오픈', 'schedule'], categories: ['schedule'] as ChunkCategory[] },
  { label: '평가 기준', aliases: ['평가', '평가 기준', '업체선정', '업체 선정', '심사', '배점'], categories: ['evaluationCriteria'] as ChunkCategory[] },
  { label: '장소', aliases: ['장소', '공간', 'venue', '삼성강남', '홍대', '매장 구조'], categories: ['venue'] as ChunkCategory[] },
  { label: '과제 내용', aliases: ['과제', '제안 요청사항', '필수 제안', '요청사항', 'required deliverables'], categories: ['requiredDeliverables'] as ChunkCategory[] },
  { label: '참고 사례', aliases: ['참고 사례', '참고', '사례', '레퍼런스', '별첨 1', '전시 참고 사례'], categories: ['referenceOnly', 'designDirection'] as ChunkCategory[] },
  { label: '기존 자산', aliases: ['기존 자산', '기존', '보유', '활용 가능', '기존 집기', '현재 집기'], categories: ['existingAsset'] as ChunkCategory[] },
  { label: '보안 운영 프로세스', aliases: ['보안 운영 프로세스', '보안 운영', '보안 프로세스'], categories: ['constraints', 'existingAsset', 'operationDirection'] as ChunkCategory[] },
] as const;

const priorityNeedDefinitions = [
  {
    label: '예산 세부 배분',
    aliases: ['예산', '비용', '견적', '금액', 'budget', '세부 배분', '항목별 예산'],
    sufficientEvidence: ['세부 예산', '예산 세부', '예산 배분', '항목별 예산', '견적 내역', '산출 내역'],
    defaultWhenMissing: true,
  },
  {
    label: '제작/운영 포함·제외 범위',
    aliases: ['제작 범위', '운영 범위', '포함 범위', '제외 범위', 'scope', '포함·제외', '포함/제외'],
    sufficientEvidence: ['포함 범위', '제외 범위', '포함/제외', '포함·제외', '제작 범위', '운영 범위'],
    defaultWhenMissing: false,
  },
  {
    label: '최종 공간 도면 / 실측 자료',
    aliases: ['도면', '실측', '공간 도면', '평면도', '공간 자료', '매장 구조'],
    sufficientEvidence: ['최종 도면', '공간 도면', '평면도', '실측', '실측 자료', 'cad', 'dwg'],
    defaultWhenMissing: true,
  },
  {
    label: '사용 가능 집기 상세 리스트',
    aliases: ['집기', '기존 집기', '사용 가능 집기', '집기 리스트', '기존 자산'],
    sufficientEvidence: ['집기 상세', '집기 리스트', '사용 가능 집기', '기존 집기 리스트', '현재 집기 활용 기준'],
    defaultWhenMissing: true,
  },
  {
    label: '브랜드 톤앤매너 / 디자인 가이드',
    aliases: ['브랜드', '톤앤매너', '디자인 가이드', '가이드', '디자인 방향'],
    sufficientEvidence: ['브랜드 톤앤매너', '톤앤매너', '디자인 가이드', '브랜드 가이드', 'visual guide'],
    defaultWhenMissing: true,
  },
  {
    label: '보안 검수 및 설치 가능 범위',
    aliases: ['보안', '검수', '설치 가능', '설치 범위', '반입', '시공 제약'],
    sufficientEvidence: ['보안 검수', '보안 운영 프로세스', '설치 가능 범위', '반입 기준', '시공 제약'],
    defaultWhenMissing: false,
  },
  {
    label: '콘텐츠 제작 범위 / 매체별 스펙',
    aliases: ['콘텐츠', '매체', '스펙', '해상도', 'led', '제작 범위'],
    sufficientEvidence: ['콘텐츠 제작 범위', '매체별 스펙', '해상도', '콘텐츠 사양', 'led 스펙'],
    defaultWhenMissing: true,
  },
  {
    label: '현장 운영 인력 규모',
    aliases: ['운영 인력', '인력 규모', '스태프', '현장 운영', 'staff'],
    sufficientEvidence: ['운영 인력 규모', '인력 규모', '투입 인력', '스태프 수', '현장 운영 인력'],
    defaultWhenMissing: true,
  },
] as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function uniqueItems(items: string[]) {
  const seen = new Set<string>();
  return items
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => {
      if (!item) return false;
      const key = normalize(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function containsAny(text: string, keywords: readonly string[]) {
  const normalized = normalize(text);
  return keywords.some((keyword) => normalized.includes(normalize(keyword)));
}

function getEvidenceText(chunks: DocumentChunk[], categories?: Set<ChunkCategory>) {
  return chunks
    .filter((chunk) => chunk.documentType === 'rfp' && (!categories || (chunk.categories ?? [chunk.category]).some((category) => categories.has(category))))
    .map((chunk) => chunk.chunkText)
    .join('\n');
}

function findPriorityNeed(item: string) {
  return priorityNeedDefinitions.find((definition) => containsAny(item, [definition.label, ...definition.aliases]));
}

function isCoveredByHighImportanceRfpEvidence(item: string, evidenceText: string) {
  const normalizedItem = normalize(item);
  if (!normalizedItem) return false;
  if (normalize(evidenceText).includes(normalizedItem)) return true;

  const significantTokens = normalizedItem.split(/\s+/).filter((token) => token.length >= 2 && !/확인|필요|추가|세부|상세/.test(token));
  if (!significantTokens.length) return false;
  const matchedTokens = significantTokens.filter((token) => normalize(evidenceText).includes(token));
  return matchedTokens.length >= Math.min(2, significantTokens.length);
}

function hasSufficientPriorityEvidence(definition: (typeof priorityNeedDefinitions)[number], allRfpEvidenceText: string) {
  return containsAny(allRfpEvidenceText, definition.sufficientEvidence);
}


function getEvidenceTextForCategories(chunks: DocumentChunk[], categories: readonly ChunkCategory[]) {
  const categorySet = new Set(categories);
  return getEvidenceText(chunks, categorySet);
}

function isProtectedInformationNeed(item: string, chunks: DocumentChunk[], allRfpEvidenceText: string) {
  return protectedInformationDefinitions.some((definition) => {
    if (!containsAny(item, [definition.label, ...definition.aliases])) return false;
    const categoryEvidence = getEvidenceTextForCategories(chunks, definition.categories);
    return containsAny(categoryEvidence || allRfpEvidenceText, definition.aliases);
  });
}

function isCoveredByAnyRfpEvidence(item: string, allRfpEvidenceText: string) {
  return isCoveredByHighImportanceRfpEvidence(item, allRfpEvidenceText);
}

function collectRawNeeds(analysis: AnalysisResult) {
  return uniqueItems([
    ...(analysis.confirmNeeded ?? []),
    ...(analysis.missingInfo ?? []),
    ...(analysis.taskSections?.flatMap((section) => section.confirmNeeded ?? []) ?? []),
    ...(analysis.rfpRequirements?.confirmNeeded ?? []),
    ...(analysis.clientTask?.confirmNeeded ?? []),
    ...(analysis.targetSpaceContentOperation?.confirmNeeded ?? []),
    ...(analysis.kpiTimelineConstraints?.confirmNeeded ?? []),
  ]);
}

export function refineAnalysisConfirmationNeeds(analysis: AnalysisResult, chunks: DocumentChunk[] = []): AnalysisResult {
  const allRfpEvidenceText = getEvidenceText(chunks);
  const highImportanceEvidenceText = getEvidenceText(chunks, evidenceCategories);
  const refined: string[] = [];
  const selectedPriorityLabels = new Set<string>();

  for (const item of collectRawNeeds(analysis)) {
    if (isProtectedInformationNeed(item, chunks, allRfpEvidenceText)) continue;

    const priorityNeed = findPriorityNeed(item);
    if (priorityNeed) {
      if (hasSufficientPriorityEvidence(priorityNeed, allRfpEvidenceText)) continue;
      if (!selectedPriorityLabels.has(priorityNeed.label)) {
        refined.push(priorityNeed.label);
        selectedPriorityLabels.add(priorityNeed.label);
      }
      continue;
    }

    if (isCoveredByHighImportanceRfpEvidence(item, highImportanceEvidenceText)) continue;
    if (isCoveredByAnyRfpEvidence(item, allRfpEvidenceText)) continue;
    refined.push(item.replace(/\s*확인\s*필요\s*$/i, '').trim());
  }

  for (const definition of priorityNeedDefinitions) {
    if (refined.length >= 8) break;
    if (!definition.defaultWhenMissing) continue;
    if (selectedPriorityLabels.has(definition.label)) continue;
    if (hasSufficientPriorityEvidence(definition, allRfpEvidenceText)) continue;
    refined.push(definition.label);
    selectedPriorityLabels.add(definition.label);
  }

  const limitedNeeds = uniqueItems(refined).slice(0, MAX_CONFIRMATION_NEEDS);

  return {
    ...analysis,
    confirmNeeded: limitedNeeds,
    missingInfo: limitedNeeds,
    taskSections: analysis.taskSections?.map((section) => ({ ...section, confirmNeeded: [] })) ?? [],
    rfpRequirements: analysis.rfpRequirements ? { ...analysis.rfpRequirements, confirmNeeded: [] } : analysis.rfpRequirements,
    clientTask: analysis.clientTask ? { ...analysis.clientTask, confirmNeeded: [] } : analysis.clientTask,
    targetSpaceContentOperation: analysis.targetSpaceContentOperation ? { ...analysis.targetSpaceContentOperation, confirmNeeded: [] } : analysis.targetSpaceContentOperation,
    kpiTimelineConstraints: analysis.kpiTimelineConstraints ? { ...analysis.kpiTimelineConstraints, confirmNeeded: [] } : analysis.kpiTimelineConstraints,
  };
}
