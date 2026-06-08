import { isUsableRagText, sanitizeCorruptedText } from './extractedTextValidation';
import type { ProposalType } from './types';

export const chunkCategories = [
  'requiredDeliverables',
  'scopeOfWork',
  'evaluationCriteria',
  'projectObjective',
  'kpi',
  'performanceGoal',
  'productFeature',
  'constraints',
  'schedule',
  'budget',
  'venue',
  'program',
  'registration',
  'systemOperation',
  'boothOperation',
  'catering',
  'staffing',
  'portfolio',
  'organization',
  'riskManagement',
  'setupDismantling',
  'designDirection',
  'operationDirection',
  'backgroundInsight',
  'concept',
  'approach',
  'projectPurpose',
  'target',
  'referenceOnly',
  'existingAsset',
  'unknown',
] as const;

export type ChunkCategory = (typeof chunkCategories)[number];
export type ChunkImportance = 'high' | 'medium' | 'low';
export type DocumentType = 'rfp' | 'finalProposal' | 'portfolio' | 'template' | 'reference' | 'budgetSample' | 'scheduleSample' | 'organizationSample';
export type ChunkSourceType = 'textExtraction' | 'visionAnalysis' | 'userInput' | 'manualMemo';

export interface DocumentChunk {
  id: string;
  documentId: string;
  documentName: string;
  documentType: DocumentType;
  pageNumber?: number;
  chunkIndex: number;
  chunkText: string;
  visualSummary?: string;
  sourceType: ChunkSourceType;
  category: ChunkCategory;
  categories?: ChunkCategory[];
  tags: string[];
  importance: ChunkImportance;
  createdAt: string;
  proposalType?: ProposalType;
  index?: string;
  sectionTitle?: string;
  slideTitle?: string;
  slideNumber?: number;
  slidePurpose?: string;
  keyMessage?: string;
  clientTemplate?: string;
  usefulPattern?: string;
}

export type RetrievalStage = 'analysis' | 'concept' | 'outline' | 'slide' | 'finalReview';

export interface RetrievalQuery {
  projectId?: string;
  stage: RetrievalStage;
  proposalType?: ProposalType;
  slideTitle?: string;
  categories?: ChunkCategory[];
  query?: string;
  limit?: number;
  chunks?: DocumentChunk[];
  categoryMatchMode?: 'boost' | 'filter';
  categoryWeights?: Partial<Record<ChunkCategory, number>>;
}


export interface RetrievalCategoryGroup {
  label: string;
  description?: string;
  categories: ChunkCategory[];
  limit?: number;
}

const stageCategories: Record<RetrievalStage, ChunkCategory[]> = {
  analysis: ['requiredDeliverables', 'projectObjective', 'performanceGoal', 'evaluationCriteria', 'constraints', 'schedule', 'productFeature', 'scopeOfWork', 'kpi', 'budget', 'venue', 'existingAsset', 'designDirection', 'backgroundInsight', 'referenceOnly', 'operationDirection'],
  concept: ['requiredDeliverables', 'performanceGoal', 'venue', 'referenceOnly', 'constraints', 'productFeature', 'designDirection', 'projectObjective', 'target', 'backgroundInsight', 'existingAsset'],
  outline: ['requiredDeliverables', 'evaluationCriteria', 'performanceGoal', 'constraints', 'venue', 'productFeature', 'scopeOfWork', 'projectObjective', 'kpi', 'schedule', 'budget', 'referenceOnly', 'existingAsset', 'designDirection', 'operationDirection'],
  slide: ['requiredDeliverables', 'scopeOfWork', 'projectObjective', 'kpi', 'performanceGoal', 'productFeature', 'evaluationCriteria', 'constraints', 'schedule', 'program', 'venue', 'registration', 'systemOperation', 'boothOperation', 'catering', 'staffing', 'portfolio', 'organization', 'riskManagement', 'setupDismantling', 'existingAsset', 'designDirection', 'backgroundInsight', 'referenceOnly', 'operationDirection', 'concept', 'approach'],
  finalReview: ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria'],
};

