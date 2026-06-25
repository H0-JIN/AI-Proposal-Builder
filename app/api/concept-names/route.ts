import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandExperienceMatrixItem, ConceptCandidate, ConceptDevelopmentLogic, ConceptNameOptionsResult, EntityDifferentiationItem, MatrixType, ProjectInput, ProposalNarrative, ProposalType, RfpDiagnosis, BrandProductIntelligence, WinningReferencePatternBrief } from '@/lib/types';
import { normalizeProposalType } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { getActiveMatrix, sanitizeConceptContextByRfpType } from '@/lib/conceptContextSanitizer';
import { extractRfpConceptHierarchy, type RfpProvidedConceptHierarchy } from '@/lib/rfpConceptHierarchy';
import { buildPatternLearningSummary, formatWinningPatternInfluenceForConceptNaming, retrieveProposalPatternsForOutline } from '@/lib/proposalPatternOutline';
import { buildWinningReferencePatternBrief } from '@/lib/winningReferencePatternBrief';
import type { DocumentChunk } from '@/lib/rag';

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

// §3-7: generic spatial/installation-mood words. A title built ONLY on these (with ZERO project-specific brand/product
// anchor token) describes spatial treatment, not the brand/product world — reject it. Allowed when paired with an anchor.
const GENERIC_SPATIAL_SET = new Set(['transparent', 'light', 'process', 'window', 'pathway', 'continuum', 'radiance', 'harbor', 'gateway', 'horizon', 'threshold', 'passage', 'luminous', 'clarity', 'glow', 'flow', 'path', 'bridge', 'frame', 'lens', 'canvas', 'aura', 'prism', 'beam', 'ray', 'investment', '투명', '빛', '과정', '통로', '여백', '지평', '문', '경계', '잔상', '흐름', '길', '창', '빛결', '결', '문턱']);
const TITLE_STOPWORDS = new Set(['of', 'the', 'a', 'an', 'and', 'to', 'in', 'for', 'with', 'on', 'by', 'is', 'be', '은', '는', '이', '가', '의', '와', '과', '을', '를', '로', '으로', '에']);
const SECTION_HEADER_WORD = /^(overview|introduction|summary|agenda|appendix|conclusion|index|contents|background|objective|approach|phase|chapter|section)$/i;

function nameTokensOf(name: string): string[] {
  return (name || '').split(/[\s/·|,.\-—~()]+/).map((token) => token.replace(/[^가-힣a-z0-9]/gi, '').toLowerCase()).filter((token) => token.length >= 2);
}
// True when EVERY meaningful title token is a generic spatial/mood word AND the title carries ZERO anchor token. A title
// that pairs a generic word with a project-specific anchor token (e.g. brand "blue" + "pathway") is NOT generic-only.
function isGenericSpatialOnlyName(name: string, anchorTokenSet: Set<string>): boolean {
  const tokens = nameTokensOf(name).filter((token) => !TITLE_STOPWORDS.has(token));
  if (!tokens.length) return false;
  if (tokens.some((token) => anchorTokenSet.has(token))) return false;
  return tokens.every((token) => GENERIC_SPATIAL_SET.has(token));
}
function hasAnchorToken(name: string, anchorTokenSet: Set<string>): boolean {
  return nameTokensOf(name).some((token) => anchorTokenSet.has(token));
}
// Conservative English-title quality: only obvious section-headers and 4+ chained-noun compounds with no connector.
function isUnnaturalEnglishTitle(name: string): boolean {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length <= 2 && tokens.some((token) => SECTION_HEADER_WORD.test(token.replace(/[^a-z0-9]/gi, '')))) return true;
  const latin = tokens.filter((token) => /[a-z]/i.test(token));
  const connector = tokens.filter((token) => /^(of|the|a|an|and|to|in|for|with|on|by|&|·|—|-)$/i.test(token));
  // 5+ chained Latin nouns with no connector reads as a broken compound; keep the bar conservative so legitimate
  // 2-4 word bilingual cover titles are never bounced (the drop only feeds the regenerate-once path, not a hard fail).
  return latin.length >= 5 && connector.length === 0;
}

const BRAND_WORLD_RFP_CONCEPT_TYPES = new Set<string>(['single_brand_experience', 'visitor_center_or_tour', 'product_experience_space', 'brand_experience']);

// Deterministic per-RFP brand/product semantic anchor (no LLM, no schema change) — typed token buckets for the server
// checks + a REQUIRED prompt block. forbidden-copy phrases / allowed tokens reuse the existing deny-list source.
interface BrandProductSemanticAnchor {
  preferredConceptVocabulary: string[];
  brandProductTokenSet: Set<string>;
  brandRequired: boolean;
  summary: string;
  promptBlock: string;
}

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
const STRICTER_RETRY_ADDENDUM = '\n\n[재생성 지시] 앞선 후보가 너무 일반적이거나 선택한 전략 방향과 약하게 연결되어 모두 거부되었다. 더 엄격하게 다시 생성하라: (1) 가치 증명/기억의 증명/인식 전환/경험 이해/가치 체험/실체화/한눈에 보는/___ 중심/___ 시그니처/Core Experience/Insight/Panorama/Signature/Experience/Journey/Moment 형태를 절대 쓰지 말 것. (2) 선택한 전략 방향의 directionAxis와 대표 설득 장면, 그리고 currentRfpVocabularySet의 실제 RFP 어휘에서 직접 도출할 것. (3) 브랜드/클라이언트명 단독 + 일반 명사 조합 금지. (4) 다른 RFP에도 그대로 쓸 수 있는 범용 이름 금지. (5) 표지 제목으로 바로 쓸 수 있는 짧고 구체적인 이름만. (6) 전시/콘텐츠/에너지/기술/쇼케이스 유형이면 모든 후보가 클라이언트·브랜드명 중심이 되지 않게 하고, 선택한 전략 방향의 관점·경험·전환·공간/콘텐츠 프레임을 표현하는 제안 표지 콘셉트 타이틀로 만든다. 후보마다 어휘와 논리를 다르게 한다. (7) 전략을 설명하는 서술형/전략 라벨/방향 라벨을 그대로 옮긴 이름, 슬로건이 있어야 의미가 생기는 이름은 거부한다. Concept Frame Synthesis의 symbolicFrame·experientialImage에서 압축한, 단독으로 서는 콘셉트 타이틀만 출력한다. (8) 후보가 transparent/light/process/window/pathway/continuum/radiance/harbor 같은 범용 공간·설치 무드 단어만으로 이루어졌거나 위 Brand/Product Semantic Anchor 의미장 토큰이 0개여서 거부되었다면, "브랜드 세계/제품 진실/감각/증명" 토큰을 conceptName에 직접 담아 다시 만든다(개별 의미 토큰 사용은 허용, 과거 컨셉명/슬로건 구절만 복사 금지).';

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

