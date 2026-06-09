import { buildRfpDifferentiationStrategy } from './rfpDifferentiation';
import type { AnalysisResult, ConceptCandidate, ProjectInput, ProposalNarrative, UploadedDocument } from './types';

const defaultFlow = [
  { stage: 'Problem Definition', purpose: '시장의 변화와 RFP 배경을 연결해 클라이언트가 지금 해결해야 할 핵심 문제를 정의합니다.' },
  { stage: 'Strategic Declaration', purpose: '문제를 기회로 전환하는 제안의 핵심 주장과 전략 방향을 선언합니다.' },
  { stage: 'Experience Strategy', purpose: '제안 논리가 방문객 여정, 공간 원칙, 경험 원칙으로 어떻게 구현되는지 설명합니다.' },
  { stage: 'Content Proposal', purpose: '히어로 경험, 주요 콘텐츠, 미디어/인터랙션이 제안 명제를 증명하는 방식을 제시합니다.' },
  { stage: 'Proof & Impact', purpose: '차별화, 실행 가능성, 기대 효과를 통해 선택해야 할 이유를 증명합니다.' },
];

function clean(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ');
}

function firstText(...values: Array<string | undefined | null>) {
  return values.map(clean).find(Boolean);
}

function joinText(values: Array<string | string[] | undefined | null>, fallback = '') {
  const text = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(clean)
    .filter(Boolean)
    .join(' · ');
  return text || fallback;
}

function documentSummary(documents?: UploadedDocument[]) {
  return documents
    ?.map((document) => clean(document.documentAnalysisText) || clean(document.extractedText)?.slice(0, 400))
    .filter(Boolean)
    .join(' · ');
}

type BuildNarrativeFallbackInput = {
  input: ProjectInput;
  analysis?: AnalysisResult;
  selectedConcept?: ConceptCandidate;
  uploadedDocuments?: UploadedDocument[];
  documentText?: string;
};

export function buildFallbackProposalNarrative({
  input,
  analysis,
  selectedConcept,
  uploadedDocuments,
  documentText,
}: BuildNarrativeFallbackInput): ProposalNarrative {
  const context = firstText(
    analysis?.projectOverview,
    documentSummary(uploadedDocuments),
    documentText?.slice(0, 500),
    input.briefText,
    `${input.projectName} / ${input.clientName}`,
  )!;
  const challenge = firstText(analysis?.clientChallenge, analysis?.clientTask?.aiProposal?.[0], analysis?.missingInfo?.[0], 'RFP 요구를 단순 수행 계획이 아니라 설득력 있는 제안 논리로 전환해야 합니다.')!;
  const opportunity = firstText(
    analysis?.targetSpaceContentOperation?.aiProposal?.[0],
    analysis?.evaluationCriteria?.[0],
    selectedConcept?.targetRelevance,
    '클라이언트의 과제를 방문객/참석자가 체감하는 경험 가치와 심사자가 판단할 수 있는 실행 근거로 연결할 수 있습니다.',
  )!;
  const thesis = firstText(
    selectedConcept?.thesisProof,
    selectedConcept?.coreMessage,
    selectedConcept?.conceptDefinition,
    selectedConcept?.oneLineDefinition,
    analysis?.rfpRequirements?.aiProposal?.[0],
    `${input.projectName || '본 프로젝트'}는 문제 정의, 전략 선언, 경험 실행, 증명 가능한 임팩트가 하나로 이어질 때 경쟁력 있는 제안이 됩니다.`,
  )!;

  const differentiation = analysis ? buildRfpDifferentiationStrategy(analysis) : null;

  return {
    marketContext: context,
    coreProblem: challenge,
    strategicOpportunity: opportunity,
    proposalThesis: thesis,
    whyNow: firstText(analysis?.schedule?.[0], analysis?.kpiTimelineConstraints?.aiProposal?.[0], '지금은 RFP 요구를 실행 항목으로만 대응하기보다 시장 변화와 클라이언트 과제를 선명한 제안 명제로 재정의해야 하는 시점입니다.')!,
    whyUs: firstText(analysis?.evaluationCriteria?.[1], selectedConcept?.executionFeasibility, '우리는 전략 메시지, 공간/콘텐츠 실행, 근거 기반 제안 구조를 함께 설계해 심사 관점과 현장 구현 가능성을 동시에 충족합니다.')!,
    whyThisConcept: firstText(
      selectedConcept?.thesisProof,
      selectedConcept?.whyThisWorks,
      selectedConcept?.conceptDefinition,
      selectedConcept?.oneLineDefinition,
      '이 콘셉트는 RFP 요구를 방문객 의미와 클라이언트 역량 증명의 경험 구조로 전환합니다.',
    )!,
    narrativeFlow: defaultFlow,
    unifyingFrame: differentiation?.unifyingFrame ?? thesis,
    differentiationPrinciple: differentiation?.differentiationPrinciple ?? '현재 RFP 근거를 기준으로 통합할 요소와 구분할 요소를 판단합니다.',
    entityDifferentiationMatrix: differentiation?.entityDifferentiationMatrix ?? [],
    riskOfOverIntegration: differentiation?.riskOfOverIntegration ?? '현재 RFP 근거 없이 과도한 통합 또는 분리를 강제하지 않습니다.',
    howToAvoidSimilarity: differentiation?.howToAvoidSimilarity ?? '현재 RFP의 과제, 평가 기준, audience takeaway에 맞춰 장표별 역할을 구분합니다.',
    currentRfpSpecificity: differentiation?.currentRfpSpecificity ?? joinText([analysis?.clientChallenge, analysis?.evaluationCriteria], '현재 RFP 분석 결과를 1차 근거로 사용합니다.'),
  };
}

