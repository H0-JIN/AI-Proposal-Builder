import type { AnalysisResult, ProposalNarrative } from './types';

export interface EntityDifferentiationItem {
  entityName: string;
  entityType: string;
  sourceEvidence: string;
  roleInProject: string;
  keyOffering: string;
  audienceTakeaway: string;
  distinctMessage: string;
  proofPoint: string;
  spatialOrContentRole: string;
  experienceMechanism: string;
  visualOrToneCue: string;
  relationshipToOtherEntities: string;
  riskIfUndifferentiated: string;
}

export interface RfpDifferentiationStrategy {
  hasMultipleEntities: boolean;
  unifyingFrame: string;
  differentiationPrinciple: string;
  entityDifferentiationMatrix: EntityDifferentiationItem[];
  riskOfOverIntegration: string;
  howToAvoidSimilarity: string;
  currentRfpSpecificity: string;
}

const empty = '현재 RFP 근거 없음';
const entityDelimiters = /[,/&+·]|\s(?:and|or)\s|(?:와|과|및|,)/iu;
const genericTaskWords = /^(?:제작|개발|운영|구성|기획|제안|관리|설치|철거|보고|협의|디자인|콘텐츠|프로그램|서비스|제품|브랜드|기업|방문객|관람객|고객|타깃)$/u;

function clean(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(clean).filter((value) => value.length >= 2 && value.length <= 80 && !genericTaskWords.test(value))));
}

function splitEntityCandidates(value?: string | null) {
  const text = clean(value);
  if (!text) return [];
  return text
    .split(entityDelimiters)
    .map((item) => item.replace(/^[•\-\d.)\s]+/u, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 60);
}

function collectEntities(analysis: AnalysisResult): EntityDifferentiationItem[] {
  const candidates: Array<{ entityName: string; entityType: string; source: string }> = [];

  for (const feature of analysis.productFeatures ?? []) {
    if (clean(feature.product)) candidates.push({ entityName: clean(feature.product), entityType: 'product/service', source: [feature.keyFeature, feature.valueProposition].filter(Boolean).join(' · ') });
  }

  for (const item of analysis.productInfo ?? []) {
    for (const entityName of splitEntityCandidates(item)) candidates.push({ entityName, entityType: 'product/service', source: item });
  }

  for (const section of analysis.taskSections ?? []) {
    for (const target of section.target ?? []) {
      for (const entityName of splitEntityCandidates(target)) candidates.push({ entityName, entityType: 'target audience / stakeholder', source: section.taskTitle });
    }
    for (const deliverable of section.requiredDeliverables ?? []) {
      for (const entityName of splitEntityCandidates(deliverable)) candidates.push({ entityName, entityType: 'content / deliverable category', source: section.taskTitle });
    }
  }

  for (const item of [analysis.targetInfo, analysis.contentCondition, analysis.spatialCondition, ...(analysis.requiredDeliverables ?? []), ...(analysis.evaluationCriteria ?? [])]) {
    for (const entityName of splitEntityCandidates(item)) candidates.push({ entityName, entityType: 'RFP element', source: item ?? '' });
  }

  const selected = unique(candidates.map((candidate) => candidate.entityName)).slice(0, 8);
  return selected.map((entityName) => {
    const evidence = candidates.find((candidate) => candidate.entityName === entityName);
    const product = (analysis.productFeatures ?? []).find((feature) => clean(feature.product) === entityName);
    return {
      entityName,
      entityType: evidence?.entityType ?? 'RFP element',
      sourceEvidence: evidence?.source || empty,
      roleInProject: evidence?.source || empty,
      keyOffering: clean(product?.keyFeature) || empty,
      audienceTakeaway: clean(product?.valueProposition) || empty,
      distinctMessage: clean(product?.valueProposition) || empty,
      proofPoint: clean(product?.valueProposition) || evidence?.source || empty,
      spatialOrContentRole: evidence?.source || empty,
      experienceMechanism: clean(product?.keyFeature) || evidence?.source || empty,
      visualOrToneCue: empty,
      relationshipToOtherEntities: selected.length > 1 ? '같은 제안 명제 안에서 비교·역할 구분이 필요한 요소' : empty,
      riskIfUndifferentiated: '구분 없이 통합하면 평가자가 각 요소의 역할, 가치, 필요성을 판단하기 어렵습니다.',
    };
  });
}

