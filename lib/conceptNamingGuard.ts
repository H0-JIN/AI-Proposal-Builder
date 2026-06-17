import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ConceptNameScopeClassification, ProposalNarrative } from './types';


export const GENERIC_CONCEPT_WORD_PENALTY_LIST = [
  'distinct unity',
  'value',
  'proof',
  'signal',
  'route',
  'reason',
  'choice',
  'connection',
  'focus',
  'resonance',
  'strategy',
  'frontier',
  'spectrum',
  'focused identity',
  'differentiated synergy',
  'synergized distinction',
  'differentiation',
  'identity',
  'nexus',
  'pulse',
  'vanguard',
  'synergy',
  'connect',
  'future',
  'innovation',
  'hub',
  'platform',
  'experience',
  'journey',
  'alliance',
  'lab',
  'studio',
  'universe',
  'beyond',
  'next',
  'shift',
  'flow',
  'distinct',
  'distinction',
  'differentiated',
  'differentiation',
  'identity',
  'unity',
];

const WEAK_GENERIC_CONCEPT_NAMES = [
  '증거 루트',
  '가치 신호',
  '선택의 이유',
  '인지의 흐름',
  '확신의 여정',
  '경험의 경로',
  '차별화의 단계',
  '혁신의 장면',
  '차별화된 통합',
  '명확한 구분',
  '통합된 경험',
  'the reason to choose',
  'scene of innovation',
  'differentiated unity',
  'connected future',
  'innovation journey',
  'signal to proof',
  'route to value',
  'evidence journey',
  'experience hub',
  'distinct unity',
  'value',
  'proof',
  'signal',
  'route',
  'reason',
  'choice',
  'connection',
  'focus',
  'resonance',
  'strategy',
  'frontier',
  'spectrum',
  'focused identity',
  'differentiated synergy',
  'synergized distinction',
  'future nexus',
  'innovation hub',
  'future experience',
  'experience journey',
  'next platform',
  'synergy hub',
  'creative lab',
  'brand universe',
];

const WEAK_GENERIC_TOKEN_COMBINATIONS = [
  ['증거', '루트'],
  ['가치', '신호'],
  ['선택의', '이유'],
  ['인지의', '흐름'],
  ['확신의', '여정'],
  ['경험의', '경로'],
  ['차별화의', '단계'],
  ['혁신의', '장면'],
  ['차별화된', '통합'],
  ['명확한', '구분'],
  ['통합된', '경험'],
  ['reason', 'choose'],
  ['scene', 'innovation'],
  ['connected', 'future'],
  ['innovation', 'journey'],
  ['signal', 'proof'],
  ['route', 'value'],
  ['evidence', 'journey'],
  ['experience', 'hub'],
  ['distinct', 'unity'],
  ['focused', 'identity'],
  ['differentiated', 'synergy'],
  ['synergized', 'distinction'],
  ['future', 'nexus'],
  ['innovation', 'hub'],
  ['future', 'experience'],
  ['experience', 'journey'],
  ['next', 'platform'],
  ['synergy', 'hub'],
];

const GENERIC_CATEGORY_WORDS = [
  ...GENERIC_CONCEPT_WORD_PENALTY_LIST,
  'pavilion',
  'zone',
  'experience',
  'journey',
  'hub',
  'platform',
  'showcase',
  'lab',
  'center',
  'centre',
  '파빌리온',
  '존',
  '허브',
  '플랫폼',
  '쇼케이스',
  '랩',
  '센터',
  '공간',
  '체험',
  '전시',
  '여정',
  '혁신',
  '미래',
  '통합',
  '차별화',
  '구분',
  '정체성',
  '가치',
  '증거',
  '신호',
  '루트',
  '이유',
  '선택',
  '연결',
  '공명',
  '확신',
  '집중',
  '방향',
  '전략',
  '메시지',
  '인지',
  '흐름',
  '경로',
  '단계',
];


const CONCEPT_ROLE_GUARD_TERMS = [
  'modular',
  'interactive',
  'value chain',
  'media',
  'zone',
  'pavilion',
  'experience',
  'content',
  'mechanism',
  'spatial',
  'spatial layout',
  'layout',
  'booth constraint',
  'booth',
  'column constraint',
  'column',
  'columns',
  'deliverable category',
  'deliverable',
  'rfp object',
  'rfp',
  'module',
  'protocol',
  'matrix',
  'feature',
  'zoning',
  'object list',
  '모듈러',
  '인터랙티브',
  '프로토콜',
  '매트릭스',
  '기능',
  '밸류체인',
  '가치사슬',
  '미디어',
  '존',
  '파빌리온',
  '체험',
  '콘텐츠',
  '컨텐츠',
  '메커니즘',
  '프로토콜',
  '매트릭스',
  '조준경',
  '개인병사용',
  '공간',
  '레이아웃',
  '부스',
  '기둥',
  '산출물',
  '오브젝트',
];

const EXECUTION_NAMING_DEVICE_TERMS = [
  'modular',
  'interactive',
  'media',
  'zone',
  'pavilion',
  'experience',
  'content',
  'mechanism',
  'spatial',
  'layout',
  'booth',
  'column',
  'columns',
  'deliverable',
  'module',
  'protocol',
  'matrix',
  'feature',
  'zoning',
  '모듈러',
  '인터랙티브',
  '프로토콜',
  '매트릭스',
  '기능',
  '미디어',
  '존',
  '파빌리온',
  '체험',
  '콘텐츠',
  '컨텐츠',
  '메커니즘',
  '프로토콜',
  '매트릭스',
  '조준경',
  '개인병사용',
  '공간',
  '레이아웃',
  '부스',
  '기둥',
  '산출물',
];

const RFP_KEYWORD_NAMING_DEVICES = [
  'value chain',
  'rfp object list',
  'object list',
  '밸류체인',
  '가치사슬',
  '오브젝트 리스트',
];

const EXPLANATORY_PATTERNS = [
  /을\s*위한/u,
  /를\s*위한/u,
  /와\s*함께하는/u,
  /과\s*함께하는/u,
  /중심의/u,
  /기반의/u,
  /플랫폼/u,
  /공간/u,
  /체험/u,
  /전시/u,
  /:/u,
  /：/u,
];

const FORBIDDEN_ABSTRACT_NAMING_TERMS = [
  '가치',
  '증거',
  '신호',
  '루트',
  '이유',
  '선택',
  '차별화',
  '통합',
  '연결',
  '혁신',
  '경험',
  '공명',
  '확신',
  '집중',
  '방향',
  '전략',
  '메시지',
  'value',
  'proof',
  'signal',
  'route',
  'reason',
  'choice',
  'differentiation',
  'connection',
  'innovation',
  'experience',
  'focus',
  'resonance',
  'strategy',
  'identity',
  'unity',
  'synergy',
  'nexus',
  'pulse',
  'vanguard',
  'frontier',
  'spectrum',
];


const UNSUPPORTED_POETIC_CONCEPT_NAMES = [
  '첫문장의 정원',
  '등대의 항로',
  '서랍 속 도감',
  '기억의 숲',
  '가능성의 지도',
  '미래의 정원',
  '빛의 항해',
  '경험의 서랍',
  '가치의 풍경',
];

