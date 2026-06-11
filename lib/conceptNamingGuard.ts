import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ProposalNarrative } from './types';


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
  '혁신의 장면',
  '차별화된 통합',
  '명확한 구분',
  '통합된 경험',
  'the reason to choose',
  'scene of innovation',
  'differentiated unity',
  'connected future',
  'innovation journey',
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
  ['혁신의', '장면'],
  ['차별화된', '통합'],
  ['명확한', '구분'],
  ['통합된', '경험'],
  ['reason', 'choose'],
  ['scene', 'innovation'],
  ['connected', 'future'],
  ['innovation', 'journey'],
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
  'zoning',
  'object list',
  '모듈러',
  '인터랙티브',
  '밸류체인',
  '가치사슬',
  '미디어',
  '존',
  '파빌리온',
  '체험',
  '콘텐츠',
  '컨텐츠',
  '메커니즘',
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
  'zoning',
  '모듈러',
  '인터랙티브',
  '미디어',
  '존',
  '파빌리온',
  '체험',
  '콘텐츠',
  '컨텐츠',
  '메커니즘',
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
  return candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR || '';
}

export function getPresentationConceptName(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR || '';
}

export function getConceptTagline(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.conceptSlogan || candidate.conceptTagline || candidate.subtitle || candidate.oneLineDefinition || '';
}

export function getConceptDefinition(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.conceptDefinition || candidate.oneLineDefinition || candidate.whyThisWorks || '';
}

