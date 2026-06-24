import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandExperienceMatrixItem, ConceptCandidate, ConceptDevelopmentLogic, ConceptNameOptionsResult, EntityDifferentiationItem, MatrixType, ProjectInput, ProposalNarrative, ProposalType, RfpDiagnosis, BrandProductIntelligence } from '@/lib/types';
import { normalizeProposalType } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { getActiveMatrix, sanitizeConceptContextByRfpType } from '@/lib/conceptContextSanitizer';
import { extractRfpConceptHierarchy, type RfpProvidedConceptHierarchy } from '@/lib/rfpConceptHierarchy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' };

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) } });
}

function compact(value: unknown, maxLength = 900) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function successResponse(result: ConceptNameOptionsResult) {
  return { ok: true, nameOptions: result.options, ...result };
}

function errorResponse(error: string, details?: string) {
  return { ok: false, error, ...(details ? { details } : {}) };
}


type NamingDirectionInput = Partial<ConceptCandidate> & {
  representativePersuasionScene?: string;
  signatureExperienceIdea?: string | ConceptCandidate['signatureProofIdea'];
  winningThesis?: ConceptCandidate['winningThesisUse'];
  id?: string;
};

function normalizeSelectedDirectionForNaming(body: { selectedDirection?: NamingDirectionInput; selectedStrategicDirection?: NamingDirectionInput; conceptId?: string; strategicDirectionLabel?: string; directionAxis?: string; oneLineStrategicBet?: string; representativePersuasionScene?: string; winningThesis?: ConceptCandidate['winningThesisUse']; conceptLeap?: ConceptCandidate['conceptLeap']; signatureProofIdea?: ConceptCandidate['signatureProofIdea']; mainRisk?: string; primaryRfpConceptType?: string }) {
  const source = body.selectedDirection ?? body.selectedStrategicDirection ?? {};
  const signatureAlias = typeof source.signatureExperienceIdea === 'object' ? source.signatureExperienceIdea : undefined;
  const signatureProofIdea = body.signatureProofIdea ?? source.signatureProofIdea ?? signatureAlias ?? {
    signatureScene: body.representativePersuasionScene || source.representativePersuasionScene || '',
    signatureContent: typeof source.signatureExperienceIdea === 'string' ? source.signatureExperienceIdea : '',
    signatureSpatialMove: '',
    signatureMediaOrInteraction: '',
    whyThisProvesTheConcept: '',
    whyThisIsNotGeneric: '',
  };
  const representativePersuasionScene = body.representativePersuasionScene || source.representativePersuasionScene || signatureProofIdea.signatureScene || signatureProofIdea.signatureContent || signatureProofIdea.signatureSpatialMove || signatureProofIdea.signatureMediaOrInteraction || '';
  return {
    ...source,
    conceptId: source.conceptId || body.conceptId || source.id || 'selected-direction',
    strategicDirectionLabel: body.strategicDirectionLabel || source.strategicDirectionLabel || source.directionLabel || source.proposalCoreConceptName || '전략 방향',
    directionAxis: body.directionAxis || source.directionAxis || source.strategicDirectionType || source.strategicDirectionLabel || 'selected_direction_axis',
    oneLineStrategicBet: body.oneLineStrategicBet || source.oneLineStrategicBet || source.oneLineSummary || source.whatThisDirectionEmphasizes || '',
    winningThesisUse: body.winningThesis || source.winningThesisUse || source.winningThesis,
    conceptLeap: body.conceptLeap || source.conceptLeap,
    signatureProofIdea: { ...signatureProofIdea, signatureScene: signatureProofIdea.signatureScene || representativePersuasionScene },
    representativePersuasionScene,
    mainRisk: body.mainRisk || source.mainRisk || source.riskOrCaution || source.risks?.[0] || '',
    rfpConceptType: source.rfpConceptType || body.primaryRfpConceptType || 'unknown',
  } as ConceptCandidate & { representativePersuasionScene?: string };
}

const GENERIC_MAIN_HOOKS = ['현장', '현장의', '경험', '체험', '증명', '가치', '연결', '흐름', '여정', '신뢰', '균형'] as const;

const INTERNAL_LANGUAGE_PATTERN = /\b(proof|evidence|proof burden|evaluator clarity|validation|source|score|signature proof idea)\b|증명 과제|증거|Proof|Evidence|Validation|Source|Score/gi;

const INTERNAL_COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/signature proof idea/gi, '대표 설득 장면'],
  [/proof burden/gi, '설득 과제'],
  [/evaluator clarity/gi, '심사자가 한눈에 이해하는 구조'],
  [/validation/gi, '검토 결과'],
  [/evidence/gi, '근거'],
  [/proof/gi, '설득 포인트'],
  [/source/gi, '근거'],
  [/score/gi, '평가'],
  [/증명 과제/g, '설득 과제'],
  [/증거/g, '확인 요소'],
];

// Category-neutral generic weak names only. Do NOT add brand/category-specific sample phrases
// (e.g. hydrogen/Pocari/factory) — cross-RFP contamination is handled generically by vocabulary grounding.
const BLOCKED_EXAMPLE_CONCEPT_NAMES = [
  'The Future Runs Here',
  'From Vision to Current',
  'Nexus',
  'Pulse',
  'Vanguard',
  'Sphere',
  'Moment Room',
  'Visible Moment',
  'Memory Moment',
  'Moment to Memory',
];

// Exact user-facing error when no sufficiently specific name can be produced even after one stricter regeneration.
const WEAK_NAMING_ERROR = '선택한 전략 방향에 맞는 충분히 구체적인 컨셉명을 생성하지 못했습니다. 전략 방향을 다시 선택하거나 컨셉명을 다시 생성해 주세요.';

// Anti-pattern naming forms (generic, no hardcoded brands). A concept name is rejected when it is dominated by one
// of these, UNLESS it is transformed into a specific RFP-grounded idea (grounding is enforced separately by vocabulary).
const SPEC_BANNED_NAME_PATTERNS: RegExp[] = [
  /가치\s*증명/u,
  /기억\s*의?\s*증명/u,
  /인식\s*전환/u,
  /경험\s*이해/u,
  /가치\s*체험/u,
  /실체화/u,
  /한눈에\s*보는/u,
  /시그니처/u,
  /\S+\s*중심\s*$/u,
  /(core\s*experience|insight\s*hub|insight|panorama|signature|moment|journey|experience)\s*$/i,
];