const categoryKeywords: Record<ChunkCategory, string[]> = {
  requiredDeliverables: ['필수', '제출', '산출물', 'deliverable', '제안서', '포함', '제안 항목', '요구 항목', '제출물', '제안 요청사항', '과제 1', '과제 2', '필수 제안', '제안 필요', '운영 방안 제안', '콘텐츠 제안', '전시 제안', '공간 구성 제안', '실행안 필요'],
  scopeOfWork: ['과업', '범위', 'scope', '수행', '대행', '제작', '개발', '운영', '설치', '철거', '납품'],
  evaluationCriteria: ['평가', '심사', '배점', '가점', '선정 기준', 'evaluation', 'criteria', 'score', '업체선정', '업체 선정', '개별 과제로 평가', '아이디어 중심 평가', '2차 제안 요청'],
  constraints: ['제약', '조건', '금지', '제외', '제한', '준수', '리스크', '유의', '보안', 'AI 클래스 미운영', '보안 운영 프로세스', '별도 제약', '가이드 無', '가이드 무'],
  schedule: ['일정', '기간', '마감', '착수', '완료', '납기', '오픈', '운영일', 'timeline', 'schedule', '제안서 제출', '대면 보고', '업체 선정 결과 통보', '5/29', '6/1', '6/2'],
  budget: ['예산', '비용', '견적', '금액', 'budget', 'price', '원', 'vat'],
  venue: ['장소', '공간', 'venue', '홀', '회의실', '전시장', '부스', '동선', 'floor', '삼성강남', '홍대', '회전식 계단', '오디토리움', '포비 공간', '매장 구조', '베뉴별 공간 특색'],
  program: ['프로그램', '세션', 'agenda', '행사', '포럼', '컨퍼런스', '네트워킹', '만찬'],
  registration: ['등록', '접수', '키오스크', 'check-in', '참가자 db', '현장 등록'],
  systemOperation: ['시스템', '음향', '조명', 'led', '프롬프터', '장비', '송출', '운영'],
  boothOperation: ['부스', '전시', '파트너', '스폰서', 'pavilion', '부스 운영'],
  catering: ['케이터링', '식음', '만찬', '오찬', '커피', '다과'],
  staffing: ['인력', '스태프', 'staff', '운영 조직', '역할', '배치'],
  portfolio: ['포트폴리오', '실적', '사례', '수행 경험', 'reference project', '레퍼런스'],
  organization: ['조직', 'pm', 'r&r', '보고 체계', '커뮤니케이션', '팀 구성'],
  riskManagement: ['리스크', '위험', '안전', '비상', '대응', '백업', 'contingency'],
  setupDismantling: ['설치', '철거', '반입', '반출', '시공', '셋업', '원상복구'],
  designDirection: ['디자인', '톤앤매너', 'visual', '공간 연출', '무드', 'look', '브랜딩', '전시 참고 사례', '디자인 레퍼런스', '연출 참고', 'reference image', 'benchmark'],
  operationDirection: ['운영 방향', '운영 방안', '운영 계획', '운영 프로세스', '동선 운영', '현장 운영', '보안 운영 프로세스'],
  backgroundInsight: ['배경', '인사이트', '현황', '전년', '전년비', 'lesson learned', '레슨런드', '문제점', '방문객 확대'],
  concept: ['콘셉트', '컨셉', 'concept', 'core idea', 'big idea', '메시지'],
  approach: ['전략', '접근', '방향', '방법론', 'approach', 'strategy', '운영 방식'],
  projectPurpose: ['목적', '배경', '기대효과', 'goal', 'objective', 'why', '프로젝트 개요'],
  projectObjective: ['프로젝트 목표', '목표', 'objective', 'project objective', '달성 목표', '추진 목표', '핵심 목표'],
  target: ['타깃', '대상', '고객', '참석자', '방문객', 'audience', 'target'],
  referenceOnly: ['참고', '예시', '예:', '벤치마크', '레퍼런스', '사례', 'reference', 'lesson learned', '별첨', '전시 참고 사례', '디자인 레퍼런스', '기존 사례', '참고 이미지'],
  existingAsset: ['기존', '보유', '활용 가능', '현재', 'as-is', '자산', '기집행', '기존 집기 활용', '내부 LED', '파사드', '스페이셜 사이니지', '현재 집기 활용 기준'],
  productFeature: ['Q8', 'H8', 'B8', '제품 특징', '제품 특장점', '핵심 기능', '주요 기능', 'key feature', 'feature', 'value proposition', '가치 제안', '제품 가치', '멀티태스킹', '폼팩터', '전면 디스플레이', '셀피'],
  kpi: ['KPI', 'kpi 달성 목표', '방문객 확대', '전년비', '1.1배', '25% 이상', '비중 확대', '상담', '판매 긍정 지표', '성과 지표', '목표 지표'],
  performanceGoal: ['성과 목표', '달성 목표', '방문객 확대', '전년비', '1.1배', '25% 이상', '비중 확대', '상담/판매 긍정 지표', '긍정 지표'],
  unknown: [],
};

