import type { ProposalType } from './types';

export const chunkCategories = [
  'requiredDeliverables',
  'scopeOfWork',
  'evaluationCriteria',
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
  tags: string[];
  importance: ChunkImportance;
  createdAt: string;
  proposalType?: ProposalType;
  index?: string;
  sectionTitle?: string;
  slideTitle?: string;
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
}

const stageCategories: Record<RetrievalStage, ChunkCategory[]> = {
  analysis: ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria', 'constraints', 'schedule', 'budget'],
  concept: ['projectPurpose', 'target', 'approach', 'concept', 'designDirection', 'referenceOnly', 'existingAsset'],
  outline: ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria', 'constraints', 'schedule', 'budget', 'referenceOnly'],
  slide: ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria', 'constraints', 'program', 'venue', 'registration', 'systemOperation', 'boothOperation', 'catering', 'staffing', 'portfolio', 'organization', 'riskManagement', 'setupDismantling', 'designDirection', 'concept', 'approach'],
  finalReview: ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria'],
};

const categoryKeywords: Record<ChunkCategory, string[]> = {
  requiredDeliverables: ['필수', '제출', '산출물', 'deliverable', '제안서', '포함', '제안 항목', '요구 항목', '제출물'],
  scopeOfWork: ['과업', '범위', 'scope', '수행', '대행', '제작', '개발', '운영', '설치', '철거', '납품'],
  evaluationCriteria: ['평가', '심사', '배점', '가점', '선정 기준', 'evaluation', 'criteria', 'score'],
  constraints: ['제약', '조건', '금지', '제외', '제한', '준수', '리스크', '유의', '보안'],
  schedule: ['일정', '기간', '마감', '착수', '완료', '납기', '오픈', '운영일', 'timeline', 'schedule'],
  budget: ['예산', '비용', '견적', '금액', 'budget', 'price', '원', 'vat'],
  venue: ['장소', '공간', 'venue', '홀', '회의실', '전시장', '부스', '동선', 'floor'],
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
  designDirection: ['디자인', '톤앤매너', 'visual', '공간 연출', '무드', 'look', '브랜딩'],
  concept: ['콘셉트', '컨셉', 'concept', 'core idea', 'big idea', '메시지'],
  approach: ['전략', '접근', '방향', '방법론', 'approach', 'strategy', '운영 방식'],
  projectPurpose: ['목적', '배경', '기대효과', 'goal', 'objective', 'why', '프로젝트 개요'],
  target: ['타깃', '대상', '고객', '참석자', '방문객', 'audience', 'target'],
  referenceOnly: ['참고', '예시', '예:', '벤치마크', '레퍼런스', '사례', 'reference', 'lesson learned'],
  existingAsset: ['기존', '보유', '활용 가능', '현재', 'as-is', '자산', '기집행'],
  unknown: [],
};

const highCategories = new Set<ChunkCategory>(['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria']);
const mediumHighCategories = new Set<ChunkCategory>(['constraints', 'schedule', 'budget']);

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokenize(value: string) {
  return Array.from(new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 2))).slice(0, 24);
}

function scoreKeywordHits(text: string, keywords: string[]) {
  const normalized = normalize(text);
  return keywords.reduce((score, keyword) => score + (normalized.includes(normalize(keyword)) ? 1 : 0), 0);
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

export function inferChunkCategory(text: string, documentType: DocumentType): ChunkCategory {
  if (documentType === 'portfolio') return 'portfolio';
  if (documentType === 'template') return 'existingAsset';
  if (documentType === 'budgetSample') return 'budget';
  if (documentType === 'scheduleSample') return 'schedule';
  if (documentType === 'organizationSample') return 'organization';
  if (documentType === 'reference') return 'referenceOnly';

  let best: { category: ChunkCategory; score: number } = { category: 'unknown', score: 0 };
  for (const category of chunkCategories) {
    if (category === 'unknown') continue;
    const score = scoreKeywordHits(text, categoryKeywords[category]);
    if (score > best.score) best = { category, score };
  }

  if (best.score === 0) return documentType === 'finalProposal' ? 'referenceOnly' : 'unknown';
  if (documentType === 'finalProposal' && ['requiredDeliverables', 'scopeOfWork', 'evaluationCriteria'].includes(best.category)) return 'referenceOnly';
  return best.category;
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
  createdAt?: string;
}): DocumentChunk[] {
  const documentType = params.documentType ?? inferDocumentType(params.documentName);
  const createdAt = params.createdAt ?? new Date().toISOString();
  const sourcePages = params.visionPages?.length
    ? params.visionPages.map((page) => ({ text: [page.extractedText, page.visualSummary].filter(Boolean).join('\n'), pageNumber: page.pageNumber, visualSummary: page.visualSummary }))
    : [{ text: params.text, pageNumber: params.pageNumber, visualSummary: params.visualSummary }];

  let chunkIndex = 0;
  return sourcePages.flatMap((page) => splitTextIntoChunks(page.text).map((chunkText) => {
    const category = inferChunkCategory(chunkText, documentType);
    const metadata = documentType === 'finalProposal' ? extractFinalProposalMetadata(chunkText) : {};
    const tags = Array.from(new Set([...tokenize(chunkText), category, documentType])).slice(0, 30);
    const chunk: DocumentChunk = {
      id: `${params.documentId}-chunk-${chunkIndex}`,
      documentId: params.documentId,
      documentName: params.documentName,
      documentType,
      pageNumber: page.pageNumber,
      chunkIndex,
      chunkText,
      visualSummary: page.visualSummary,
      sourceType: params.sourceType,
      category,
      tags,
      importance: inferChunkImportance(category, chunkText),
      createdAt,
      ...metadata,
    };
    chunkIndex += 1;
    return chunk;
  }));
}