const BRAND_NOUN_GENERIC_TAILS = /^(experience|journey|moment|signature|insight|panorama|value|proof|hub|platform|zone|center|story|space|vision|future)$/i;

// True when the name is dominated by a banned abstract/consulting form or is just brand/client name + a generic noun.
function isWeakConceptName(name: string, input: { clientName?: string; projectName?: string }) {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  if (SPEC_BANNED_NAME_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  const brandTokens = [input.clientName, input.projectName]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s+/))
    .map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, ''))
    .filter((token) => token.length >= 2);
  const nameTokens = trimmed.split(/\s+/).map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, '')).filter(Boolean);
  if (nameTokens.length >= 2 && nameTokens.some((token) => brandTokens.some((brand) => token.toLowerCase() === brand.toLowerCase()))) {
    const nonBrand = nameTokens.filter((token) => !brandTokens.some((brand) => token.toLowerCase() === brand.toLowerCase()));
    if (nonBrand.length && nonBrand.every((token) => (GENERIC_MAIN_HOOKS as readonly string[]).includes(token) || BRAND_NOUN_GENERIC_TAILS.test(token))) return true;
  }
  return false;
}

// Conservative brand/client tokens (same source as isWeakConceptName: only clientName/projectName).
function brandTokensOf(input: { clientName?: string; projectName?: string }): string[] {
  return [input.clientName, input.projectName]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s+/))
    .map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, ''))
    .filter((token) => token.length >= 2);
}

// Relaxed: the name contains a brand/client token ANYWHERE (vs isWeakConceptName which also requires the rest to be
// generic). Used only for the cross-option "not ALL names brand-centered" check on cover-title proposal types.
function isBrandCenteredName(name: string, brandTokens: string[]): boolean {
  if (!brandTokens.length) return false;
  const nameTokens = (name || '').split(/\s+/).map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, '')).filter(Boolean);
  return nameTokens.some((token) => brandTokens.some((brand) => token.toLowerCase() === brand.toLowerCase()));
}

// Exhibition / content / energy / technology / showcase family: final names must read like proposal-cover concept
// titles, not brand+noun. Visitor-room/factory-tour, MICE, conference, and basic are intentionally EXCLUDED (unchanged).
const COVER_TITLE_PROPOSAL_TYPES = new Set<ProposalType>(['exhibition_booth_content', 'corporate_technology_showcase', 'experience_marketing']);
const COVER_TITLE_RFP_CONCEPT_TYPES = new Set<string>(['technology_showcase', 'exhibition_booth', 'content_media_experience', 'product_experience_space']);
function isCoverTitleNamingFamily(input: ProjectInput, selectedDirection: ConceptCandidate): boolean {
  if (COVER_TITLE_PROPOSAL_TYPES.has(normalizeProposalType(input.proposalType))) return true;
  const rfpConceptType = selectedDirection.rfpConceptType;
  return rfpConceptType ? COVER_TITLE_RFP_CONCEPT_TYPES.has(rfpConceptType) : false;
}

// Strategy-descriptor words that signal a name is EXPLAINING the direction rather than being a concept title.
const STRATEGY_DESCRIPTOR_WORDS = new Set(['전략', '방향', '설득', '증명', '강화', '전환', '이해', '체험', '경험', '가치', '관점', '연결', '통합', '구조', '방안', '계획', '접근', '솔루션', '강조', '확장', '구현', '제시', '형성', '설계', '방식', '제고', '확보']);
// Explanatory / sentence-like tail: a concept TITLE must not end like a strategy sentence.
const EXPLANATORY_NAME_TAIL = /(합니다|입니다|하는|되는|위한|통해|중심으로|기반으로|전략|방향|방안|솔루션|구조|구현|제시|설계)\s*$/u;
// Exact user-facing error when the strategy could not be turned into a concept-level title even after one regeneration.
const DESCRIPTIVE_NAMING_ERROR = '선택한 전략 방향을 컨셉명으로 충분히 전환하지 못했습니다. 컨셉명을 다시 생성해 주세요.';

function directionLabelTokens(dir: ConceptCandidate): Set<string> {
  return new Set([dir.strategicDirectionLabel, dir.oneLineStrategicBet, dir.whatThisDirectionEmphasizes, (dir as { oneLineSummary?: string }).oneLineSummary]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\s/·|]+/))
    .map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, ''))
    .filter((token) => token.length >= 2));
}

// True when the conceptName reads like a DESCRIPTIVE SUMMARY / STRATEGY LABEL / direction-label restatement rather than
// a compressed proposal-cover title. Applied ONLY to cover-title types, so visitor-room/pavilion/expo are unaffected.
function isDescriptiveOrStrategyLabelName(name: string, dir: ConceptCandidate): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  const tokens = trimmed.split(/[\s/·|]+/).map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, '')).filter(Boolean);
  if (tokens.length > 5 || trimmed.replace(/\s+/g, '').length > 28) return true; // too long to be a title
  if (EXPLANATORY_NAME_TAIL.test(trimmed)) return true; // explanatory / sentence-like
  const labelTokens = directionLabelTokens(dir);
  const labelOverlap = tokens.filter((token) => labelTokens.has(token)).length;
  if (labelOverlap >= 3 || (labelOverlap >= 2 && labelOverlap === tokens.length)) return true; // near-pure restatement of the direction label
  const descCount = tokens.filter((token) => STRATEGY_DESCRIPTOR_WORDS.has(token)).length;
  if (tokens.length >= 2 && descCount >= 2 && descCount >= Math.ceil(tokens.length / 2)) return true; // dominated by strategy-descriptor words
  return false;
}