export function buildRfpDifferentiationStrategy(analysis: AnalysisResult, narrative?: ProposalNarrative): RfpDifferentiationStrategy {
  const matrix = collectEntities(analysis);
  const evidenceText = [analysis.projectOverview, analysis.clientChallenge, analysis.targetInfo, analysis.spatialCondition, analysis.contentCondition, analysis.operationCondition, ...(analysis.requiredDeliverables ?? []), ...(analysis.requiredScope ?? []), ...(analysis.scopeOfWork ?? []), ...(analysis.productInfo ?? []), ...(analysis.evaluationCriteria ?? [])].map(clean).join(' ');
  const multiEntitySignal = /(?:공동|참여|협력|multiple|multi|pavilion|파빌리온|관|기업|회사|브랜드|stakeholder|이해관계자|파트너|계열사|제품군|존별|zone별|부스별|기관별)/i.test(evidenceText);
  const singleExperienceSignal = /(?:단일|브랜드 경험|방문자센터|홍보관|체험관|쇼룸|visitor center|tour|single brand|brand experience)/i.test(evidenceText);
  const equalWeightCount = matrix.filter((item) => !/target audience|content \/ deliverable category|RFP element/i.test(item.entityType) || /기업|회사|브랜드|product\/service/i.test(item.entityType)).length;
  const hasMultipleEntities = matrix.length >= 2 && multiEntitySignal && !(singleExperienceSignal && equalWeightCount < 2);
  const evaluation = clean(analysis.evaluationCriteria?.[0]);
  const thesis = clean(narrative?.proposalThesis) || clean(analysis.rfpRequirements?.aiProposal?.[0]);

  return {
    hasMultipleEntities,
    unifyingFrame: thesis || '현재 RFP의 핵심 목적과 평가 기준을 하나의 제안 명제로 묶습니다.',
    differentiationPrinciple: hasMultipleEntities
      ? 'Unity는 제안 명제와 경험 흐름에만 적용하고, 각 요소의 역할·메시지·관객 행동·증거는 분리해 보이게 합니다.'
      : '현재 RFP 근거상 강제적인 다중 요소 차별화가 필요하지 않으므로, 과도한 분할보다 핵심 과제와 증거의 선명도를 우선합니다.',
    entityDifferentiationMatrix: hasMultipleEntities ? matrix : [],
    riskOfOverIntegration: hasMultipleEntities ? '하나의 통합 모티프만 강조하면 서로 다른 회사/브랜드/제품/존/대상/콘텐츠의 평가상 차이가 사라질 수 있습니다.' : '단순 RFP에서 불필요한 차별화 매트릭스를 만들면 제안 논리가 산만해질 수 있습니다.',
    howToAvoidSimilarity: hasMultipleEntities ? '각 핵심 장표는 무엇을 통합하는지와 무엇을 구분하는지를 동시에 밝히고, 요소별 audience takeaway와 proof point를 분리합니다.' : '현재 RFP evidence에서 확인되는 핵심 목적, 요구사항, 평가 기준에 집중합니다.',
    currentRfpSpecificity: [thesis, evaluation, analysis.clientChallenge].map(clean).filter(Boolean).join(' · ') || '현재 RFP 분석 결과를 1차 근거로 사용합니다.',
  };
}

export function summarizeDifferentiationStrategy(strategy: RfpDifferentiationStrategy) {
  return JSON.stringify(strategy, null, 2);
}
