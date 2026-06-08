import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ProposalNarrative } from './types';

const WEAK_GENERIC_CONCEPT_NAMES = [
  'hydrogen flow',
  'future nexus',
  'pulse of hydrogen',
  'future grid',
  'living h2',
  'hydrogen experience',
  'hydrogen pavilion',
  'hydrogen journey',
];

const WEAK_GENERIC_TOKEN_COMBINATIONS = [
  ['hydrogen', 'flow'],
  ['future', 'nexus'],
  ['future', 'grid'],
  ['hydrogen', 'experience'],
  ['hydrogen', 'pavilion'],
  ['hydrogen', 'journey'],
];

const GENERIC_CATEGORY_WORDS = [
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

function hasWeakGenericConceptName(name: string) {
  const normalized = normalizedText(name);
  const tokens = normalized.split(/[\s/·|+_-]+/).filter(Boolean);

  return WEAK_GENERIC_CONCEPT_NAMES.includes(normalized) || WEAK_GENERIC_TOKEN_COMBINATIONS.some((combination) =>
    combination.every((token) => tokens.includes(token))
  );
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
  return candidate.conceptTagline || candidate.subtitle || candidate.oneLineDefinition || '';
}

export function getConceptDefinition(candidate?: ConceptCandidate) {
  if (!candidate) return '';
  return candidate.conceptDefinition || candidate.oneLineDefinition || candidate.whyThisWorks || '';
}

export function normalizeConceptCandidate(candidate: ConceptCandidate): ConceptCandidate {
  const conceptName = (candidate.conceptName || candidate.conceptTitle || candidate.conceptNameEN || candidate.conceptNameKR).trim();
  const conceptTagline = (candidate.conceptTagline || candidate.subtitle || candidate.oneLineDefinition).trim();
  const conceptDefinition = (candidate.conceptDefinition || candidate.oneLineDefinition || candidate.whyThisWorks).trim();

  return {
    ...candidate,
    conceptName,
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
  context: { analysis?: AnalysisResult; proposalNarrative?: ProposalNarrative } = {},
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
    if (hasGenericMainNamingDevice(name)) violations.push(`${label}: conceptName uses a generic category word as the main naming device.`);
    if (containsAny(name, constraintTerms)) violations.push(`${label}: conceptName appears to be derived from constraints, deliverables, venue, schedule, or implementation conditions.`);
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
    'Regenerate all 3 concepts. Keep the strategic narrative, but replace rejected naming logic with concise, memorable, proposal-ready names derived from proposalThesis, audience transformation, client vision, HTWO/client brand message, hydrogen value chain where relevant, strategic opportunity, and core experience promise.',
    'Do not use constraints, columns, booth limits, venue limitations, schedule, budget, deliverable names, equipment, media types, object lists, or floor-plan limitations as conceptName sources.',
    'Avoid weak generic names such as Hydrogen Flow, Future Nexus, Future Grid, Pulse of Hydrogen, Living H2, Hydrogen Experience, Hydrogen Pavilion, and Hydrogen Journey. Do not use external project names or unrelated case names to make naming feel stronger.',
  ].join('\n');
}