const GENERIC_POETIC_OBJECT_TERMS = [
  '정원',
  '등대',
  '항로',
  '서랍',
  '도감',
  '숲',
  '지도',
  '항해',
  '풍경',
  '바다',
  '별',
  '빛',
  '문장',
  '기억',
  '가능성',
];

const METAPHOR_SOURCE_TYPES = [
  'actual RFP object',
  'project type',
  'client or brand role',
  'product/service logic',
  'spatial structure',
  'audience behavior',
  'content mechanism',
  'operational proof',
  'evaluation criteria',
  'stakeholder relationship',
];

const RFP_OVERVIEW_DEFINITION_STARTERS = [
  'project name',
  'project period',
  'venue',
  'budget',
  'client',
  'submission',
  '프로젝트명',
  '사업명',
  '기간',
  '장소',
  '예산',
  '클라이언트',
  '제출',
  '입찰',
];

const CONSTRAINT_SOURCE_TERMS = [
  'column',
  'columns',
  'pillar',
  'constraint',
  'constraints',
  'booth',
  'venue',
  'budget',
  'schedule',
  'deliverable',
  'equipment',
  'floor plan',
  'sightline',
  '기둥',
  '제약',
  '부스',
  '장소',
  '공간 조건',
  '예산',
  '일정',
  '산출물',
  '장비',
  '평면',
  '동선',
  '시야',
];

const SENTENCE_ENDINGS = /(합니다|드립니다|제안합니다|구현합니다|만듭니다|전환합니다|연결합니다|실현합니다|제시합니다|하는|되는|위한)$/u;

function normalizedText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function titleUnitCount(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return 0;
  const spacedUnits = trimmed.split(/\s+/).filter(Boolean).length;
  if (spacedUnits > 1) return spacedUnits;
  const hangulChunks = trimmed.match(/[가-힣]{2,}/g)?.length ?? 0;
  const latinChunks = trimmed.match(/[a-zA-Z0-9]+/g)?.length ?? 0;
  return Math.max(1, hangulChunks + latinChunks);
}

