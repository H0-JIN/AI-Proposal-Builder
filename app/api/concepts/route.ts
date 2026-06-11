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

const DEFAULT_CONCEPT_COUNT = 2;
const DEFAULT_PATTERN_LIMIT = 8;
const RETRY_PATTERN_LIMIT = 5;
const CONCEPT_GENERATION_TIMEOUT_MS = Number(process.env.CONCEPT_GENERATION_TIMEOUT_MS ?? 18_000);

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
  const keywordBase: [string, string, string] = index === 1 ? ['증거 루트', '인지 순서', '판단 장치'] : ['가치 신호', '참여 루프', '실행 증명'];
  const definition = index === 1
    ? compactText(`${analysis.clientChallenge || narrative.coreProblem}을 평가자가 이해하기 쉬운 경험 약속으로 바꾸는 콘셉트입니다.`, 180)
    : compactText(`${narrative.proposalThesis || analysis.projectOverview}를 관객 인식 변화와 실행 흐름으로 연결하는 콘셉트입니다.`, 180);
  const mechanism = {
    experienceMechanism: index === 1 ? '요구 근거를 발견-비교-판단 순서로 펼쳐 평가자가 선택 논리를 따라가게 함' : '핵심 가치를 신호-참여-증명 루프로 반복 확인하게 함',
    spatialMechanism: compactText(analysis.spatialCondition || '도입, 핵심 확인, 증명 구간으로 동선을 구분', 140),
    contentMechanism: compactText(analysis.contentCondition || '메시지, 사례, 실행 근거를 역할별 콘텐츠로 분리', 140),
    interactionMechanism: compactText(analysis.operationCondition || '관객 행동이 다음 이해 단계로 이어지는 간단한 확인 접점 제공', 140),
    recognitionLogic: index === 1 ? '무엇이 문제인지 먼저 보고, 왜 필요한지 이해한 뒤, 어떻게 증명되는지 확인' : '핵심 신호를 인지하고 직접 참여한 뒤 실행 가능성을 확인',
    visitorOrAudienceTransformation: compactText(narrative.whyThisConcept || '막연한 관심에서 평가 가능한 확신으로 전환', 140),
    proofMechanism: compactText(analysis.evaluationCriteria?.[0] || '필수 산출물과 평가 기준에 맞춰 가치와 실행성을 증명', 140),
    whyThisCanBecomeAConcept: '공간, 콘텐츠, 상호작용, 운영 기준으로 반복 적용 가능한 작동 원리를 갖기 때문',
  };

  return {
    conceptId,
    conceptName: name,
    conceptSlogan: index === 1 ? '문제를 선택 이유로 바꾸다' : '경험으로 확신을 만들다',
    conceptTagline: index === 1 ? '문제를 선택 이유로 바꾸다' : '경험으로 확신을 만들다',
    conceptDefinition: definition,
    hiddenNeedResolved: compactText(narrative.strategicOpportunity || analysis.clientChallenge, 160),
    strategicApproach: compactText(narrative.proposalThesis || 'RFP 핵심 요구를 간결한 경험 구조로 증명합니다.', 180),
    whyThisConcept: compactText(narrative.whyThisConcept || definition, 180),
    conceptMechanism: mechanism,
    whyThisNameWorks: index === 1 ? 'RFP 근거를 판단 동선으로 바꾸는 작동 원리를 짧게 암시합니다.' : '가치 인지와 참여 증명의 반복 구조를 짧게 암시합니다.',
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
    subtitle: index === 1 ? '문제를 선택 이유로 바꾸다' : '경험으로 확신을 만들다',
    conceptNameKR: name,
    conceptNameEN: name,
    oneLineDefinition: definition,
    coreMessage: compactText(narrative.proposalThesis || definition, 160),
    thesisProof: compactText(narrative.whyThisConcept || 'RFP 요구와 실행 구조가 직접 연결됩니다.', 160),
    experienceStructure: '문제 인식 → 핵심 가치 이해 → 실행 근거 확인',
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

function buildFallbackConcepts(analysis: AnalysisResult, proposalNarrative: ProposalNarrative, reason: string): ConceptCandidatesResult {
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
      fallbackCandidate(1, '증거 루트', analysis, proposalNarrative),
      fallbackCandidate(2, '가치 신호', analysis, proposalNarrative),
    ],
    recommendation: {
      recommendedConceptId: 'C1',
      recommendationReason: '가장 빠르게 RFP 문제와 선택 이유를 연결하는 경량 후보입니다.',
      whyNotOthers: 'C2는 경험 확장성이 있으나 세부 연출 보완이 더 필요합니다.',
    },
    namingGuardNotice: {
      message: `컨셉 생성 시간이 초과되었습니다. 후보 수와 참고 패턴을 줄여 다시 시도해 주세요. (${reason})`,
      repairedConceptIds: [],
      warningConceptIds: ['C1', 'C2'],
      violations: [],
    },
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
    };

    if (!body.input || !body.analysis) {
      return NextResponse.json({ error: '프로젝트 입력값과 분석 결과가 필요합니다.' }, { status: 400 });
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
      '너는 한국어 제안서 콘셉트를 빠르게 설계하는 크리에이티브 디렉터다.',
      `정확히 ${maxCandidates}개의 콘셉트 후보만 생성한다. 후보를 3개로 늘리지 말라.`,
      '긴 문단을 쓰지 말고 모든 설명은 1문장 또는 짧은 구로 작성한다.',
      '출력은 hiddenNeeds, strategicApproach, entityDifferentiationMatrix, conceptDevelopmentLogic, concepts, recommendation을 포함한다.',
      '필수 생성 순서: (1) Current RFP evidence (2) Hidden Needs (3) Strategic Approach (4) entity/content/audience differentiation if applicable (5) conceptMechanism (6) conceptName candidates (7) conceptSlogan (8) conceptDefinition (9) execution keywords (10) antiPatternValidation.',
      '각 concepts 항목은 conceptName 전에 conceptMechanism 8개 필드를 먼저 설계한 뒤, 그 메커니즘에서 이름을 도출한다.',
      'conceptName은 Hidden Needs, Strategic Approach, 회피 규칙, 일반 목표, 일반 산업어에서 직접 만들지 말고 experience/spatial/content/interaction/recognition/proof mechanism에서만 도출한다.',
      '각 후보별로 내부적으로 이름 5개를 만들고 specificityToCurrentRfp, memorability, mechanismClarity, expandabilityToSpaceContentMedia, nonGenericQuality, coverTitlePotential을 1~5점으로 채점한 뒤 평균 4 미만은 1회 보정하고 최종 1개만 출력한다. 내부 후보와 점수는 출력하지 않는다.',
      '약한 이름 금지: 선택의 이유, 혁신의 장면, 차별화된 통합, 명확한 구분, 통합된 경험, Distinct Unity, Focused Identity, Scene of Innovation, The Reason to Choose, Connected Future, Innovation Journey, Experience Hub.',
      'conceptName은 전략 문장/슬라이드 제목/프로젝트 목표/직접 솔루션 문구/캠페인 문구/RFP 요약/회피 규칙 번역처럼 보이면 안 된다.',
      '한국어 이름은 추상 명사구보다 action, system, route, field, signal, ritual, sequence, transformation, experience structure를 암시하는 짧은 이름을 선호한다.',
      '영어 이름은 Nexus, Pulse, Vanguard, Synergy, Future, Innovation, Experience, Journey, Platform, Hub, Connect, Beyond, Next, Shift, Flow를 피한다.',
      'conceptSlogan은 평가자가 이해할 수 있게 RFP 목표와 제안 약속을 1문장으로 설명하되, conceptName 자체는 간결하게 유지한다.',
      'keywordExecutionGuide는 keyword별 spatialUXImplication, designImplication, contentImplication, contentOrMediaImplication, operationImplication을 각각 1개의 짧은 구로 작성하고 conceptMechanism에서 파생한다.',
      'experienceNarrativeFlow는 3~4개의 짧은 단계만 작성한다.',
      'antiPatternValidation은 riskToAvoid, howThisConceptAvoidsIt, validationCheck를 포함하고 proposal_patterns 회피 규칙을 검증 기준으로만 사용하며 naming source로 쓰지 않는다.',
      'proposal_patterns에 포함된 과거 프로젝트명, 클라이언트명, 파일명, 고유 상세를 추정하거나 재사용하지 않는다.',
      isEventOperationType ? '행사 운영형 콘셉트도 시스템명/카테고리명이 아니라 행사 목적과 비즈니스 기회를 압축한 이름으로 작성한다.' : '각 후보는 서로 다른 전략 관점과 경험 흐름을 가진다.',
    ].join('\n');

    const userPrompt = `제안서 유형: ${proposalTypeLabels[effectiveProposalType]}

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

Generation order reminder: Current RFP evidence → Hidden Needs → Strategic Approach → Entity/content/audience differentiation if applicable → Concept Mechanism → internal 5-name scoring → selected Concept Name → Concept Slogan → Concept Definition → exactly 3 Execution Keywords → Anti-pattern Validation.`;

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
        concepts: generated.concepts.slice(0, maxCandidates),
        entityDifferentiationMatrix: differentiationStrategy.hasMultipleEntities
          ? (generated.entityDifferentiationMatrix?.length ? generated.entityDifferentiationMatrix : differentiationStrategy.entityDifferentiationMatrix)
          : [],
      });
      result = applyNonBlockingConceptNamingGuard(result, { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules });
      return NextResponse.json(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'generation timeout';
      const fallback = applyNonBlockingConceptNamingGuard(buildFallbackConcepts(body.analysis, proposalNarrative, reason), { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules });
      return NextResponse.json(fallback);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉 생성 시간이 초과되었습니다. 후보 수와 참고 패턴을 줄여 다시 시도해 주세요.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