const highCategories = new Set<ChunkCategory>(['requiredDeliverables', 'scopeOfWork', 'projectObjective', 'kpi', 'performanceGoal', 'productFeature', 'evaluationCriteria']);
const mediumHighCategories = new Set<ChunkCategory>(['constraints', 'schedule', 'budget', 'venue', 'existingAsset']);

const primaryCategoryPriority: ChunkCategory[] = [
  'requiredDeliverables',
  'kpi',
  'performanceGoal',
  'productFeature',
  'schedule',
  'evaluationCriteria',
  'constraints',
  'existingAsset',
  'venue',
  'designDirection',
  'operationDirection',
  'backgroundInsight',
  'referenceOnly',
  'scopeOfWork',
  'projectObjective',
];

const multiLabelBoosts: Partial<Record<ChunkCategory, RegExp[]>> = {
  requiredDeliverables: [/제안\s*요청사항/i, /과제\s*[12]/i, /필수\s*(제안|요청|포함)/i, /실행안\s*(필요|제안)|제안\s*필요/i],
  kpi: [/kpi\s*달성\s*목표/i, /kpi/i, /성과\s*지표/i, /목표\s*지표/i],
  performanceGoal: [/달성\s*목표/i, /성과\s*목표/i, /전년비|\d+(?:\.\d+)?\s*배|\d+\s*%/i],
  productFeature: [/\b(?:Q8|H8|B8)\b/i, /제품\s*(?:특징|특장점|기능|가치)/i, /핵심\s*기능|주요\s*기능|가치\s*제안/i],
  schedule: [/일정/i, /제안서\s*제출|대면\s*보고|업체\s*선정|통보/i, /\d{1,2}\s*\/\s*\d{1,2}/],
  evaluationCriteria: [/평가/i, /업체\s*선정/i, /배점|심사|가점/i],
  constraints: [/보안\s*운영\s*프로세스/i, /보안|준수|제약|제한|유의/i],
  existingAsset: [/별첨\s*2/i, /기존|현재|보유|활용\s*가능/i, /보안\s*운영\s*프로세스/i],
  venue: [/장소|공간|삼성강남|홍대|매장|오디토리움|동선/i],
  designDirection: [/별첨\s*1/i, /전시\s*참고\s*사례/i, /디자인|브랜딩|아트월|모뉴먼트|쇼케이스/i],
  referenceOnly: [/별첨\s*1/i, /참고|예시|사례|레퍼런스|벤치마크/i],
  operationDirection: [/운영\s*방향/i, /운영\s*(방안|계획|프로세스)/i, /현장\s*운영|동선\s*운영/i],
  backgroundInsight: [/상반기\s*운영/i, /lesson\s*learned/i, /레슨런드|레슨\s*런드|인사이트|현황|전년비/i],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokenize(value: string) {
  return Array.from(new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 2))).slice(0, 24);
}

function scoreKeywordHits(text: string, keywords: string[]) {
  const normalized = normalize(text);
  return keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalize(keyword);
    if (!normalizedKeyword || !normalized.includes(normalizedKeyword)) return score;
    const isSpecificPhrase = normalizedKeyword.includes(' ') || /\d/.test(normalizedKeyword) || normalizedKeyword.length >= 6;
    return score + (isSpecificPhrase ? 4 : 1);
  }, 0);
}

export function inferDocumentType(fileName: string): DocumentType {
  const name = normalize(fileName);
  if (/final|최종|기존 제안|proposal/.test(name)) return 'finalProposal';
  if (/portfolio|포트폴리오|실적/.test(name)) return 'portfolio';
  if (/template|템플릿|양식/.test(name)) return 'template';
  if (/budget|견적|예산/.test(name)) return 'budgetSample';
  if (/schedule|일정/.test(name)) return 'scheduleSample';
  if (/organization|조직|인력/.test(name)) return 'organizationSample';
  if (/reference|레퍼런스|참고|사례/.test(name)) return 'reference';
  return 'rfp';
}