function containsAny(value: string, terms: string[]) {
  const normalized = normalizedText(value);
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function significantTokens(value: string) {
  return normalizedText(value)
    .split(/[^a-z0-9가-힣]+/iu)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function hasDirectAvoidanceRuleEcho(name: string, avoidanceRules: string[] = []) {
  const nameTokens = new Set(significantTokens(name));
  if (!nameTokens.size) return false;

  return avoidanceRules.some((rule) => {
    const ruleTokens = significantTokens(rule);
    if (ruleTokens.length < 2) return false;
    const overlap = ruleTokens.filter((token) => nameTokens.has(token)).length;
    return overlap >= 2 || (ruleTokens.length === 2 && overlap === 1 && nameTokens.size <= 2);
  });
}

function countTerms(value: string, terms: string[]) {
  const normalized = normalizedText(value);
  return terms.reduce((count, term) => count + (normalized.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function hasUntransformedConceptRoleTerm(name: string) {
  return containsAny(name, CONCEPT_ROLE_GUARD_TERMS);
}

function hasExecutionDescriptionName(name: string) {
  const normalized = normalizedText(name);
  const executionTermCount = countTerms(name, EXECUTION_NAMING_DEVICE_TERMS);
  return executionTermCount >= 2
    || /modular[\s/·|+_-]+interactive/i.test(normalized)
    || /interactive[\s/·|+_-]+modular/i.test(normalized)
    || RFP_KEYWORD_NAMING_DEVICES.some((term) => normalized.includes(term.toLowerCase()));
}

function hasWeakGenericConceptName(name: string) {
  const normalized = normalizedText(name);
  const tokens = normalized.split(/[\s/·|+_-]+/).filter(Boolean);

  return WEAK_GENERIC_CONCEPT_NAMES.includes(normalized) || WEAK_GENERIC_TOKEN_COMBINATIONS.some((combination) =>
    combination.every((token) => tokens.includes(token))
  );
}

function hasForbiddenAbstractNamingCore(name: string) {
  return containsAny(name, FORBIDDEN_ABSTRACT_NAMING_TERMS);
}

function hasGenericConceptPenaltyWord(name: string) {
  const normalized = normalizedText(name);
  const tokens = normalized.split(/[\s/·|+_-]+/).filter(Boolean);
  return GENERIC_CONCEPT_WORD_PENALTY_LIST.some((word) => tokens.includes(word) || normalized === word);
}

function hasGenericMainNamingDevice(name: string) {
  const normalized = normalizedText(name);
  const tokens = normalized.split(/[\s/·|+_-]+/).filter(Boolean);
  return GENERIC_CATEGORY_WORDS.some((word) => {
    const normalizedWord = word.toLowerCase();
    return tokens.includes(normalizedWord) || normalized.endsWith(` ${normalizedWord}`) || normalized.endsWith(normalizedWord);
  });
}

function isLikelySentence(name: string) {
  const trimmed = name.trim();
  return SENTENCE_ENDINGS.test(trimmed) || /[.!?。]$/.test(trimmed) || EXPLANATORY_PATTERNS.some((pattern) => pattern.test(trimmed));
}


function hasStrategyStatementName(name: string) {
  const normalized = normalizedText(name);
  return [
    /value signal/i,
    /proof route/i,
    /reason to choose/i,
    /scene of innovation/i,
    /connected future/i,
    /innovation journey/i,
    /focused identity/i,
    /distinct unity/i,
    /differentiated unity/i,
    /증거\s*루트/u,
    /가치\s*신호/u,
    /선택의\s*이유/u,
    /혁신의\s*장면/u,
    /차별화된\s*통합/u,
    /명확한\s*구분/u,
    /통합된\s*경험/u,
    /구현$/u,
    /전략$/u,
    /방향$/u,
    /솔루션$/u,
    /제안$/u,
    /목표$/u,
  ].some((pattern) => pattern.test(normalized));
}


function isJourneyOrExecutionOnlyName(name: string) {
  const normalized = normalizedText(name);
  return [
    /journey/i,
    /route/i,
    /path/i,
    /flow/i,
    /sequence/i,
    /step/i,
    /signal\s*(to|→)\s*proof/i,
    /route\s*(to|→)\s*value/i,
    /evidence\s*journey/i,
    /인지\s*의?\s*흐름/u,
    /확신\s*의?\s*여정/u,
    /경험\s*의?\s*경로/u,
    /차별화\s*의?\s*단계/u,
    /증거\s*루트/u,
    /가치\s*신호/u,
  ].some((pattern) => pattern.test(normalized));
}

function nameMechanismScore(candidate: ConceptCandidate, name: string) {
  const mechanismText = Object.values(candidate.conceptMechanism ?? {}).join(' ');
  const metaphorText = Object.values(candidate.conceptMetaphorSource ?? {}).join(' ');
  const nameText = normalizedText(name);
  const specificityToCurrentRfp = significantTokens(`${metaphorText} ${mechanismText}`).some((token) => nameText.includes(token)) ? 5 : 4;
  const symbolicPower = metaphorText.trim() && !hasStrategyStatementName(name) ? 5 : 3;
  const memorability = titleUnitCount(name) <= 3 && name.length <= 24 ? 5 : titleUnitCount(name) <= 5 ? 4 : 2;
  const coverTitlePotential = !isLikelySentence(name) && !hasExecutionDescriptionName(name) ? 5 : 2;
  const expandability = candidate.keywordExecutionGuide?.length === 3 && mechanismText.trim() && metaphorText.trim() ? 5 : 3;
  const nonGenericQuality = !hasWeakGenericConceptName(name) && !hasGenericMainNamingDevice(name) && !hasGenericConceptPenaltyWord(name) ? 5 : 2;
  const notStrategyLabel = !hasStrategyStatementName(name) && !hasDirectAvoidanceRuleEcho(name) ? 5 : 2;
  const scores = [specificityToCurrentRfp, symbolicPower, memorability, coverTitlePotential, expandability, nonGenericQuality, notStrategyLabel];
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}


function analysisEvidenceText(analysis?: AnalysisResult, proposalNarrative?: ProposalNarrative) {
  return normalizedText([
    analysis?.projectOverview,
    analysis?.clientChallenge,
    analysis?.targetInfo,
    analysis?.spatialCondition,
    analysis?.contentCondition,
    analysis?.operationCondition,
    analysis?.proposalStructureGuard,
    ...(analysis?.requiredDeliverables ?? []),
    ...(analysis?.scopeOfWork ?? []),
    ...(analysis?.evaluationCriteria ?? []),
    ...(analysis?.requiredItems ?? []),
    ...(analysis?.requiredScope ?? []),
    ...(analysis?.productInfo ?? []),
    ...(analysis?.productFeatures ?? []).flatMap((feature) => [feature.product, feature.keyFeature, feature.valueProposition]),
    ...(analysis?.kpiObjectives ?? []),
    ...(analysis?.constraints ?? []),
    ...(analysis?.schedule ?? []),
    ...(analysis?.kpiScheduleConstraints ?? []),
    proposalNarrative?.proposalThesis,
    proposalNarrative?.strategicOpportunity,
    proposalNarrative?.differentiationPrinciple,
  ].filter(Boolean).join(' '));
}

function hasExplicitRfpGrounding(candidate: ConceptCandidate) {
  const grounding = candidate.rfpGrounding ?? candidate.conceptMetaphorSource?.rfpEvidence ?? [];
  const sourceTypes = candidate.conceptMetaphorSource?.sourceTypes ?? [];
  return grounding.filter((item) => item.trim().length >= 8).length >= 3
    && sourceTypes.some((sourceType) => METAPHOR_SOURCE_TYPES.includes(sourceType));
}

function unsupportedPoeticTerms(name: string, rfpEvidenceText: string) {
  const normalizedName = normalizedText(name);
  const exactUnsupported = UNSUPPORTED_POETIC_CONCEPT_NAMES.includes(normalizedName);
  const poeticTerms = GENERIC_POETIC_OBJECT_TERMS.filter((term) => normalizedName.includes(term));
  if (!exactUnsupported && !poeticTerms.length) return [];

  return poeticTerms.filter((term) => !rfpEvidenceText.includes(term));
}

function isUnsupportedPoeticMetaphor(_candidate: ConceptCandidate, name: string, rfpEvidenceText: string) {
  return unsupportedPoeticTerms(name, rfpEvidenceText).length > 0;
}

function conceptDefinitionCopiesOverview(definition: string, context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult }) {
  const normalizedDefinition = normalizedText(definition);
  if (!normalizedDefinition) return false;
  if (RFP_OVERVIEW_DEFINITION_STARTERS.some((starter) => normalizedDefinition.startsWith(starter))) return true;

  const forbiddenStarts = [
    context.input?.projectName,
    context.input?.clientName,
    context.analysis?.projectOverview,
    context.analysis?.spatialCondition,
    context.analysis?.operationCondition,
  ]
    .filter(Boolean)
    .map((item) => normalizedText(String(item)).slice(0, 24))
    .filter((item) => item.length >= 8);

  return forbiddenStarts.some((starter) => normalizedDefinition.startsWith(starter));
}

function buildFallbackGrounding(candidate: ConceptCandidate, context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative }) {
  const analysis = context.analysis;
  return compactUnique([
    analysis?.productInfo?.[0],
    analysis?.requiredItems?.[0],
    analysis?.requiredScope?.[0],
    analysis?.scopeOfWork?.[0],
    analysis?.evaluationCriteria?.[0],
    analysis?.targetInfo,
    analysis?.spatialCondition,
    analysis?.contentCondition,
    analysis?.operationCondition,
    context.proposalNarrative?.proposalThesis,
    candidate.conceptMechanism?.proofMechanism,
    'RFP 핵심 요구와 제안 명제 연결',
    '필수 산출물과 실행 가능성 증명',
    '평가 기준에 맞춘 선택 이유 제시',
  ], 5);
}

function compactUnique(values: Array<string | undefined>, limit = 5) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value ?? '').trim().replace(/\s+/g, ' '))
    .filter((value) => value.length >= 4)
    .filter((value) => {
      const key = normalizedText(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function buildDefinitionFromMechanism(candidate: ConceptCandidate) {
  const mechanism = candidate.conceptMechanism;
  return mechanism?.whyThisCanBecomeAConcept
    || mechanism?.recognitionLogic
    || candidate.whyThisCanOrganizeProposal
    || candidate.whyThisConcept
    || candidate.whyThisWorks
    || 'RFP의 핵심 근거를 하나의 판단 구조로 묶어 공간·콘텐츠·운영 실행을 조직하는 콘셉트입니다.';
}

function collectConstraintTerms(analysis?: AnalysisResult) {
  const dynamicTerms = [
    ...(analysis?.constraints ?? []),
    analysis?.spatialCondition,
    analysis?.operationCondition,
    ...(analysis?.schedule ?? []),
  ]
    .filter(Boolean)
    .flatMap((item) => String(item).split(/[\s,.;:()\[\]{}\/]+/u))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 16);

  return Array.from(new Set([...CONSTRAINT_SOURCE_TERMS, ...dynamicTerms]));
}

function candidateName(candidate: ConceptCandidate) {
  return candidate.repairedProposalCoreConceptName || candidate.proposalCoreConceptName || candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR || '';
}

function sourceDisplayedConceptName(candidate: ConceptCandidate) {
  return candidate.proposalCoreConceptName || candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR || '';
}

export function getPresentationConceptName(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.repairedProposalCoreConceptName || candidate.proposalCoreConceptName || candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR || '';
}

export function getConceptTagline(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.proposalCoreConceptSlogan || candidate.conceptSlogan || candidate.conceptTagline || candidate.subtitle || candidate.oneLineDefinition || '';
}

export function getConceptDefinition(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.proposalCoreConceptDefinition || candidate.conceptDefinition || candidate.oneLineDefinition || candidate.whyThisWorks || '';
}

export function normalizeConceptCandidate(candidate: ConceptCandidate): ConceptCandidate {
  const conceptName = (candidate.repairedProposalCoreConceptName || candidate.proposalCoreConceptName || candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR).trim();
  const conceptTagline = (candidate.proposalCoreConceptSlogan || candidate.conceptSlogan || candidate.conceptTagline || candidate.subtitle || candidate.oneLineDefinition).trim();
  const conceptDefinition = (candidate.proposalCoreConceptDefinition || candidate.conceptDefinition || candidate.oneLineDefinition || candidate.whyThisWorks).trim();
  const winningThesisUse = candidate.winningThesisUse ?? {
    contextShift: candidate.conceptRationale?.strategicShift || candidate.strategicApproach || '',
    previousBaseline: candidate.conceptRationale?.problemInsight || '',
    newReality: candidate.conceptRationale?.clientNeed || candidate.hiddenNeedResolved || '',
    clientUniquePosition: candidate.conceptRationale?.whyThisConcept || candidate.whyThisNameFitsRfp || '',
    audiencePerceptionGap: candidate.conceptRationale?.audienceBarrier || candidate.targetRelevance || '',
    winningClaim: candidate.coreMessage || candidate.strategicApproach || conceptTagline,
    whyNow: candidate.hiddenNeedResolved || candidate.whyThisConcept || '',
    whyThisClient: candidate.whyThisNameFitsRfp || candidate.whyThisNameWorks || '',
    whatMustBeProven: candidate.thesisProof || candidate.executionFeasibility || '',
  };
  const conceptLeap = candidate.conceptLeap ?? {
    fromStatement: winningThesisUse.previousBaseline || '',
    toStatement: winningThesisUse.newReality || '',
    conceptLeap: candidate.whyThisConcept || candidate.whyThisCanOrganizeProposal || conceptDefinition,
    corePromise: winningThesisUse.winningClaim || conceptTagline,
    emotionalTakeaway: candidate.conceptMechanism?.visitorOrAudienceTransformation || candidate.targetRelevance || '',
    evaluatorTakeaway: candidate.conceptMechanism?.proofMechanism || candidate.thesisProof || '',
  };
  const signatureProofIdea = candidate.signatureProofIdea ?? {
    signatureScene: candidate.keyExperienceAssetDirection || candidate.experienceStructure || '',
    signatureContent: candidate.contentMediaImplication || candidate.conceptMechanism?.contentMechanism || '',
    signatureSpatialMove: candidate.spatialApplication || candidate.conceptMechanism?.spatialMechanism || '',
    signatureMediaOrInteraction: candidate.mediaInteractionPotential || candidate.conceptMechanism?.interactionMechanism || '',
    whyThisProvesTheConcept: candidate.thesisProof || candidate.conceptMechanism?.proofMechanism || '',
    whyThisIsNotGeneric: candidate.whyThisNameFitsRfp || candidate.whyThisIsNotJustPoetic || '',
  };

  return {
    ...candidate,
    strategicDirectionType: candidate.strategicDirectionType || 'proposal_strategy_option',
    strategicDirectionLabel: candidate.strategicDirectionLabel || '전략 옵션',
    whatThisDirectionEmphasizes: candidate.whatThisDirectionEmphasizes || candidate.strategicApproach || candidate.whyThisConcept || 'RFP에 맞는 제안 우선순위를 강조합니다.',
    whenToChooseThisDirection: candidate.whenToChooseThisDirection || '이 전략 우선순위가 평가에서 가장 중요할 때 선택합니다.',
    conceptMechanism: candidate.conceptMechanism ?? {
      experienceMechanism: candidate.experienceStructure || candidate.experienceLogic || '',
      spatialMechanism: candidate.spatialApplication || '',
      contentMechanism: candidate.mediaInteractionPotential || '',
      interactionMechanism: candidate.experienceNarrativeFlow?.join(' → ') || '',
      recognitionLogic: candidate.coreMessage || '',
      visitorOrAudienceTransformation: candidate.targetRelevance || '',
      proofMechanism: candidate.thesisProof || candidate.executionFeasibility || '',
      whyThisCanBecomeAConcept: candidate.whyThisConcept || candidate.whyThisWorks || '',
    },
    conceptMetaphorSource: {
      ...(candidate.conceptMetaphorSource ?? {
        metaphorSeed: conceptName,
        symbolicImage: candidate.conceptMechanism?.experienceMechanism || candidate.experienceStructure || conceptDefinition,
        proposalWorld: candidate.conceptMechanism?.whyThisCanBecomeAConcept || candidate.keyExperienceAssetDirection || conceptTagline,
        whyThisCanBecomeAConceptTitle: candidate.whyThisNameWorks || candidate.whyThisConcept || candidate.whyThisWorks || '',
      }),
      sourceTypes: candidate.conceptMetaphorSource?.sourceTypes?.length ? candidate.conceptMetaphorSource.sourceTypes : ['project type'],
      rfpEvidence: candidate.conceptMetaphorSource?.rfpEvidence?.length ? candidate.conceptMetaphorSource.rfpEvidence : candidate.rfpGrounding ?? [],
    },
    rfpGrounding: candidate.rfpGrounding?.length ? candidate.rfpGrounding : candidate.conceptMetaphorSource?.rfpEvidence ?? [],
    whyThisNameFitsRfp: candidate.whyThisNameFitsRfp || candidate.whyThisNameWorks || candidate.conceptMetaphorSource?.whyThisCanBecomeAConceptTitle || '',
    whyThisIsNotJustPoetic: candidate.whyThisIsNotJustPoetic || '현재 RFP 근거와 실행 메커니즘에서 파생된 이름인지 검증합니다.',
    whyThisCanOrganizeProposal: candidate.whyThisCanOrganizeProposal || candidate.conceptMechanism?.whyThisCanBecomeAConcept || candidate.whyThisConcept || '',
    whyThisNameWorks: candidate.whyThisNameWorks || candidate.conceptMetaphorSource?.whyThisCanBecomeAConceptTitle || candidate.whyThisConcept || candidate.whyThisWorks || '',
    keywordExecutionGuide: (candidate.keywordExecutionGuide ?? []).map((guide) => ({
      ...guide,
      contentOrMediaImplication: guide.contentOrMediaImplication || guide.contentImplication || '',
      operationImplication: guide.operationImplication || candidate.executionFeasibility || '',
    })),
    antiPatternValidation: {
      riskToAvoid: candidate.antiPatternValidation?.riskToAvoid || candidate.riskOrCaution || 'Generic proposal language',
      howThisConceptAvoidsIt: candidate.antiPatternValidation?.howThisConceptAvoidsIt || candidate.antiPatternValidation?.validationSummary || '',
      validationCheck: candidate.antiPatternValidation?.validationCheck || candidate.antiPatternValidation?.validationCriteria?.[0] || '',
      validationCriteria: candidate.antiPatternValidation?.validationCriteria ?? [],
      passed: candidate.antiPatternValidation?.passed ?? true,
      validationSummary: candidate.antiPatternValidation?.validationSummary || '',
    },
    mainStrength: candidate.mainStrength || candidate.strengths?.[0] || candidate.evaluationSummary || 'RFP 핵심 우선순위를 선명하게 보여줍니다.',
    mainRisk: candidate.mainRisk || candidate.risks?.[0] || candidate.riskOrCaution || '선택한 방향 외의 우선순위는 후속 구조에서 보완해야 합니다.',
    entityDifferentiationUse: candidate.entityDifferentiationUse ?? {
      unifyingFrame: '',
      distinctEntityRoles: '',
      visitorRecognitionLogic: '',
      proofByEntity: '',
      riskCheck: '',
    },
    conceptScopeValidation: candidate.conceptScopeValidation ?? buildScopeValidation(candidate),
    conceptNameScopeClassification: candidate.conceptNameScopeClassification ?? classifyConceptNameScope(candidate),
    conceptNameEnglish: candidate.conceptNameEnglish || candidate.conceptNameEN || (/^[\x00-\x7F]+$/.test(conceptName) ? conceptName : ''),
    conceptNameKoreanSubtitle: candidate.conceptNameKoreanSubtitle || (/^[\x00-\x7F]+$/.test(conceptName) ? candidate.subtitle || conceptTagline : ''),
    conceptSloganKorean: candidate.conceptSloganKorean || conceptTagline,
    conceptSloganEnglish: candidate.conceptSloganEnglish || '',
    winningThesisUse,
    conceptLeap,
    signatureProofIdea,
    repairedProposalCoreConceptName: candidate.repairedProposalCoreConceptName,
    proposalCoreConceptName: conceptName,
    proposalCoreConceptSlogan: candidate.proposalCoreConceptSlogan || conceptTagline,
    proposalCoreConceptDefinition: conceptDefinition,
    whyThisIsCoreConcept: candidate.whyThisIsCoreConcept || candidate.whyThisNameWorks || candidate.whyThisConcept || candidate.whyThisWorks || '',
    experiencePrinciple: candidate.experiencePrinciple || candidate.conceptMechanism?.visitorOrAudienceTransformation || candidate.experienceLogic || candidate.experienceStructure || '',
    visitorJourney: candidate.visitorJourney || candidate.experienceNarrativeFlow?.join(' → ') || candidate.conceptMechanism?.interactionMechanism || '',
    contentMediaImplication: candidate.contentMediaImplication || candidate.conceptMechanism?.contentMechanism || candidate.mediaInteractionPotential || '',
    conceptName,
    conceptSlogan: candidate.conceptSlogan || candidate.proposalCoreConceptSlogan || conceptTagline,
    conceptTagline,
    conceptDefinition,
    conceptTitle: conceptName,
    subtitle: conceptTagline,
    oneLineDefinition: conceptDefinition,
  };
}

export function normalizeConceptCandidatesResult(result: ConceptCandidatesResult): ConceptCandidatesResult {
  return {
    ...result,
    entityDifferentiationMatrix: result.entityDifferentiationMatrix ?? [],
    concepts: result.concepts.map(normalizeConceptCandidate),
  };
}


function compactNameKey(name: string) {
  return normalizedText(name).replace(/[^a-z0-9가-힣]/giu, '');
}

function areNearDuplicateNames(a: string, b: string) {
  const left = compactNameKey(a);
  const right = compactNameKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = new Set(significantTokens(a));
  const rightTokens = significantTokens(b);
  if (leftTokens.size && rightTokens.length) {
    const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
    if (overlap >= Math.min(leftTokens.size, rightTokens.length)) return true;
  }
  return (left.length >= 6 && right.includes(left)) || (right.length >= 6 && left.includes(right));
}

const NARROW_SCOPE_NAME_PATTERNS = [
  /protocol|matrix|feature|module|zone|section|interaction|interface|engine|system|field|arena|frame/i,
  /프로토콜|매트릭스|모듈|기능|존|섹션|인터랙션|시스템|조준경|개인병사용|야간투시경|공학장비|광학장비|야전시경|필드|아레나|프레임/u,
];

const CONTENT_MODULE_SCOPE_TERMS = [
  'module', 'content', 'media', 'interaction', 'interface', 'demo', 'asset', 'scene', 'journey', 'flow',
  '모듈', '콘텐츠', '컨텐츠', '미디어', '인터랙션', '데모', '에셋', '장면', '여정', '흐름',
];

const SECTION_SCOPE_TERMS = [
  'zone', 'section', 'pavilion', 'booth', 'field', 'arena', 'stage', 'layout', 'spatial',
  '존', '섹션', '파빌리온', '부스', '필드', '아레나', '스테이지', '레이아웃', '공간',
];

function isNarrowProposalScopeName(name: string) {
  return NARROW_SCOPE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function centralHeroTerms(context: { analysis?: AnalysisResult }) {
  const analysis = context.analysis;
  const overview = normalizedText([analysis?.projectOverview, analysis?.clientChallenge, analysis?.proposalStructureGuard].filter(Boolean).join(' '));
  const candidates = [
    ...(analysis?.productInfo ?? []),
    ...(analysis?.productFeatures ?? []).map((feature) => feature.product),
  ].map((item) => normalizeSafeNameSeed(item).trim()).filter((item) => item.length >= 2);
  return candidates.filter((term) => {
    const count = overview.split(term.toLowerCase()).length - 1;
    return count >= 2 && candidates.length <= 1;
  });
}

function productSpecificTerms(context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative }) {
  const analysis = context.analysis;
  const entityTerms = (context.proposalNarrative?.entityDifferentiationMatrix ?? []).flatMap((item) => [
    item.entityName,
    item.entityType,
    item.keyOffering,
    item.spatialOrContentRole,
    item.experienceMechanism,
  ]);
  return compactUnique([
    ...(analysis?.productInfo ?? []),
    ...(analysis?.productFeatures ?? []).flatMap((feature) => [feature.product, feature.keyFeature]),
    ...(analysis?.requiredItems ?? []),
    ...(analysis?.requiredScope ?? []),
    ...(analysis?.scopeOfWork ?? []),
    ...(analysis?.requiredDeliverables ?? []),
    analysis?.contentCondition,
    analysis?.spatialCondition,
    ...entityTerms,
  ].flatMap((value) => normalizeSafeNameSeed(String(value ?? '')).split(/\s+/)), 80)
    .filter((token) => token.length >= 2 && token.length <= 14)
    .filter((token) => !centralHeroTerms(context).some((hero) => normalizedText(hero).includes(normalizedText(token))));
}

function isProductSpecificName(name: string, context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative }) {
  const normalized = normalizedText(name);
  const terms = productSpecificTerms(context);
  const hits = terms.filter((term) => normalized.includes(term.toLowerCase()));
  return hits.length > 0 && (hits.length >= Math.max(1, titleUnitCount(name) - 1) || isNarrowProposalScopeName(name));
}

export function classifyConceptNameScope(candidate: ConceptCandidate, context: { analysis?: AnalysisResult } = {}): ConceptNameScopeClassification {
  const name = candidateName(candidate);
  if (!name.trim()) return 'generic_label';
  if (isProductSpecificName(name, context)) return 'product_specific_level';
  if (containsAny(name, CONTENT_MODULE_SCOPE_TERMS) || isJourneyOrExecutionOnlyName(name)) return 'content_module_level';
  if (containsAny(name, SECTION_SCOPE_TERMS) || isNarrowProposalScopeName(name) || isLikelySentence(name)) return 'section_level';
  if (hasWeakGenericConceptName(name) || hasGenericConceptPenaltyWord(name) || hasGenericMainNamingDevice(name) || hasForbiddenAbstractNamingCore(name)) return 'generic_label';
  if (hasProposalLevelScope(candidate, context)) return 'proposal_level';
  return 'generic_label';
}

function hasProposalLevelScope(candidate: ConceptCandidate, context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative } = {}) {
  const validation = candidate.conceptScopeValidation;
  if (validation && (!validation.notProductSpecificOnly || !validation.notSectionTitleOnly)) return false;
  if (validation) return Object.values(validation).every(Boolean);

  const mechanism = candidate.conceptMechanism;
  return Boolean(
    mechanism?.spatialMechanism?.trim()
      && mechanism?.contentMechanism?.trim()
      && mechanism?.interactionMechanism?.trim()
      && mechanism?.proofMechanism?.trim()
      && candidate.whyThisCanOrganizeProposal?.trim()
  );
}

function buildScopeValidation(candidate: ConceptCandidate, context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative } = {}) {
  const mechanism = candidate.conceptMechanism;
  const name = candidateName(candidate);
  return {
    coversWholeProposal: Boolean(candidate.whyThisCanOrganizeProposal || mechanism?.whyThisCanBecomeAConcept),
    coversMainEntitiesOrScope: Boolean(candidate.entityDifferentiationUse?.unifyingFrame || candidate.rfpGrounding?.length),
    expandableToSpace: Boolean(mechanism?.spatialMechanism || candidate.spatialApplication),
    expandableToContent: Boolean(mechanism?.contentMechanism || candidate.contentMediaImplication),
    expandableToMediaOrInteraction: Boolean(mechanism?.interactionMechanism || candidate.mediaInteractionPotential),
    expandableToOperationOrProof: Boolean(mechanism?.proofMechanism || candidate.executionFeasibility),
    notProductSpecificOnly: !isNarrowProposalScopeName(name) && !isProductSpecificName(name, context),
    notSectionTitleOnly: !isLikelySentence(name) && !hasUntransformedConceptRoleTerm(name),
  };
}