export function ensureProposalNarrative(narrative: ProposalNarrative | undefined, fallbackInput: BuildNarrativeFallbackInput) {
  const fallback = buildFallbackProposalNarrative(fallbackInput);
  const merged = {
    ...fallback,
    ...narrative,
    narrativeFlow: narrative?.narrativeFlow?.length ? narrative.narrativeFlow : fallback.narrativeFlow,
  };

  if (fallbackInput.analysis) {
    const differentiation = buildRfpDifferentiationStrategy(fallbackInput.analysis, merged);
    return {
      ...merged,
      unifyingFrame: narrative?.unifyingFrame || differentiation.unifyingFrame,
      differentiationPrinciple: narrative?.differentiationPrinciple || differentiation.differentiationPrinciple,
      entityDifferentiationMatrix: narrative?.entityDifferentiationMatrix?.length ? narrative.entityDifferentiationMatrix : differentiation.entityDifferentiationMatrix,
      riskOfOverIntegration: narrative?.riskOfOverIntegration || differentiation.riskOfOverIntegration,
      howToAvoidSimilarity: narrative?.howToAvoidSimilarity || differentiation.howToAvoidSimilarity,
      currentRfpSpecificity: narrative?.currentRfpSpecificity || differentiation.currentRfpSpecificity,
    };
  }

  return merged;
}

export function summarizeProposalNarrative(narrative: ProposalNarrative) {
  return [
    `Market Context: ${narrative.marketContext}`,
    `Core Problem: ${narrative.coreProblem}`,
    `Strategic Opportunity: ${narrative.strategicOpportunity}`,
    `Proposal Thesis: ${narrative.proposalThesis}`,
    `Why Now: ${narrative.whyNow}`,
    `Why Us: ${narrative.whyUs}`,
    `Why This Concept: ${narrative.whyThisConcept}`,
    `Narrative Flow: ${narrative.narrativeFlow.map((flow) => `${flow.stage}=${flow.purpose}`).join(' / ')}`,
    `Unifying Frame: ${narrative.unifyingFrame ?? ''}`,
    `Differentiation Principle: ${narrative.differentiationPrinciple ?? ''}`,
    `Entity Differentiation Matrix: ${JSON.stringify(narrative.entityDifferentiationMatrix ?? [])}`,
    `Risk Of Over-Integration: ${narrative.riskOfOverIntegration ?? ''}`,
    `How To Avoid Similarity: ${narrative.howToAvoidSimilarity ?? ''}`,
    `Current RFP Specificity: ${narrative.currentRfpSpecificity ?? ''}`,
  ].join('\n');
}