// Stricter-filter instruction appended to the prompt for the single allowed regeneration when the first pass is all-weak.
const STRICTER_RETRY_ADDENDUM = '\n\n[재생성 지시] 앞선 후보가 너무 일반적이거나 선택한 전략 방향과 약하게 연결되어 모두 거부되었다. 더 엄격하게 다시 생성하라: (1) 가치 증명/기억의 증명/인식 전환/경험 이해/가치 체험/실체화/한눈에 보는/___ 중심/___ 시그니처/Core Experience/Insight/Panorama/Signature/Experience/Journey/Moment 형태를 절대 쓰지 말 것. (2) 선택한 전략 방향의 directionAxis와 대표 설득 장면, 그리고 currentRfpVocabularySet의 실제 RFP 어휘에서 직접 도출할 것. (3) 브랜드/클라이언트명 단독 + 일반 명사 조합 금지. (4) 다른 RFP에도 그대로 쓸 수 있는 범용 이름 금지. (5) 표지 제목으로 바로 쓸 수 있는 짧고 구체적인 이름만. (6) 전시/콘텐츠/에너지/기술/쇼케이스 유형이면 모든 후보가 클라이언트·브랜드명 중심이 되지 않게 하고, 선택한 전략 방향의 관점·경험·전환·공간/콘텐츠 프레임을 표현하는 제안 표지 콘셉트 타이틀로 만든다. 후보마다 어휘와 논리를 다르게 한다. (7) 전략을 설명하는 서술형/전략 라벨/방향 라벨을 그대로 옮긴 이름, 슬로건이 있어야 의미가 생기는 이름은 거부한다. Concept Frame Synthesis의 symbolicFrame·experientialImage에서 압축한, 단독으로 서는 콘셉트 타이틀만 출력한다.';

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/gi, '');
}

function optionTextFingerprint(option: { conceptName?: string; oneLineSlogan?: string; shortMeaning?: string; strategicClaim?: string; whyItFitsRfp?: string; whyItFits?: string; whyItFitsSelectedDirection?: string }) {
  return [option.conceptName, option.oneLineSlogan, option.shortMeaning, option.strategicClaim, option.whyItFitsRfp || option.whyItFits || option.whyItFitsSelectedDirection]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, ' ')
    .trim();
}

function resemblesBlockedExample(name: string) {
  const normalized = normalizeName(name);
  return BLOCKED_EXAMPLE_CONCEPT_NAMES.some((blocked) => {
    const b = normalizeName(blocked);
    return normalized === b || normalized.includes(b) || b.includes(normalized);
  });
}


function userFacingCopy(value: string, maxLength = 180) {
  return INTERNAL_COPY_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), compact(value, maxLength));
}

function tokenizeKoreanNouns(text: string) {
  return Array.from(new Set((text.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [])
    .map((token) => token.replace(/의$/, '').trim())
    .filter((token) => token.length >= 2 && !GENERIC_MAIN_HOOKS.includes(token as (typeof GENERIC_MAIN_HOOKS)[number]))));
}

function buildCurrentRfpVocabularySet(body: { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis; proposalNarrative?: ProposalNarrative; conceptDevelopmentLogic?: ConceptDevelopmentLogic }, activeMatrix: unknown) {
  const analysisVocabulary = body.analysis as AnalysisResult & { targetAudience?: string; brandKeywords?: string[]; coreRequirements?: string[] };
  // STRATEGY-first ordering: the selected direction + diagnosis + category vocabulary come first so the model's
  // "use currentRfpVocabularySet first" instinct lands on strategic value, NOT the brand. projectName/clientName are
  // demoted to the end (kept only so a brand token can still ground a name when the direction warrants it).
  const fields = [
    body.selectedDirection.strategicDirectionLabel,
    body.selectedDirection.whatThisDirectionEmphasizes,
    body.selectedDirection.oneLineStrategicBet,
    body.rfpDiagnosis?.strategicTension,
    body.rfpDiagnosis?.coreWinningCondition,
    body.rfpDiagnosis?.hiddenNeed,
    body.rfpDiagnosis?.persuasionTask,
    body.rfpDiagnosis?.clientUniquePosition,
    body.selectedDirection.rfpGrounding?.join(' '),
    body.analysis.projectOverview,
    analysisVocabulary.targetAudience,
    body.analysis.requiredScope?.join(' '),
    analysisVocabulary.coreRequirements?.join(' '),
    compact(body.analysis.rfpRequirements, 1000),
    compact(body.conceptDevelopmentLogic, 1000),
    compact(activeMatrix, 1000),
    analysisVocabulary.brandKeywords?.join(' '),
    body.input.projectName,
    body.input.clientName,
  ];
  return tokenizeKoreanNouns(fields.filter(Boolean).join(' ')).slice(0, 28);
}

// Build a current-RFP-specific concept-naming ANCHOR block, fed to the model as the PRIMARY naming source so names are
// derived from strategy (claim/tension/perception/scene), then category/mechanism/frame, with the client/brand/entity
// name only as a secondary modifier. For pavilions it adds a pavilion-level conceptual frame so blocking a single
// participant does not collapse into generic names. No example names, no hardcoded brands — all current-RFP fields.
function buildConceptNamingAnchor(body: { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence; proposalNarrative?: ProposalNarrative; primaryRfpConceptType?: string }, hierarchy?: RfpProvidedConceptHierarchy): string {
  const dir = body.selectedDirection;
  const diag = body.rfpDiagnosis;
  const bpi = body.brandProductIntelligence;
  const narrative = body.proposalNarrative;
  const rfpConceptType = dir.rfpConceptType || body.primaryRfpConceptType || body.analysis.primaryRfpConceptType;
  const isPavilion = rfpConceptType === 'multi_entity_pavilion' || normalizeProposalType(body.input.proposalType) === 'multi_entity_pavilion';
  const sig = dir.signatureProofIdea;
  const scene = (dir as { representativePersuasionScene?: string }).representativePersuasionScene || sig?.signatureScene || sig?.signatureContent || sig?.signatureSpatialMove || '';
  const v = (value?: string, max = 160) => compact(value, max) || '없음';
  const p1 = `전략 주장=${v(dir.oneLineStrategicBet || dir.winningThesisUse?.winningClaim || dir.whatThisDirectionEmphasizes)} · 전략적 긴장=${v(diag?.strategicTension || diag?.coreWinningCondition)} · 인식 전환=${v(bpi?.audiencePerceptionGap || diag?.evaluatorDecisionRisk || diag?.hiddenNeed)} · 설득 과제=${v(diag?.persuasionTask || diag?.proofBurden)} · 대표 설득 장면=${v(scene)}`;
  const p2 = `카테고리/산업 어휘=${v(bpi?.categoryContext || bpi?.productOrServiceMeaning)} · 경험/콘텐츠/공간 메커니즘=${v(sig?.signatureSpatialMove || sig?.signatureMediaOrInteraction || sig?.signatureContent || body.analysis.contentCondition)}`;
  const pavilionFrame = isPavilion
    ? `\n[파빌리온 프레임] 공동 메시지=${v(narrative?.unifyingFrame || diag?.coreWinningCondition)} · 주체 간 관계/역할=${v(narrative?.differentiationPrinciple || diag?.strategicTension)} · 결합 역량=${v(diag?.coreWinningCondition || dir.whatThisDirectionEmphasizes)} · 관람객의 전체 이해=${v(bpi?.audiencePerceptionGap || diag?.hiddenNeed)}`
    : '';
  // Priority 0: the RFP's OWN explicit concept hierarchy (when provided) outranks everything below, ahead of any
  // participant/brand name. For pavilions, names must come from the pavilion-level theme, not one participant.
  const p0 = hierarchy
    ? `\n[Priority 0 — RFP 제공 공식 컨셉 위계, 최우선] 메인 테마=${compact(hierarchy.mainTheme, 160) || '없음'} · 서브 테마=${compact(hierarchy.subThemes.join(' / '), 200) || '없음'} · 존 컨셉=${compact(hierarchy.zoneConcepts.join(' / '), 200) || '없음'} · 공식 슬로건=${compact(hierarchy.officialSlogan, 160) || '없음'} · 핵심 메시지=${compact(hierarchy.keyMessage, 160) || '없음'}. 이 위계가 네이밍 1순위 앵커이며 참여 주체/브랜드명보다 우선한다.`
    : '';
  return `=== Concept Naming Anchor (PRIMARY 네이밍 소스. client/brand/entity name은 보조 수식어로만 사용) ===${p0}\n[Priority 1] ${p1}\n[Priority 2] ${p2}${pavilionFrame}\n[Priority 3] client/brand/entity name = 보조 수식어 한정. 모든 후보가 client/brand/entity name에 의존하면 안 된다.`;
}