function inferGlobalNamingMode(context: { analysis?: AnalysisResult }) {
  const evidence = analysisEvidenceText(context.analysis);
  return /overseas|global|international|trade show|buyer|b2b|showcase|pavilion|expo|해외|글로벌|국제|바이어|수출|파빌리온|쇼케이스/i.test(evidence);
}

export function validateConceptNaming(
  result: ConceptCandidatesResult,
  context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative; avoidanceRules?: string[] } = {},
) {
  const constraintTerms = collectConstraintTerms(context.analysis);
  const rfpEvidenceText = analysisEvidenceText(context.analysis, context.proposalNarrative);
  const violations: string[] = [];

  result.concepts.forEach((candidate, index) => {
    const name = candidateName(candidate);
    const unitCount = titleUnitCount(name);
    const label = `${candidate.conceptId || `concept-${index + 1}`} (${name || 'empty name'})`;

    const scopeClassification = classifyConceptNameScope(candidate, context);
    if (scopeClassification !== 'proposal_level') violations.push(`${label}: conceptNameScopeClassification is ${scopeClassification}; only proposal_level is valid for proposalCoreConceptName.`);
    if (!hasProposalLevelScope(candidate, context)) violations.push(`${label}: conceptScopeValidation must prove proposal-level coverage across strategy, space, content, media/interaction, operation/proof, main entities/scope, and non-section naming.`);
    if (isProductSpecificName(name, context)) violations.push(`${label}: conceptName is based mainly on one product, equipment type, technology, zone, content module, interaction, participant entity, or RFP subsection instead of the whole proposal.`);
    if (isNarrowProposalScopeName(name)) violations.push(`${label}: conceptName is too narrow for proposal level and reads like a product, module, zone, interaction, feature, protocol, matrix, or section title.`);
    if (!name.trim()) violations.push(`${label}: conceptName is empty.`);
    if (unitCount > 5 || name.length > 36) violations.push(`${label}: conceptName is too long for a presentation-ready title.`);
    if (isLikelySentence(name)) violations.push(`${label}: conceptName reads like an explanatory sentence or section heading.`);
    if (hasForbiddenAbstractNamingCore(name)) violations.push(`${label}: conceptName is centered on a forbidden abstract/corrective naming word rather than a project-specific metaphor source.`);
    if (hasStrategyStatementName(name)) violations.push(`${label}: conceptName reads like a strategy statement, slide title, project objective, direct solution phrase, or avoidance-rule translation instead of a concept mechanism.`);
    if (nameMechanismScore(candidate, name) < 4) violations.push(`${label}: conceptName scores below 4 on specificity, memorability, mechanism clarity, expandability, non-generic quality, or cover-title potential.`);
    if (hasWeakGenericConceptName(name)) violations.push(`${label}: proposalCoreConceptName is a weak generic keyword combination rather than a proposal-ready idea.`);
    if (isJourneyOrExecutionOnlyName(name)) violations.push(`${label}: proposalCoreConceptName reads like a visitor journey, sequence, interaction mechanism, content section, slide title, strategic instruction, or anti-pattern correction rather than the proposal's organizing idea.`);
    if (hasGenericConceptPenaltyWord(name)) violations.push(`${label}: conceptName uses a generic tech/event branding word from the universal penalty list without current-RFP-specific justification.`);
    if (hasGenericMainNamingDevice(name)) violations.push(`${label}: conceptName uses a generic category word as the main naming device.`);
    if (hasUntransformedConceptRoleTerm(name)) violations.push(`${label}: conceptName uses execution methods, content categories, spatial solutions, constraints, or RFP keywords as the main naming device instead of a transformed strategic metaphor.`);
    if (hasExecutionDescriptionName(name)) violations.push(`${label}: conceptName reads like an execution strategy, content category, spatial solution, RFP keyword, or technical description instead of a strategic idea.`);
    if (containsAny(name, constraintTerms)) violations.push(`${label}: conceptName appears to be derived from constraints, deliverables, venue, schedule, or implementation conditions.`);
    if (hasDirectAvoidanceRuleEcho(name, context.avoidanceRules)) violations.push(`${label}: conceptName directly echoes a lost-proposal avoidance rule; anti-patterns must be validation criteria, not naming source material.`);
    if (isUnsupportedPoeticMetaphor(candidate, name, rfpEvidenceText)) violations.push(`${label}: conceptName uses a literary or arbitrary poetic metaphor that is not grounded in current RFP objects, roles, mechanisms, spatial/content logic, evaluation criteria, or stakeholder relationships.`);
    if (!hasExplicitRfpGrounding(candidate)) violations.push(`${label}: concept candidate must include 3-5 concrete rfpGrounding evidence points and a valid conceptMetaphorSource.sourceTypes value.`);
    if (conceptDefinitionCopiesOverview(getConceptDefinition(candidate), context)) violations.push(`${label}: conceptDefinition appears to restate the RFP overview or administrative facts instead of explaining the concept mechanism.`);
  });

  for (let i = 0; i < result.concepts.length; i += 1) {
    for (let j = i + 1; j < result.concepts.length; j += 1) {
      const left = candidateName(result.concepts[i]);
      const right = candidateName(result.concepts[j]);
      if (areNearDuplicateNames(left, right)) violations.push(`${result.concepts[i].conceptId || `concept-${i + 1}`} and ${result.concepts[j].conceptId || `concept-${j + 1}`}: concept names are duplicate or near-duplicate; keep strategic directions distinct and repair the weaker name.`);
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}


function normalizeSafeNameSeed(value: string) {
  return value
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[^a-zA-Z0-9가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSymbolicSeeds(value: string, fallbackSeeds: string[] = []) {
  const blocked = ['제안', '프로젝트', '사업', '운영', '행사', '콘텐츠', '체험', '전시', '공간', '부스', '기둥', '장소', '예산', '일정', '산출물'];
  const seeds = normalizeSafeNameSeed(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && token.length <= 8)
    .filter((token) => !blocked.includes(token))
    .filter((token) => !FORBIDDEN_ABSTRACT_NAMING_TERMS.some((term) => token.toLowerCase().includes(term.toLowerCase())));
  return [...seeds, ...fallbackSeeds].filter(Boolean);
}


function extractRfpNameSeeds(context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative }) {
  const analysis = context.analysis;
  const values = [
    ...(analysis?.productInfo ?? []),
    ...(analysis?.productFeatures ?? []).flatMap((feature) => [feature.product, feature.keyFeature, feature.valueProposition]),
    ...(analysis?.requiredItems ?? []),
    ...(analysis?.requiredScope ?? []),
    ...(analysis?.scopeOfWork ?? []),
    ...(analysis?.requiredDeliverables ?? []),
    ...(analysis?.evaluationCriteria ?? []),
    analysis?.targetInfo,
    analysis?.spatialCondition,
    analysis?.contentCondition,
    analysis?.operationCondition,
    context.input?.clientName,
    context.input?.projectName,
    context.proposalNarrative?.proposalThesis,
  ];

  const blocked = new Set([
    '제안', '프로젝트', '사업', '운영', '행사', '콘텐츠', '컨텐츠', '체험', '전시', '공간', '부스', '장소', '예산', '일정', '산출물',
    '요구', '기준', '평가', '구축', '제작', '관리', '용역', '과업', '수행', '필수', '대상', '제출',
  ]);

  return compactUnique(values.flatMap((value) => normalizeSafeNameSeed(String(value ?? '')).split(/\s+/)), 12)
    .filter((token) => token.length >= 2 && token.length <= 10)
    .filter((token) => !blocked.has(token))
    .filter((token) => !GENERIC_POETIC_OBJECT_TERMS.includes(token))
    .filter((token) => !FORBIDDEN_ABSTRACT_NAMING_TERMS.some((term) => token.toLowerCase().includes(term.toLowerCase())));
}

function buildSafeConceptNamesFromMetaphor(candidate: ConceptCandidate, context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative }) {
  const globalMode = inferGlobalNamingMode(context);
  const direction = normalizedText(candidate.strategicDirectionType || candidate.strategicDirectionLabel || '');
  const narrative = context.proposalNarrative;
  const hasMultipleEntities = Boolean(narrative?.entityDifferentiationMatrix?.length && narrative.entityDifferentiationMatrix.length > 1);
  const proofHeavy = /proof|trust|reliable|operation|signature|증명|신뢰|운영|실행/.test(direction);
  const participationHeavy = /audience|participation|behavior|서비스|참여|행동/.test(direction);
  const impactHeavy = /impact|hero|signature|상징|임팩트|히어로/.test(direction);

  const englishNames = compactUnique([
    hasMultipleEntities ? 'Shared Mission Atlas' : '',
    proofHeavy ? 'Readiness Theater' : '',
    proofHeavy ? 'Capability Ledger' : '',
    participationHeavy ? 'Audience Compass' : '',
    participationHeavy ? 'Response Canvas' : '',
    impactHeavy ? 'Flagship Horizon' : '',
    impactHeavy ? 'Flagship Landmark' : '',
    'Mission Cartography',
    'Capability Canopy',
    'Role Constellation',
  ], 10);

  const koreanNames = compactUnique([
    hasMultipleEntities ? '공동 임무의 축' : '',
    hasMultipleEntities ? '역할의 성좌' : '',
    proofHeavy ? '수행 역량의 무대' : '',
    proofHeavy ? '검증 가능한 현장' : '',
    participationHeavy ? '관객 반응의 나침반' : '',
    participationHeavy ? '참여가 남기는 궤적' : '',
    impactHeavy ? '대표 장면의 지평' : '',
    impactHeavy ? '상징이 되는 현장' : '',
    '목적이 보이는 축',
    '판단을 여는 무대',
  ], 10);

  return globalMode ? [...englishNames, ...koreanNames] : [...koreanNames, ...englishNames];
}

function applyConceptName(candidate: ConceptCandidate, conceptName: string, warning?: string, context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative } = {}, reason = 'Displayed core concept name failed proposal-level validation and was repaired deterministically.'): ConceptCandidate {
  const rfpGrounding = buildFallbackGrounding(candidate, context);
  const conceptDefinition = conceptDefinitionCopiesOverview(getConceptDefinition(candidate), context)
    ? buildDefinitionFromMechanism(candidate)
    : getConceptDefinition(candidate);
  const originalName = sourceDisplayedConceptName(candidate).trim();

  return normalizeConceptCandidate({
    ...candidate,
    repairedProposalCoreConceptName: conceptName,
    proposalCoreConceptName: conceptName,
    proposalCoreConceptDefinition: conceptDefinition,
    conceptName,
    conceptDefinition,
    oneLineDefinition: conceptDefinition,
    conceptTitle: conceptName,
    conceptNameKR: /^[\x00-\x7F]+$/.test(conceptName) ? (candidate.conceptNameKoreanSubtitle || conceptName) : conceptName,
    conceptNameEN: /^[\x00-\x7F]+$/.test(conceptName) ? conceptName : (candidate.conceptNameEnglish || conceptName),
    conceptNameEnglish: /^[\x00-\x7F]+$/.test(conceptName) ? conceptName : (candidate.conceptNameEnglish || ''),
    conceptNameKoreanSubtitle: /^[\x00-\x7F]+$/.test(conceptName) ? (candidate.conceptNameKoreanSubtitle || getConceptTagline(candidate)) : '',
    conceptSloganKorean: candidate.conceptSloganKorean || getConceptTagline(candidate),
    conceptSloganEnglish: candidate.conceptSloganEnglish || '',
    conceptScopeValidation: { ...buildScopeValidation({ ...candidate, proposalCoreConceptName: conceptName, conceptName } as ConceptCandidate), notProductSpecificOnly: !isProductSpecificName(conceptName, context) },
    conceptNameScopeClassification: 'proposal_level',
    rfpGrounding: candidate.rfpGrounding?.length ? candidate.rfpGrounding : rfpGrounding,
    conceptMetaphorSource: {
      ...(candidate.conceptMetaphorSource ?? {
        metaphorSeed: conceptName,
        symbolicImage: candidate.conceptMechanism?.recognitionLogic || conceptDefinition,
        proposalWorld: candidate.conceptMechanism?.whyThisCanBecomeAConcept || conceptDefinition,
        whyThisCanBecomeAConceptTitle: '',
      }),
      metaphorSeed: conceptName,
      sourceTypes: candidate.conceptMetaphorSource?.sourceTypes?.length ? candidate.conceptMetaphorSource.sourceTypes : ['product/service logic', 'evaluation criteria'],
      rfpEvidence: candidate.conceptMetaphorSource?.rfpEvidence?.length ? candidate.conceptMetaphorSource.rfpEvidence : rfpGrounding,
    },
    whyThisNameFitsRfp: candidate.whyThisNameFitsRfp || `${conceptName}은 RFP의 구체 근거를 제안 판단 장치로 묶습니다.`,
    whyThisIsNotJustPoetic: candidate.whyThisIsNotJustPoetic || '임의의 문학적 사물이 아니라 현재 RFP의 대상·역할·평가 근거에서 추출한 명명입니다.',
    whyThisCanOrganizeProposal: candidate.whyThisCanOrganizeProposal || candidate.conceptMechanism?.whyThisCanBecomeAConcept || '공간·콘텐츠·미디어·운영·증명 장표의 상위 기준으로 확장됩니다.',
    namingGuardWarning: warning,
    nameValidationStatus: warning ? 'warning' : 'repaired',
    nameValidation: {
      nameValidationStatus: warning ? 'warning' : 'repaired',
      originalName,
      repairedName: conceptName,
      reason,
    },
  });
}

function getCandidateViolations(candidate: ConceptCandidate, index: number, context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative; avoidanceRules?: string[] }) {
  const result = validateConceptNaming({
    hiddenNeeds: {} as ConceptCandidatesResult['hiddenNeeds'],
    strategicApproach: {} as ConceptCandidatesResult['strategicApproach'],
    entityDifferentiationMatrix: [],
    conceptDevelopmentLogic: {} as ConceptCandidatesResult['conceptDevelopmentLogic'],
    recommendation: { recommendedConceptId: '', recommendationReason: '', whyNotOthers: '' },
    concepts: [candidate],
  }, context);

  return result.violations.map((violation) => violation.replace(/^concept-1/, candidate.conceptId || `concept-${index + 1}`));
}

