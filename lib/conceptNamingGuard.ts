import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ProposalNarrative } from './types';


export const GENERIC_CONCEPT_WORD_PENALTY_LIST = [
  'distinct unity',
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
  'distinct unity',
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

export function buildConceptNamingRetryInstruction(violations: string[]) {
  return [
    'CONCEPT NAMING GUARD REJECTION:',
    ...violations.map((violation) => `- ${violation}`),
    'Regenerate all 3 concepts. Keep the strategic narrative, but replace rejected naming logic with concise, memorable, proposal-ready names derived from the current RFP strategic tension, client situation, audience barrier, product/service logic, spatial or content mechanism, desired perception shift, evaluation criteria, proposalThesis, and proof logic.',
    'Concept Role Guard: conceptName must express the proposal strategic idea, not the execution method. Do not use modular, interactive, value chain, media, zone, pavilion, experience, content, mechanism, spatial layout, booth/column constraints, deliverable categories, or RFP object lists as the main naming device unless transformed into a strong strategic metaphor.',
    'Reject names that read like technical descriptions, combine 2+ execution terms, use modular interactive or value chain as the main naming device, exceed 5 words without a strong reason, sound like slide titles, or start from constraints instead of proposalThesis.',
    'Do not use constraints, columns, booth limits, venue limitations, schedule, budget, deliverable names, equipment, media types, object lists, or floor-plan limitations as conceptName sources.',
    'Universal Concept Novelty Guard: do not default to Distinct Unity, Focused Identity, Differentiated Synergy, Nexus, Pulse, Vanguard, Synergy, Connect, Future, Innovation, Hub, Platform, Experience, Journey, Alliance, Lab, Studio, Universe, Beyond, Next, Shift, Flow, Differentiation, or Identity as the main concept name. Avoid names that sound like generic tech/event branding or direct correction of a lost-proposal reason. Concept names must be specific to the current brief and not reusable across unrelated RFPs. Do not use external project names or unrelated case names to make naming feel stronger.',
  ].join('\n');
}