// Concept Frame Synthesis: the step BEFORE naming that reframes the selected strategy into title territory so the model
// produces a COMPRESSED concept title, not a description. coreMeaning + forbiddenDescriptiveWords are deterministic;
// the other slots are filled internally by the model before naming. No example names, current-RFP-only.
function buildConceptFrameSynthesis(body: { selectedDirection: ConceptCandidate }): string {
  const dir = body.selectedDirection;
  const sig = dir.signatureProofIdea;
  const scene = (dir as { representativePersuasionScene?: string }).representativePersuasionScene || sig?.signatureScene || sig?.signatureContent || sig?.signatureSpatialMove || '';
  const coreMeaning = compact(dir.oneLineStrategicBet || dir.winningThesisUse?.winningClaim || dir.whatThisDirectionEmphasizes, 180) || '선택한 전략 방향의 핵심 의미';
  const forbidden = Array.from(directionLabelTokens(dir)).slice(0, 14).join(' / ') || '없음';
  return [
    '=== Concept Frame Synthesis (네이밍 직전 단계. 전략을 설명하지 말고 콘셉트 타이틀로 전환하기 위한 프레임) ===',
    `coreMeaningToCarry(타이틀이 반드시 담아야 할 전략 의미): ${coreMeaning}`,
    '다음 슬롯을 먼저 내부적으로 채운 뒤(슬롯 자체는 출력하지 말 것) 그 프레임에서 conceptName 타이틀을 만든다:',
    '- symbolicFrame: coreMeaning을 타이틀로 바꿀 상징적 프레임 하나',
    '- experientialImage: 관람객이 떠올리거나 기억할 한 장면/이미지',
    '- narrativeMotion: 개념이 암시하는 움직임/변화',
    '- audienceAfterimage: 관람 후 남는 인상',
    `- spatialOrContentGesture: 공간/미디어/콘텐츠 행위 (대표 장면 참고: ${compact(scene, 140) || '없음'})`,
    '- emotionalTone: 타이틀이 가져야 할 톤',
    '- titleTerritory: 이 타이틀이 속할 네이밍 세계(현재 RFP 카테고리 기반)',
    `forbiddenDescriptiveWords(타이틀의 주가 되면 안 되는 전략 설명어. 그대로 나열·반복 금지): ${forbidden}`,
    'nameShouldFeelLike: 설명문이 아니라 의도된 콘셉트 타이틀. 슬로건이 설명하기 전에 단독으로 의미가 서고, 호기심을 만들되 모호하지 않다.',
  ].join('\n');
}

function hasInternalMainCopy(option: ConceptNameOptionsResult['options'][number]) {
  INTERNAL_LANGUAGE_PATTERN.lastIndex = 0;
  return INTERNAL_LANGUAGE_PATTERN.test([option.conceptName, option.oneLineSlogan, option.shortMeaning, option.whyItFitsRfp, option.mainRisk].filter(Boolean).join(' '));
}

function genericHookCounts(options: ConceptNameOptionsResult['options']) {
  const counts = new Map<string, number>();
  for (const option of options) {
    const text = [option.conceptName, option.oneLineSlogan].filter(Boolean).join(' ');
    for (const hook of GENERIC_MAIN_HOOKS) {
      if (new RegExp(hook, 'g').test(text)) counts.set(hook, (counts.get(hook) ?? 0) + 1);
    }
  }
  return counts;
}

function repeatsGenericMainHook(option: ConceptNameOptionsResult['options'][number], counts: Map<string, number>) {
  const text = [option.conceptName, option.oneLineSlogan].filter(Boolean).join(' ');
  return GENERIC_MAIN_HOOKS.some((hook) => (counts.get(hook) ?? 0) > 2 && text.includes(hook));
}

function usesCurrentVocabulary(option: ConceptNameOptionsResult['options'][number], vocabulary: string[]) {
  if (!vocabulary.length) return true;
  // Lowercase both sides so English/Latin RFP tokens are not missed on a case mismatch.
  const text = [option.conceptName, option.oneLineSlogan, option.shortMeaning, option.whyItFitsRfp || option.whyItFitsSelectedDirection].filter(Boolean).join(' ').toLowerCase();
  return vocabulary.some((word) => word.length >= 2 && text.includes(word.toLowerCase()));
}

function passesNameFirewall(option: ConceptNameOptionsResult['options'][number], repeatedHooks?: Map<string, number>) {
  const name = option.conceptName || '';
  if (!name.trim()) return false;
  if (resemblesBlockedExample(name)) return false;
  if (hasInternalMainCopy(option)) return false;
  if (repeatedHooks && repeatsGenericMainHook(option, repeatedHooks)) return false;
  // Concrete safety checks only. Cross-RFP category contamination is no longer a hardcoded brand list — it is handled
  // generically by the vocabulary-grounding quality filter (a name with no current-RFP vocabulary, including one that
  // imports another category's terms, fails grounding) before the result is returned.
  return true;
}