export function applyNonBlockingConceptNamingGuard(
  result: ConceptCandidatesResult,
  context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative; avoidanceRules?: string[] } = {},
): ConceptCandidatesResult {
  const repairedConceptIds = new Set<string>();
  const warningConceptIds = new Set<string>();
  const allViolations: string[] = [];
  let safeNameIndex = 0;

  const concepts = result.concepts.map((candidate, index) => {
    const originalViolations = getCandidateViolations(candidate, index, context);
    if (!originalViolations.length) {
      const displayedName = sourceDisplayedConceptName(candidate).trim();
      return normalizeConceptCandidate({
        ...candidate,
        nameValidationStatus: 'passed' as const,
        nameValidation: {
          nameValidationStatus: 'passed' as const,
          originalName: displayedName,
          repairedName: displayedName,
          reason: 'Displayed core concept name passed proposal-level scope validation.',
        },
      });
    }

    allViolations.push(...originalViolations);
    const safeNames = buildSafeConceptNamesFromMetaphor(candidate, context);
    const safeName = safeNames[safeNameIndex % safeNames.length];
    safeNameIndex += 1;
    const repairedCandidate = applyConceptName(candidate, safeName, undefined, context, originalViolations[0] || 'Displayed name was product/module specific.');
    const repairedViolations = getCandidateViolations(repairedCandidate, index, context);
    if (!repairedViolations.length) {
      repairedConceptIds.add(candidate.conceptId || `concept-${index + 1}`);
      return repairedCandidate;
    }

    allViolations.push(...repairedViolations);
    repairedConceptIds.add(candidate.conceptId || `concept-${index + 1}`);
    warningConceptIds.add(candidate.conceptId || `concept-${index + 1}`);
    return {
      ...repairedCandidate,
      namingGuardWarning: '콘셉트명이 약한 제품/모듈/섹션 라벨로 감지되어 대체 이름으로 자동 보정했습니다. 세부 기준은 추가 확인이 필요합니다.',
      nameValidationStatus: 'warning' as const,
      nameValidation: {
        nameValidationStatus: 'warning' as const,
        originalName: sourceDisplayedConceptName(candidate).trim(),
        repairedName: safeName,
        reason: repairedViolations[0] || originalViolations[0] || 'Name repair completed with remaining validation warnings.',
      },
    };
  });

  const guarded = normalizeConceptCandidatesResult({ ...result, concepts });
  if (!repairedConceptIds.size && !warningConceptIds.size) return guarded;

  return {
    ...guarded,
    namingGuardNotice: {
      message: '일부 콘셉트명을 1회 자동 보정했습니다. 보정되지 않은 후보는 경고만 표시하고 결과는 유지했습니다.',
      repairedConceptIds: Array.from(repairedConceptIds),
      warningConceptIds: Array.from(warningConceptIds),
      violations: allViolations,
    },
  };
}