function scoreCategory(text: string, category: ChunkCategory) {
  const keywordScore = scoreKeywordHits(text, categoryKeywords[category]);
  const boostScore = (multiLabelBoosts[category] ?? []).reduce((score, pattern) => score + (pattern.test(text) ? 10 : 0), 0);
  return keywordScore + boostScore;
}

function documentTypeDefaultCategories(documentType: DocumentType): ChunkCategory[] | undefined {
  if (documentType === 'portfolio') return ['portfolio'];
  if (documentType === 'template') return ['existingAsset'];
  if (documentType === 'budgetSample') return ['budget'];
  if (documentType === 'scheduleSample') return ['schedule'];
  if (documentType === 'organizationSample') return ['organization'];
  if (documentType === 'reference') return ['referenceOnly'];
  return undefined;
}


function orderInferredCategories(categories: ChunkCategory[], text: string) {
  const contextualPriority: ChunkCategory[] = [];
  if (/\b(?:Q8|H8|B8)\b/i.test(text)) contextualPriority.push('productFeature');
  if (/kpi/i.test(text)) contextualPriority.push('kpi', 'performanceGoal');
  if (/별첨\s*2|보안\s*운영\s*프로세스/i.test(text)) contextualPriority.push('constraints', 'existingAsset', 'operationDirection');
  if (/별첨\s*1|전시\s*참고\s*사례/i.test(text)) contextualPriority.push('referenceOnly', 'designDirection');
  if (/lesson\s*learned|레슨런드|레슨\s*런드|상반기\s*운영/i.test(text)) contextualPriority.push('backgroundInsight');
  if (/과제\s*[12]|제안\s*요청사항/i.test(text)) contextualPriority.push('requiredDeliverables');

  if (!contextualPriority.length) return categories;
  const priority = new Map(contextualPriority.map((category, index) => [category, contextualPriority.length - index]));
  return [...categories].sort((a, b) => (priority.get(b) ?? 0) - (priority.get(a) ?? 0));
}