export function normalizeConceptCandidate(candidate: ConceptCandidate): ConceptCandidate {
  const conceptName = (candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR).trim();
  const conceptTagline = (candidate.conceptSlogan || candidate.conceptTagline || candidate.subtitle || candidate.oneLineDefinition).trim();
  const conceptDefinition = (candidate.conceptDefinition || candidate.oneLineDefinition || candidate.whyThisWorks).trim();

  return {
    ...candidate,
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
    conceptMetaphorSource: candidate.conceptMetaphorSource ?? {
      metaphorSeed: conceptName,
      symbolicImage: candidate.conceptMechanism?.experienceMechanism || candidate.experienceStructure || conceptDefinition,
      proposalWorld: candidate.conceptMechanism?.whyThisCanBecomeAConcept || candidate.keyExperienceAssetDirection || conceptTagline,
      whyThisCanBecomeAConceptTitle: candidate.whyThisNameWorks || candidate.whyThisConcept || candidate.whyThisWorks || '',
    },
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
    entityDifferentiationUse: candidate.entityDifferentiationUse ?? {
      unifyingFrame: '',
      distinctEntityRoles: '',
      visitorRecognitionLogic: '',
      proofByEntity: '',
      riskCheck: '',
    },
    conceptName,
    conceptSlogan: candidate.conceptSlogan || conceptTagline,
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

export function validateConceptNaming(
  result: ConceptCandidatesResult,
  context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative; avoidanceRules?: string[] } = {},
) {
  const constraintTerms = collectConstraintTerms(context.analysis);
  const violations: string[] = [];

  result.concepts.forEach((candidate, index) => {
    const name = candidateName(candidate);
    const unitCount = titleUnitCount(name);
    const label = `${candidate.conceptId || `concept-${index + 1}`} (${name || 'empty name'})`;

    if (!name.trim()) violations.push(`${label}: conceptName is empty.`);
    if (unitCount > 5 || name.length > 36) violations.push(`${label}: conceptName is too long for a presentation-ready title.`);
    if (isLikelySentence(name)) violations.push(`${label}: conceptName reads like an explanatory sentence or section heading.`);
    if (hasForbiddenAbstractNamingCore(name)) violations.push(`${label}: conceptName is centered on a forbidden abstract/corrective naming word rather than a project-specific metaphor source.`);
    if (hasStrategyStatementName(name)) violations.push(`${label}: conceptName reads like a strategy statement, slide title, project objective, direct solution phrase, or avoidance-rule translation instead of a concept mechanism.`);
    if (nameMechanismScore(candidate, name) < 4) violations.push(`${label}: conceptName scores below 4 on specificity, memorability, mechanism clarity, expandability, non-generic quality, or cover-title potential.`);
    if (hasWeakGenericConceptName(name)) violations.push(`${label}: conceptName is a weak generic keyword combination rather than a proposal-ready idea.`);
    if (hasGenericConceptPenaltyWord(name)) violations.push(`${label}: conceptName uses a generic tech/event branding word from the universal penalty list without current-RFP-specific justification.`);
    if (hasGenericMainNamingDevice(name)) violations.push(`${label}: conceptName uses a generic category word as the main naming device.`);
    if (hasUntransformedConceptRoleTerm(name)) violations.push(`${label}: conceptName uses execution methods, content categories, spatial solutions, constraints, or RFP keywords as the main naming device instead of a transformed strategic metaphor.`);
    if (hasExecutionDescriptionName(name)) violations.push(`${label}: conceptName reads like an execution strategy, content category, spatial solution, RFP keyword, or technical description instead of a strategic idea.`);
    if (containsAny(name, constraintTerms)) violations.push(`${label}: conceptName appears to be derived from constraints, deliverables, venue, schedule, or implementation conditions.`);
    if (hasDirectAvoidanceRuleEcho(name, context.avoidanceRules)) violations.push(`${label}: conceptName directly echoes a lost-proposal avoidance rule; anti-patterns must be validation criteria, not naming source material.`);
  });

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

function buildSafeConceptNamesFromMetaphor(candidate: ConceptCandidate, context: { input?: { projectName?: string; clientName?: string }; analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative }) {
  const source = candidate.conceptMetaphorSource;
  const metaphorSeeds = extractSymbolicSeeds([
    source?.metaphorSeed,
    source?.symbolicImage,
    source?.proposalWorld,
    source?.whyThisCanBecomeAConceptTitle,
  ].filter(Boolean).join(' '));
  const contextSeeds = extractSymbolicSeeds([
    context.input?.projectName,
    context.input?.clientName,
    context.analysis?.projectOverview,
  ].filter(Boolean).join(' '), ['첫문장', '등대']);
  const prefix = metaphorSeeds[0] || contextSeeds[0] || '첫문장';
  const second = metaphorSeeds.find((token) => token !== prefix) || contextSeeds.find((token) => token !== prefix) || '등대';

  return [
    `${prefix}의 정원`,
    `${second}의 항구`,
    `${prefix} 서랍`,
    `${second} 지도`,
    `${prefix}의 표본실`,
    `${second} 극장`,
    `${prefix} 관측소`,
    `${second}의 문턱`,
  ];
}

function applyConceptName(candidate: ConceptCandidate, conceptName: string, warning?: string): ConceptCandidate {
  return normalizeConceptCandidate({
    ...candidate,
    conceptName,
    conceptTitle: conceptName,
    conceptNameKR: conceptName,
    conceptNameEN: conceptName,
    namingGuardWarning: warning,
  });
}

function getCandidateViolations(candidate: ConceptCandidate, index: number, context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative; avoidanceRules?: string[] }) {
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
    if (!originalViolations.length) return candidate;

    allViolations.push(...originalViolations);
    const safeNames = buildSafeConceptNamesFromMetaphor(candidate, context);
    const safeName = safeNames[safeNameIndex % safeNames.length];
    safeNameIndex += 1;
    const repairedCandidate = applyConceptName(candidate, safeName, '일부 콘셉트명이 기준을 충족하지 않아 1회 자동 보정했습니다. 결과를 확인해 주세요.');
    const repairedViolations = getCandidateViolations(repairedCandidate, index, context);
    if (!repairedViolations.length) {
      repairedConceptIds.add(candidate.conceptId || `concept-${index + 1}`);
      return repairedCandidate;
    }

    allViolations.push(...repairedViolations);
    warningConceptIds.add(candidate.conceptId || `concept-${index + 1}`);
    return {
      ...candidate,
      namingGuardWarning: '콘셉트명 기준 확인이 필요하지만 전략 레이어는 유지했습니다.',
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
    'Concept Role Guard: conceptName must express the proposal strategic idea, not the execution method. Do not use modular, interactive, value chain, media, zone, pavilion, experience, content, mechanism, spatial layout, booth/column constraints, deliverable categories, or RFP object lists as the main naming device unless transformed into a strong strategic metaphor.',
    'Reject names that read like technical descriptions, combine 2+ execution terms, use modular interactive or value chain as the main naming device, exceed 5 words without a strong reason, sound like slide titles, or start from constraints instead of proposalThesis.',
    'Do not use constraints, columns, booth limits, venue limitations, schedule, budget, deliverable names, equipment, media types, object lists, or floor-plan limitations as conceptName sources.',
    'Metaphor Source Naming Guard: first create metaphorSeed, symbolicImage, proposalWorld, and whyThisCanBecomeAConceptTitle; internally generate 5 names, score specificityToCurrentRfp, symbolicPower, memorability, coverTitlePotential, expandability, nonGenericQuality, and notStrategyLabel, then output only the selected name. Universal Concept Novelty Guard: do not default to Distinct Unity, Focused Identity, Differentiated Synergy, Nexus, Pulse, Vanguard, Synergy, Connect, Future, Innovation, Hub, Platform, Experience, Journey, Alliance, Lab, Studio, Universe, Beyond, Next, Shift, Flow, Differentiation, or Identity as the main concept name. Avoid names that sound like generic tech/event branding or direct correction of a lost-proposal reason. Concept names must be specific to the current brief and not reusable across unrelated RFPs. Do not use external project names or unrelated case names to make naming feel stronger.',
  ].join('\n');
}
