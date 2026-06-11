import { NextResponse } from 'next/server';
import { conceptCandidatesJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ProjectInput, ProposalNarrative } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { ensureProposalNarrative, summarizeProposalNarrative } from '@/lib/proposalNarrative';
import { applyNonBlockingConceptNamingGuard, normalizeConceptCandidatesResult } from '@/lib/conceptNamingGuard';
import { buildRfpDifferentiationStrategy, summarizeDifferentiationStrategy } from '@/lib/rfpDifferentiation';
import { formatProposalPatternDiagnostics, formatProposalPatternsForConceptPrompt, retrieveProposalPatternsForOutline } from '@/lib/proposalPatternOutline';
import { conceptPromptVersion } from '@/lib/conceptPromptVersion';

const DEFAULT_CONCEPT_COUNT = 3;
const DEFAULT_PATTERN_LIMIT = 8;
const RETRY_PATTERN_LIMIT = 5;
const CONCEPT_GENERATION_TIMEOUT_MS = Number(process.env.CONCEPT_GENERATION_TIMEOUT_MS ?? 18_000);

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

function conceptsJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

function compactList(items: string[] = [], limit = 8, itemLimit = 160) {
  return items
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => (item.length > itemLimit ? `${item.slice(0, itemLimit).trim()}…` : item));
}

function compactText(value = '', maxLength = 420) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function buildCompactAnalysis(analysis: AnalysisResult, differentiationSummary: string, proposalNarrative: ProposalNarrative) {
  return {
    projectOverview: compactText(analysis.projectOverview),
    coreProblem: compactText(analysis.clientChallenge || proposalNarrative.coreProblem),
    keyRequirements: compactList([
      ...(analysis.requiredItems ?? []),
      ...(analysis.requiredScope ?? []),
      ...(analysis.scopeOfWork ?? []),
      ...(analysis.evaluationCriteria ?? []),
    ], 10),
    constraints: compactList([
      ...(analysis.constraints ?? []),
      analysis.spatialCondition,
      analysis.contentCondition,
      analysis.operationCondition,
      ...(analysis.kpiScheduleConstraints ?? []),
    ].filter(Boolean), 10),
    targetAudience: compactText(analysis.targetInfo, 240),
    requiredDeliverables: compactList(analysis.requiredDeliverables ?? [], 10),
    entityDifferentiation: compactText(differentiationSummary, 700),
    hiddenNeedsDraft: {
      surfaceRequest: compactText(analysis.projectOverview, 220),
      hiddenNeed: compactText(proposalNarrative.strategicOpportunity || analysis.clientChallenge, 260),
      clientAnxiety: compactText(analysis.confirmNeeded?.[0] || analysis.missingInfo?.[0] || '심사자가 전략과 실행 가능성을 빠르게 이해해야 함', 220),
      decisionTrigger: compactText(analysis.evaluationCriteria?.[0] || analysis.kpiObjectives?.[0] || 'RFP 요구와 평가 기준에 맞는 명확한 선택 이유', 220),
      evaluationRisk: compactText(analysis.proposalStructureGuard || analysis.missingInfo?.[1] || '근거 없는 확장과 장황한 설명으로 핵심 메시지가 흐려지는 리스크', 220),
      realWinningCondition: compactText(proposalNarrative.proposalThesis || analysis.clientChallenge, 260),
    },
  };
}

