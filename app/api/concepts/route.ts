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

function fallbackGrounding(analysis: AnalysisResult, narrative: ProposalNarrative) {
  return compactList([
    analysis.productInfo?.[0],
    analysis.requiredItems?.[0],
    analysis.requiredScope?.[0],
    analysis.scopeOfWork?.[0],
    analysis.evaluationCriteria?.[0],
    analysis.targetInfo,
    analysis.spatialCondition,
    narrative.proposalThesis,
    'RFP 핵심 요구와 제안 명제 연결',
    '필수 산출물과 실행 가능성 증명',
    '평가 기준에 맞춘 선택 이유 제시',
  ].filter(Boolean), 5, 140);
}

function fallbackNameSeeds(analysis: AnalysisResult) {
  const blocked = new Set(['제안', '프로젝트', '사업', '운영', '행사', '콘텐츠', '체험', '전시', '공간', '요구', '평가', '기준', '과업']);
  return compactList([
    ...(analysis.productInfo ?? []),
    ...(analysis.productFeatures ?? []).map((feature) => feature.product || feature.keyFeature),
    ...(analysis.requiredItems ?? []),
    ...(analysis.requiredScope ?? []),
    ...(analysis.scopeOfWork ?? []),
  ], 12, 40)
    .flatMap((item) => item.replace(/[^a-zA-Z0-9가-힣\s]/g, ' ').split(/\s+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 10 && !blocked.has(item));
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


interface StrategicDirectionPlanItem {
  type: string;
  label: string;
  emphasis: string;
  chooseWhen: string;
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function buildStrategicDirectionPlan(analysis: AnalysisResult, narrative: ProposalNarrative, hasMultipleEntities: boolean): StrategicDirectionPlanItem[] {
  const evidenceText = [
    analysis.projectOverview,
    analysis.clientChallenge,
    analysis.targetInfo,
    analysis.contentCondition,
    analysis.operationCondition,
    analysis.spatialCondition,
    ...(analysis.requiredItems ?? []),
    ...(analysis.requiredScope ?? []),
    ...(analysis.scopeOfWork ?? []),
    ...(analysis.requiredDeliverables ?? []),
    ...(analysis.evaluationCriteria ?? []),
    narrative.differentiationPrinciple,
  ].filter(Boolean).join(' ');

  const contentHeavy = hasAny(evidenceText, [/미디어|영상|콘텐츠|content|media|message|메시지|SNS|캠페인|홍보|스토리|채널/i]);
  const operationHeavy = hasAny(evidenceText, [/운영|동선|등록|안전|인력|staff|operation|logistics|현장|서비스|접수|관리|프로세스|매뉴얼/i]);

  if (hasMultipleEntities) {
    return [
      { type: 'multi_entity_unity_first', label: '통합 중심', emphasis: '여러 참여 주체를 하나의 큰 브랜드·공간·경험 프레임으로 강하게 보이게 하는 방향', chooseWhen: '평가자가 전체 인상, 통일성, 대표 이미지를 가장 중요하게 볼 때 적합' },
      { type: 'multi_entity_balanced_distinction', label: '통합+개별 구분', emphasis: '공통 프레임은 유지하되 각 기업·제품·존·콘텐츠의 역할 차이를 분명하게 보이게 하는 방향', chooseWhen: '통합감과 함께 참여 주체별 차별 역할을 평가자가 명확히 이해해야 할 때 적합' },
      { type: 'multi_entity_signature_impact', label: '상징적 임팩트', emphasis: '대표 장면과 상징 구조로 전체 프로젝트의 힘, 리더십, 첫인상을 강하게 만드는 방향', chooseWhen: '초기 주목도, 상징성, 대외 홍보 임팩트가 중요한 RFP일 때 적합' },
    ];
  }

  if (contentHeavy && !operationHeavy) {
    return [
      { type: 'content_message_architecture', label: '메시지 구조', emphasis: '핵심 메시지와 콘텐츠 체계를 명확한 정보 구조로 설계하는 방향', chooseWhen: '평가자가 메시지 일관성, 콘텐츠 논리, 이해 용이성을 중요하게 볼 때 적합' },
      { type: 'content_audience_participation', label: '참여 전환', emphasis: '관객이 콘텐츠를 수동적으로 보는 데서 참여하고 반응하는 경험으로 전환하는 방향', chooseWhen: '타깃 행동 변화, 참여율, 공유 가능성이 중요한 과업일 때 적합' },
      { type: 'content_hero_media_impact', label: '히어로 미디어', emphasis: '대표 콘텐츠나 미디어 장면으로 기억에 남는 강한 인상을 만드는 방향', chooseWhen: '대표 영상, 미디어월, 캠페인 확산처럼 한 장면의 임팩트가 중요할 때 적합' },
    ];
  }

  if (operationHeavy) {
    return [
      { type: 'operation_reliable_execution', label: '안정 실행', emphasis: '리스크를 줄이고 일정·인력·현장 운영이 안정적으로 작동하는 실행 체계를 보여주는 방향', chooseWhen: '평가자가 수행 안정성, 일정 준수, 리스크 관리를 우선 볼 때 적합' },
      { type: 'operation_user_service_experience', label: '서비스 경험', emphasis: '참가자·관람객·운영자의 접점 경험을 매끄럽게 만드는 서비스 흐름 중심 방향', chooseWhen: '현장 만족도, 이용 편의, 접점별 서비스 품질이 중요한 과업일 때 적합' },
      { type: 'operation_proof_trust', label: '운영 신뢰 증명', emphasis: '운영 역량과 검증 근거를 신뢰할 수 있는 증명 구조로 보여주는 방향', chooseWhen: '수행사 역량, 안전성, 품질 보증을 강하게 설득해야 할 때 적합' },
    ];
  }

  return [
    { type: 'single_brand_identity', label: '브랜드 정체성', emphasis: '단일 브랜드의 의미와 톤을 하나의 선명한 제안 세계로 구축하는 방향', chooseWhen: '브랜드 이미지, 정체성, 일관된 인상이 가장 중요한 RFP일 때 적합' },
    { type: 'single_brand_audience_behavior', label: '관객 행동 변화', emphasis: '타깃이 브랜드를 이해하는 데서 참여·공감·행동으로 이동하게 만드는 방향', chooseWhen: '방문자 반응, 참여, 인식 변화가 핵심 성과로 평가될 때 적합' },
    { type: 'single_brand_signature_proof', label: '시그니처 증명', emphasis: '제품·서비스 강점이나 대표 경험을 통해 브랜드 역량을 직접 증명하는 방향', chooseWhen: '제품력, 기술력, 서비스 우수성, 대표 장면의 설득력이 중요할 때 적합' },
  ];
}

function formatStrategicDirectionPlanForPrompt(plan: StrategicDirectionPlanItem[]) {
  return plan.map((item, index) => `C${index + 1}: ${item.label} (${item.type})\n- emphasis: ${item.emphasis}\n- chooseWhen: ${item.chooseWhen}`).join('\n');
}

function fallbackCandidate(index: number, name: string, analysis: AnalysisResult, narrative: ProposalNarrative): ConceptCandidate {
  const conceptId = `C${index}`;
  const direction = buildStrategicDirectionPlan(analysis, narrative, Boolean(narrative.entityDifferentiationMatrix?.length && narrative.entityDifferentiationMatrix.length > 1))[(index - 1) % 3];
  const fallbackPresets = [
    { keywords: ['근거', '판단', '확장'] as [string, string, string], slogan: 'RFP 근거가 바로 제안 구조로 이어지게 합니다.', definition: `RFP의 핵심 요구를 판단 기준과 실행 접점으로 변환해 평가자가 선택 이유를 확인하게 하는 콘셉트입니다.`, experienceMechanism: 'RFP 근거를 도입-판단-확장 순서로 배열해 제안의 논리를 따라가게 함', recognitionLogic: '요구 조건과 실행 근거가 같은 기준으로 연결됨을 기억함', nameWhy: '현재 RFP의 구체 근거를 제안 판단 장치로 바꾸는 이름입니다.' },
    { keywords: ['대상', '역할', '증명'] as [string, string, string], slogan: '각 대상의 역할을 분명히 나누고 하나의 증명으로 묶습니다.', definition: `RFP에 등장한 대상과 역할을 분리한 뒤 공간·콘텐츠·운영 증거로 재조합하는 콘셉트입니다.`, experienceMechanism: '대상별 역할을 먼저 인식하고 마지막에 통합 증명으로 연결하는 흐름', recognitionLogic: '각 요소의 차이와 전체 제안 명제를 동시에 기억함', nameWhy: 'RFP에 있는 대상·역할·평가 근거를 제목의 출처로 삼습니다.' },
    { keywords: ['기준', '접점', '운영'] as [string, string, string], slogan: '평가 기준이 현장 접점과 운영 방식으로 보이게 합니다.', definition: `평가 기준을 콘텐츠 접점과 운영 증거로 번역해 제안서 전체의 검증 흐름을 만드는 콘셉트입니다.`, experienceMechanism: '기준-접점-운영 순서로 평가 언어를 실행 장면으로 전환함', recognitionLogic: '추상 평가 항목이 실제 현장 작동 방식으로 확인됨을 기억함', nameWhy: '평가 기준과 운영 증거라는 RFP 근거에서 파생된 이름입니다.' },
  ];
  const preset = fallbackPresets[(index - 1) % fallbackPresets.length];
  const rfpGrounding = fallbackGrounding(analysis, narrative);
  const seed = fallbackNameSeeds(analysis)[index - 1] || fallbackNameSeeds(analysis)[0] || '판단';
  const repairedName = name || `${seed} ${['프레임', '필드', '아레나'][(index - 1) % 3]}`;
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
    strategicDirectionType: direction.type,
    strategicDirectionLabel: direction.label,
    whatThisDirectionEmphasizes: direction.emphasis,
    whenToChooseThisDirection: direction.chooseWhen,
    proposalCoreConceptName: repairedName,
    proposalCoreConceptSlogan: preset.slogan,
    proposalCoreConceptDefinition: definition,
    whyThisIsCoreConcept: compactText(`${repairedName}은 관람 순서가 아니라 RFP 과제, 제안 명제, 공간·콘텐츠·운영·증명 방식을 하나의 제안 세계로 묶는 최상위 프레임입니다.`, 220),
    experiencePrinciple: compactText(`관객이 ${preset.recognitionLogic}으로 인식하도록 경험의 태도와 감정 전환을 설계합니다.`, 180),
    visitorJourney: keywordBase.join(' → '),
    contentMediaImplication: compactText(`${keywordBase.join(', ')} 키워드를 기준으로 콘텐츠, 미디어, 오브젝트의 역할을 나누고 각 접점이 핵심 명제를 증명하게 합니다.`, 180),
    conceptName: repairedName,
    conceptSlogan: preset.slogan,
    conceptTagline: preset.slogan,
    conceptDefinition: definition,
    hiddenNeedResolved: compactText(narrative.strategicOpportunity || analysis.clientChallenge, 160),
    strategicApproach: compactText(narrative.proposalThesis || 'RFP 핵심 요구를 간결한 경험 구조로 증명합니다.', 180),
    whyThisConcept: compactText(narrative.whyThisConcept || definition, 180),
    conceptMechanism: mechanism,
    conceptMetaphorSource: {
      metaphorSeed: repairedName,
      symbolicImage: `${repairedName} 안에서 RFP 근거가 판단 기준과 실행 접점으로 전환되는 이미지`,
      proposalWorld: `${repairedName}을 기준으로 공간, 콘텐츠, 미디어, 운영 접점을 배열하는 제안 세계`,
      whyThisCanBecomeAConceptTitle: preset.nameWhy,
      sourceTypes: ['product/service logic', 'evaluation criteria'],
      rfpEvidence: rfpGrounding,
    },
    rfpGrounding,
    whyThisNameFitsRfp: compactText(rfpGrounding.slice(0, 3).join(' / ') || preset.nameWhy, 220),
    whyThisIsNotJustPoetic: '임의의 문학적 사물이 아니라 현재 RFP의 대상·역할·평가 근거에서 뽑은 명명입니다.',
    whyThisCanOrganizeProposal: '이름이 공간, 콘텐츠, 미디어, 운영, 증명 장표의 반복 기준으로 확장됩니다.',
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
    mainStrength: direction.emphasis,
    mainRisk: `${direction.label} 방향은 강점이 선명한 만큼 다른 전략 우선순위는 후속 구조에서 함께 보완해야 합니다.`,
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
    conceptTitle: repairedName,
    subtitle: preset.slogan,
    conceptNameKR: repairedName,
    conceptNameEN: repairedName,
    conceptNameEnglish: '',
    conceptNameKoreanSubtitle: '',
    conceptSloganKorean: preset.slogan,
    conceptSloganEnglish: '',
    conceptScopeValidation: {
      coversWholeProposal: true,
      coversMainEntitiesOrScope: true,
      expandableToSpace: true,
      expandableToContent: true,
      expandableToMediaOrInteraction: true,
      expandableToOperationOrProof: true,
      notProductSpecificOnly: true,
      notSectionTitleOnly: true,
    },
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
      fallbackCandidate(1, '', analysis, proposalNarrative),
      fallbackCandidate(2, '', analysis, proposalNarrative),
      fallbackCandidate(3, '', analysis, proposalNarrative),
    ],
    recommendation: {
      recommendedConceptId: 'C1',
      recommendedDirectionLabel: buildStrategicDirectionPlan(analysis, proposalNarrative, Boolean(proposalNarrative.entityDifferentiationMatrix?.length && proposalNarrative.entityDifferentiationMatrix.length > 1))[0]?.label || '전략 방향',
      recommendationReason: '현재 RFP에서는 요구 근거를 빠르게 묶고 평가자가 선택 이유를 이해하기 쉬운 방향을 우선 추천합니다.',
      otherDirectionsUsefulness: '다른 방향은 통합감, 개별 구분, 임팩트, 참여, 운영 신뢰 등 우선순위가 달라질 때 유용한 선택지입니다.',
      tradeOffSummary: '추천 방향은 명확성이 강하지만, 다른 방향들은 각각 차별 구분·참여 전환·상징 임팩트 같은 별도 강점을 제공합니다.',
      whyNotOthers: '다른 후보가 나쁜 것이 아니라, 현재 입력 기준에서는 추천 후보가 RFP 근거와 제안 구조를 가장 빠르게 연결합니다.',
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


function withNeutralDirectionRecommendation(result: ConceptCandidatesResult): ConceptCandidatesResult {
  const recommended = result.concepts.find((concept) => concept.conceptId === result.recommendation.recommendedConceptId) ?? result.concepts[0];
  const otherDirections = result.concepts
    .filter((concept) => concept.conceptId !== recommended?.conceptId)
    .map((concept) => `${concept.conceptId} ${concept.strategicDirectionLabel}: ${concept.whenToChooseThisDirection}`)
    .join(' / ');
  const negativeComparisonPattern = /bad|not good|wrong|나쁘|별로|부적합|틀렸|실패|낮[다은]|부족/i;
  const existingOtherUse = result.recommendation.otherDirectionsUsefulness || result.recommendation.whyNotOthers || '';
  const safeOtherUsefulness = existingOtherUse && !negativeComparisonPattern.test(existingOtherUse)
    ? existingOtherUse
    : (otherDirections || '다른 방향은 평가 우선순위가 달라질 때 유용한 대안입니다.');

  return {
    ...result,
    recommendation: {
      ...result.recommendation,
      recommendedConceptId: result.recommendation.recommendedConceptId || recommended?.conceptId || 'C1',
      recommendedDirectionLabel: result.recommendation.recommendedDirectionLabel || recommended?.strategicDirectionLabel || '전략 방향',
      otherDirectionsUsefulness: safeOtherUsefulness,
      tradeOffSummary: result.recommendation.tradeOffSummary || '각 후보는 우열이 아니라 통합감, 구분성, 임팩트, 참여, 운영 신뢰 등 서로 다른 우선순위의 선택지입니다.',
      whyNotOthers: safeOtherUsefulness,
    },
  };
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
    const strategicDirectionPlan = buildStrategicDirectionPlan(body.analysis, proposalNarrative, hasMultipleEntities);
    const proposalPatternDiagnostics = formatProposalPatternDiagnostics(proposalPatternGuidance.summary, hasMultipleEntities);
    const proposalPatternContext = formatProposalPatternsForConceptPrompt(proposalPatternGuidance.patterns, proposalPatternGuidance.avoidanceRules, maxProposalPatterns);

    const systemPrompt = [
      `Concept Prompt Version: ${conceptPromptVersion}. 이 버전의 Proposal Core Concept hierarchy만 사용한다.`,
      '너는 한국어 제안서 콘셉트를 빠르게 설계하는 크리에이티브 디렉터다.',
      `정확히 ${maxCandidates}개의 콘셉트 후보를 생성한다. 최소 3개의 usable concept를 반환하고, 내부 네이밍 후보 5개는 절대 노출하지 말라.`,
      '3개 후보는 winner-loser 비교가 아니라 서로 다른 전략 방향 옵션이어야 한다.',
      '각 후보는 strategicDirectionType, strategicDirectionLabel, whatThisDirectionEmphasizes, whenToChooseThisDirection을 반드시 포함한다.',
      'strategicDirectionLabel은 카드에 보이는 짧은 한국어 방향명이며, proposalCoreConceptName은 별도의 제안 레벨 마스터 콘셉트명이어야 한다. 방향명을 콘셉트명으로 그대로 쓰지 않는다.',
      '추천은 가장 적합한 방향을 설명하되 다른 후보를 나쁘다/부적합하다/틀렸다로 말하지 않는다. 다른 방향의 쓰임과 선택 간 trade-off를 중립적으로 설명한다.',
      '긴 문단을 쓰지 말고 모든 설명은 1문장 또는 짧은 구로 작성한다.',
      '출력은 hiddenNeeds, strategicApproach, entityDifferentiationMatrix, conceptDevelopmentLogic, concepts, recommendation을 포함한다.',
      '필수 생성 순서: (1) Hidden Needs (2) Strategic Approach (3) Entity/Content/Audience Differentiation if applicable (4) Proposal Core Concept (5) Experience Principle (6) Visitor Journey (7) Content/Media Execution (8) Anti-pattern Validation.',
      'Visitor Journey를 Proposal Core Concept보다 먼저 만들거나 Core Concept의 이름으로 승격하지 않는다.',
      '각 concepts 항목은 proposalCoreConceptName, proposalCoreConceptSlogan, proposalCoreConceptDefinition, whyThisIsCoreConcept, experiencePrinciple, visitorJourney, contentMediaImplication을 반드시 분리한다.',
      'legacy 호환을 위해 conceptName은 proposalCoreConceptName과 동일하게, conceptDefinition은 proposalCoreConceptDefinition과 동일하게 출력한다.',
      'Proposal Core Concept은 전체 제안서의 최상위 전략·창의 프레임이며 client objective, RFP challenge, brand/product meaning, space, content, operation, proof를 연결하고 제안서 표지 제목이 될 수 있어야 한다.',
      'Proposal Core Concept scope validation을 각 후보에 포함한다: coversWholeProposal, coversMainEntitiesOrScope, expandableToSpace, expandableToContent, expandableToMediaOrInteraction, expandableToOperationOrProof, notProductSpecificOnly, notSectionTitleOnly는 모두 true여야 한다. false가 하나라도 있으면 이름과 정의를 수리한 뒤 true 상태만 출력한다.',
      '콘셉트명은 전체 제안 전략, 공간 경험, 콘텐츠 방향, 미디어/인터랙션, 운영/실행 논리, 증명/평가 논리, 최종 발표 스토리라인을 조직할 수 있어야 한다.',
      '제품명 하나, 특정 기술, 특정 존, 특정 체험 모듈, 특정 콘텐츠 섹션, 운영 프로세스명, 개인 병사용 프로토콜, 조준경 매트릭스 같은 이름은 제안 레벨 콘셉트가 아니므로 거부하고 전체 프레임으로 수리한다.',
      'RFP에 여러 기업·제품·존·대상·콘텐츠 카테고리가 있으면 RFP가 명시한 전체 hero가 아닌 한 하나의 제품군이나 섹션만 대표하는 이름을 금지한다.',
      '3개 후보의 conceptName은 중복/근접 중복이면 안 된다. 유사하면 약한 후보 이름만 재생성하되 전략 방향 차이는 유지한다.',
      'RFP 맥락에 따라 naming language를 선택한다. 해외 전시, 국제 파빌리온, 글로벌 트레이드쇼, 기술 쇼케이스, B2B 글로벌 이벤트, 영어 용어가 많은 프로젝트, 해외 방문객/바이어 대상이면 English concept name을 우선하고 Korean subtitle/explanation을 제공한다. 국내 브랜드, 로컬 팝업, 한국 공공 캠페인, 한국 소비자 행사, 한국어 단독 대상이면 Korean concept name을 허용하고 English subtitle은 선택 사항이다.',
      '각 후보는 conceptNameEnglish, conceptNameKoreanSubtitle, conceptSloganKorean, conceptSloganEnglish(if useful)를 포함한다. 단 영어/한국어를 모든 RFP에 강제하지 말고 맥락에 맞춰 비워도 된다.',
      'Proposal Core Concept은 visitor path, interaction flow, content sequence, audience recognition flow, media mechanism으로 축소되면 안 된다.',
      'Experience Principle은 core concept이 관객 인식·참여·감정 전환으로 어떻게 작동하는지 설명한다. awareness/differentiation/immersion/conviction/recognition/comparison/participation/memory는 여기에서 다루고 core concept name으로 쓰지 않는다.',
      'Visitor Journey는 Awareness → Differentiation → Immersion → Conviction 같은 순차 흐름으로만 작성하고 Core Concept을 대체하지 않는다.',
      'Content / Media Execution Idea는 core concept에서 파생된 콘텐츠, 미디어, 인터랙션, 오브젝트 실행 아이디어로만 작성한다.',
      '각 concepts 항목은 Proposal Core Concept 설계 후 conceptMechanism 8개 필드와 conceptMetaphorSource(metaphorSeed, symbolicImage, proposalWorld, whyThisCanBecomeAConceptTitle, sourceTypes, rfpEvidence)를 정리한다.',
      '각 concepts 항목은 rfpGrounding(3~5개의 현재 RFP 구체 근거), whyThisNameFitsRfp, whyThisIsNotJustPoetic, whyThisCanOrganizeProposal을 반드시 포함한다.',
      'proposalCoreConceptName/conceptName은 Hidden Needs, Strategic Approach, 회피 규칙, 평가 논리, 문제 해결 문구에서 직접 만들지 말고 conceptMetaphorSource의 RFP-grounded metaphor, scene, structure, symbolic frame, experience image에서만 도출한다.',
      'Concept Metaphor Source는 actual RFP object, project type, client or brand role, product/service logic, spatial structure, audience behavior, content mechanism, operational proof, evaluation criteria, stakeholder relationship 중 하나 이상에서만 도출한다.',
      '첫문장의 정원, 등대의 항로, 서랍 속 도감, 기억의 숲, 가능성의 지도, 미래의 정원, 빛의 항해, 경험의 서랍, 가치의 풍경처럼 문학 제목 같은 임의 은유는 RFP 원문 근거가 명시되지 않으면 거부하고 이름만 RFP 대상·역할·메커니즘·공간/콘텐츠 논리 기반으로 수리한다.',
      'conceptDefinition은 프로젝트명, 기간, 장소, 예산, 클라이언트, 제출 조건 등 RFP 개요를 반복하며 시작하지 말고 콘셉트의 의미, 작동 방식, 생성 경험/제안 논리, 전략 과제 해결 방식을 설명한다.',
      '후보 다양성 점검: 반환 전 3개 후보가 서로 다른 전략 우선순위를 갖는지, C1/C2/C3 선택 시 제안 방향이 어떻게 바뀌는지, 이름 차이가 단순 문구 차이가 아닌 방향 차이에서 비롯되는지 확인한다. 너무 유사하면 약한 중복 후보만 재생성한다.',
      '각 후보별로 내부적으로 이름 5개를 만들고 specificityToCurrentRfp, symbolicPower, memorability, coverTitlePotential, expandability, nonGenericQuality, notStrategyLabel을 1~5점으로 채점한다. 종합 4 미만이거나 섹션 제목/컨설팅 헤딩/전략 부제/문제해결 문구로도 쓸 수 있으면 이름만 재생성하고 최종 1개만 출력한다. 내부 후보와 점수는 출력하지 않는다.',
      '약한 Core Concept 이름 금지: 증거 루트, 가치 신호, 선택의 이유, 인지의 흐름, 확신의 여정, 경험의 경로, 차별화의 단계, Signal to Proof, Route to Value, Evidence Journey, 혁신의 장면, 차별화된 통합, 명확한 구분, 통합된 경험, Distinct Unity, Focused Identity, Scene of Innovation, The Reason to Choose, Connected Future, Innovation Journey, Experience Hub.',
      'conceptName은 전략 문장/슬라이드 제목/프로젝트 목표/직접 솔루션 문구/캠페인 문구/RFP 요약/회피 규칙 번역처럼 보이면 안 되며, 무관한 RFP에 재사용하면 어색해야 한다.',
      '한국어 conceptName은 가치/증거/신호/루트/이유/선택/차별화/통합/연결/혁신/경험/공명/확신/집중/방향/전략/메시지 중심 이름을 거부하고, 현재 RFP에서만 성립하는 상징 세계·구조 이미지·장면 제목으로 작성한다.',
      '영어 conceptName은 value/proof/signal/route/reason/choice/differentiation/connection/innovation/experience/focus/resonance/strategy/identity/unity/synergy/nexus/pulse/vanguard/frontier/spectrum 중심 이름을 거부한다.',
      'conceptSlogan은 평가자가 이해할 수 있게 RFP 목표와 제안 약속을 1문장으로 설명하되, conceptName 자체는 간결하게 유지한다.',
      'keywordExecutionGuide는 keyword별 spatialUXImplication, designImplication, contentImplication, contentOrMediaImplication, operationImplication을 각각 1개의 짧은 구로 작성하고 conceptMechanism에서 파생한다.',
      'experienceNarrativeFlow는 3~4개의 짧은 단계만 작성한다.',
      'antiPatternValidation은 Core Concept name이 visitor journey label, experience sequence, interaction mechanism, content section title, slide title, strategic instruction, anti-pattern correction인지 점검하고, proposal_patterns 회피 규칙은 검증 기준으로만 사용하며 naming source로 쓰지 않는다.',
      'proposal_patterns에 포함된 과거 프로젝트명, 클라이언트명, 파일명, 고유 상세를 추정하거나 재사용하지 않는다.',
      isEventOperationType ? '행사 운영형 콘셉트도 시스템명/카테고리명이 아니라 행사 목적과 비즈니스 기회를 압축한 이름으로 작성한다.' : '각 후보는 서로 다른 전략 관점과 경험 흐름을 가진다.',
      'mainStrength와 mainRisk는 짧은 중립 문장으로 작성한다. mainRisk는 결함이 아니라 해당 방향 선택 시 보완할 trade-off로 설명한다.',
    ].join('\n');

    const userPrompt = `제안서 유형: ${proposalTypeLabels[effectiveProposalType]}

Request Debug Metadata (캐시 방지 및 재생성 추적):
${JSON.stringify(metadata, null, 2)}

Strategic Direction Plan (이 순서로 C1/C2/C3를 생성하되 RFP에 맞게 이름과 실행은 구체화):
${formatStrategicDirectionPlanForPrompt(strategicDirectionPlan)}

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

Generation order reminder: Hidden Needs → Strategic Approach → Entity/Content/Audience Differentiation if applicable → Strategic Direction Option → Proposal Core Concept → Experience Principle → Visitor Journey → Content/Media Execution → Anti-pattern Validation. Do not generate Visitor Journey before Proposal Core Concept. Choose recommendation by best-fit strategic direction, RFP specificity, originality, whole-proposal organizing power, expandability to space/content/media/operation, evaluator clarity, and anti-pattern avoidance. recommendation.whyNotOthers must use neutral trade-off language and must explain what the other directions are useful for, not why they are bad.`;

    try {
      const generated = await createStructuredJson<ConceptCandidatesResult>({
        schemaName: 'proposal_concept_candidates',
        schema: conceptCandidatesJsonSchema,
        system: systemPrompt,
        user: userPrompt,
        timeoutMs: CONCEPT_GENERATION_TIMEOUT_MS,
      });

      let result = withNeutralDirectionRecommendation(normalizeConceptCandidatesResult({
        ...generated,
        conceptPromptVersion,
        regenerationId: metadata.regenerationId,
        generationAttempt: metadata.generationAttempt,
        generatedAt: metadata.generatedAt,
        concepts: generated.concepts.slice(0, maxCandidates),
        entityDifferentiationMatrix: differentiationStrategy.hasMultipleEntities
          ? (generated.entityDifferentiationMatrix?.length ? generated.entityDifferentiationMatrix : differentiationStrategy.entityDifferentiationMatrix)
          : [],
      }));
      result = applyNonBlockingConceptNamingGuard(result, { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules });
      return conceptsJson(attachGenerationMetadata(result, metadata));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'generation timeout';
      const fallback = applyNonBlockingConceptNamingGuard(withNeutralDirectionRecommendation(buildFallbackConcepts(body.analysis, proposalNarrative, reason, metadata)), { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules });
      return conceptsJson(attachGenerationMetadata(fallback, metadata));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉 생성 시간이 초과되었습니다. 후보 수와 참고 패턴을 줄여 다시 시도해 주세요.';
    return conceptsJson({ error: message, conceptPromptVersion }, { status: 500 });
  }
}