// Brand/Theme Tone Anchor: the current RFP's distinct tone/world (category vocabulary, brand positioning, exhibition
// theme, audience promise, proof scene). It exists so AT LEAST ONE candidate carries that tone and cannot fit unrelated
// brands — WITHOUT placing the brand/client name in the title (the tone is reflected indirectly). All current-RFP only.
function buildBrandThemeToneAnchor(body: { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence }, hierarchy: RfpProvidedConceptHierarchy | undefined, currentRfpVocabularySet: string[]): string {
  const bpi = body.brandProductIntelligence;
  const dir = body.selectedDirection;
  const sig = dir.signatureProofIdea;
  const scene = (dir as { representativePersuasionScene?: string }).representativePersuasionScene || sig?.signatureScene || sig?.signatureContent || sig?.signatureSpatialMove || '';
  const v = (value?: string, max = 160) => compact(value, max) || '없음';
  const theme = hierarchy?.mainTheme || hierarchy?.keyMessage || body.analysis.projectOverview;
  // Tone vocabulary, but with the brand/client name tokens stripped so the "직접 활용" line never surfaces the brand
  // name itself (the title must reflect the brand world via tone/vocabulary, not by placing the brand name in it).
  const brandTokens = brandTokensOf(body.input);
  const categoryVocab = (bpi?.brandSpecificVocabulary?.length ? bpi.brandSpecificVocabulary : currentRfpVocabularySet)
    .filter((term) => term && !brandTokens.some((token) => term.toLowerCase().includes(token.toLowerCase())))
    .slice(0, 12).join(' / ') || '없음';
  return [
    '=== Brand/Theme Tone Anchor (현재 RFP의 고유 톤·세계. 브랜드/클라이언트명을 직접 넣지 말고 톤·어휘·상징·콘텐츠 세계로 간접 반영) ===',
    `카테고리/산업 세계: ${v(bpi?.categoryContext || bpi?.productOrServiceMeaning)}`,
    `전시/프로젝트 테마: ${v(theme)}`,
    `브랜드 톤·포지셔닝: ${v(bpi?.toneGuidance || bpi?.clientOrBrandRole)}`,
    `카테고리 고유 어휘(직접 활용): ${categoryVocab}`,
    `타깃 관객·약속: ${v(bpi?.audiencePerceptionGap || body.rfpDiagnosis?.hiddenNeed)}`,
    `대표 증명/경험 장면: ${v(scene)}`,
    '브랜드/제품 세계 차원(방문관·공장견학·쇼룸·브랜드 체험형에서 적극 활용): 브랜드 컬러·시그니처 색 / 제품 본질(성분·효능·진실) / 감각 단서 / 확인·증명 장면 / 방문 후 변화·전환 / 기억·잔상. 위 카테고리 고유 어휘와 현재 RFP가 뒷받침하는 한, 이 차원의 단어(예: 색·성분·공정·투명·균형 등 도메인 어휘)를 자유롭게 활용한다(과거 제안의 정확한 컨셉명/슬로건/페이지 제목 "구절"만 복사 금지이며, 개별 브랜드/카테고리 단어는 금지 대상이 아니다).',
    '요구: 3개 중 최소 1개(주제형)는 위 톤·어휘·테마·브랜드/제품 세계를 담아 현재 RFP에 고유하게 들려야 하고, 무관한 브랜드/전시에는 그대로 쓸 수 없어야 한다. 공간·빛·기억·임팩트·설치만 말하는 범용 이름, 브랜드/제품 세계·제품 진실·증명 장치를 무시한 이름, 무관한 방문관에도 맞는 이름은 거부하고 재생성한다. 단, 브랜드/클라이언트명 자체를 conceptName에 직접 넣지 않는다(톤·어휘·상징으로 간접 반영).',
  ].join('\n');
}