function fallbackCandidate(index: number, name: string, analysis: AnalysisResult, narrative: ProposalNarrative): ConceptCandidate {
  const conceptId = `C${index}`;
  const fallbackPresets = [
    { keywords: ['문턱', '채집', '목격'] as [string, string, string], slogan: '흩어진 요구를 한 장면 안에서 목격하게 합니다.', definition: `${analysis.clientChallenge || narrative.coreProblem}을 관객이 단계별로 발견하는 상징적 장면으로 바꾸는 콘셉트입니다.`, experienceMechanism: '입구-채집-목격 순서로 과제 맥락을 장면화해 평가자가 제안의 세계를 따라가게 함', recognitionLogic: '흩어진 조건을 하나의 장면으로 보고 각 장치의 역할을 기억함', nameWhy: '메커니즘이 만든 문턱과 채집 이미지를 제목화해 전략 설명이 아닌 제안 세계로 보이게 합니다.' },
    { keywords: ['등대', '항로', '정박'] as [string, string, string], slogan: '복잡한 판단 조건을 한 방향의 항해 장면으로 묶습니다.', definition: `${narrative.proposalThesis || analysis.projectOverview}를 공간과 콘텐츠가 같은 방향으로 항해하는 경험 프레임으로 전개하는 콘셉트입니다.`, experienceMechanism: '관객이 기준점을 찾고 항로를 따라가며 마지막에 실행 장면에 정박하는 흐름', recognitionLogic: '기준점-이동-도착의 이미지로 핵심 약속을 기억함', nameWhy: 'RFP의 복잡한 판단 흐름을 항해 세계로 바꿔 공간·미디어·운영으로 확장할 수 있습니다.' },
    { keywords: ['서랍', '표본', '도감'] as [string, string, string], slogan: '각 요소의 고유 역할을 꺼내 보고 하나의 그림으로 완성합니다.', definition: `${analysis.projectOverview || narrative.proposalThesis}의 핵심 요소를 표본처럼 분류하고 조합하는 콘셉트입니다.`, experienceMechanism: '요소별 역할을 서랍처럼 열어 보고 마지막에 하나의 도감 장면으로 통합해 이해시킴', recognitionLogic: '각 요소의 차이와 전체 그림을 동시에 기억함', nameWhy: '다중 제품·서비스 RFP에서도 각 entity를 표본 세계 안에 배치할 수 있는 제목입니다.' },
  ];
  const preset = fallbackPresets[(index - 1) % fallbackPresets.length];
  const keywordBase = preset.keywords;
  const definition = compactText(preset.definition, 180);
  const mechanism = {
    experienceMechanism: preset.experienceMechanism,
    spatialMechanism: compactText(analysis.spatialCondition || '도입, 핵심 확인, 증명 구간으로 동선을 구분', 140),
    contentMechanism: compactText(analysis.contentCondition || '메시지, 사례, 실행 근거를 역할별 콘텐츠로 분리', 140),
    interactionMechanism: compactText(analysis.operationCondition || '관객 행동이 다음 이해 단계로 이어지는 간단한 확인 접점 제공', 140),
    recognitionLogic: preset.recognitionLogic,
    visitorOrAudienceTransformation: compactText(narrative.whyThisConcept || '막연한 관심에서 평가 가능한 확신으로 전환', 140),
    proofMechanism: compactText(analysis.evaluationCriteria?.[0] || '필수 산출물과 평가 기준에 맞춰 가치와 실행성을 증명', 140),
    whyThisCanBecomeAConcept: '공간, 콘텐츠, 상호작용, 운영 기준으로 반복 적용 가능한 작동 원리를 갖기 때문',
  };

  return {
    conceptId,
    proposalCoreConceptName: name,
    proposalCoreConceptSlogan: preset.slogan,
    proposalCoreConceptDefinition: definition,
    whyThisIsCoreConcept: compactText(`${name}은 관람 순서가 아니라 RFP 과제, 제안 명제, 공간·콘텐츠·운영·증명 방식을 하나의 제안 세계로 묶는 최상위 프레임입니다.`, 220),
    experiencePrinciple: compactText(`관객이 ${preset.recognitionLogic}으로 인식하도록 경험의 태도와 감정 전환을 설계합니다.`, 180),
    visitorJourney: keywordBase.join(' → '),
    contentMediaImplication: compactText(`${keywordBase.join(', ')} 키워드를 기준으로 콘텐츠, 미디어, 오브젝트의 역할을 나누고 각 접점이 핵심 명제를 증명하게 합니다.`, 180),
    conceptName: name,
    conceptSlogan: preset.slogan,
    conceptTagline: preset.slogan,
    conceptDefinition: definition,
    hiddenNeedResolved: compactText(narrative.strategicOpportunity || analysis.clientChallenge, 160),
    strategicApproach: compactText(narrative.proposalThesis || 'RFP 핵심 요구를 간결한 경험 구조로 증명합니다.', 180),
    whyThisConcept: compactText(narrative.whyThisConcept || definition, 180),
    conceptMechanism: mechanism,
    conceptMetaphorSource: {
      metaphorSeed: name,
      symbolicImage: `${name} 안에서 관객이 요구 조건을 장면으로 발견하는 이미지`,
      proposalWorld: `${name}을 기준으로 공간, 콘텐츠, 미디어, 운영 접점을 배열하는 제안 세계`,
      whyThisCanBecomeAConceptTitle: preset.nameWhy,
    },
    whyThisNameWorks: preset.nameWhy,
    conceptKeywords: keywordBase,
    keywordExecutionGuide: keywordBase.map((keyword) => ({
      keyword,
      spatialUXImplication: `${keyword}를 한눈에 이해하는 동선`,
      designImplication: `${keyword}가 보이는 간결한 시각 언어`,
      contentImplication: `${keyword}를 증명하는 짧은 메시지`,
      contentOrMediaImplication: `${keyword}의 역할이 분명한 콘텐츠/미디어 단서`,
      operationImplication: `${keyword}가 현장에서 유지되는 운영 체크`,
    })),
    experienceNarrativeFlow: ['문제 인식', '가치 이해', '선택 확신'],
    antiPatternValidation: {
      riskToAvoid: '콘셉트명이 전략 문장이나 회피 규칙의 번역처럼 보이는 리스크',
      howThisConceptAvoidsIt: '이름보다 먼저 경험 작동 원리를 정의하고 이름은 그 메커니즘의 표지로 제한합니다.',
      validationCheck: '각 콘텐츠 요소가 특정 역할, 관객 가치, 증명 포인트를 갖는가?',
      validationCriteria: ['RFP 근거 없는 확장 금지', '장황한 후보 설명 축소', '실행 가능성 확인'],
      passed: true,
      validationSummary: '시간 초과 방지를 위해 핵심 검증 기준만 적용한 경량 후보입니다.',
    },
    entityDifferentiationUse: {
      unifyingFrame: compactText(narrative.unifyingFrame || '하나의 제안 명제로 통합', 120),
      distinctEntityRoles: compactText(narrative.differentiationPrinciple || '요소별 역할을 중복 없이 분리', 120),
      visitorRecognitionLogic: '관객이 차이를 단계적으로 인지',
      proofByEntity: '핵심 산출물과 평가 기준으로 증명',
      riskCheck: '요소 간 유사 표현을 피함',
    },
    conceptRationale: {
      problemInsight: compactText(analysis.clientChallenge || narrative.coreProblem, 140),
      clientNeed: compactText(narrative.strategicOpportunity || analysis.projectOverview, 140),
      audienceBarrier: compactText(analysis.targetInfo || '관객이 핵심 가치를 빠르게 이해하기 어려움', 140),
      strategicShift: '정보 나열에서 선택 이유 증명으로 전환',
      whyThisConcept: compactText(narrative.whyThisConcept || definition, 140),
    },
    conceptTitle: name,
    subtitle: preset.slogan,
    conceptNameKR: name,
    conceptNameEN: name,
    oneLineDefinition: definition,
    coreMessage: compactText(narrative.proposalThesis || definition, 160),
    thesisProof: compactText(narrative.whyThisConcept || 'RFP 요구와 실행 구조가 직접 연결됩니다.', 160),
    experienceStructure: keywordBase.join(' → '),
    expectedAssets: compactList(analysis.requiredDeliverables ?? ['핵심 메시지', '경험 흐름', '실행 근거'], 3, 60),
    strengths: ['빠른 이해', 'RFP 부합', '실행 연결'],
    risks: ['세부 연출은 후속 구조 단계에서 보완 필요'],
    evaluationSummary: '경량 후보이므로 선택 후 구조 생성 단계에서 세부화합니다.',
    experienceLogic: '짧은 흐름으로 핵심 명제를 증명',
    keyExperienceAssetDirection: 'Brand Experience Module',
    targetRelevance: compactText(analysis.targetInfo || '핵심 타깃의 이해 장벽을 낮춤', 120),
    spatialApplication: '요구 공간 조건 안에서 메시지 중심으로 적용',
    mediaInteractionPotential: '필요 시 간단한 미디어/콘텐츠 접점으로 확장',
    viralPotential: '짧은 슬로건과 명확한 장면으로 공유 가능',
    executionFeasibility: '필수 산출물과 제약 조건을 우선 반영',
    whyThisWorks: compactText(narrative.proposalThesis || definition, 160),
    riskOrCaution: '추가 검토 시 RFP 원문 근거를 재확인하세요.',
    evaluationScores: {
      rfpFitScore: 4,
      targetFitScore: 4,
      differentiationScore: 3,
      spatialFeasibilityScore: 4,
      viralPotentialScore: 3,
      operationFeasibilityScore: 4,
    },
  };
}

