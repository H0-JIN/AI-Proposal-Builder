import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ConceptDevelopmentLogic, ProjectInput } from './types';
import { getPresentationConceptName } from './conceptNamingGuard';

export type StrategyLayerMetadata = {
  winningStrategyBrief: string;
  proposalThesis: string;
  experienceLogic: string;
};

type StrategyLayerContext = {
  input: ProjectInput;
  analysis: AnalysisResult;
  selectedConcept: ConceptCandidate;
  conceptDevelopmentLogic?: ConceptDevelopmentLogic;
  conceptGenerationResult?: ConceptCandidatesResult;
};

function firstText(...values: Array<string | undefined | null>) {
  return values.map((value) => value?.trim()).find(Boolean);
}

function joinNonEmpty(values: Array<string | undefined>, separator = ' · ') {
  return values.map((value) => value?.trim()).filter(Boolean).join(separator);
}

export function buildStrategyLayerMetadata({
  input,
  analysis,
  selectedConcept,
  conceptDevelopmentLogic,
  conceptGenerationResult,
}: StrategyLayerContext): StrategyLayerMetadata {
  const logic = conceptDevelopmentLogic ?? conceptGenerationResult?.conceptDevelopmentLogic;
  const recommendedConcept = conceptGenerationResult?.concepts.find(
    (concept) => concept.conceptId === conceptGenerationResult.recommendation.recommendedConceptId,
  );

  const selectedConceptLabel = getPresentationConceptName(selectedConcept) || joinNonEmpty([selectedConcept.conceptNameEN, selectedConcept.conceptNameKR], ' / ') || '핵심 콘셉트';
  const projectContext = joinNonEmpty([input.projectName, input.clientName], ' / ') || analysis.projectOverview;
  const requiredFocus = joinNonEmpty([
    analysis.clientChallenge,
    analysis.requiredDeliverables?.slice(0, 3).join(', '),
    analysis.evaluationCriteria?.slice(0, 2).join(', '),
  ]);
  const rfpSummary = joinNonEmpty([
    analysis.projectOverview,
    analysis.clientChallenge,
    analysis.targetInfo,
    analysis.spatialCondition,
    analysis.contentCondition,
  ]);

  return {
    winningStrategyBrief: firstText(
      logic?.winningStrategyBrief,
      conceptGenerationResult?.recommendation.recommendationReason,
      logic?.selectedConceptReason,
      selectedConcept.whyThisWorks,
      requiredFocus && `${projectContext}의 핵심 요구를 ${selectedConceptLabel} 중심의 실행 가능한 경험 전략으로 연결합니다. ${requiredFocus}`,
      rfpSummary,
      `${selectedConceptLabel}을 기준으로 RFP 요구와 실행 계획을 연결합니다.`,
    )!,
    proposalThesis: firstText(
      logic?.proposalThesis,
      selectedConcept.coreMessage,
      selectedConcept.conceptDefinition,
      selectedConcept.oneLineDefinition,
      recommendedConcept?.coreMessage,
      logic?.conceptSeed,
      `${selectedConceptLabel}은 ${analysis.clientChallenge || 'RFP 과제'}를 해결하기 위한 제안서의 중심 주장입니다.`,
    )!,
    experienceLogic: firstText(
      logic?.experienceLogic,
      selectedConcept.experienceLogic,
      recommendedConcept?.experienceLogic,
      selectedConcept.keyExperienceAssetDirection,
      logic?.experienceOpportunity,
      '방문객/참석자의 주목, 참여, 반응, 결과물, 공유가 하나의 흐름으로 이어지도록 설계합니다.',
    )!,
  };
}