// Map an upstream generation error to a stable machine-readable reason code for the client.
function classifyServerError(message: string) {
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|aborted|abort/i.test(message)) return 'model_timeout';
  if (/비어 있습니다|empty/i.test(message)) return 'empty_response';
  if (/JSON|Unexpected token|parse/i.test(message)) return 'invalid_json';
  return 'model_error';
}

function truthyValidation() {
  return {
    coverReady: true,
    connectedToCoreWinningCondition: true,
    connectedToSelectedDirection: true,
    currentRfpSpecific: true,
    noPromptExampleCopy: true,
    noCrossRfpContamination: true,
    notGenericEnglishCombination: true,
    notInternalStrategyLabel: true,
    notSlideTitle: true,
    notTooLong: true,
    expandableToProposalSystem: true,
    specificToCurrentRfp: true,
    noRepeatedMainHook: true,
    noInternalProofLanguageInMainCopy: true,
    currentRfpVocabularyUsed: true,
    notGeneric: true,
    notCrossRfpContaminated: true,
    namesAreSpecificToSelectedDirection: true,
    namesDoNotFitOtherDirections: true,
    noDuplicateConceptLogic: true,
    noNearDuplicateNames: true,
    noGenericEnglishCombination: true,
    connectedToDiagnosis: true,
    connectedToBrandProductIntelligence: true,
  };
}