const importanceScore: Record<ChunkImportance, number> = { high: 30, medium: 15, low: 5 };
const documentTypeScore: Record<DocumentType, number> = { rfp: 20, finalProposal: 14, portfolio: 10, template: 9, reference: 7, budgetSample: 8, scheduleSample: 8, organizationSample: 8 };

export function retrieveRelevantChunks({ stage, proposalType, slideTitle, categories, query, limit = 8, chunks = [] }: RetrievalQuery): DocumentChunk[] {
  const targetCategories = new Set(categories?.length ? categories : stageCategories[stage]);
  const queryTokens = tokenize([query, slideTitle, proposalType].filter(Boolean).join(' '));

  return chunks
    .map((chunk) => {
      const text = normalize([chunk.chunkText, chunk.slideTitle, chunk.sectionTitle, chunk.keyMessage, chunk.tags.join(' ')].filter(Boolean).join(' '));
      const categoryScore = targetCategories.has(chunk.category) ? 45 : 0;
      const tagScore = chunk.tags.reduce((score, tag) => score + (queryTokens.includes(normalize(tag)) ? 8 : 0), 0);
      const keywordScore = queryTokens.reduce((score, token) => score + (text.includes(token) ? 5 : 0), 0);
      const proposalScore = proposalType && chunk.proposalType === proposalType ? 10 : 0;
      const slideScore = slideTitle && normalize([chunk.slideTitle ?? '', chunk.sectionTitle ?? ''].join(' ')).includes(normalize(slideTitle)) ? 20 : 0;
      const finalProposalScore = stage === 'outline' || stage === 'slide' ? (chunk.documentType === 'finalProposal' ? 18 : 0) : 0;
      return {
        chunk,
        score: categoryScore + tagScore + keywordScore + proposalScore + slideScore + finalProposalScore + importanceScore[chunk.importance] + documentTypeScore[chunk.documentType],
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex)
    .slice(0, limit)
    .map((item) => item.chunk);
}

export function formatChunksForPrompt(chunks: DocumentChunk[], maxChars = 9000) {
  let output = '';
  for (const chunk of chunks) {
    const block = `[${chunk.documentName}${chunk.pageNumber ? ` p.${chunk.pageNumber}` : ''} | ${chunk.documentType} | ${chunk.category} | ${chunk.importance}]
${chunk.sectionTitle ? `sectionTitle: ${chunk.sectionTitle}\n` : ''}${chunk.slideTitle ? `slideTitle: ${chunk.slideTitle}\n` : ''}${chunk.keyMessage ? `keyMessage: ${chunk.keyMessage}\n` : ''}${chunk.chunkText}`;
    if ((output + '\n\n' + block).length > maxChars) break;
    output = [output, block].filter(Boolean).join('\n\n');
  }
  return output;
}

export function buildEvidenceItems(chunks: DocumentChunk[], limit = 8) {
  return chunks.slice(0, limit).map((chunk) => ({
    sourceDocument: chunk.documentName,
    pageNumber: chunk.pageNumber,
    category: chunk.category,
    shortExcerpt: chunk.chunkText.replace(/\s+/g, ' ').slice(0, 220),
  }));
}