// §3-7: deterministic brand/product semantic anchor — typed token buckets from existing fields (brandProductIntelligence,
// signatureProofIdea, rfpDiagnosis, reference brief) + a REQUIRED prompt block. No LLM, no schema change. The positive
// counterpart to the deny-list: makes brand/product vocabulary REQUIRED, not just allowed.
function buildBrandProductSemanticAnchor(
  body: { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence; primaryRfpConceptType?: string },
  refBrief: WinningReferencePatternBrief | null,
): BrandProductSemanticAnchor {
  const bpi = body.brandProductIntelligence;
  const dir = body.selectedDirection;
  const sig = dir.signatureProofIdea;
  const tok = (text?: string) => (text ? tokenizeKoreanNouns(text) : []);
  const cap = (arr: string[], n = 10) => Array.from(new Set(arr.map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, n);

  const brandWorldKeywords = cap([...(bpi?.brandSpecificVocabulary ?? []), ...tok(bpi?.clientOrBrandRole), ...(refBrief?.brandTonePattern ? tok(refBrief.brandTonePattern) : [])]);
  const productTruthKeywords = cap([...tok(bpi?.productOrServiceMeaning), ...tok(bpi?.categoryContext)]);
  const sensoryKeywords = cap([...tok(sig?.signatureContent), ...tok(sig?.signatureSpatialMove), ...tok(sig?.signatureMediaOrInteraction)]);
  const proofKeywords = cap([...tok(sig?.signatureScene), ...tok((dir as { representativePersuasionScene?: string }).representativePersuasionScene), ...tok(body.rfpDiagnosis?.proofBurden)]);
  const visitorTransformationKeywords = cap([...tok(bpi?.audiencePerceptionGap), ...tok(body.rfpDiagnosis?.hiddenNeed)]);
  const processOrSystemKeywords = cap([...tok(bpi?.categoryContext), ...tok(sig?.signatureSpatialMove)]);

  const preferredConceptVocabulary = cap([...brandWorldKeywords, ...productTruthKeywords, ...sensoryKeywords, ...proofKeywords, ...visitorTransformationKeywords], 20);
  // Non-generic brand/product/sensory tokens for the server checks — a generic spatial word can never satisfy the anchor
  // requirement, and a brand whose only vocab is generic yields an empty set that SOFT-DISABLES the gate (no over-drop).
  const brandProductTokenSet = new Set([...brandWorldKeywords, ...productTruthKeywords, ...sensoryKeywords].map((t) => t.toLowerCase()).filter((t) => t.length >= 2 && !GENERIC_SPATIAL_SET.has(t)));

  const rfpType = dir.rfpConceptType || body.primaryRfpConceptType || body.analysis.primaryRfpConceptType || '';
  const ptype = normalizeProposalType(body.input.proposalType);
  const isBrandWorldType = BRAND_WORLD_RFP_CONCEPT_TYPES.has(rfpType) || ptype === 'brand_experience' || ptype === 'visitor_center_tour';
  const isMultiEntity = rfpType === 'multi_entity_pavilion';
  const brandRequired = isBrandWorldType && !isMultiEntity && brandProductTokenSet.size > 0;

  const line = (label: string, arr: string[]) => `${label}: ${arr.join(' / ') || '없음'}`;
  const promptBlock = [
    '=== Brand/Product Semantic Anchor (REQUIRED — 최소 1개 후보가 이 의미장에서 토큰을 직접 가져와야 함. 공간·빛·과정만 말하는 범용 이름 금지) ===',
    line('브랜드 세계', brandWorldKeywords),
    line('제품 진실', productTruthKeywords),
    line('감각', sensoryKeywords),
    line('증명', proofKeywords),
    line('방문객 변화', visitorTransformationKeywords),
    line('공정/시스템', processOrSystemKeywords),
    line('우선 활용 어휘(positive pull)', preferredConceptVocabulary),
    brandRequired
      ? '요구: 최소 1개 후보(주제형)는 위 "브랜드 세계/제품 진실/감각" 토큰을 conceptName에 직접 담아 무관한 브랜드에는 그대로 쓸 수 없는 타이틀이어야 한다.'
      : '요구: 위 의미장 토큰이 있으면 최소 1개 후보가 이를 conceptName에 담는다(다중 주체/공동관형은 파빌리온 프레임을 유지하고 브랜드 토큰을 강제하지 않는다).',
    'transparent/light/process/window/pathway/continuum/radiance/harbor/투명/빛/과정/통로 같은 범용 공간·설치 무드 단어만으로 이루어진 이름(위 의미장 토큰 0개)은 거부하고 재생성한다. 단, 위 의미장 토큰과 결합하면 범용 단어도 허용한다. 개별 의미 토큰은 금지 대상이 아니다(정확한 과거 컨셉명/슬로건/페이지 제목 "구절"만 복사 금지). 현재 RFP가 지지하는 브랜드/카테고리/제품/증명/감각 어휘는 적극 사용하라.',
  ].join('\n');

  return { preferredConceptVocabulary, brandProductTokenSet, brandRequired, summary: preferredConceptVocabulary.slice(0, 8).join(', '), promptBlock };
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
// Hangul / Latin dominance — used by the language policy and the koreanSubtitle backfill.
function isLatinDominantName(value: string): boolean {
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const hangul = (value.match(/[가-힣]/g) || []).length;
  return latin > 0 && latin >= hangul;
}
// Deterministic concept-name language policy. Default conceptName to ENGLISH for global / B2B / technology / energy /
// mobility / exhibition / brand-showcase / corporate-pavilion / international contexts (Korean conceptNames there tend to
// collapse into descriptive labels); allow Korean as the PRIMARY conceptName only when Korean / local / cultural / heritage
// identity is itself the concept. Generic category signals only — no hardcoded brand/company/RFP names.
function decidePrimaryConceptLanguage(body: { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis }): { language: 'english_default' | 'korean_primary'; reason: string } {
  const text = [body.input.projectName, body.input.clientName, body.input.briefText, body.analysis?.projectOverview, body.selectedDirection?.strategicDirectionLabel, body.selectedDirection?.rfpConceptType, body.rfpDiagnosis?.coreWinningCondition].filter(Boolean).join(' \n ');
  const koreanCultural = /전통\s*문화|문화\s*유산|무형\s*유산|국가\s*유산|문화재|민속|향토|향교|서원|국악|판소리|한복|한지|종가|세시|마을\s*공동체|지역\s*공동체|지역\s*주민|주민\s*참여|공공\s*문화|생활\s*문화|역사\s*문화|heritage|folk\s*culture|intangible\s*cultural|traditional\s*korean/i.test(text);
  if (koreanCultural) return { language: 'korean_primary', reason: 'Korean/local/cultural/heritage identity is the concept' };
  return { language: 'english_default', reason: 'global/B2B/technology/exhibition/brand-showcase/international context defaults to an English title with Korean subtitle/slogan' };
}

function buildFinalOptions(
  result: ConceptNameOptionsResult,
  body: { input: ProjectInput; selectedDirection: ConceptCandidate; recentNameOptions?: string[]; existingNamesForSelectedDirection?: string[]; blockedOtherDirectionNames?: string[]; analysis?: AnalysisResult; brandProductIntelligence?: BrandProductIntelligence; candidateRole?: string },
  currentRfpVocabularySet: string[],
  forbiddenCopyTerms: string[] = [],
  semanticAnchor?: BrandProductSemanticAnchor,
) {
  const styles = ['Direct claim', 'Short bilingual title', 'Brand/category-specific phrase', 'Spatial/experience frame', 'Symbolic but grounded', 'Strong one-line statement'] as const;
  const repeatedHooks = genericHookCounts(result.options ?? []);
  const blockedNameSet = new Set([...(body.recentNameOptions ?? []), ...(body.existingNamesForSelectedDirection ?? []), ...(body.blockedOtherDirectionNames ?? [])].map(normalizeName).filter(Boolean));
  // Reference deny-list (§3-6): block EXACT / near-identical old concept NAMES / SLOGANS / PAGE TITLES (multi-word
  // phrases), but DO NOT block individual brand/category SEMANTIC tokens that the current RFP / brand actually supports.
  // The old substring-per-token match over-blocked words like "blue"/"proof"/"ion". A lone coined token is still blocked
  // only when it is NOT supported by the current RFP / brand vocabulary (so a genuinely coined one-word old name stays
  // forbidden). Copy protection is made phrase-accurate, not weakened.
  const denyTokenize = (text: string) => text.toLowerCase().split(/[\s/·|,.\-—~()[\]"'`]+/).map((token) => token.replace(/[^가-힣a-z0-9]/g, '')).filter((token) => token.length >= 2);
  const allowedTokenSet = new Set(denyTokenize([currentRfpVocabularySet.join(' '), (body.brandProductIntelligence?.brandSpecificVocabulary ?? []).join(' '), body.input.briefText ?? '', compact(body.analysis, 4000) ?? ''].join(' ')));
  const forbiddenEntries = forbiddenCopyTerms.map((term) => term.toLowerCase().trim()).filter((term) => term.length >= 2).map((term) => ({ term, tokens: denyTokenize(term) }));
  const forbiddenPhrases = forbiddenEntries.filter((entry) => entry.tokens.length >= 2);
  const forbiddenLoneTokens = forbiddenEntries.filter((entry) => entry.tokens.length === 1 && Boolean(entry.tokens[0]) && !allowedTokenSet.has(entry.tokens[0]));
  const copiesForbiddenReference = (option: { conceptName?: string; koreanSubtitle?: string; oneLineSlogan?: string }) => {
    const fieldsText = `${option.conceptName || ''} ${option.koreanSubtitle || ''} ${option.oneLineSlogan || ''}`.toLowerCase();
    const fieldTokens = new Set(denyTokenize(fieldsText));
    // Exact or near-identical old name/slogan/title reuse: the full phrase appears, or >=80% of its tokens are present
    // (catches a reordered/minor-word-change copy) — this is the "exact + near-identical phrase" block.
    const phraseHit = forbiddenPhrases.some((phrase) => fieldsText.includes(phrase.term) || phrase.tokens.filter((token) => fieldTokens.has(token)).length >= Math.max(2, Math.ceil(phrase.tokens.length * 0.8)));
    if (phraseHit) return true;
    // A genuinely coined single-word old concept name (not current-RFP/brand vocab) → block by WHOLE-WORD match.
    return forbiddenLoneTokens.some((entry) => fieldTokens.has(entry.tokens[0] as string));
  };
  const seenNameSet = new Set<string>();
  const seenFingerprintSet = new Set<string>();
  let blockedNameDrops = 0;
  const deduped = (result.options ?? []).filter((option) => {
    const nameKey = normalizeName(option.conceptName || '');
    const fingerprint = optionTextFingerprint(option);
    if (!nameKey) return false;
    if (blockedNameSet.has(nameKey)) { blockedNameDrops += 1; return false; }
    if (forbiddenEntries.length && copiesForbiddenReference(option)) { blockedNameDrops += 1; return false; }
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
  let genericSpatialDrops = 0;
  let themeGateDrops = 0;
  let englishQualityDrops = 0;
  const anchorTokenSet = semanticAnchor?.brandProductTokenSet ?? new Set<string>();
  const quality = safe.filter((entry) => {
    const conceptName = entry.option.conceptName || '';
    if (isWeakConceptName(conceptName, body.input)) return false;
    if (vocabRich && !entry.usesVocabulary) return false;
    // §3-7: reject a title built ONLY on generic spatial/mood words with ZERO brand/product anchor token (soft-disabled
    // when the anchor set is empty, so an RFP with no brand intelligence still produces names). Allowed when paired.
    if (anchorTokenSet.size && isGenericSpatialOnlyName(conceptName, anchorTokenSet)) { genericSpatialDrops += 1; return false; }
    // §3-7: the 'theme' candidate (A) must carry a brand/product world token — gated to brand-world types via brandRequired.
    if (semanticAnchor?.brandRequired && body.candidateRole === 'theme' && anchorTokenSet.size && !hasAnchorToken(conceptName, anchorTokenSet)) { themeGateDrops += 1; return false; }
    // §3-7: drop unnatural English titles (section-header words / broken 4+ noun compounds) for Latin-dominant names.
    if (isLatinDominantName(conceptName) && isUnnaturalEnglishTitle(conceptName)) { englishQualityDrops += 1; return false; }
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
      koreanConceptSeed: option.koreanConceptSeed,
      // An English-dominant conceptName must always carry a Korean subtitle that preserves the Korean concept-seed meaning.
      // If the model omitted it, backfill from the Korean seed first (it carries the concept meaning), then shortMeaning.
      koreanSubtitle: (option.koreanSubtitle && option.koreanSubtitle.trim()) ? option.koreanSubtitle : (isLatinDominantName(option.conceptName || '') ? userFacingCopy(option.koreanConceptSeed || option.shortMeaning || option.oneLineSlogan || '', 60) : ''),
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
  return { options, diag: { returned: (result.options ?? []).length, deduped: deduped.length, safe: safe.length, quality: quality.length, blockedNameDrops, coverTitleFamily, allBrandCentered, descriptiveDrops, genericSpatialDrops, themeGateDrops, englishQualityDrops } };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; analysisSummary?: string; selectedDirection: ConceptCandidate; selectedStrategicDirection?: ConceptCandidate; proposalNarrative?: ProposalNarrative; conceptDevelopmentLogic?: ConceptDevelopmentLogic; entityDifferentiationMatrix?: EntityDifferentiationItem[]; relevantMatrix?: unknown; activeMatrix?: unknown; brandExperienceMatrix?: BrandExperienceMatrixItem[]; matrixType?: MatrixType; primaryRfpConceptType?: string; languageMode?: string; rfpDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence; recentNameOptions?: string[]; existingNamesForSelectedDirection?: string[]; blockedOtherDirectionNames?: string[]; projectId?: string | null; documentIds?: string[]; winningReferenceChunks?: DocumentChunk[]; winningReferenceBrief?: WinningReferencePatternBrief | null; winningReferenceBriefProvided?: boolean; candidateCount?: number; candidateRole?: string };
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
    const brandThemeToneBlock = buildBrandThemeToneAnchor(body, rfpHierarchy, currentRfpVocabularySet);
    const conceptFrameBlock = buildConceptFrameSynthesis(body);
    // Phase 3-2: safe, project-scoped winning/losing pattern learning (structure-only, Priority 4). Skips when no scope.
    const learningGuidance = await retrieveProposalPatternsForOutline({ projectId: body.projectId ?? null, documentIds: body.documentIds ?? [], currentProposalType: normalizeProposalType(body.input.proposalType), limit: 12 });
    // Phase 3-2b: distil the current project's OWN uploaded reference proposal into concept-LOGIC structure (one LLM call,
    // cached client-side and reused). An untagged reference is surfaced as NEUTRAL (not "winning"). Falls back cleanly.
    const refBriefResult = body.winningReferenceBriefProvided
      ? { hasReference: Boolean(body.winningReferenceBrief), usable: Boolean(body.winningReferenceBrief), brief: body.winningReferenceBrief ?? null }
      : (body.winningReferenceChunks?.length ? await buildWinningReferencePatternBrief({ referenceChunks: body.winningReferenceChunks, currentRfpContext: compact(body.analysis, 4000) }) : { hasReference: false, usable: false, brief: null });
    if (refBriefResult.usable && refBriefResult.brief) {
      learningGuidance.comparison.winningReferencePatternBrief = refBriefResult.brief;
      learningGuidance.comparison.referenceBriefIsNeutral = learningGuidance.comparison.evidenceSource.wonCount === 0;
    }
    console.info('[concept-names:refBrief]', { hasReference: refBriefResult.hasReference, usable: refBriefResult.usable, forbiddenCount: refBriefResult.brief?.forbiddenCopyTerms?.length ?? 0, neutral: learningGuidance.comparison.referenceBriefIsNeutral ?? false });
    // §3-7: required brand/product semantic anchor (deterministic) — the positive pull that makes brand vocabulary required.
    const semanticAnchor = buildBrandProductSemanticAnchor(body, refBriefResult.brief);
    console.info('[concept-names:semanticAnchor]', { brandRequired: semanticAnchor.brandRequired, anchorTokens: semanticAnchor.brandProductTokenSet.size, preferred: semanticAnchor.preferredConceptVocabulary.length });
    const winningPatternInfluenceBlock = formatWinningPatternInfluenceForConceptNaming(learningGuidance.comparison);
    const patternLearningSummary = buildPatternLearningSummary(learningGuidance.comparison);
    const conceptLanguage = decidePrimaryConceptLanguage(body);
    const languagePolicyBlock = [
      '=== Concept Name Language Policy (제목의 "언어"만 결정한다. 제목의 강도·구조·독창성은 위 Concept Frame Synthesis가 결정한다) ===',
      `primaryConceptLanguage: ${conceptLanguage.language} — ${conceptLanguage.reason}`,
      '네이밍 시퀀스(반드시 이 순서로 내부 사고): (1) 위 Concept Frame Synthesis에서 가장 강한 개념적 의미를 잡는다. (2) 그 의미를 담은 강한 한국어 "컨셉 시드 타이틀"을 내부적으로 만든다(좋은 한국어 제안 컨셉 제목처럼 압축적이고 상징적). (3) english_default이면 이 한국어 시드를 영어 conceptName으로 trans-create 한다 — 새 범용 영어 라벨을 만들지 말고, 시드의 이미지·긴장·움직임·상징 프레임을 영어로 보존한다. (4) 한국어 시드(또는 다듬은 버전)를 koreanSubtitle로 쓴다. (5) oneLineSlogan은 한국어 기본. (6) 영어 conceptName과 한국어 koreanSubtitle가 한 쌍처럼 맞물리게 한다.',
      'korean_primary이면 한국어 시드 자체가 conceptName이 된다(여전히 설명/문장/전략 라벨이 아니라 압축된 표지 타이틀).',
      'english_default이면 conceptName 3개 중 최소 2개가 영어 trans-created 타이틀이고, 각 영어 conceptName에는 자연스러운 한국어 koreanSubtitle와 한국어 oneLineSlogan을 함께 둔다.',
      '검증: 영어 conceptName은 한국어 시드의 개념적 강도를 보존해야 한다. 영어가 시드보다 약하거나 더 범용적/더 추상적이면 재생성한다. 영어가 일반 명사·전략 라벨·카테고리 라벨로 납작해지면 거부한다. 한국어 시드가 모든 영어 후보보다 강하면, 영어 conceptName은 새로 만든 범용 라벨이 아니라 시드의 trans-creation이어야 한다. koreanSubtitle는 영어 이름의 단순 번역이 아니라 원래 한국어 시드 의미를 보존한다.',
      '언어 정책은 제목의 언어만 정한다. conceptName의 강도/독창성은 symbolic frame, experiential image, narrative motion, audience afterimage, spatial/content gesture, strategic tension, 대표 설득 장면에서 나온다(범용 영어 단어 조합이 아니다).',
      'koreanSubtitle/oneLineSlogan/shortMeaning/whyItFitsRfp는 한국어로 작성한다(UI 언어가 한국어). 내부 한국어 시드는 main UI에 노출하지 않는다.',
    ].join('\n');
    console.info('[concept-names:gating]', { rfpProvidedConceptHierarchyDetected: Boolean(rfpHierarchy), primaryConceptLanguage: conceptLanguage.language, hierarchyFieldsUsedForNaming: rfpHierarchy ? Object.entries({ mainTheme: rfpHierarchy.mainTheme, subThemes: rfpHierarchy.subThemes.length, zoneConcepts: rfpHierarchy.zoneConcepts.length, officialSlogan: rfpHierarchy.officialSlogan, keyMessage: rfpHierarchy.keyMessage }).filter(([, v]) => v).map(([k]) => k) : [] });

    // §3-5: generate only a small batch per request (the client drives the incremental loop) so each request stays light
    // and cannot time out. requestedCount defaults to 3 for backward compatibility; the client sends 1. candidateRole
    // (theme/scene/declaration) carries the deliberate A/B/C variety across the client's per-candidate requests.
    const requestedCount = Math.max(1, Math.min(3, Math.floor(body.candidateCount ?? 3)));
    const roleHints: Record<string, string> = {
      theme: '주제형(Brand/Product World Title) — 위 Brand/Product Semantic Anchor의 "브랜드 세계/제품 진실/감각" 토큰을 conceptName에 반드시 1개 이상 직접 담아, 현재 브랜드/제품 세계가 또렷이 드러나고 무관한 브랜드/방문관에는 그대로 쓸 수 없는 타이틀(브랜드/클라이언트명 자체는 직접 사용 금지, 톤·어휘·상징으로 반영, namingStyle은 Brand/category-specific phrase). transparent/light/process/window/pathway 같은 범용 공간·무드 단어만으로 만들지 말 것.',
      scene: '장면형(Experience/Scene Title) — 대표 관람 경험·장면·움직임을 기억에 남는 이미지로 압축하되, 반드시 제품 진실 또는 증명 장치(위 Semantic Anchor의 제품 진실/증명 토큰)와 연결한다(namingStyle은 Spatial/experience frame). 공간 무드만 묘사하지 말 것.',
      declaration: '선언형(Strategic/Proof Title) — 선택한 전략 방향을 표지 타이틀로 압축하되, 추상적 리더십/과정 라벨이 아니라 전략을 증명(위 Semantic Anchor의 증명 토큰)과 연결한다(namingStyle은 Direct claim 또는 Strong one-line statement).',
    };
    const requestedRole = typeof body.candidateRole === 'string' ? roleHints[body.candidateRole] : undefined;
    const namingStyleLine = '- namingStyle 필드를 반드시 다음 중 하나로 지정: Direct claim, Short bilingual title, Brand/category-specific phrase, Spatial/experience frame, Symbolic but grounded, Strong one-line statement.';
    const countRequirementBlock = requestedCount >= 3
      ? `- options는 반드시 정확히 3개. 모두 표지에 올릴 수 있는 강한 후보여야 한다.\n${namingStyleLine}\n- 3개 후보는 의도적으로 서로 다른 역할을 갖는다: (A) ${roleHints.theme} (B) ${roleHints.scene} (C) ${roleHints.declaration} 세 후보는 톤·어휘·논리에서 명확히 달라야 하고, 셋 다 무관한 브랜드에 그대로 맞는 범용 영어/추상 명사 조합이면 거부하고 재생성한다. 단, 이 역할 분담이 Concept Frame Synthesis → 한국어 컨셉 시드 → (필요 시) 영어 trans-create 순서를 깨뜨리지 않는다.`
      : `- options는 반드시 정확히 ${requestedCount}개의 강한 후보. 빠르고 가볍게 생성하되 품질은 절대 낮추지 말 것(표지에 바로 올릴 수 있는 수준이어야 한다).\n${namingStyleLine}\n- 이 후보의 역할: ${requestedRole || roleHints.declaration}\n- 위 'Existing names for selected direction to avoid'의 이름과 의도적으로 다른 톤·어휘·논리로 만들고, 같은 slogan structure / strategic claim / shortMeaning 반복을 거부한다. 무관한 브랜드에 그대로 맞는 범용 영어/추상 명사 조합이면 거부하고 재생성한다. 이 역할 분담이 Concept Frame Synthesis → 한국어 컨셉 시드 → (필요 시) 영어 trans-create 순서를 깨뜨리지 않는다.`;

    const system = [
      'You are a senior Korean proposal concept naming director.',
      'Generate final cover-level concept name options only after a strategic direction has been selected.',
      `Return exactly ${requestedCount} strong final concept name option(s) for the selected strategic direction only. Fewer, sharper, non-interchangeable options are required.`,
      'Concept Frame Synthesis is the PRIMARY naming driver and always comes first. Build the conceptName from the frame, not from the language policy: derive the strongest conceptual meaning from the frame, form an internal strong Korean concept-seed title, and only then apply the language. When primaryConceptLanguage is english_default, TRANS-CREATE the Korean seed into a short English cover title (at least 2 of 3) that preserves the seed\'s image/tension/movement/symbol — never invent a separate generic English label, and never flatten it into a business keyword; carry the Korean seed as koreanSubtitle and a Korean oneLineSlogan. When korean_primary, the Korean seed is the conceptName. The language policy decides ONLY the title language; the title\'s strength, distinctiveness, and structure must come from the symbolic frame / experiential image / narrative motion / audience afterimage / strategic tension / representative proof scene. Reject any English name that is weaker, more generic, or more abstract than the Korean seed, or that reads as a generic noun, strategy label, category label, or description.',
      'Avoid consulting labels, analysis headings, internal strategy phrases, generic abstract nouns, awkward translated phrases, product-specific names, one-zone-specific names, one-entity-specific names, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-cover concepts that express the winning claim and can expand into space, content, media, and operation.',
      'Internally use coreWinningCondition, strategicTension, proofBurden, selectedStrategicDirection, and signatureProofIdea, but translate all visible copy into planner-friendly Korean: proof=설득 포인트/확인 장면/대표 설득 장면, evidence=근거, proof burden=설득 과제, required proof elements=필수 설득 요소, signature proof idea=대표 설득 장면.',
      'If the Concept Naming Anchor includes a [Priority 0 — RFP 제공 공식 컨셉 위계] line, that RFP-provided concept hierarchy (main theme / sub themes / zone concept / official slogan / key message) OUTRANKS everything below and is the primary naming source, ahead of the client/brand/entity name; for multi-entity pavilions, name from the pavilion-level theme, never from one participant.',
      'A "Winning Pattern Influence (Priority 4)" block may be provided from the current project\'s OWN uploaded reference proposals. If present, use the won concept-LOGIC STRUCTURE (how the problem was reframed, how strategy became concept, how content followed, how proof was placed) so at least one candidate applies a proven win-rate logic pattern — but NEVER copy old concept names/slogans/page titles/copy/client or project names, and NEVER let it override Priority 1-3 (current RFP, selected direction, Concept Frame Synthesis) or the Korean-seed→transcreation order. Use losing patterns ONLY as risk warnings (avoid generic/abstract/weak logic); never as positive inspiration. If the block says "데이터 없음", do not assume or fabricate any winning pattern.',
      'Naming source priority (STRICT). Priority 1: the selected direction\'s strategic claim, the current RFP\'s strategic tension, the audience/evaluator perception shift, and the representative persuasion scene. Priority 2: category/industry/project-specific vocabulary, the spatial/media/content/UX mechanism, and the pavilion or exhibition-level narrative frame. Priority 3: client/brand/entity name. The client/brand/entity name may be used ONLY as a secondary modifier that adds strategic meaning, never as the default naming subject, and NOT in every candidate. Derive names from the Concept Naming Anchor block first; use currentRfpVocabularySet as supporting vocabulary, not as a brand-first source. Do not hardcode example vocabularies across RFPs.',
      'For multi-entity pavilion RFPs, name at pavilion / relationship / system / collective-experience level using the 파빌리온 프레임 anchor. Never make a single participant the title subject unless the RFP explicitly establishes it as the lead owner. Do NOT produce a name merely by deleting an entity name (that yields generic names) — replace it with a specific pavilion-level conceptual frame from the diagnosis.',
      'For exhibition/content/energy/technology RFPs, NOT all candidates may contain the client/brand name; use it only when the selected direction is explicitly about leadership/ownership/representative role, and even then keep it limited and meaning-adding. Default to the category/industry shift, the core audience understanding gap, the experience/content mechanism, current-reality-vs-future tension when present, and the intended post-viewing perception — not client/brand name + generic/exhibition/experience noun, and not a descriptive restatement of the RFP.',
      'Use only selected strategic direction, its directionAxis and 대표 설득 장면, confirmed diagnosis, brandProductIntelligence, signatureProofIdea, and current RFP analysis. Do not use proposal_patterns, previous proposal names, old clients/categories, WDS/pavilion wording, won/lost outcomes, old slogans, or old structures.',
      `Blocked example names are banned as outputs and paraphrase sources: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}. Do not output or imitate them.`,
    ].join('\n');

    const user = `${conceptFrameBlock}\n\n${namingAnchorBlock}\n\n${brandThemeToneBlock}\n\n${semanticAnchor.promptBlock}\n\n${winningPatternInfluenceBlock}\n\n${languagePolicyBlock}\n\nconceptName은 위 Concept Frame Synthesis에서 압축한 콘셉트 타이틀이다. 전략을 설명하지 말고 타이틀로 전환하라: selectedStrategicDirectionLabel/oneLineSummary를 이름 템플릿으로 쓰지 말고, conceptName이 shortMeaning·oneLineSlogan·whyItFitsRfp가 할 일을 대신하지 않게 한다. 타이틀은 슬로건 없이도 단독으로 의미가 서야 하고 whyItFitsRfp를 압축한 문장이 아니어야 한다. 아래 RFP 맥락은 보조 정보이며, 프로젝트/클라이언트명은 보조 수식어로만 쓴다.\n프로젝트(맥락용): ${body.input.projectName}\n클라이언트(맥락용): ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
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
Names already generated for other directions to block: ${body.blockedOtherDirectionNames?.join(' / ') || 'none'}\n\n요구사항:\n${countRequirementBlock}
- generic hook(현장/경험/체험/증명/가치/연결/흐름/여정/신뢰/균형)이 conceptName 또는 oneLineSlogan의 주어처럼 3회 이상 반복되면 약한 후보를 currentRfpVocabularySet 기반으로 재작성한다.\n- 각 option은 먼저 koreanConceptSeed(Concept Frame Synthesis에서 만든 강한 한국어 컨셉 시드 타이틀)를 만들고, 그 시드에서 conceptName을 도출한다. 출력 필드: koreanConceptSeed, conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsSelectedDirection, namingStyle, mainRisk. 점수, validation boolean 블록, expandableTo, 디버그/근거 필드는 출력하지 말라(서버가 코드로 처리한다). english_default이면 conceptName은 koreanConceptSeed를 trans-create한 영어 타이틀이어야 하고(시드와 따로 새로 만든 범용 영어 라벨이 아님), koreanSubtitle는 koreanConceptSeed의 의미를 보존한다. korean_primary이면 conceptName은 koreanConceptSeed(또는 다듬은 버전)이다.\n- conceptName은 전략을 "설명"하는 문장이 아니라 Concept Frame Synthesis에서 압축한 제안서 표지 콘셉트 타이틀이다. 전략 라벨/슬라이드 제목/제품 카테고리/분석 heading/방향 라벨 복사/서술형 요약이 아니며, 상징·이미지·움직임·긴장·장면 같은 프레임을 함축해야 한다. 슬로건이 풀어 설명하기 전에 단독으로 의도가 읽혀야 하고, 호기심을 만들되 모호하지 않게 한다. 임시 전략 방향명/컨설팅 목차명/단순 제품명/랜덤 영어 명사 조합이 아니다.
- 필드 역할 분리: conceptName=압축 타이틀(설명/문장/요약 금지), oneLineSlogan=타이틀을 설명·날카롭게(타이틀보다 직접적이어도 됨), shortMeaning=타이틀이 왜 맞는지, whyItFitsRfp=RFP 근거. conceptName이 다른 필드의 역할을 대신하지 말라. forbiddenDescriptiveWords를 타이틀의 주 단어로 쓰지 말라.
- 각 option의 oneLineSlogan은 conceptName이 주장하는 승리 논리를 1문장으로 설명한다. whyItFitsSelectedDirection은 선택한 전략 방향과 confirmed diagnosis의 coreWinningCondition, strategicTension, proofBurden, signatureProofIdea 중 최소 2개와 연결한다.
- generic English word combinations, vague abstract nouns, consulting-style labels, literal RFP summaries, any-name-fits-any-exhibition 후보를 거부하고 재생성한다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- Generate names only for the selected strategic direction. The names must not be usable for the other two directions. If a name could fit another direction with no change, reject it. 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- Use the selected direction’s directionAxis and 대표 설득 장면 as the primary naming source.
- 추가 후보 요청이면 Existing names for selected direction과 Names already generated for other directions를 모두 피하고, 같은 slogan structure / strategic claim / shortMeaning 반복을 거부하라.
- 각 후보 생성 전 내부적으로 What must this proposal prove? What belief shift should evaluator make? Strongest claim? Cover first-page fit? Expandable to space/content/media/operation? 을 검증하고 실패하면 버려라.
- 위 Concept Name Language Policy의 네이밍 시퀀스를 따른다: Concept Frame Synthesis → 강한 한국어 컨셉 시드 → (english_default면) 시드를 영어 conceptName으로 trans-create → koreanSubtitle=시드 의미 보존 → 한국어 oneLineSlogan. 영어 conceptName은 시드에서 trans-create한 타이틀이어야 하고 새로 만든 범용 영어 라벨/비즈니스 키워드/일반 명사가 아니다. 영어가 한국어 시드보다 약하거나 더 범용/추상적이면 거부하고 재작성한다. korean_primary면 한국어 시드가 conceptName이며 여전히 설명 문장/서술형 라벨이 아니어야 한다.
- main visible copy(conceptName, oneLineSlogan, shortMeaning, whyItFitsSelectedDirection, mainRisk)에 raw English internal terms(proof/evidence/proof burden/evaluator clarity/validation/source/score/signature proof idea)를 쓰지 말고 한국어 사용자 언어로 번역한다.
- 컨셉명은 선택한 전략 방향에만 맞아야 하고 다른 방향에는 어색해야 하며, 후보끼리 근접 중복이 아니어야 한다. validation boolean 블록은 출력하지 말라(구분성·금지어·중복 검증과 점수는 서버가 코드로 수행한다).
- 금지 예시명/이전 예시명을 그대로 출력하거나 변형하지 말라: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}.
- 현재 RFP/진단/brandProductIntelligence에 근거가 없는 다른 카테고리(에너지/음료/기술/공간/이벤트 등)의 어휘를 가져오면 실패다. 어떤 category word든 현재 RFP 증거에 실제로 있을 때만 사용한다.
- brandProductIntelligence.wordsToAvoid와 무관 카테고리 어휘를 쓰면 실패다. 서로 다른 RFP 카테고리에 모두 그대로 맞는 이름, Moment/Memory/Proof/Evidence/Field/Flow/Grid/Signature/Panorama/Insight 같은 범용어 중심 이름은 현재 RFP 강한 근거가 없으면 거부한다.
- 다음 형태는 컨셉명/슬로건의 주된 naming device로 쓰지 말라(현재 RFP에 맞게 구체적으로 변형된 경우만 예외): 가치 증명, 기억의 증명, 인식 전환, 경험 이해, 가치 체험, 실체화, 한눈에 보는 ___, ___ 중심, ___ 시그니처, ___ Core Experience, ___ Insight, ___ Panorama, ___ Signature, ___ Experience, ___ Journey, ___ Moment. 브랜드/클라이언트명 단독 + 일반 명사 조합도 거부한다.
- Final naming source lock: selectedStrategicDirection, confirmed diagnosis, current RFP summary만 네이밍 근거로 사용하라. proposal_patterns, previous proposal names, old clients/categories/wording은 사용하지 말라. hardcoded direction presets는 사용하지 말라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- single_brand_experience 또는 visitor_center_or_tour는 brand meaning, sensory cue, product value, process/확인 장면, visitor memory, transformation after visit에서 이름을 도출하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라. 이 유형에서는 최소 1개 후보가 브랜드 컬러·제품 본질(성분·효능·진실)·감각 단서·공정/증명 장면·방문 후 변화·기억 중 하나 이상의 브랜드/제품 세계 토큰을 반드시 담아야 한다(위 Brand/Theme Tone Anchor 기반). 공간·빛·기억·임팩트·설치만 말하고 브랜드/제품 세계·제품 진실·증명 장치를 무시한 범용 이름, 무관한 방문관에도 그대로 맞는 이름은 거부하고 재생성한다.
- multi_entity_pavilion만 shared pavilion frame, entity/domain relationship, system logic, capability 확인 장면, symbolic presence 기반 네이밍을 허용한다.`;

    const generate = (userPrompt: string) => createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user: userPrompt, timeoutMs: 18_000, maxRetries: 1 });

    const forbiddenCopyTerms = refBriefResult.brief?.forbiddenCopyTerms ?? [];
    // §3-5: generate only THIS small batch (requestedCount, default 1) so a single request is light and cannot time out.
    // The CLIENT drives the loop across requests to reach three valid candidates and shows per-candidate progress. We keep
    // a small bounded per-request retry (maxAttemptsPerCandidate) so a single rejected batch still usually yields a valid
    // candidate without a long request. No 3-candidate top-up here, no infinite loop — the client owns the total budget.
    type BuiltOption = ReturnType<typeof buildFinalOptions>['options'][number];
    const accepted: BuiltOption[] = [];
    const acceptedNorm = new Set<string>();
    const acceptedNames: string[] = [];
    let result: ConceptNameOptionsResult | undefined;
    const MAX_ATTEMPTS_PER_REQUEST = 2;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_REQUEST && accepted.length < requestedCount; attempt++) {
      const attemptBody = {
        ...body,
        recentNameOptions: [...(body.recentNameOptions ?? []), ...acceptedNames],
        existingNamesForSelectedDirection: [...(body.existingNamesForSelectedDirection ?? []), ...acceptedNames],
      };
      const avoidLine = acceptedNames.length ? `\n\n[이미 생성됨 — 반드시 회피하고 새 후보만 생성] ${acceptedNames.join(' / ')}` : '';
      const attemptUser = `${user}${attempt === 0 ? '' : STRICTER_RETRY_ADDENDUM}${avoidLine}`;
      const attemptResult = await generate(attemptUser);
      if (attempt === 0) result = attemptResult;
      const attemptBuilt = buildFinalOptions(attemptResult, attemptBody, currentRfpVocabularySet, forbiddenCopyTerms, semanticAnchor);
      for (const option of attemptBuilt.options) {
        const key = normalizeName(option.conceptName || '');
        if (!key || acceptedNorm.has(key)) continue;
        accepted.push(option);
        acceptedNorm.add(key);
        acceptedNames.push(option.conceptName || '');
        if (accepted.length >= requestedCount) break;
      }
    }
    // Return whatever valid candidates this light request produced (0..requestedCount). The client accumulates across
    // requests and surfaces the final "couldn't reach 3" error — the server never blocks on reaching the full count.
    const finalOptions = accepted.slice(0, requestedCount).map((option, index) => ({ ...option, id: `${body.selectedDirection.conceptId || 'direction'}-${body.candidateRole || 'name'}-${index + 1}` }));
    console.info('[concept-names:incremental]', { requestedCount, returned: finalOptions.length, role: body.candidateRole ?? null });
    return json({ ...successResponse({ ...(result ?? ({} as ConceptNameOptionsResult)), selectedDirectionId: body.selectedDirection.conceptId, options: finalOptions }), patternLearningSummary, winningReferenceBrief: refBriefResult.brief, brandProductSemanticAnchorSummary: semanticAnchor.summary, requestedCount, returnedCount: finalOptions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.';
    return json(errorResponse(WEAK_NAMING_ERROR, `reason=${classifyServerError(message)}; ${message}`), { status: 502 });
  }
}