function buildFallbackConcepts(analysis: AnalysisResult, proposalNarrative: ProposalNarrative, reason: string, metadata?: ConceptGenerationMetadata): ConceptCandidatesResult {
  const hiddenNeeds = {
    surfaceRequest: compactText(analysis.projectOverview, 180),
    hiddenNeed: compactText(proposalNarrative.strategicOpportunity || analysis.clientChallenge, 180),
    clientAnxiety: compactText(analysis.confirmNeeded?.[0] || '심사자가 차별성과 실행 가능성을 확신해야 함', 180),
    decisionTrigger: compactText(analysis.evaluationCriteria?.[0] || 'RFP 적합성과 명확한 실행 근거', 180),
    evaluationRisk: '장황한 생성으로 핵심 콘셉트 선택이 지연되는 리스크',
    realWinningCondition: compactText(proposalNarrative.proposalThesis || analysis.clientChallenge, 180),
  };
  const strategicApproach = {
    strategicTension: compactText(proposalNarrative.coreProblem || analysis.clientChallenge, 180),
    winningApproach: compactText(proposalNarrative.proposalThesis || '핵심 요구를 간결한 경험 약속으로 증명', 180),
    differentiationLogic: compactText(proposalNarrative.differentiationPrinciple || '요구사항별 역할을 분명히 나누고 하나의 메시지로 묶음', 180),
    audiencePerceptionShift: compactText(proposalNarrative.whyThisConcept || '이해에서 확신으로 전환', 180),
    proofLogic: '필수 산출물·제약·평가 기준에 맞춘 실행 증거 제시',
  };

  return {
    conceptPromptVersion,
    regenerationId: metadata?.regenerationId,
    generationAttempt: metadata?.generationAttempt,
    generatedAt: metadata?.generatedAt,
    hiddenNeeds,
    strategicApproach,
    entityDifferentiationMatrix: proposalNarrative.entityDifferentiationMatrix ?? [],
    conceptDevelopmentLogic: {
      winningStrategyBrief: strategicApproach.winningApproach,
      proposalThesis: proposalNarrative.proposalThesis,
      experienceLogic: '문제 → 가치 → 증명 순서의 경량 경험 흐름',
      clientIntent: hiddenNeeds.hiddenNeed,
      audienceTakeaway: strategicApproach.audiencePerceptionShift,
      strategicTension: strategicApproach.strategicTension,
      conceptSeed: '빠르게 이해되고 실행 근거가 보이는 콘셉트',
      coreChallenge: compactText(analysis.clientChallenge, 140),
      targetInsight: compactText(analysis.targetInfo || '핵심 타깃의 이해 장벽', 140),
      brandOrProductValue: compactText(analysis.productInfo?.[0] || analysis.productFeatures?.[0]?.valueProposition || 'RFP 핵심 가치', 140),
      experienceOpportunity: compactText(proposalNarrative.strategicOpportunity, 140),
      strategicApproach: strategicApproach.winningApproach,
      conceptNecessity: '시간 초과 없이 선택 가능한 최소 후보를 제공하기 위함',
      selectedConceptReason: '후속 구조 생성에서 세부 실행 장표로 확장 가능합니다.',
      conceptDevelopmentCriteria: ['RFP 부합', '간결성', '실행 가능성'],
    },
    concepts: [
      fallbackCandidate(1, '첫문장의 정원', analysis, proposalNarrative),
      fallbackCandidate(2, '등대의 항로', analysis, proposalNarrative),
      fallbackCandidate(3, '서랍 속 도감', analysis, proposalNarrative),
    ],
    recommendation: {
      recommendedConceptId: 'C1',
      recommendationReason: '방문 흐름보다 RFP 문제, 공간·콘텐츠·운영·증명 구조를 가장 명확하게 묶는 Core Concept 후보입니다.',
      whyNotOthers: 'C2는 경험 확장성이 있으나 세부 연출 보완이 더 필요합니다.',
    },
    namingGuardNotice: {
      message: `컨셉 생성 시간이 초과되었습니다. 후보 수와 참고 패턴을 줄여 다시 시도해 주세요. (${reason})`,
      repairedConceptIds: [],
      warningConceptIds: ['C1', 'C2', 'C3'],
      violations: [],
    },
  };
}