export function inferChunkCategories(text: string, documentType: DocumentType): ChunkCategory[] {
  const defaultCategories = documentTypeDefaultCategories(documentType);
  if (defaultCategories) return defaultCategories;

  const scored = chunkCategories
    .filter((category) => category !== 'unknown')
    .map((category) => ({ category, score: scoreCategory(text, category) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      const priorityDiff = (primaryCategoryPriority.indexOf(a.category) === -1 ? 999 : primaryCategoryPriority.indexOf(a.category)) - (primaryCategoryPriority.indexOf(b.category) === -1 ? 999 : primaryCategoryPriority.indexOf(b.category));
      return b.score - a.score || priorityDiff;
    });

  if (!scored.length) return [documentType === 'finalProposal' ? 'referenceOnly' : 'unknown'];

  const scoreThreshold = Math.max(2, Math.floor(scored[0].score * 0.35));
  const categories = scored
    .filter((item) => item.score >= scoreThreshold)
    .map((item) => item.category)
    .filter((category) => !(documentType === 'finalProposal' && ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria'].includes(category)))
    .slice(0, 5);

  return orderInferredCategories(categories.length ? categories : [documentType === 'finalProposal' ? 'referenceOnly' : scored[0].category], text);
}

export function inferChunkCategory(text: string, documentType: DocumentType): ChunkCategory {
  return inferChunkCategories(text, documentType)[0];
}

export function inferChunkImportance(category: ChunkCategory, text: string): ChunkImportance {
  if (highCategories.has(category)) return 'high';
  if (mediumHighCategories.has(category)) return /필수|반드시|제출|마감|계약|준수|예산|총액|deadline|must/i.test(text) ? 'high' : 'medium';
  if (category === 'referenceOnly' || category === 'existingAsset') return 'low';
  if (category === 'unknown') return text.length > 500 ? 'medium' : 'low';
  return 'medium';
}

function splitTextIntoChunks(text: string, maxLength = 1200) {
  const blocks = text.split(/\n{2,}|(?=\n?\s*(?:제\s*\d+\s*[장절]|\d+[.)]|[A-Z]\.))/g).map((block) => block.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  for (const block of blocks.length ? blocks : [text]) {
    if ((buffer + '\n\n' + block).trim().length <= maxLength) {
      buffer = [buffer, block].filter(Boolean).join('\n\n');
      continue;
    }
    if (buffer) chunks.push(buffer);
    if (block.length <= maxLength) {
      buffer = block;
    } else {
      for (let index = 0; index < block.length; index += maxLength) chunks.push(block.slice(index, index + maxLength));
      buffer = '';
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function extractFinalProposalMetadata(text: string) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^(\d+\.?\s*)?(section|chapter|part|[가-힣A-Za-z ].{2,40})$/i.test(line)) ?? '';
  const slideLine = lines.find((line) => /slide|슬라이드|장표|page|페이지/i.test(line)) ?? heading;
  return {
    index: lines.slice(0, 5).join(' / ').slice(0, 240),
    sectionTitle: heading.slice(0, 120),
    slideTitle: slideLine.replace(/^(slide|슬라이드|장표|page|페이지)\s*\d*[:.)-]?\s*/i, '').slice(0, 120),
    slidePurpose: (lines.find((line) => /목적|purpose|역할/i.test(line)) ?? '').slice(0, 180),
    keyMessage: (lines.find((line) => /핵심|message|key/i.test(line)) ?? lines[1] ?? '').slice(0, 220),
    clientTemplate: lines.some((line) => /template|템플릿|master|가이드/i.test(line)) ? 'clientTemplate' : '',
    usefulPattern: lines.find((line) => /구조|패턴|framework|목차|index|outline/i.test(line))?.slice(0, 180) ?? '',
  };
}

export function createDocumentChunks(params: {
  documentId: string;
  documentName: string;
  documentType?: DocumentType;
  text: string;
  sourceType: ChunkSourceType;
  visualSummary?: string;
  pageNumber?: number;
  visionPages?: { pageNumber: number; extractedText: string; visualSummary: string }[];
  pageSources?: { pageNumber: number; text: string; sourceType: ChunkSourceType; visualSummary?: string }[];
  createdAt?: string;
}): DocumentChunk[] {
  const documentType = params.documentType ?? inferDocumentType(params.documentName);
  const createdAt = params.createdAt ?? new Date().toISOString();
  const sourcePages = params.pageSources?.length
    ? params.pageSources
    : params.visionPages?.length
      ? params.visionPages.map((page) => ({ text: [page.extractedText, page.visualSummary].filter(Boolean).join('\n'), pageNumber: page.pageNumber, visualSummary: page.visualSummary, sourceType: 'visionAnalysis' as ChunkSourceType }))
      : [{ text: params.text, pageNumber: params.pageNumber, visualSummary: params.visualSummary, sourceType: params.sourceType }];

  let chunkIndex = 0;
  return sourcePages.flatMap((page) => splitTextIntoChunks(page.text)
    .map((chunkText) => sanitizeCorruptedText(chunkText))
    .filter((chunkText) => isUsableRagText(chunkText))
    .map((chunkText) => {
      const categories = inferChunkCategories(chunkText, documentType);
      const category = categories[0];
      const metadata = documentType === 'finalProposal' ? extractFinalProposalMetadata(chunkText) : {};
      const tags = Array.from(new Set([...tokenize(chunkText), ...categories, documentType])).slice(0, 30);
      const chunk: DocumentChunk = {
        id: `${params.documentId}-chunk-${chunkIndex}`,
        documentId: params.documentId,
        documentName: params.documentName,
        documentType,
        pageNumber: page.pageNumber,
        chunkIndex,
        chunkText,
        visualSummary: page.visualSummary,
        sourceType: page.sourceType,
        category,
        categories,
        tags,
        importance: inferChunkImportance(category, chunkText),
        createdAt,
        ...metadata,
      };
      chunkIndex += 1;
      return chunk;
    }));
}

const stageCategoryWeights: Partial<Record<RetrievalStage, Partial<Record<ChunkCategory, number>>>> = {
  concept: {
    requiredDeliverables: 40,
    performanceGoal: 20,
    venue: 15,
    referenceOnly: 15,
    constraints: 10,
    productFeature: 15,
  },
  analysis: {
    requiredDeliverables: 25,
    projectObjective: 20,
    performanceGoal: 20,
    evaluationCriteria: 15,
    constraints: 10,
    schedule: 10,
    productFeature: 15,
  },
  outline: {
    requiredDeliverables: 35,
    evaluationCriteria: 20,
    performanceGoal: 20,
    constraints: 15,
    venue: 10,
    productFeature: 15,
  },
};

const referencePriorityPatterns = [
  /레퍼런스|벤치마크|참고\s*사례|reference|benchmark|case\s*study/i,
  /디자인\s*레퍼런스|전시\s*참고\s*사례|reference\s*image|design\s*reference/i,
];

function maxStageCategoryWeight(stage: RetrievalStage, chunkCategories: ChunkCategory[], targetCategories: Set<ChunkCategory>, categoryWeights?: Partial<Record<ChunkCategory, number>>) {
  const weights = categoryWeights ?? stageCategoryWeights[stage];
  return chunkCategories.reduce((max, category) => {
    if (!targetCategories.has(category)) return max;
    return Math.max(max, weights ? (weights[category] ?? 5) : 45);
  }, 0);
}

function referencePriorityScore(stage: RetrievalStage, text: string, chunkCategories: ChunkCategory[], queryContext: string) {
  const isReferenceChunk = chunkCategories.includes('referenceOnly') || chunkCategories.includes('designDirection');
  if (!isReferenceChunk) return 0;

  const namedReferenceScore = referencePriorityPatterns.reduce((score, pattern) => score + (pattern.test(text) ? 18 : 0), 0);
  if (!namedReferenceScore) return 0;

  const influencesConcept = stage === 'concept';
  const influencesSpatialStrategy = (stage === 'outline' || stage === 'slide') && /spatial|space|zone|venue|공간|동선|배치|연출/i.test(queryContext);
  return influencesConcept || influencesSpatialStrategy ? namedReferenceScore : Math.floor(namedReferenceScore / 2);
}

const importanceScore: Record<ChunkImportance, number> = { high: 30, medium: 15, low: 5 };
const documentTypeScore: Record<DocumentType, number> = { rfp: 20, finalProposal: 14, portfolio: 10, template: 9, reference: 7, budgetSample: 8, scheduleSample: 8, organizationSample: 8 };

export function retrieveRelevantChunks({ stage, proposalType, slideTitle, categories, query, limit = 8, chunks = [], categoryMatchMode = 'boost', categoryWeights }: RetrievalQuery): DocumentChunk[] {
  const targetCategories = new Set(categories?.length ? categories : stageCategories[stage]);
  const queryTokens = tokenize([query, slideTitle, proposalType].filter(Boolean).join(' '));

  const scoredChunks = chunks
    .map((chunk) => {
      const text = normalize([chunk.chunkText, chunk.slideTitle, chunk.sectionTitle, chunk.keyMessage, chunk.tags.join(' ')].filter(Boolean).join(' '));
      const chunkCategoryList = chunk.categories ?? [chunk.category];
      const categoryMatch = chunkCategoryList.some((category) => targetCategories.has(category));
      const categoryScore = maxStageCategoryWeight(stage, chunkCategoryList, targetCategories, categoryWeights);
      const tagScore = chunk.tags.reduce((score, tag) => score + (queryTokens.includes(normalize(tag)) ? 8 : 0), 0);
      const keywordScore = queryTokens.reduce((score, token) => score + (text.includes(token) ? 5 : 0), 0);
      const proposalScore = proposalType && chunk.proposalType === proposalType ? 10 : 0;
      const slideScore = slideTitle && normalize([chunk.slideTitle ?? '', chunk.sectionTitle ?? ''].join(' ')).includes(normalize(slideTitle)) ? 20 : 0;
      const finalProposalScore = stage === 'outline' || stage === 'slide' ? (chunk.documentType === 'finalProposal' ? 18 : 0) : 0;
      const prioritizedReferenceScore = referencePriorityScore(stage, text, chunkCategoryList, [query, slideTitle].filter(Boolean).join(' '));
      return {
        chunk,
        categoryMatch,
        score: categoryScore + prioritizedReferenceScore + tagScore + keywordScore + proposalScore + slideScore + finalProposalScore + importanceScore[chunk.importance] + documentTypeScore[chunk.documentType],
      };
    })
    .filter((item) => item.score > 0);

  const categoryFilteredChunks = categoryMatchMode === 'filter' ? scoredChunks.filter((item) => item.categoryMatch) : scoredChunks;
  const rankedChunks = categoryFilteredChunks.length ? categoryFilteredChunks : scoredChunks;

  return rankedChunks
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, limit)
    .map((item) => item.chunk);
}

function dedupeChunks(chunks: DocumentChunk[]) {
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
}

export function retrieveCategoryEvidenceGroups(params: Omit<RetrievalQuery, 'categories' | 'limit' | 'categoryMatchMode'> & {
  groups: RetrievalCategoryGroup[];
  defaultLimitPerGroup?: number;
}) {
  return params.groups.map((group) => ({
    ...group,
    chunks: retrieveRelevantChunks({
      ...params,
      categories: group.categories,
      limit: group.limit ?? params.defaultLimitPerGroup ?? 4,
      categoryMatchMode: 'filter',
    }),
  }));
}

export function flattenCategoryEvidenceGroups(groups: Array<RetrievalCategoryGroup & { chunks: DocumentChunk[] }>) {
  return dedupeChunks(groups.flatMap((group) => group.chunks));
}

export function formatCategoryEvidenceGroupsForPrompt(groups: Array<RetrievalCategoryGroup & { chunks: DocumentChunk[] }>, maxChars = 12000) {
  let output = '';

  for (const group of groups) {
    const formattedChunks = formatChunksForPrompt(group.chunks, Math.max(1800, Math.floor(maxChars / Math.max(groups.length, 1))));
    const block = [`## ${group.label}`, `categories: ${group.categories.join(', ')}`, group.description ? `사용 목적: ${group.description}` : '', formattedChunks || '해당 category 근거 없음'].filter(Boolean).join('\n');
    if ((output + '\n\n' + block).length > maxChars) break;
    output = [output, block].filter(Boolean).join('\n\n');
  }

  return output;
}

export function formatChunksForPrompt(chunks: DocumentChunk[], maxChars = 9000) {
  let output = '';
  for (const chunk of chunks) {
    const chunkText = sanitizeCorruptedText(chunk.chunkText);
    if (!isUsableRagText(chunkText)) continue;

    const block = `[${chunk.documentName}${chunk.pageNumber ? ` p.${chunk.pageNumber}` : ''} | ${chunk.documentType} | ${(chunk.categories ?? [chunk.category]).join(', ')} | ${chunk.importance}]\n${chunk.sectionTitle ? `sectionTitle: ${sanitizeCorruptedText(chunk.sectionTitle)}\n` : ''}${chunk.slideTitle ? `slideTitle: ${sanitizeCorruptedText(chunk.slideTitle)}\n` : ''}${chunk.keyMessage ? `keyMessage: ${sanitizeCorruptedText(chunk.keyMessage)}\n` : ''}${chunkText}`;
    if ((output + '\n\n' + block).length > maxChars) break;
    output = [output, block].filter(Boolean).join('\n\n');
  }
  return output;
}
function buildBulletSummary(text: string, category: ChunkCategory) {
  const cleaned = sanitizeCorruptedText(text).replace(/\s+/g, ' ').trim();
  const sentences = cleaned
    .split(/(?<=[.!?。！？])\s+|\n+|(?:^|\s)(?=[•*-]\s+)/g)
    .map((sentence) => sentence.replace(/^[•*-]\s*/, '').trim())
    .filter((sentence) => sentence.length >= 8);
  const candidates = sentences.length ? sentences : cleaned.split(/[,;·]/g).map((part) => part.trim()).filter((part) => part.length >= 8);
  const bullets = candidates.slice(0, 3).map((sentence) => sentence.slice(0, 120));
  if (bullets.length) return bullets;
  return [`${category} 관련 근거: ${cleaned.slice(0, 100)}`];
}


export function buildEvidenceItems(chunks: DocumentChunk[], limit = 8) {
  return chunks
    .map((chunk) => ({ chunk, cleanedText: sanitizeCorruptedText(chunk.chunkText) }))
    .filter((item) => isUsableRagText(item.cleanedText))
    .slice(0, limit)
    .map(({ chunk, cleanedText }) => ({
      sourceDocument: chunk.documentName,
      pageNumber: chunk.pageNumber,
      category: (chunk.categories ?? [chunk.category]).join(', '),
      categories: chunk.categories ?? [chunk.category],
      importance: chunk.importance,
      bulletSummary: buildBulletSummary(cleanedText, chunk.category),
      shortExcerpt: cleanedText.replace(/\s+/g, ' ').slice(0, 220),
    }));
}