export function buildConceptNamingRetryInstruction(violations: string[]) {
  return [
    'CONCEPT NAMING GUARD REJECTION:',
    ...violations.map((violation) => `- ${violation}`),
    'Regenerate all 3 concepts. Keep the strategic narrative, but replace rejected naming logic with concise, memorable, proposal-ready names derived from each candidate’s Concept Metaphor Source: metaphorSeed, symbolicImage, proposalWorld, and whyThisCanBecomeAConceptTitle. Do not derive names directly from hidden needs, strategic approach, mechanism summary, anti-patterns, evaluation logic, or corrective wording.',
    'Concept Level Guard: proposalCoreConceptName/conceptName must express the highest-level organizing idea for the whole proposal, not an Experience Principle, Visitor Journey, content section, interaction mechanism, slide title, strategic instruction, or anti-pattern correction.',
    'Reject journey-like names such as 증거 루트, 가치 신호, 선택의 이유, 인지의 흐름, 확신의 여정, 경험의 경로, 차별화의 단계, Signal to Proof, Route to Value, and Evidence Journey. These can only appear under visitorJourney or section labels, never as the core concept name.',
    'Concept Role Guard: conceptName must express the proposal strategic idea, not the execution method. Do not use modular, interactive, value chain, media, zone, pavilion, experience, content, mechanism, spatial layout, booth/column constraints, deliverable categories, or RFP object lists as the main naming device unless transformed into a strong strategic metaphor.',
    'Reject names that read like technical descriptions, combine 2+ execution terms, use modular interactive or value chain as the main naming device, exceed 5 words without a strong reason, sound like slide titles, or start from constraints instead of proposalThesis.',
    'Do not use constraints, columns, booth limits, venue limitations, schedule, budget, deliverable names, equipment, media types, object lists, or floor-plan limitations as conceptName sources.',
    'Metaphor Source Naming Guard: first create metaphorSeed, symbolicImage, proposalWorld, and whyThisCanBecomeAConceptTitle; internally generate 5 names, score specificityToCurrentRfp, symbolicPower, memorability, coverTitlePotential, expandability, nonGenericQuality, and notStrategyLabel, then output only the selected name. Universal Concept Novelty Guard: do not default to Distinct Unity, Focused Identity, Differentiated Synergy, Nexus, Pulse, Vanguard, Synergy, Connect, Future, Innovation, Hub, Platform, Experience, Journey, Alliance, Lab, Studio, Universe, Beyond, Next, Shift, Flow, Differentiation, or Identity as the main concept name. Avoid names that sound like generic tech/event branding or direct correction of a lost-proposal reason. Concept names must be specific to the current brief and not reusable across unrelated RFPs. Do not use external project names or unrelated case names to make naming feel stronger.',
  ].join('\n');
}