interface ConceptGenerationMetadata {
  conceptPromptVersion?: string;
  regenerationId?: string;
  generationAttempt?: number;
  requestedAt?: string;
  generatedAt?: string;
}

function attachGenerationMetadata(result: ConceptCandidatesResult, metadata: ConceptGenerationMetadata): ConceptCandidatesResult {
  return {
    ...result,
    conceptPromptVersion,
    regenerationId: metadata.regenerationId,
    generationAttempt: metadata.generationAttempt,
    generatedAt: metadata.generatedAt,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      input: ProjectInput;
      analysis: AnalysisResult;
      proposalNarrative?: ProposalNarrative;
      documentChunks?: DocumentChunk[];
      options?: { retryLight?: boolean; maxCandidates?: number; maxProposalPatterns?: number };
      conceptPromptVersion?: string;
      regenerationId?: string;
      timestamp?: string;
      attempt?: number;
      generationAttempt?: number;
    };

    if (!body.input || !body.analysis) {
      return conceptsJson({ error: '프로젝트 입력값과 분석 결과가 필요합니다.' }, { status: 400 });
    }

    const metadata: ConceptGenerationMetadata = {
      conceptPromptVersion: body.conceptPromptVersion,
      regenerationId: body.regenerationId,
      generationAttempt: body.generationAttempt ?? body.attempt,
      requestedAt: body.timestamp,
      generatedAt: new Date().toISOString(),
    };

    if (metadata.conceptPromptVersion && metadata.conceptPromptVersion !== conceptPromptVersion) {
      return conceptsJson({
        error: `지원하지 않는 콘셉트 프롬프트 버전입니다. expected=${conceptPromptVersion}, received=${metadata.conceptPromptVersion}`,
        conceptPromptVersion,
        receivedConceptPromptVersion: metadata.conceptPromptVersion,
      }, { status: 409 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const effectiveProposalType = body.analysis.inferredProposalType ?? body.input.proposalType;
    const isEventOperationType = effectiveProposalType === 'mice_event_operation' || effectiveProposalType === 'conference_forum';
    const maxCandidates = Math.min(DEFAULT_CONCEPT_COUNT, Math.max(DEFAULT_CONCEPT_COUNT, body.options?.maxCandidates ?? DEFAULT_CONCEPT_COUNT));
    const maxProposalPatterns = body.options?.retryLight ? RETRY_PATTERN_LIMIT : Math.min(DEFAULT_PATTERN_LIMIT, body.options?.maxProposalPatterns ?? DEFAULT_PATTERN_LIMIT);
    const proposalNarrative = ensureProposalNarrative(body.proposalNarrative, { input: body.input, analysis: body.analysis, documentText: '' });
    const differentiationStrategy = buildRfpDifferentiationStrategy(body.analysis, proposalNarrative);
    const differentiationSummary = summarizeDifferentiationStrategy(differentiationStrategy);
    const compactAnalysis = buildCompactAnalysis(body.analysis, differentiationSummary, proposalNarrative);
    const proposalPatternGuidance = await retrieveProposalPatternsForOutline({ limit: maxProposalPatterns, antiPatternLimit: maxProposalPatterns });
    const hasMultipleEntities = differentiationStrategy.hasMultipleEntities;
    const proposalPatternDiagnostics = formatProposalPatternDiagnostics(proposalPatternGuidance.summary, hasMultipleEntities);
    const proposalPatternContext = formatProposalPatternsForConceptPrompt(proposalPatternGuidance.patterns, proposalPatternGuidance.avoidanceRules, maxProposalPatterns);

    const systemPrompt = [
      `Concept Prompt Version: ${conceptPromptVersion}. 이 버전의 Proposal Core Concept hierarchy만 사용한다.`,
      '너는 한국어 제안서 콘셉트를 빠르게 설계하는 크리에이티브 디렉터다.',
      `정확히 ${maxCandidates}개의 콘셉트 후보를 생성한다. 최소 3개의 usable concept를 반환하고, 내부 네이밍 후보 5개는 절대 노출하지 말라.`,
      '긴 문단을 쓰지 말고 모든 설명은 1문장 또는 짧은 구로 작성한다.',
      '출력은 hiddenNeeds, strategicApproach, entityDifferentiationMatrix, conceptDevelopmentLogic, concepts, recommendation을 포함한다.',
      '필수 생성 순서: (1) Hidden Needs (2) Strategic Approach (3) Entity/Content/Audience Differentiation if applicable (4) Proposal Core Concept (5) Experience Principle (6) Visitor Journey (7) Content/Media Execution (8) Anti-pattern Validation.',
      'Visitor Journey를 Proposal Core Concept보다 먼저 만들거나 Core Concept의 이름으로 승격하지 않는다.',
      '각 concepts 항목은 proposalCoreConceptName, proposalCoreConceptSlogan, proposalCoreConceptDefinition, whyThisIsCoreConcept, experiencePrinciple, visitorJourney, contentMediaImplication을 반드시 분리한다.',
      'legacy 호환을 위해 conceptName은 proposalCoreConceptName과 동일하게, conceptDefinition은 proposalCoreConceptDefinition과 동일하게 출력한다.',
      'Proposal Core Concept은 전체 제안서의 최상위 전략·창의 프레임이며 client objective, RFP challenge, brand/product meaning, space, content, operation, proof를 연결하고 제안서 표지 제목이 될 수 있어야 한다.',
      'Proposal Core Concept은 visitor path, interaction flow, content sequence, audience recognition flow, media mechanism으로 축소되면 안 된다.',
      'Experience Principle은 core concept이 관객 인식·참여·감정 전환으로 어떻게 작동하는지 설명한다. awareness/differentiation/immersion/conviction/recognition/comparison/participation/memory는 여기에서 다루고 core concept name으로 쓰지 않는다.',
      'Visitor Journey는 Awareness → Differentiation → Immersion → Conviction 같은 순차 흐름으로만 작성하고 Core Concept을 대체하지 않는다.',
      'Content / Media Execution Idea는 core concept에서 파생된 콘텐츠, 미디어, 인터랙션, 오브젝트 실행 아이디어로만 작성한다.',
      '각 concepts 항목은 Proposal Core Concept 설계 후 conceptMechanism 8개 필드와 conceptMetaphorSource(metaphorSeed, symbolicImage, proposalWorld, whyThisCanBecomeAConceptTitle)를 정리한다.',
      'proposalCoreConceptName/conceptName은 Hidden Needs, Strategic Approach, 회피 규칙, 평가 논리, 문제 해결 문구에서 직접 만들지 말고 conceptMetaphorSource의 project-specific metaphor, scene, structure, symbolic frame, experience image에서만 도출한다.',
      '각 후보별로 내부적으로 이름 5개를 만들고 specificityToCurrentRfp, symbolicPower, memorability, coverTitlePotential, expandability, nonGenericQuality, notStrategyLabel을 1~5점으로 채점한다. 종합 4 미만이거나 섹션 제목/컨설팅 헤딩/전략 부제/문제해결 문구로도 쓸 수 있으면 이름만 재생성하고 최종 1개만 출력한다. 내부 후보와 점수는 출력하지 않는다.',
      '약한 Core Concept 이름 금지: 증거 루트, 가치 신호, 선택의 이유, 인지의 흐름, 확신의 여정, 경험의 경로, 차별화의 단계, Signal to Proof, Route to Value, Evidence Journey, 혁신의 장면, 차별화된 통합, 명확한 구분, 통합된 경험, Distinct Unity, Focused Identity, Scene of Innovation, The Reason to Choose, Connected Future, Innovation Journey, Experience Hub.',
      'conceptName은 전략 문장/슬라이드 제목/프로젝트 목표/직접 솔루션 문구/캠페인 문구/RFP 요약/회피 규칙 번역처럼 보이면 안 된다.',
      '한국어 conceptName은 가치/증거/신호/루트/이유/선택/차별화/통합/연결/혁신/경험/공명/확신/집중/방향/전략/메시지 중심 이름을 거부하고, 현재 RFP에서만 성립하는 상징 세계·구조 이미지·장면 제목으로 작성한다.',
      '영어 conceptName은 value/proof/signal/route/reason/choice/differentiation/connection/innovation/experience/focus/resonance/strategy/identity/unity/synergy/nexus/pulse/vanguard/frontier/spectrum 중심 이름을 거부한다.',
      'conceptSlogan은 평가자가 이해할 수 있게 RFP 목표와 제안 약속을 1문장으로 설명하되, conceptName 자체는 간결하게 유지한다.',
      'keywordExecutionGuide는 keyword별 spatialUXImplication, designImplication, contentImplication, contentOrMediaImplication, operationImplication을 각각 1개의 짧은 구로 작성하고 conceptMechanism에서 파생한다.',
      'experienceNarrativeFlow는 3~4개의 짧은 단계만 작성한다.',
      'antiPatternValidation은 Core Concept name이 visitor journey label, experience sequence, interaction mechanism, content section title, slide title, strategic instruction, anti-pattern correction인지 점검하고, proposal_patterns 회피 규칙은 검증 기준으로만 사용하며 naming source로 쓰지 않는다.',
      'proposal_patterns에 포함된 과거 프로젝트명, 클라이언트명, 파일명, 고유 상세를 추정하거나 재사용하지 않는다.',
      isEventOperationType ? '행사 운영형 콘셉트도 시스템명/카테고리명이 아니라 행사 목적과 비즈니스 기회를 압축한 이름으로 작성한다.' : '각 후보는 서로 다른 전략 관점과 경험 흐름을 가진다.',
    ].join('\n');

    const userPrompt = `제안서 유형: ${proposalTypeLabels[effectiveProposalType]}

Request Debug Metadata (캐시 방지 및 재생성 추적):
${JSON.stringify(metadata, null, 2)}

Compact RFP Analysis JSON (이 필드만 RFP 근거로 사용):
${JSON.stringify(compactAnalysis, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${inputQuality.missingItems.slice(0, 5).map((item) => `${item.label}: ${item.description}`).join(' / ') || '없음'}
- AI missingInfo: ${compactList(body.analysis.missingInfo ?? [], 5).join(' / ') || '없음'}

Proposal Narrative 요약:
${compactText(summarizeProposalNarrative(proposalNarrative), 700)}

RFP Entity Differentiation Summary:
${compactText(differentiationSummary, 700)}

proposal_patterns compact diagnostics:
${proposalPatternDiagnostics}

proposal_patterns compact JSON (최대 ${maxProposalPatterns}개, source_text/summary/과거 고유명 없음):
${proposalPatternContext}

Generation order reminder: Hidden Needs → Strategic Approach → Entity/Content/Audience Differentiation if applicable → Proposal Core Concept → Experience Principle → Visitor Journey → Content/Media Execution → Anti-pattern Validation. Do not generate Visitor Journey before Proposal Core Concept, and choose recommendation by strategic fit, RFP specificity, originality, whole-proposal organizing power, expandability to space/content/media/operation, evaluator clarity, and anti-pattern avoidance.`;

    try {
      const generated = await createStructuredJson<ConceptCandidatesResult>({
        schemaName: 'proposal_concept_candidates',
        schema: conceptCandidatesJsonSchema,
        system: systemPrompt,
        user: userPrompt,
        timeoutMs: CONCEPT_GENERATION_TIMEOUT_MS,
      });

      let result = normalizeConceptCandidatesResult({
        ...generated,
        conceptPromptVersion,
        regenerationId: metadata.regenerationId,
        generationAttempt: metadata.generationAttempt,
        generatedAt: metadata.generatedAt,
        concepts: generated.concepts.slice(0, maxCandidates),
        entityDifferentiationMatrix: differentiationStrategy.hasMultipleEntities
          ? (generated.entityDifferentiationMatrix?.length ? generated.entityDifferentiationMatrix : differentiationStrategy.entityDifferentiationMatrix)
          : [],
      });
      result = applyNonBlockingConceptNamingGuard(result, { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules });
      return conceptsJson(attachGenerationMetadata(result, metadata));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'generation timeout';
      const fallback = applyNonBlockingConceptNamingGuard(buildFallbackConcepts(body.analysis, proposalNarrative, reason, metadata), { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules });
      return conceptsJson(attachGenerationMetadata(fallback, metadata));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉 생성 시간이 초과되었습니다. 후보 수와 참고 패턴을 줄여 다시 시도해 주세요.';
    return conceptsJson({ error: message, conceptPromptVersion }, { status: 500 });
  }
}