// Run the full client-side filtering pipeline on one model result: dedup -> safety firewall -> quality/grounding gate
// -> rank -> top 3. Weak/anti-pattern names and (when vocabulary is rich) ungrounded names are dropped, never padded.
function buildFinalOptions(
  result: ConceptNameOptionsResult,
  body: { input: ProjectInput; selectedDirection: ConceptCandidate; recentNameOptions?: string[]; existingNamesForSelectedDirection?: string[]; blockedOtherDirectionNames?: string[] },
  currentRfpVocabularySet: string[],
) {
  const styles = ['Direct claim', 'Short bilingual title', 'Brand/category-specific phrase', 'Spatial/experience frame', 'Symbolic but grounded', 'Strong one-line statement'] as const;
  const repeatedHooks = genericHookCounts(result.options ?? []);
  const blockedNameSet = new Set([...(body.recentNameOptions ?? []), ...(body.existingNamesForSelectedDirection ?? []), ...(body.blockedOtherDirectionNames ?? [])].map(normalizeName).filter(Boolean));
  const seenNameSet = new Set<string>();
  const seenFingerprintSet = new Set<string>();
  let blockedNameDrops = 0;
  const deduped = (result.options ?? []).filter((option) => {
    const nameKey = normalizeName(option.conceptName || '');
    const fingerprint = optionTextFingerprint(option);
    if (!nameKey) return false;
    if (blockedNameSet.has(nameKey)) { blockedNameDrops += 1; return false; }
    if (seenNameSet.has(nameKey) || (fingerprint && seenFingerprintSet.has(fingerprint))) return false;
    seenNameSet.add(nameKey);
    if (fingerprint) seenFingerprintSet.add(fingerprint);
    return true;
  });
  // Compute the vocabulary match on the RAW option (before userFacingCopy truncates/replaces the fields it reads).
  const prepared = deduped.map((option) => ({
    usesVocabulary: usesCurrentVocabulary(option, currentRfpVocabularySet),
    option: { ...option, oneLineSlogan: userFacingCopy(option.oneLineSlogan || option.shortMeaning, 120), shortMeaning: userFacingCopy(option.shortMeaning, 100), whyItFitsRfp: userFacingCopy(option.whyItFitsRfp || option.whyItFits || option.whyItFitsSelectedDirection || option.shortMeaning, 180), mainRisk: userFacingCopy(option.mainRisk || option.risk, 120) },
  }));
  const safe = prepared.filter((entry) => passesNameFirewall(entry.option, repeatedHooks));
  // Quality gate: drop spec anti-pattern names, and — when the RFP vocabulary is rich enough to judge grounding —
  // drop names that use no current-RFP vocabulary. The grounding drop is the generic, bidirectional cross-RFP
  // contamination guard (a name importing another category's terms uses no current vocabulary, so it fails here).
  const vocabRich = currentRfpVocabularySet.length >= 6;
  const coverTitleFamily = isCoverTitleNamingFamily(body.input, body.selectedDirection);
  let descriptiveDrops = 0;
  const quality = safe.filter((entry) => {
    const conceptName = entry.option.conceptName || '';
    if (isWeakConceptName(conceptName, body.input)) return false;
    if (vocabRich && !entry.usesVocabulary) return false;
    // Cover-title types: drop names that read like a descriptive summary / strategy label / direction-label restatement
    // (the title must be a compressed concept title, not an explanation). Drops feed the regenerate-once-then-error path.
    if (coverTitleFamily && isDescriptiveOrStrategyLabelName(conceptName, body.selectedDirection)) { descriptiveDrops += 1; return false; }
    return true;
  });
  // Cross-option guard (cover-title types only): if EVERY surviving name is brand/client-name-centered, the set reads
  // like brand+noun labels rather than proposal-cover concept titles — drop the whole pool so the regenerate-once path
  // fires (and, if still all brand-centered, the existing 422 error). Requires >=2 so a single lone name is not zeroed.
  const brandTokens = brandTokensOf(body.input);
  const allBrandCentered = coverTitleFamily && quality.length >= 2 && quality.every((entry) => isBrandCenteredName(entry.option.conceptName || '', brandTokens));
  const qualityPool = allBrandCentered ? [] : quality;
  // Soft preference: still rank vocab-matching names first within the quality pool.
  const vocabMatched = qualityPool.filter((entry) => entry.usesVocabulary);
  const ranked = (vocabMatched.length ? [...vocabMatched, ...qualityPool.filter((entry) => !entry.usesVocabulary)] : qualityPool).map((entry) => entry.option);
  const options = ranked.slice(0, 3).map((option, index) => {
    const whyItFits = option.whyItFitsRfp || option.whyItFits || option.whyItFitsSelectedDirection || option.shortMeaning;
    const mainRisk = option.mainRisk || option.risk || '';
    // Scores / validation / expandability are server-derived (no longer required from the model output).
    return {
      ...option,
      id: option.id || `${body.selectedDirection.conceptId || 'direction'}-name-${index + 1}`,
      koreanSubtitle: option.koreanSubtitle ?? '',
      oneLineSlogan: option.oneLineSlogan || option.shortMeaning,
      whyItFitsRfp: whyItFits,
      whyItFitsSelectedDirection: option.whyItFitsSelectedDirection || whyItFits,
      namingStyle: option.namingStyle ?? styles[index % styles.length],
      mainRisk,
      strategicClaim: option.strategicClaim || option.oneLineSlogan || option.shortMeaning,
      expandableTo: option.expandableTo ?? { space: option.shortMeaning, content: whyItFits, media: option.oneLineSlogan || option.shortMeaning, operation: mainRisk },
      validation: option.validation ?? truthyValidation(),
      coverReadinessScore: option.coverReadinessScore ?? option.coverTitleScore ?? 4,
      specificityScore: option.specificityScore ?? option.rfpSpecificityScore ?? 4,
      coverTitleScore: option.coverTitleScore ?? 4,
      memorabilityScore: option.memorabilityScore ?? 4,
      rfpSpecificityScore: option.rfpSpecificityScore ?? 4,
      expandabilityScore: option.expandabilityScore ?? 4,
      risk: option.risk ?? mainRisk,
    };
  });
  return { options, diag: { returned: (result.options ?? []).length, deduped: deduped.length, safe: safe.length, quality: quality.length, blockedNameDrops, coverTitleFamily, allBrandCentered, descriptiveDrops } };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; analysisSummary?: string; selectedDirection: ConceptCandidate; selectedStrategicDirection?: ConceptCandidate; proposalNarrative?: ProposalNarrative; conceptDevelopmentLogic?: ConceptDevelopmentLogic; entityDifferentiationMatrix?: EntityDifferentiationItem[]; relevantMatrix?: unknown; activeMatrix?: unknown; brandExperienceMatrix?: BrandExperienceMatrixItem[]; matrixType?: MatrixType; primaryRfpConceptType?: string; languageMode?: string; rfpDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence; recentNameOptions?: string[]; existingNamesForSelectedDirection?: string[]; blockedOtherDirectionNames?: string[] };
    if (!body.input || !body.analysis || (!body.selectedDirection && !body.selectedStrategicDirection)) return json(errorResponse('프로젝트 입력값, 분석 결과, 선택한 전략 방향이 필요합니다.'), { status: 400 });
    body.selectedDirection = normalizeSelectedDirectionForNaming(body) as ConceptCandidate;

    const sanitizedContext = sanitizeConceptContextByRfpType({
      primaryRfpConceptType: body.selectedDirection.rfpConceptType || body.primaryRfpConceptType || body.analysis.primaryRfpConceptType || 'unknown',
      rawPrimaryRfpConceptType: body.analysis.primaryRfpConceptType,
      matrixType: body.matrixType ?? body.analysis.matrixType,
      rawMatrixType: body.matrixType ?? body.analysis.matrixType,
      entityDifferentiationMatrix: body.entityDifferentiationMatrix,
      brandExperienceMatrix: body.brandExperienceMatrix ?? (body.matrixType === 'brandExperienceMatrix' ? (body.activeMatrix ?? body.relevantMatrix) as BrandExperienceMatrixItem[] : undefined),
    });
    const activeMatrix = body.activeMatrix ?? getActiveMatrix(sanitizedContext) ?? body.relevantMatrix ?? null;
    const currentRfpOnlyMode = true; // final naming context = selected direction + confirmed diagnosis + current RFP only; proposal_patterns are not allowed.

    const currentRfpVocabularySet = buildCurrentRfpVocabularySet(body, activeMatrix);
    // Explicit RFP-provided concept hierarchy (current RFP text only) → highest-priority naming anchor (above brand/entity).
    const rfpHierarchy = extractRfpConceptHierarchy(body.input.briefText);
    const namingAnchorBlock = buildConceptNamingAnchor(body, rfpHierarchy);
    const conceptFrameBlock = buildConceptFrameSynthesis(body);
    console.info('[concept-names:gating]', { rfpProvidedConceptHierarchyDetected: Boolean(rfpHierarchy), hierarchyFieldsUsedForNaming: rfpHierarchy ? Object.entries({ mainTheme: rfpHierarchy.mainTheme, subThemes: rfpHierarchy.subThemes.length, zoneConcepts: rfpHierarchy.zoneConcepts.length, officialSlogan: rfpHierarchy.officialSlogan, keyMessage: rfpHierarchy.keyMessage }).filter(([, v]) => v).map(([k]) => k) : [] });

    const system = [
      'You are a senior Korean proposal concept naming director.',
      'Generate final cover-level concept name options only after a strategic direction has been selected.',
      'Return exactly 3 strong final concept name options for the selected strategic direction only. Fewer, sharper, non-interchangeable options are required.',
      'Avoid consulting labels, analysis headings, internal strategy phrases, generic abstract nouns, awkward translated phrases, product-specific names, one-zone-specific names, one-entity-specific names, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-cover concepts that express the winning claim and can expand into space, content, media, and operation.',
      'Internally use coreWinningCondition, strategicTension, proofBurden, selectedStrategicDirection, and signatureProofIdea, but translate all visible copy into planner-friendly Korean: proof=설득 포인트/확인 장면/대표 설득 장면, evidence=근거, proof burden=설득 과제, required proof elements=필수 설득 요소, signature proof idea=대표 설득 장면.',
      'If the Concept Naming Anchor includes a [Priority 0 — RFP 제공 공식 컨셉 위계] line, that RFP-provided concept hierarchy (main theme / sub themes / zone concept / official slogan / key message) OUTRANKS everything below and is the primary naming source, ahead of the client/brand/entity name; for multi-entity pavilions, name from the pavilion-level theme, never from one participant.',
      'Naming source priority (STRICT). Priority 1: the selected direction\'s strategic claim, the current RFP\'s strategic tension, the audience/evaluator perception shift, and the representative persuasion scene. Priority 2: category/industry/project-specific vocabulary, the spatial/media/content/UX mechanism, and the pavilion or exhibition-level narrative frame. Priority 3: client/brand/entity name. The client/brand/entity name may be used ONLY as a secondary modifier that adds strategic meaning, never as the default naming subject, and NOT in every candidate. Derive names from the Concept Naming Anchor block first; use currentRfpVocabularySet as supporting vocabulary, not as a brand-first source. Do not hardcode example vocabularies across RFPs.',
      'For multi-entity pavilion RFPs, name at pavilion / relationship / system / collective-experience level using the 파빌리온 프레임 anchor. Never make a single participant the title subject unless the RFP explicitly establishes it as the lead owner. Do NOT produce a name merely by deleting an entity name (that yields generic names) — replace it with a specific pavilion-level conceptual frame from the diagnosis.',
      'For exhibition/content/energy/technology RFPs, NOT all candidates may contain the client/brand name; use it only when the selected direction is explicitly about leadership/ownership/representative role, and even then keep it limited and meaning-adding. Default to the category/industry shift, the core audience understanding gap, the experience/content mechanism, current-reality-vs-future tension when present, and the intended post-viewing perception — not client/brand name + generic/exhibition/experience noun, and not a descriptive restatement of the RFP.',
      'Use only selected strategic direction, its directionAxis and 대표 설득 장면, confirmed diagnosis, brandProductIntelligence, signatureProofIdea, and current RFP analysis. Do not use proposal_patterns, previous proposal names, old clients/categories, WDS/pavilion wording, won/lost outcomes, old slogans, or old structures.',
      `Blocked example names are banned as outputs and paraphrase sources: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}. Do not output or imitate them.`,
    ].join('\n');

    const user = `${conceptFrameBlock}\n\n${namingAnchorBlock}\n\nconceptName은 위 Concept Frame Synthesis에서 압축한 콘셉트 타이틀이다. 전략을 설명하지 말고 타이틀로 전환하라: selectedStrategicDirectionLabel/oneLineSummary를 이름 템플릿으로 쓰지 말고, conceptName이 shortMeaning·oneLineSlogan·whyItFitsRfp가 할 일을 대신하지 않게 한다. 타이틀은 슬로건 없이도 단독으로 의미가 서야 하고 whyItFitsRfp를 압축한 문장이 아니어야 한다. 아래 RFP 맥락은 보조 정보이며, 프로젝트/클라이언트명은 보조 수식어로만 쓴다.\n프로젝트(맥락용): ${body.input.projectName}\n클라이언트(맥락용): ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
Selected secondaryRfpConceptTypes: ${body.selectedDirection.secondaryRfpConceptTypes?.join(' / ') || 'none'}
Relevant Matrix Type: ${sanitizedContext.matrixType}
Active Matrix Type: ${sanitizedContext.activeMatrixType}
Sanitizer Applied: ${sanitizedContext.sanitizerApplied}
Sanitizer Reason: ${sanitizedContext.sanitizerReason}
Selected Direction ID: ${body.selectedDirection.conceptId || (body.selectedDirection as { id?: string }).id || 'none'}
Selected Direction Axis: ${body.selectedDirection.directionAxis || 'none'}
Selected Direction Label: ${body.selectedDirection.strategicDirectionLabel || body.selectedDirection.directionLabel || body.selectedDirection.strategicDirectionType}
Selected Direction One-line Bet: ${body.selectedDirection.oneLineStrategicBet || body.selectedDirection.oneLineSummary || 'none'}
Confirmed RFP-only Diagnosis: ${compact(body.rfpDiagnosis, 2200)}
Brand/Product Intelligence: ${compact(body.brandProductIntelligence, 2200)}
Selected Strategic Direction Basis: ${compact({ winningThesis: body.selectedDirection.winningThesisUse, conceptLeap: body.selectedDirection.conceptLeap, signatureProofIdea: body.selectedDirection.signatureProofIdea, whatThisDirectionEmphasizes: body.selectedDirection.whatThisDirectionEmphasizes, rfpGrounding: body.selectedDirection.rfpGrounding }, 2200)}
Winning Thesis / Concept Leap / Signature Proof Idea 포함 전략 방향 JSON: ${compact(body.selectedDirection, 4500)}\nConcept Development Logic: ${compact(body.conceptDevelopmentLogic, 2600)}\nRelevant Matrix Only: ${compact(activeMatrix, 2200)}\nLanguage Mode: ${body.languageMode || 'bilingual'}\nProposal Narrative: ${compact(body.proposalNarrative, 2200)}
currentRfpVocabularySet: ${currentRfpVocabularySet.join(' / ')}
Brand vocabulary: ${body.brandProductIntelligence?.brandSpecificVocabulary?.join(' / ') || 'none'}
Words/tone to avoid: ${body.brandProductIntelligence?.wordsToAvoid?.join(' / ') || 'none'}
Existing names for selected direction to avoid: ${(body.existingNamesForSelectedDirection ?? body.recentNameOptions)?.join(' / ') || 'none'}
Names already generated for other directions to block: ${body.blockedOtherDirectionNames?.join(' / ') || 'none'}\n\n요구사항:\n- options는 반드시 정확히 3개. 모두 표지에 올릴 수 있는 강한 후보여야 한다.\n- namingStyle 필드를 반드시 다음 중 하나로 다양화: Direct claim, Short bilingual title, Brand/category-specific phrase, Spatial/experience frame, Symbolic but grounded, Strong one-line statement.\n- 3개는 선택된 방향의 axis, thesis, signature scene에서만 갈라지는 서로 다른 naming logic이어야 한다. 같은 구조로 반복하지 말라.
- generic hook(현장/경험/체험/증명/가치/연결/흐름/여정/신뢰/균형)이 conceptName 또는 oneLineSlogan의 주어처럼 3회 이상 반복되면 약한 후보를 currentRfpVocabularySet 기반으로 재작성한다.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsSelectedDirection, namingStyle, mainRisk만 출력한다. 점수, validation boolean 블록, expandableTo, 디버그/근거 필드는 출력하지 말라(서버가 코드로 처리한다).\n- conceptName은 전략을 "설명"하는 문장이 아니라 Concept Frame Synthesis에서 압축한 제안서 표지 콘셉트 타이틀이다. 전략 라벨/슬라이드 제목/제품 카테고리/분석 heading/방향 라벨 복사/서술형 요약이 아니며, 상징·이미지·움직임·긴장·장면 같은 프레임을 함축해야 한다. 슬로건이 풀어 설명하기 전에 단독으로 의도가 읽혀야 하고, 호기심을 만들되 모호하지 않게 한다. 임시 전략 방향명/컨설팅 목차명/단순 제품명/랜덤 영어 명사 조합이 아니다.
- 필드 역할 분리: conceptName=압축 타이틀(설명/문장/요약 금지), oneLineSlogan=타이틀을 설명·날카롭게(타이틀보다 직접적이어도 됨), shortMeaning=타이틀이 왜 맞는지, whyItFitsRfp=RFP 근거. conceptName이 다른 필드의 역할을 대신하지 말라. forbiddenDescriptiveWords를 타이틀의 주 단어로 쓰지 말라.
- 각 option의 oneLineSlogan은 conceptName이 주장하는 승리 논리를 1문장으로 설명한다. whyItFitsSelectedDirection은 선택한 전략 방향과 confirmed diagnosis의 coreWinningCondition, strategicTension, proofBurden, signatureProofIdea 중 최소 2개와 연결한다.
- generic English word combinations, vague abstract nouns, consulting-style labels, literal RFP summaries, any-name-fits-any-exhibition 후보를 거부하고 재생성한다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- Generate names only for the selected strategic direction. The names must not be usable for the other two directions. If a name could fit another direction with no change, reject it. 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- Use the selected direction’s directionAxis and 대표 설득 장면 as the primary naming source.
- 추가 후보 요청이면 Existing names for selected direction과 Names already generated for other directions를 모두 피하고, 같은 slogan structure / strategic claim / shortMeaning 반복을 거부하라.
- 각 후보 생성 전 내부적으로 What must this proposal prove? What belief shift should evaluator make? Strongest claim? Cover first-page fit? Expandable to space/content/media/operation? 을 검증하고 실패하면 버려라.
- Korean proposal users: 최소 2개 Korean-first 후보를 포함하고, 글로벌/브랜드/전시 맥락이면 최소 2개 English 또는 bilingual 후보를 포함하라. English 후보에는 koreanSubtitle 또는 oneLineSlogan으로 자연스러운 한국어 설명을 제공하라.
- main visible copy(conceptName, oneLineSlogan, shortMeaning, whyItFitsSelectedDirection, mainRisk)에 raw English internal terms(proof/evidence/proof burden/evaluator clarity/validation/source/score/signature proof idea)를 쓰지 말고 한국어 사용자 언어로 번역한다.
- 컨셉명은 선택한 전략 방향에만 맞아야 하고 다른 방향에는 어색해야 하며, 후보끼리 근접 중복이 아니어야 한다. validation boolean 블록은 출력하지 말라(구분성·금지어·중복 검증과 점수는 서버가 코드로 수행한다).
- 금지 예시명/이전 예시명을 그대로 출력하거나 변형하지 말라: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}.
- 현재 RFP/진단/brandProductIntelligence에 근거가 없는 다른 카테고리(에너지/음료/기술/공간/이벤트 등)의 어휘를 가져오면 실패다. 어떤 category word든 현재 RFP 증거에 실제로 있을 때만 사용한다.
- brandProductIntelligence.wordsToAvoid와 무관 카테고리 어휘를 쓰면 실패다. 서로 다른 RFP 카테고리에 모두 그대로 맞는 이름, Moment/Memory/Proof/Evidence/Field/Flow/Grid/Signature/Panorama/Insight 같은 범용어 중심 이름은 현재 RFP 강한 근거가 없으면 거부한다.
- 다음 형태는 컨셉명/슬로건의 주된 naming device로 쓰지 말라(현재 RFP에 맞게 구체적으로 변형된 경우만 예외): 가치 증명, 기억의 증명, 인식 전환, 경험 이해, 가치 체험, 실체화, 한눈에 보는 ___, ___ 중심, ___ 시그니처, ___ Core Experience, ___ Insight, ___ Panorama, ___ Signature, ___ Experience, ___ Journey, ___ Moment. 브랜드/클라이언트명 단독 + 일반 명사 조합도 거부한다.
- Final naming source lock: selectedStrategicDirection, confirmed diagnosis, current RFP summary만 네이밍 근거로 사용하라. proposal_patterns, previous proposal names, old clients/categories/wording은 사용하지 말라. hardcoded direction presets는 사용하지 말라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- single_brand_experience 또는 visitor_center_or_tour는 brand meaning, sensory cue, product value, process/확인 장면, visitor memory, transformation after visit에서 이름을 도출하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라.
- multi_entity_pavilion만 shared pavilion frame, entity/domain relationship, system logic, capability 확인 장면, symbolic presence 기반 네이밍을 허용한다.`;

    const generate = (userPrompt: string) => createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user: userPrompt, timeoutMs: 18_000, maxRetries: 1 });

    let result = await generate(user);
    let built = buildFinalOptions(result, body, currentRfpVocabularySet);
    // Spec: if the first pass produces zero sufficiently-specific options (all weak/ungrounded/duplicate),
    // regenerate ONCE with stricter anti-pattern filtering before failing. Never show weak fallback names.
    if (!built.options.length) {
      result = await generate(user + STRICTER_RETRY_ADDENDUM);
      built = buildFinalOptions(result, body, currentRfpVocabularySet);
    }
    if (!built.options.length) {
      const { returned, deduped, safe, quality, blockedNameDrops, descriptiveDrops } = built.diag;
      // When the model kept producing descriptive / strategy-label names that could not be turned into concept titles,
      // surface the conversion-specific error; otherwise the generic weak-naming error.
      const conversionFailure = descriptiveDrops > 0 && safe > 0;
      const message = conversionFailure ? DESCRIPTIVE_NAMING_ERROR : WEAK_NAMING_ERROR;
      return json(errorResponse(message, `reason=${conversionFailure ? 'descriptive_after_retry' : 'weak_after_retry'}; returned=${returned}; deduped=${deduped}; safe=${safe}; quality=${quality}; blockedNameDrops=${blockedNameDrops}; descriptiveDrops=${descriptiveDrops}`), { status: 422 });
    }
    return json(successResponse({ ...result, selectedDirectionId: body.selectedDirection.conceptId, options: built.options }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.';
    return json(errorResponse(WEAK_NAMING_ERROR, `reason=${classifyServerError(message)}; ${message}`), { status: 502 });
  }
}
