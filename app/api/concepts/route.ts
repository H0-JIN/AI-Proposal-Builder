import { NextResponse } from 'next/server';
import { conceptCandidatesJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ProjectInput, ProposalNarrative, RfpConceptType, MatrixType, BrandExperienceMatrixItem, RfpDiagnosis, BrandProductIntelligence } from '@/lib/types';
import type { ChunkCategory, DocumentChunk } from '@/lib/rag';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { ensureProposalNarrative, summarizeProposalNarrative } from '@/lib/proposalNarrative';
import { applyNonBlockingConceptNamingGuard, normalizeConceptCandidatesResult } from '@/lib/conceptNamingGuard';
import { buildRfpDifferentiationStrategy, summarizeDifferentiationStrategy } from '@/lib/rfpDifferentiation';
import { formatProposalPatternDiagnostics, type OutlineProposalPattern, type ProposalPatternRetrievalSummary } from '@/lib/proposalPatternOutline';
import { conceptPromptVersion } from '@/lib/conceptPromptVersion';
import { getActiveMatrix, sanitizeConceptContextByRfpType, matrixTypeForRfpConceptType } from '@/lib/conceptContextSanitizer';

const DEFAULT_CONCEPT_COUNT = 3;
const ALLOWED_DIRECTION_AXES = ['representative_position', 'audience_understanding', 'signature_scene', 'product_value_proof', 'process_trust', 'category_shift', 'system/ecosystem_proof', 'spatial_journey', 'brand_memory', 'operational_confidence', 'evaluator_clarity', 'emotional_affinity', 'technology_reality_proof'] as const;
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


type EvidenceRole = 'core' | 'detail' | 'structure' | 'reference';
type EntityBalanceStatus = 'balanced' | 'over-focused' | 'unknown';

interface BalancedEvidenceGroup {
  entity: string;
  category: string;
  role: EvidenceRole;
  items: string[];
}

interface SeparatedEvidenceLevels {
  proposalLevelEvidence: string[];
  entityLevelEvidence: string[];
  contentDetailEvidence: string[];
  referenceOnlyEvidence: string[];
  evidenceLevelRules: string[];
}

interface BalancedEvidenceSummary {
  status: EntityBalanceStatus;
  dominantEntity?: string;
  majorEntities: string[];
  coreEvidence: string[];
  detailEvidence: string[];
  groups: BalancedEvidenceGroup[];
  sourceRoleRules: string[];
}

const CORE_CONCEPT_CATEGORIES = new Set<ChunkCategory>(['projectObjective', 'projectPurpose', 'requiredDeliverables', 'scopeOfWork', 'evaluationCriteria', 'constraints', 'target', 'venue', 'performanceGoal', 'kpi', 'operationDirection']);
const DETAIL_CONCEPT_CATEGORIES = new Set<ChunkCategory>(['productFeature', 'designDirection', 'backgroundInsight', 'referenceOnly', 'existingAsset']);
const DETAIL_ENTITY_TERMS = /EO|optical|optic|optics|equipment|spec|lens|sensor|camera|product|제품|장비|광학|사양|스펙|조준경|시스템|이미지|reference|레퍼런스|참고/i;

const INTERNAL_AXIS_PATTERN = /\b(?:category_shift|audience_perception_change|representative_position|technology_reality_proof|product_value_proof|process_trust|ecosystem_proof|system\/ecosystem_proof|spatial_journey|brand_memory|operational_confidence|evaluator_clarity|emotional_affinity|signature_scene|audience_understanding)\b/gi;

function plannerFacingDirectionText(value = '') {
  return compactText(value.replace(INTERNAL_AXIS_PATTERN, (axis) => directionAxisLabel(axis)), 220);
}

const BASIC_DIRECTION_PATTERN = /요구\s*충족|요건\s*충족|범위\s*포괄|범위\s*커버|scope\s*coverage|fulfill(?:ing)?\s*requirements|cover(?:ing)?\s*(?:all\s*)?scope|정보\s*전달|information\s*delivery|communicat(?:e|ing)\s*information|안정\s*운영|stable\s*operation|balanced?\s*planning|균형\s*구성|기획과\s*운영|콘텐츠\s*정리|organizing\s*content|basic\s*feasibility|visitor\s*understanding|브랜드\s*커뮤니케이션|통합\s*관리/i;
const RFP_FACT_DIRECTION_PATTERN = /(?:20\d{2}년|\d{1,2}월|\d{1,2}일|\d{1,2}\s*~\s*\d{1,2}|KINTEX|킨텍스|COEX|코엑스|BEXCO|벡스코|\d[\d,]*(?:\.\d+)?\s*(?:㎡|m2|m²|평)|\d+\s*%|콘텐츠\s*\d+\s*%|콘텐츠\s*개발|운영\s*구성|전시\s*기간|B2B\s*대상|부스|booth|venue|schedule|deliverable|KPI|평가\s*기준|산출물)/i;

function directionAxisLabel(axis?: string) {
  const labels: Record<string, string> = {
    technology_reality_proof: '기술 현실화 설득', representative_position: '대표 포지션 선언', audience_understanding: '관람 이해 전환', product_value_proof: '제품 가치 체감', 'system/ecosystem_proof': '생태계 작동 확인', ecosystem_proof: '생태계 작동 확인', category_shift: '카테고리 전환 설득', signature_scene: '시그니처 장면 각인', spatial_journey: '공간 여정 설계', brand_memory: '브랜드 기억 형성', process_trust: '과정 신뢰 형성', operational_confidence: '운영 확신 설계', evaluator_clarity: '평가 명확성 설계', emotional_affinity: '정서적 친밀감 형성',
  };
  return labels[axis || ''] || '전략 선택 방향';
}

// Every abstract axis-translation phrase directionAxisLabel() can emit, plus weak generic labels.
// A user-facing strategicDirectionLabel must never equal OR contain one of these.
const AXIS_TRANSLATION_LABELS = [
  '기술 현실화 설득', '대표 포지션 선언', '관람 이해 전환', '제품 가치 체감', '생태계 작동 확인', '카테고리 전환 설득',
  '시그니처 장면 각인', '공간 여정 설계', '브랜드 기억 형성', '과정 신뢰 형성', '운영 확신 설계', '평가 명확성 설계',
  '정서적 친밀감 형성', '전략 선택 방향', '카테고리 전환 증명', '관람 인식 전환', '대표 장면 각인', '클라이언트 고유성',
  '평가 확신 설계', '전략 방향', '브랜드 경험 방향', 'RFP 맞춤 방향',
];

function isAxisTranslationLabel(label: string): boolean {
  const value = (label || '').trim();
  if (!value) return false;
  return AXIS_TRANSLATION_LABELS.some((phrase) => value === phrase || value.includes(phrase));
}

// The generic "[subject] + 인식 전환 / 경험 이해 / 가치 체험 / 설득 / 이해 / 체감" template smell.
// Matched ANYWHERE (not just end-of-string) so a trailing word can't smuggle it past, e.g. "견학룸 인식 전환 경험".
const WEAK_DIRECTION_LABEL_PATTERN = /인식\s*전환|경험\s*이해|가치\s*체험|가치\s*체감|(?:^|\s)(?:이해|체감|설득)(?=\s|$)/;

// A user-facing label is generic if it is an axis translation, follows the weak subject+axis template,
// or uses a venue/content-format word as its subject (the first token).
function isGenericDirectionLabel(label: string): boolean {
  const value = (label || '').trim();
  if (!value) return true;
  if (isAxisTranslationLabel(value) || WEAK_DIRECTION_LABEL_PATTERN.test(value)) return true;
  const firstToken = value.split(/[\s/·|]+/).filter(Boolean)[0] || '';
  return CONTEXT_NOUN_BLOCKLIST.test(firstToken);
}

// Discovery axis keys and legacy axis terms must collapse to a single canonical key from ALLOWED_DIRECTION_AXES.
const DIRECTION_AXIS_CANONICAL_MAP: Record<string, (typeof ALLOWED_DIRECTION_AXES)[number]> = {
  category_shift: 'category_shift',
  audience_perception_change: 'audience_understanding',
  audience_understanding: 'audience_understanding',
  required_proof: 'product_value_proof',
  product_value_proof: 'product_value_proof',
  client_unique_position: 'representative_position',
  representative_position: 'representative_position',
  signature_experience: 'signature_scene',
  signature_scene: 'signature_scene',
  evaluator_clarity: 'evaluator_clarity',
  ecosystem_system_proof: 'system/ecosystem_proof',
  ecosystem_proof: 'system/ecosystem_proof',
  'system/ecosystem_proof': 'system/ecosystem_proof',
  operational_confidence_without_multi_entity_logic: 'operational_confidence',
  operational_confidence: 'operational_confidence',
  process_trust: 'process_trust',
  spatial_journey: 'spatial_journey',
  brand_memory: 'brand_memory',
  emotional_affinity: 'emotional_affinity',
  technology_reality_proof: 'technology_reality_proof',
};

// Collapse any axis input (composite "key: evidence" string or legacy term) to a canonical allowed key.
function canonicalizeDirectionAxis(axis?: string, fallbackIndex = 0): (typeof ALLOWED_DIRECTION_AXES)[number] {
  const key = (axis || '').split(':')[0].trim().toLowerCase().replace(/\s+/g, '_');
  return DIRECTION_AXIS_CANONICAL_MAP[key] || ALLOWED_DIRECTION_AXES[Math.abs(fallbackIndex) % ALLOWED_DIRECTION_AXES.length];
}

// User-facing direction title = current-RFP context noun + axis intent, so the card shows a planner-readable
// phrase (e.g. "브랜드 인식 전환", "수소 인식 전환") instead of the internal axis label ("카테고리 전환 설득").
// Strong, structurally varied strategic nominalizations. NEVER the weak "[subject] + 인식 전환/경험 이해/가치 체험"
// triad — those are blocked by isWeakDirectionLabel. The model's own label is always preferred over these fallbacks.
const AXIS_LABEL_TEMPLATES: Record<string, (ctx: string) => string> = {
  category_shift: (c) => `${c} 실체화`,
  audience_understanding: (c) => `한눈에 보는 ${c}`,
  representative_position: (c) => `${c} 대표성 각인`,
  product_value_proof: (c) => `${c} 가치 증명`,
  process_trust: (c) => `${c} 신뢰 체험화`,
  signature_scene: (c) => `${c} 대표 장면`,
  'system/ecosystem_proof': (c) => `통합 ${c} 생태계`,
  spatial_journey: (c) => `${c}의 여정`,
  brand_memory: (c) => `${c} 기억화`,
  operational_confidence: (c) => `${c} 운영 신뢰`,
  evaluator_clarity: (c) => `${c} 핵심 압축`,
  emotional_affinity: (c) => `${c} 정서 공감`,
  technology_reality_proof: (c) => `${c} 현재화`,
};

function contextualDirectionLabel(canonicalAxis: string, contextNoun: string): string {
  const ctx = (contextNoun || '브랜드').trim() || '브랜드';
  const template = AXIS_LABEL_TEMPLATES[canonicalAxis];
  return template ? template(ctx) : `${ctx} 전략 방향`;
}

// Content-format / deliverable / process words must never become the subject of a strategy label.
// "Hero" is a content format (a hero zone/scene), not a strategic direction.
const CONTEXT_NOUN_BLOCKLIST = /^(hero|히어로|콘텐츠|콘텐트|content|영상|video|디자인|design|그래픽|graphic|미디어|media|패널|panel|사이니지|signage|키오스크|kiosk|부스|booth|배너|banner|리플렛|책자|카탈로그|catalog|모형|목업|mockup|기획|운영|operation|제작|구축|설치|시공|견학룸|견학|홍보관|체험관|전시관|쇼룸|showroom|파빌리온|pavilion|전시|exhibition|공간|space|룸|room|존|zone|관|hall)$/i;

// A short, clean subject noun from the current RFP to seed user-facing labels (no facts/figures/content-formats).
function directionContextNoun(analysis: AnalysisResult): string {
  const seed = fallbackNameSeeds(analysis).find((token) => token.length >= 2 && token.length <= 8 && !isRfpFactDirectionText(token) && !CONTEXT_NOUN_BLOCKLIST.test(token));
  return seed || '브랜드';
}

// Axis intent fragments used to compose grounded, per-card direction copy (repair/fallback only).
const AXIS_BET_INTENT: Record<string, string> = {
  category_shift: '미래 이미지가 아니라 지금 작동하는 실체로 보여주는',
  representative_position: '이 분야를 대표하는 주체임을 전시 첫 장면부터 각인시키는',
  audience_understanding: '복잡한 내용을 하나의 흐름으로 압축해 관람객이 단계적으로 이해하게 만드는',
  product_value_proof: '핵심 가치를 관람객이 직접 체감하도록 증명하는',
  process_trust: '과정과 근거를 직접 확인시켜 신뢰를 만드는',
  signature_scene: '하나의 대표 장면으로 기억되게 만드는',
  'system/ecosystem_proof': '전체 시스템이 실제로 연결되어 작동함을 한눈에 보여주는',
  spatial_journey: '공간 동선을 따라 자연스럽게 설득되도록 설계하는',
  brand_memory: '방문 후에도 남는 대표 인상을 만드는',
  operational_confidence: '현장 운영과 실행 가능성에 확신을 주는',
  evaluator_clarity: '심사자가 핵심을 즉시 이해하도록 명확하게 보여주는',
  emotional_affinity: '관람객의 정서적 공감을 끌어내는',
  technology_reality_proof: '기술이 지금 현실에서 작동함을 증명하는',
};
const AXIS_CRITERION_INTENT: Record<string, (c: string) => string> = {
  category_shift: (c) => `${c}에 대한 인식을 근본적으로 바꾸는 것`,
  representative_position: (c) => `${c}의 대표성과 리더십을 가장 강하게 보여주는 것`,
  audience_understanding: (c) => `다양한 관람객이 ${c}를 한 번에 이해하도록 만드는 것`,
  product_value_proof: (c) => `${c}의 가치를 관람객이 직접 체감하게 하는 것`,
  process_trust: (c) => `${c}의 과정과 근거로 신뢰를 얻는 것`,
  signature_scene: (c) => `${c}이 하나의 대표 장면으로 기억되게 만드는 것`,
  'system/ecosystem_proof': (c) => `${c} 전체가 하나의 시스템으로 작동함을 보여주는 것`,
  spatial_journey: (c) => `${c} 공간 경험과 동선으로 설득하는 것`,
  brand_memory: (c) => `방문 후 ${c} 인상이 오래 남게 만드는 것`,
  operational_confidence: (c) => `${c} 현장 운영의 안정성과 실행 가능성을 입증하는 것`,
  evaluator_clarity: (c) => `심사자가 ${c}의 핵심을 빠르게 파악하게 만드는 것`,
  emotional_affinity: (c) => `${c}에 대한 관람객의 정서적 공감을 끌어내는 것`,
  technology_reality_proof: (c) => `${c} 기술의 현실성과 적용 가능성을 증명하는 것`,
};
const AXIS_SCENE_INTENT: Record<string, (c: string) => string> = {
  category_shift: (c) => `${c}을(를) 미래가 아닌 현재로 전환해 보여주는 대형 전환 연출`,
  representative_position: (c) => `${c} 리더십을 선언하는 압도적 메인 히어로 장면`,
  audience_understanding: (c) => `관람객 유형별로 다른 깊이의 정보를 선택해 보는 계층형 ${c} 맵`,
  product_value_proof: (c) => `${c}의 가치를 직접 체험하는 인터랙티브 존`,
  process_trust: (c) => `${c}의 과정을 생산-저장-운송-활용처럼 단계별로 확인하는 프로세스 라인`,
  signature_scene: (c) => `전시 전체를 압축하는 단 하나의 ${c} 시그니처 장면`,
  'system/ecosystem_proof': (c) => `${c}이(가) 하나의 도시 시스템처럼 연결되는 대형 미디어 월`,
  spatial_journey: (c) => `도입-핵심-마무리 동선으로 이어지는 ${c} 공간 여정 연출`,
  brand_memory: (c) => `방문 후 한 문장으로 남는 ${c} 대표 이미지 월`,
  operational_confidence: (c) => `운영 동선과 안전을 한눈에 보여주는 ${c} 통합 운영 맵`,
  evaluator_clarity: (c) => `${c} 핵심 메시지를 한 화면에 정리한 요약 장면`,
  emotional_affinity: (c) => `관람객의 감정을 끌어내는 ${c} 몰입형 연출`,
  technology_reality_proof: (c) => `${c} 기술이 실제 작동하는 모습을 보여주는 라이브 데모`,
};

function directionSubjectPhrase(contextNoun: string, rfpEvidence: string): string {
  const ctx = (contextNoun || '브랜드').trim() || '브랜드';
  const evidence = compactText(rfpEvidence || '', 36).replace(/[.…]+$/, '').trim();
  return evidence && evidence.length >= 4 && evidence.length <= 24 && !isRfpFactDirectionText(evidence) ? evidence : ctx;
}

// "어떻게 설득하는가": a concrete one-line strategic bet (not the axis-label template).
function directionStrategicBet(canonicalAxis: string, contextNoun: string, rfpEvidence: string): string {
  const subject = directionSubjectPhrase(contextNoun, rfpEvidence);
  const intent = AXIS_BET_INTENT[canonicalAxis] || '핵심 가치를 분명하게 보여주는';
  return compactText(`${subject} 중심으로 ${intent} 방향입니다.`, 170);
}

// "선택 기준": an actionable planner decision criterion.
function directionSelectionCriterion(canonicalAxis: string, contextNoun: string): string {
  const ctx = (contextNoun || '브랜드').trim() || '브랜드';
  const builder = AXIS_CRITERION_INTENT[canonicalAxis];
  const intent = builder ? builder(ctx) : `${ctx}의 핵심 가치를 분명히 보여주는 것`;
  return compactText(`${intent}이 가장 중요할 때 선택합니다.`, 170);
}

// "대표 설득 장면": a concrete spatial/content/media scene.
function directionRepresentativeScene(canonicalAxis: string, contextNoun: string): string {
  const ctx = (contextNoun || '브랜드').trim() || '브랜드';
  const builder = AXIS_SCENE_INTENT[canonicalAxis];
  return compactText(builder ? builder(ctx) : `${ctx}의 핵심을 한눈에 보여주는 대표 장면`, 140);
}

function isRfpFactDirectionText(text = '') {
  const compacted = text.trim();
  if (!compacted) return true;
  return RFP_FACT_DIRECTION_PATTERN.test(compacted) || /^.{0,8}(?:개발|운영|구성|기간|대상|부스|평가|산출).{0,8}$/.test(compacted);
}

// A user-facing strategic direction label must be a short strategic phrase, not an RFP fact, raw axis term, or long summary.
function isValidDirectionLabel(label: string, conceptType: RfpConceptType): boolean {
  const value = (label || '').trim();
  if (!value) return false;
  if (isRfpFactDirectionText(value)) return false;
  if (BASIC_DIRECTION_PATTERN.test(value)) return false;
  INTERNAL_AXIS_PATTERN.lastIndex = 0;
  if (INTERNAL_AXIS_PATTERN.test(value)) return false;
  if (conceptType !== 'multi_entity_pavilion' && MULTI_ENTITY_LEAKAGE_PATTERN.test(value)) return false;
  if (isGenericDirectionLabel(value)) return false;
  const words = value.split(/[\s/·|]+/).filter(Boolean);
  return words.length >= 1 && words.length <= 8;
}

function buildDirectionQualityValidation(concept: ConceptCandidate, planItem: StrategicDirectionPlanItem) {
  const text = [
    concept.strategicDirectionLabel,
    concept.whatThisDirectionEmphasizes,
    concept.whenToChooseThisDirection,
    concept.winningThesisUse?.winningClaim,
    concept.conceptLeap?.conceptLeap,
    concept.signatureProofIdea?.whyThisProvesTheConcept,
    concept.mainStrength,
  ].filter(Boolean).join(' ');
  const factLikeLabel = isRfpFactDirectionText(concept.strategicDirectionLabel || '');
  const isOnlyBasicRequirement = BASIC_DIRECTION_PATTERN.test(text) || factLikeLabel;
  const addressesCoreWinningCondition = Boolean(concept.winningThesisUse?.winningClaim || planItem.emphasis);
  const addressesStrategicTension = Boolean(concept.winningThesisUse?.audiencePerceptionGap || concept.winningThesisUse?.contextShift || concept.conceptLeap?.fromStatement || planItem.directionAxis);
  const addressesProofBurden = Boolean(concept.winningThesisUse?.whatMustBeProven || concept.signatureProofIdea?.whyThisProvesTheConcept || concept.requiredProofElementsAddressed?.length || planItem.rfpEvidence);
  const hasDistinctPointOfView = Boolean(concept.conceptLeap?.conceptLeap || concept.signatureProofIdea?.whyThisIsNotGeneric || planItem.directionAxis) && !isOnlyBasicRequirement;
  const couldFitAnyRfp = !concept.directionSource?.rfpEvidence && !(concept.rfpGrounding?.length) || /^(전략 방향|브랜드 경험 방향|정보 전달|안정 운영|요구 충족|균형 구성|통합 관리|콘텐츠 정리)$/i.test((concept.strategicDirectionLabel || '').trim());
  const hasRepresentativePersuasionScene = Boolean(concept.signatureProofIdea?.signatureScene || concept.signatureProofIdea?.signatureContent || concept.signatureProofIdea?.whyThisProvesTheConcept);
  const directionAxisIsValid = Boolean((concept.directionAxis || planItem.directionAxis) && (ALLOWED_DIRECTION_AXES as readonly string[]).includes((concept.directionAxis || planItem.directionAxis) as typeof ALLOWED_DIRECTION_AXES[number]));
  const isStrategicBet = !isOnlyBasicRequirement && addressesCoreWinningCondition && addressesProofBurden && hasDistinctPointOfView && !couldFitAnyRfp && hasRepresentativePersuasionScene && directionAxisIsValid;
  return {
    isStrategicBet,
    isOnlyBasicRequirement,
    addressesCoreWinningCondition,
    addressesStrategicTension,
    addressesProofBurden,
    hasDistinctPointOfView,
    couldFitAnyRfp,
    isStrategicChoice: isStrategicBet,
    notRfpFactSummary: !factLikeLabel,
    notScheduleVenueScaleFact: !factLikeLabel,
    notRequirementList: !isOnlyBasicRequirement,
    directionAxisIsValid,
    hasRepresentativePersuasionScene,
    hasDistinctWinningLogic: hasDistinctPointOfView,
    canGenerateUniqueConceptNames: isStrategicBet,
    validationReason: isStrategicBet
      ? '현재 RFP의 winning condition과 proof burden을 해결하는 선택지로 검증됨.'
      : '기본 수행조건/범용 방향으로 감지되어 confirmed diagnosis 기반 전략적 베팅으로 수리 필요.',
  };
}

function repairBasicStrategicDirection(concept: ConceptCandidate, planItem: StrategicDirectionPlanItem): ConceptCandidate {
  const repaired = {
    ...concept,
    strategicDirectionLabel: isValidDirectionLabel(concept.strategicDirectionLabel || '', planItem.rfpConceptType) ? (concept.strategicDirectionLabel || '').trim() : planItem.label,
    strategicDirectionType: planItem.type,
    directionAxis: planItem.directionAxis || planItem.type,
    whatThisDirectionEmphasizes: planItem.emphasis,
    whenToChooseThisDirection: planItem.chooseWhen,
    winningThesisUse: { ...(concept.winningThesisUse ?? {}), winningClaim: concept.winningThesisUse?.winningClaim || compactText(`${planItem.label}: ${planItem.rfpEvidence}`, 150), whatMustBeProven: concept.winningThesisUse?.whatMustBeProven || planItem.rfpEvidence } as ConceptCandidate['winningThesisUse'],
    conceptLeap: { ...(concept.conceptLeap ?? {}), conceptLeap: concept.conceptLeap?.conceptLeap || `${planItem.label} 관점에서 ${compactText(planItem.rfpEvidence, 70)}을(를) 평가자가 믿을 수 있는 대표 장면과 증거로 전환합니다.`, corePromise: concept.conceptLeap?.corePromise || planItem.emphasis } as ConceptCandidate['conceptLeap'],
    signatureProofIdea: { ...(concept.signatureProofIdea ?? {}), whyThisProvesTheConcept: concept.signatureProofIdea?.whyThisProvesTheConcept || `${planItem.rfpEvidence}를 근거로 선택 위험을 낮추는 대표 증명 장면을 제시합니다.`, whyThisIsNotGeneric: concept.signatureProofIdea?.whyThisIsNotGeneric || 'confirmed RFP-only diagnosis의 winning condition, tension, proof burden에서 도출한 방향이므로 범용 수행조건이 아닙니다.' } as ConceptCandidate['signatureProofIdea'],
    proposalCoreConceptName: isRfpFactDirectionText(planItem.label) ? directionAxisLabel(planItem.directionAxis || planItem.type) : planItem.label,
    conceptName: isRfpFactDirectionText(planItem.label) ? directionAxisLabel(planItem.directionAxis || planItem.type) : planItem.label,
    mainStrength: planItem.emphasis,
    mainRisk: concept.mainRisk || '전략적 주장이 선명한 만큼 후속 outline에서 실행 세부 증거를 충분히 배치해야 합니다.',
  };
  return { ...repaired, strategicDirectionQualityValidation: buildDirectionQualityValidation(repaired, planItem) };
}

function inferEvidenceRoleFromCategory(category?: ChunkCategory): EvidenceRole {
  if (!category) return 'core';
  if (category === 'referenceOnly' || category === 'existingAsset' || category === 'designDirection' || category === 'backgroundInsight') return 'reference';
  if (DETAIL_CONCEPT_CATEGORIES.has(category)) return 'detail';
  if (CORE_CONCEPT_CATEGORIES.has(category)) return 'core';
  return 'core';
}

function entityTokensFromText(text: string, entities: string[]) {
  const lower = text.toLowerCase();
  return entities.filter((entity) => entity && lower.includes(entity.toLowerCase()));
}

function buildBalancedEvidenceSummary(params: { analysis: AnalysisResult; differentiationStrategy: ReturnType<typeof buildRfpDifferentiationStrategy>; documentChunks: DocumentChunk[]; proposalNarrative: ProposalNarrative }): BalancedEvidenceSummary {
  const { analysis, differentiationStrategy, documentChunks, proposalNarrative } = params;
  const majorEntities = differentiationStrategy.entityDifferentiationMatrix.map((item) => item.entityName).filter(Boolean).slice(0, 8);
  const groups = new Map<string, BalancedEvidenceGroup>();
  const add = (entity: string, category: string, role: EvidenceRole, text?: string, cap = 4) => {
    const cleanText = compactText(text || '', 220);
    if (!entity || !cleanText || /현재 RFP 근거 없음/.test(cleanText)) return;
    const key = `${entity}::${category}::${role}`;
    const existing = groups.get(key) ?? { entity, category, role, items: [] };
    if (existing.items.length < cap && !existing.items.includes(cleanText)) existing.items.push(cleanText);
    groups.set(key, existing);
  };

  for (const item of differentiationStrategy.entityDifferentiationMatrix) {
    add(item.entityName, item.entityType || 'entity', 'core', item.roleInProject || item.sourceEvidence, 3);
    add(item.entityName, 'differentiation', 'core', [item.distinctMessage, item.audienceTakeaway, item.proofPoint].filter(Boolean).join(' · '), 3);
    add(item.entityName, 'content-detail', 'detail', item.keyOffering || item.experienceMechanism, 2);
  }

  const globalCore = [
    analysis.projectOverview,
    analysis.clientChallenge,
    proposalNarrative.proposalThesis,
    proposalNarrative.strategicOpportunity,
    analysis.targetInfo,
    ...(analysis.requiredDeliverables ?? []),
    ...(analysis.requiredItems ?? []),
    ...(analysis.requiredScope ?? []),
    ...(analysis.scopeOfWork ?? []),
    ...(analysis.evaluationCriteria ?? []),
    ...(analysis.constraints ?? []),
  ];
  globalCore.forEach((item) => add('RFP-wide', 'rfp-core', 'core', item, 8));

  for (const chunk of documentChunks) {
    if (chunk.documentType && chunk.documentType !== 'rfp') continue;
    const categories = chunk.categories?.length ? chunk.categories : [chunk.category];
    const role = categories.some((category) => inferEvidenceRoleFromCategory(category) === 'reference') ? 'reference' : categories.some((category) => inferEvidenceRoleFromCategory(category) === 'detail') ? 'detail' : 'core';
    if (role !== 'core') continue;
    const matched = entityTokensFromText(`${chunk.sectionTitle ?? ''} ${chunk.chunkText}`, majorEntities);
    const targets = matched.length ? matched : ['RFP-wide'];
    targets.slice(0, 3).forEach((entity) => add(entity, categories[0] || 'chunk', role, chunk.chunkText, 2));
  }

  const evidenceGroups = Array.from(groups.values()).filter((group) => group.items.length);
  const perEntityCounts = majorEntities.map((entity) => ({ entity, count: evidenceGroups.filter((group) => group.entity === entity && group.role === 'core').reduce((sum, group) => sum + group.items.length, 0) }));
  const max = perEntityCounts.reduce((acc, item) => Math.max(acc, item.count), 0);
  const min = perEntityCounts.reduce((acc, item) => Math.min(acc, item.count || 0), max || 0);
  const dominant = perEntityCounts.find((item) => item.count === max && max >= Math.max(3, min * 2 + 2));
  return {
    status: majorEntities.length < 2 ? 'unknown' : dominant ? 'over-focused' : 'balanced',
    dominantEntity: dominant?.entity,
    majorEntities,
    coreEvidence: evidenceGroups.filter((group) => group.role === 'core').flatMap((group) => group.items.slice(0, 3)).slice(0, 24),
    detailEvidence: evidenceGroups.filter((group) => group.role !== 'core').flatMap((group) => group.items.slice(0, 1)).slice(0, 10),
    groups: evidenceGroups.slice(0, 24),
    sourceRoleRules: [
      'rfp=current RFP evidence only for concept naming',
      'proposal/proposal_patterns=structure pattern only; never naming source',
      'reference=case insight only; never core concept naming',
      'memo=use only when explicitly relevant to current RFP',
      'referenceOnly/product specs/equipment lists are detail evidence, not core naming evidence',
    ],
  };
}


function buildSeparatedEvidenceLevels(params: { analysis: AnalysisResult; differentiationStrategy: ReturnType<typeof buildRfpDifferentiationStrategy>; documentChunks: DocumentChunk[]; proposalNarrative: ProposalNarrative }): SeparatedEvidenceLevels {
  const { analysis, differentiationStrategy, documentChunks, proposalNarrative } = params;
  const proposalLevelEvidence = compactList([
    analysis.projectOverview,
    analysis.clientChallenge,
    analysis.targetInfo,
    analysis.spatialCondition,
    analysis.contentCondition,
    analysis.operationCondition,
    proposalNarrative.proposalThesis,
    proposalNarrative.strategicOpportunity,
    proposalNarrative.differentiationPrinciple,
    proposalNarrative.unifyingFrame,
    ...(analysis.requiredDeliverables ?? []),
    ...(analysis.requiredItems ?? []),
    ...(analysis.requiredScope ?? []),
    ...(analysis.scopeOfWork ?? []),
    ...(analysis.evaluationCriteria ?? []),
    ...(analysis.constraints ?? []),
    ...(analysis.kpiObjectives ?? []),
    ...(analysis.kpiScheduleConstraints ?? []),
  ].filter((item): item is string => Boolean(item)), 28, 220);

  const entityLevelEvidence = compactList(differentiationStrategy.entityDifferentiationMatrix.flatMap((item) => [
    [item.entityName, item.entityType, item.roleInProject, item.distinctMessage, item.audienceTakeaway, item.proofPoint, item.relationshipToOtherEntities].filter(Boolean).join(' · '),
  ]), 16, 240);

  const contentDetailEvidence = compactList([
    ...(analysis.productInfo ?? []),
    ...(analysis.productFeatures ?? []).flatMap((feature) => [feature.product, feature.keyFeature, feature.valueProposition]),
    ...differentiationStrategy.entityDifferentiationMatrix.flatMap((item) => [item.keyOffering, item.spatialOrContentRole, item.experienceMechanism, item.visualOrToneCue]),
    ...documentChunks
      .filter((chunk) => chunk.documentType !== 'reference')
      .filter((chunk) => chunk.category === 'productFeature' || chunk.categories?.some((category) => ['productFeature', 'designDirection', 'backgroundInsight', 'existingAsset'].includes(category)))
      .flatMap((chunk) => [chunk.sectionTitle, chunk.chunkText]),
  ].filter((item): item is string => Boolean(item)), 24, 180);

  const referenceOnlyEvidence = compactList([
    ...(analysis.referenceOnly ?? []),
    ...documentChunks
      .filter((chunk) => chunk.documentType === 'reference' || chunk.category === 'referenceOnly' || chunk.categories?.includes('referenceOnly'))
      .flatMap((chunk) => [chunk.sectionTitle, chunk.chunkText]),
  ].filter((item): item is string => Boolean(item)), 18, 180);

  return {
    proposalLevelEvidence,
    entityLevelEvidence,
    contentDetailEvidence,
    referenceOnlyEvidence,
    evidenceLevelRules: [
      'proposalCoreConceptName, slogan, definition, winningThesis, and conceptLeap may use proposalLevelEvidence only.',
      'entityLevelEvidence is for entityDifferentiationMatrix, entity role explanation, direction comparison, and proof by entity only.',
      'contentDetailEvidence is for content detail slides, signature proof examples, content/media implications, and execution keywords only.',
      'referenceOnlyEvidence is for case insight, reference notes, and proof inspiration only; never for core concept naming.',
    ],
  };
}

function repairEntityBalance(result: ConceptCandidatesResult, summary: BalancedEvidenceSummary): ConceptCandidatesResult {
  if (result.matrixType && result.matrixType !== 'entityDifferentiationMatrix') return result;
  if (summary.majorEntities.length < 2) return result;
  const normalizedEntities = summary.majorEntities.map((entity) => ({ entity, lc: entity.toLowerCase() }));
  const repairedConcepts = result.concepts.map((concept) => {
    const namingText = [concept.proposalCoreConceptName, concept.conceptName, concept.conceptTitle, concept.signatureProofIdea?.signatureScene, concept.signatureProofIdea?.signatureContent, concept.signatureProofIdea?.whyThisProvesTheConcept].filter(Boolean).join(' ');
    const lc = namingText.toLowerCase();
    const coveredEntities = normalizedEntities.filter(({ lc: entityLc }) => lc.includes(entityLc)).map(({ entity }) => entity);
    const fallbackCovered = coveredEntities.length ? coveredEntities : summary.majorEntities;
    const detailDominated = DETAIL_ENTITY_TERMS.test(namingText) && coveredEntities.length <= 1;
    const dominantEntity = coveredEntities.length === 1 ? coveredEntities[0] : detailDominated ? (summary.dominantEntity || coveredEntities[0]) : undefined;
    const overFocused = Boolean(dominantEntity && fallbackCovered.length < summary.majorEntities.length) || detailDominated;
    if (!overFocused) {
      return { ...concept, coveredEntities: fallbackCovered, missingEntities: summary.majorEntities.filter((entity) => !fallbackCovered.includes(entity)), dominantEntity, entityBalanceStatus: 'balanced' as const };
    }
    const repairedName = concept.proposalCoreConceptName && !DETAIL_ENTITY_TERMS.test(concept.proposalCoreConceptName)
      ? concept.proposalCoreConceptName
      : `${concept.strategicDirectionLabel || '통합'} Field`;
    const proof = concept.signatureProofIdea ?? { signatureScene: '', signatureContent: '', signatureSpatialMove: '', signatureMediaOrInteraction: '', whyThisProvesTheConcept: '', whyThisIsNotGeneric: '' };
    return {
      ...concept,
      proposalCoreConceptName: repairedName,
      repairedProposalCoreConceptName: repairedName,
      conceptName: repairedName,
      conceptTitle: repairedName,
      proposalCoreConceptDefinition: `${concept.proposalCoreConceptDefinition} 주요 entity/category를 하나의 RFP-level operating frame으로 묶고, 특정 제품 상세가 아니라 전체 제안 범위의 역할 차이를 증명하도록 보정했습니다.`,
      signatureProofIdea: {
        ...proof,
        signatureScene: proof.signatureScene && !DETAIL_ENTITY_TERMS.test(proof.signatureScene) ? proof.signatureScene : 'Shared hero system map connecting all major entities/categories',
        signatureContent: proof.signatureContent && !DETAIL_ENTITY_TERMS.test(proof.signatureContent) ? proof.signatureContent : `전체 범위(${summary.majorEntities.join(' / ')})의 역할·관객 가치·증거를 한 화면에서 보여주는 통합 운영 필드`,
        whyThisProvesTheConcept: `단일 제품이나 장비 상세가 아니라 ${summary.majorEntities.join(' / ')}가 각각 어떤 역할로 제안 명제를 증명하는지 보여주므로 전체 제안 스코프를 대표합니다.`,
      },
      coveredEntities: summary.majorEntities,
      missingEntities: [],
      dominantEntity,
      entityBalanceStatus: 'balanced' as const,
    };
  });
  return { ...result, concepts: repairedConcepts, evidenceBalance: { status: summary.status, dominantEntity: summary.dominantEntity, coveredEntities: summary.majorEntities } };
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
  rfpConceptType: RfpConceptType;
  secondaryRfpConceptTypes: RfpConceptType[];
  label: string;
  emphasis: string;
  chooseWhen: string;
  source: string;
  rfpEvidence: string;
  patternLearning: string;
  lostAvoidance: string;
  rfpTypeLensUsed: string;
  rfpEvidenceUsed: string;
  proposalLearningUsed: string;
  lostPatternAvoided: string;
  discoveryBrief?: StrategicDirectionDiscoveryBrief;
  directionAxis?: string;
  representativeScene?: string;
  contextNoun?: string;
}

interface StrategicDirectionDiscoveryBrief {
  currentProjectCategory: string;
  coreRfpChallenge: string;
  hiddenNeed: string;
  evaluatorDecisionRisk: string;
  clientUniquePosition: string;
  categoryShift: string;
  audiencePerceptionGap: string;
  whatMustBeProven: string;
  strongestStrategicTension: string;
  possibleDirectionAxes: string[];
}

const MULTI_ENTITY_LEAKAGE_PATTERN = /국가|국가관|국격|그룹|연합|공동관|계열사|대기업\s*집단|하나의\s*큰\s*존재감|통합된\s*관람\s*이해|통합\s*아이덴티티|통합\s*\+?\s*역할\s*차별화|역할\s*(?:구분|차별화)|상징적\s*리더십|공동\s*시너지|연합\s*시너지|national\s*pavilion|joint\s*pavilion|alliance|coalition|group\s*presence|unified\s*identity|role\s*differentiation|symbolic\s*leadership|entity\s*role|multi[-\s]*entity|consortium|Entity\s*Differentiation\s*Matrix|entity\s*role\s*matrix/i;
const VISITOR_BRAND_OVERRIDE_PATTERN = /견학룸|견학|브랜드\s*체험|브랜드\s*공간|공장\s*견학|방문객\s*체험|제품\s*이해|제조\s*공정|브랜드\s*스토리|체험룸|쇼룸|투어|visitor\s*room|brand\s*tour|brand\s*experience(?:\s*space)?|factory\s*tour|visitor\s*center|showroom/i;
const BLOCKED_MULTI_ENTITY_TERMS = ['국가', '국가관', '그룹', '연합', '공동관', '계열사', '대기업 집단', '하나의 큰 존재감', '통합된 관람 이해', '통합 아이덴티티', '통합+역할 차별화', '역할 차별화', '역할 구분', '상징적 리더십', '공동 시너지', '연합 시너지', 'national pavilion', 'joint pavilion', 'alliance', 'coalition', 'group presence', 'unified identity', 'role differentiation', 'symbolic leadership', 'entity role', 'multi-entity', 'consortium'];

function selectedDirectionLensSet(plan: StrategicDirectionPlanItem[]) {
  return plan.map((item) => item.directionAxis || item.label);
}

function summarizeActiveMatrix(matrixType: MatrixType, params: { entityCount: number; brandExperienceMatrix: BrandExperienceMatrixItem[] }) {
  if (matrixType === 'entityDifferentiationMatrix') return `Entity Differentiation Matrix active (${params.entityCount} rows)`;
  if (matrixType === 'brandExperienceMatrix') return `Brand Experience Matrix active (${params.brandExperienceMatrix.length} rows): ${params.brandExperienceMatrix.map((item) => item.experienceStage).join(' / ')}`;
  if (matrixType === 'productExperienceMatrix') return 'Product Experience Matrix active (deterministic gate; no generated rows in this flow)';
  if (matrixType === 'operationTrustMatrix') return 'Operation Trust Matrix active (deterministic gate; no generated rows in this flow)';
  return 'No active matrix';
}

function rfpEvidenceText(analysis: AnalysisResult, narrative: ProposalNarrative) {
  return [
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
    ...(analysis.productInfo ?? []),
    narrative.unifyingFrame,
    narrative.differentiationPrinciple,
  ].filter(Boolean).join(' ');
}

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function classifyRfpEvidence(evidenceText: string, hasMultipleEntities: boolean) {
  const multiEntityEvidenceCount = countMatches(evidenceText, [
    /공동관|공동\s*부스|공동\s*전시|파빌리온|joint\s*(?:booth|pavilion|exhibition)|national\s*pavilion|shared\s*exhibition|consortium|컨소시엄/i,
    /참여기업|참여\s*기관|협력사|계열사|기관별|기업별|브랜드별|(?:여러|다수|복수|multiple|multi).{0,20}(?:기업|회사|브랜드|기관)/i,
    /도메인별|business\s*unit|multiple\s*domains|각\s*(?:사업부|도메인).*독립|독립.*(?:사업부|도메인)/i,
    /통합.*(?:개별|구분|차별|역할)|(?:개별|구분|차별|역할).*통합|unified.*(?:differentiated|role)|balance.*(?:identity|distinction)|각\s*(?:기업|기관|브랜드|도메인).*역할/i,
  ]);
  const singleBrandVisitorRoomEvidenceCount = countMatches(evidenceText, [VISITOR_BRAND_OVERRIDE_PATTERN]);
  const hasContentOnlyNoise = /(?:audience|visitor|room|zone|content|process|display|touchpoint|제품|서비스|운영|부서|방문객|관람객|룸|존|콘텐츠|공정|공간|동선|터치포인트)/i.test(evidenceText);
  const isMultiEntityPavilion = multiEntityEvidenceCount >= 2 || (hasMultipleEntities && multiEntityEvidenceCount >= 1 && !hasContentOnlyNoise);
  return {
    multiEntityEvidenceCount,
    singleBrandVisitorRoomEvidenceCount,
    isMultiEntityPavilion: singleBrandVisitorRoomEvidenceCount > 0 && multiEntityEvidenceCount < 2 ? false : isMultiEntityPavilion,
  };
}

function hasMultiEntityPavilionEvidence(evidenceText: string, hasMultipleEntities: boolean) {
  return classifyRfpEvidence(evidenceText, hasMultipleEntities).isMultiEntityPavilion;
}

function matrixTypeForRfp(primaryType: RfpConceptType): MatrixType {
  return matrixTypeForRfpConceptType(primaryType);
}

function buildBrandExperienceMatrix(analysis: AnalysisResult, narrative: ProposalNarrative): BrandExperienceMatrixItem[] {
  const brandMeaning = compactText(narrative.whyThisConcept || narrative.proposalThesis || analysis.projectOverview || '브랜드가 방문객에게 증명해야 할 의미', 180);
  const proof = compactText(analysis.contentCondition || analysis.spatialCondition || analysis.productInfo?.[0] || analysis.requiredScope?.[0] || '공정·제품·공간 경험으로 확인되는 증거', 180);
  return [
    { brandMeaning, visitorQuestion: compactText(analysis.clientChallenge || '왜 이 브랜드를 직접 방문해 경험해야 하는가?', 160), experienceStage: 'Brand World Entry', processOrProofPoint: proof, spatialMoment: '브랜드 세계관에 진입하는 첫 장면', sensoryOrEmotionalCue: '몰입감과 기대감', memoryAfterVisit: '브랜드가 가진 관점과 분위기' },
    { brandMeaning, visitorQuestion: '이 브랜드의 실체와 신뢰는 어디에서 오는가?', experienceStage: 'Process / Proof', processOrProofPoint: proof, spatialMoment: '공정·제품·운영 근거를 체감하는 증명 장면', sensoryOrEmotionalCue: '납득과 신뢰', memoryAfterVisit: '말이 아니라 과정으로 확인한 신뢰' },
    { brandMeaning, visitorQuestion: '방문 후 무엇을 기억하고 말하게 되는가?', experienceStage: 'Signature Memory', processOrProofPoint: compactText(analysis.evaluationCriteria?.[0] || narrative.whyThisConcept || proof, 180), spatialMoment: '방문 경험을 압축하는 시그니처 장면', sensoryOrEmotionalCue: '감정적 잔상과 공유 욕구', memoryAfterVisit: '다시 떠오르는 대표 장면과 한 문장' },
  ];
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifyRfpConceptTypes(analysis: AnalysisResult, narrative: ProposalNarrative, hasMultipleEntities: boolean): RfpConceptType[] {
  const evidenceText = rfpEvidenceText(analysis, narrative);
  const hasVisitorBrandOverride = VISITOR_BRAND_OVERRIDE_PATTERN.test(evidenceText);
  const isMultiEntityPavilion = hasMultiEntityPavilionEvidence(evidenceText, hasMultipleEntities);

  if (hasVisitorBrandOverride && !isMultiEntityPavilion) {
    return Array.from(new Set<RfpConceptType>([
      /견학|견학룸|공장\s*견학|방문객\s*체험|체험룸|쇼룸|factory\s*tour|showroom|visitor\s*room/i.test(evidenceText) ? 'visitor_center_or_tour' : 'single_brand_experience',
      'single_brand_experience',
      'product_experience_space',
    ]));
  }

  const types: RfpConceptType[] = [];
  if (isMultiEntityPavilion) types.push('multi_entity_pavilion');
  if (hasAny(evidenceText, [/방문자센터|홍보관|체험관|전시관|visitor\s*center|tour|투어|견학|factory\s*tour|showroom|쇼룸/i])) types.push('visitor_center_or_tour');
  if (hasAny(evidenceText, [/제품|상품|product|demo|demonstration|시연|체험존|사용자 경험|user experience|UX|기능|성능|proof/i])) types.push('product_experience_space');
  if (hasAny(evidenceText, [/팝업|pop[-\s]?up|캠페인|campaign|activation|프로모션|SNS|viral|share/i])) types.push('pop_up_or_campaign');
  if (hasAny(evidenceText, [/부스|booth|전시부스|박람회|trade\s*show|expo|exhibition/i])) types.push('exhibition_booth');
  if (hasAny(evidenceText, [/미디어|영상|콘텐츠|content|media|message|메시지|스토리|채널|interactive/i])) types.push('content_media_experience');
  if (hasAny(evidenceText, [/운영|동선|등록|안전|인력|staff|operation|logistics|현장|서비스|접수|관리|프로세스|매뉴얼/i])) types.push('operation_heavy_event');
  if (hasAny(evidenceText, [/공공|정부|지자체|공기관|public sector|policy|정책|시민|국민/i])) types.push('public_sector_exhibition');
  if (hasAny(evidenceText, [/기술|테크|technology|AI|ICT|디지털|플랫폼|솔루션|showcase|innovation|혁신/i])) types.push('technology_showcase');
  if (!isMultiEntityPavilion && hasAny(evidenceText, [/브랜드|brand|identity|worldview|세계관|이미지|경험 공간|brand experience|방문자센터|홍보관|체험관|전시관|visitor\s*center|tour|투어|견학|factory\s*tour|showroom|쇼룸/i])) types.push('single_brand_experience');
  if (!types.length) types.push('unknown');
  return Array.from(new Set(types));
}
function primaryRfpConceptType(types: RfpConceptType[]): RfpConceptType {
  const priority: RfpConceptType[] = ['multi_entity_pavilion', 'visitor_center_or_tour', 'single_brand_experience', 'product_experience_space', 'pop_up_or_campaign', 'content_media_experience', 'operation_heavy_event', 'exhibition_booth', 'technology_showcase', 'public_sector_exhibition', 'unknown'];
  return priority.find((type) => types.includes(type)) ?? 'unknown';
}

function buildStrategicDirectionDiscoveryBrief(analysis: AnalysisResult, narrative: ProposalNarrative, conceptType: RfpConceptType, hasMultipleEntities: boolean): StrategicDirectionDiscoveryBrief {
  const evidenceText = rfpEvidenceText(analysis, narrative);
  const categoryHints = [
    hasAny(evidenceText, [/수소|hydrogen|energy|에너지|mobility|모빌리티|sustainability|지속가능|future\s*tech/i]) && '미래 기술/에너지 전시 경험',
    conceptType === 'multi_entity_pavilion' && hasMultipleEntities && '복수 주체가 공동으로 설득해야 하는 전시/파빌리온',
    (conceptType === 'visitor_center_or_tour' || conceptType === 'single_brand_experience') && '단일 브랜드 방문/쇼룸/체험 공간',
    conceptType === 'technology_showcase' && '기술 가치와 적용 가능성을 증명하는 쇼케이스',
    conceptType === 'exhibition_booth' && '현장 관람과 평가 설득이 필요한 전시 부스',
  ].filter(Boolean) as string[];
  const currentProjectCategory = categoryHints[0] || compactText(analysis.projectOverview || '현재 RFP 기반 경험/전시 제안', 120);
  const coreRfpChallenge = firstEvidence(analysis, narrative, [/문제|과제|목표|challenge|objective|차별|평가|성과|KPI|인지|신뢰/i], '평가자가 이 제안을 선택해야 하는 이유를 현재 RFP 증거로 분명히 만들어야 함');
  const hiddenNeed = compactText(narrative.strategicOpportunity || analysis.clientChallenge || analysis.confirmNeeded?.[0] || '요구사항 이상의 선택 이유와 기억되는 대표 경험 확보', 180);
  const evaluatorDecisionRisk = firstEvidence(analysis, narrative, [/평가|심사|리스크|위험|제약|예산|일정|운영|generic|차별/i], '일반적인 전시/공간 해법처럼 보이면 선택 근거가 약해지는 리스크');
  const clientUniquePosition = compactText(narrative.whyThisConcept || narrative.differentiationPrinciple || analysis.projectOverview || '현재 클라이언트가 가진 제품·공정·브랜드·역할 근거', 180);
  const categoryShift = firstEvidence(analysis, narrative, [/전환|변화|미래|future|기술|technology|시장|카테고리|에너지|수소|지속가능|mobility|새로운/i], '카테고리가 단순 소개에서 실체 증명과 경험 설득으로 이동');
  const audiencePerceptionGap = firstEvidence(analysis, narrative, [/방문|관람|고객|대상|audience|visitor|인식|이해|체감|경험|신뢰/i], '관람자가 아직 이해·신뢰·기억하지 못하는 핵심 가치가 존재');
  const whatMustBeProven = firstEvidence(analysis, narrative, [/증명|proof|실행|운영|공정|제품|서비스|기능|성과|deliverable|산출|안전/i], '공간·콘텐츠·미디어·운영을 통해 제안의 실체와 실행 가능성을 증명');
  const strongestStrategicTension = compactText(`${categoryShift} ↔ ${whatMustBeProven}`, 220);
  const axes = [
    `category_shift: ${categoryShift}`,
    `audience_perception_change: ${audiencePerceptionGap}`,
    `required_proof: ${whatMustBeProven}`,
    `client_unique_position: ${clientUniquePosition}`,
    `signature_experience: ${compactText(narrative.unifyingFrame || analysis.contentCondition || '대표 장면으로 기억되는 설득 장면', 150)}`,
    `evaluator_clarity: ${evaluatorDecisionRisk}`,
  ];
  if (conceptType === 'multi_entity_pavilion' && hasMultipleEntities) axes.push(`ecosystem_system_proof: ${compactText(narrative.differentiationPrinciple || '복수 주체의 관계와 기여를 현재 RFP 근거로 명확화', 150)}`);
  if (conceptType !== 'multi_entity_pavilion') axes.push(`operational_confidence_without_multi_entity_logic: ${compactText(analysis.operationCondition || '단일 RFP 맥락의 실행 신뢰를 증명', 150)}`);
  return { currentProjectCategory, coreRfpChallenge, hiddenNeed, evaluatorDecisionRisk, clientUniquePosition, categoryShift, audiencePerceptionGap, whatMustBeProven, strongestStrategicTension, possibleDirectionAxes: Array.from(new Set(axes)).slice(0, 8) };
}

function firstEvidence(analysis: AnalysisResult, narrative: ProposalNarrative, patterns: RegExp[], fallback: string) {
  const pool = [
    analysis.clientChallenge, analysis.projectOverview, analysis.targetInfo, analysis.contentCondition, analysis.operationCondition, analysis.spatialCondition,
    ...(analysis.evaluationCriteria ?? []), ...(analysis.requiredDeliverables ?? []), ...(analysis.requiredScope ?? []), ...(analysis.scopeOfWork ?? []), ...(analysis.kpiObjectives ?? []),
    narrative.proposalThesis, narrative.strategicOpportunity, narrative.differentiationPrinciple, narrative.whyThisConcept,
  ].filter(Boolean) as string[];
  return compactText(pool.find((item) => patterns.some((pattern) => pattern.test(item))) || pool.find(Boolean) || fallback, 180);
}

function buildProposalLearningBrief(patterns: OutlineProposalPattern[], avoidanceRules: string[]) {
  const usable = patterns.filter((pattern) => pattern.pattern_reference_type === 'positive' || pattern.outcome === 'won' || (pattern.outcome === 'lost' && pattern.outcome_reason_type === 'external'));
  const caution = patterns.filter((pattern) => pattern.outcome === 'lost' && pattern.pattern_reference_type !== 'positive');
  const positivePrinciples = usable.slice(0, 5).map((pattern) => [pattern.narrative_stage, pattern.slide_role, pattern.reusable_principle, pattern.why_it_matters].filter(Boolean).join(' · '));
  const lostAvoidance = [
    ...caution.slice(0, 4).map((pattern) => [pattern.failure_areas.join('/'), pattern.outcome_reason_type, pattern.why_it_matters || pattern.reusable_principle].filter(Boolean).join(' · ')),
    ...avoidanceRules.slice(0, 3),
  ].filter(Boolean);
  return {
    positivePrinciples: positivePrinciples.length ? positivePrinciples : ['강한 proposal_patterns가 없으므로 현재 RFP 근거와 제안 명제를 1차 기준으로 사용'],
    lostAvoidance: lostAvoidance.length ? lostAvoidance : ['명확한 미수주 회피 패턴 없음: 현재 RFP evidence의 구체성과 선택 이유를 자체 검증'],
    hasWonPattern: usable.some((pattern) => pattern.outcome === 'won'),
    hasLostPattern: caution.length > 0 || avoidanceRules.length > 0,
  };
}

function buildStrategicDirectionPlan(analysis: AnalysisResult, narrative: ProposalNarrative, hasMultipleEntities: boolean, patterns: OutlineProposalPattern[] = [], avoidanceRules: string[] = []): StrategicDirectionPlanItem[] {
  const conceptTypes = classifyRfpConceptTypes(analysis, narrative, hasMultipleEntities);
  const conceptType = primaryRfpConceptType(conceptTypes);
  const secondary = conceptTypes.filter((type) => type !== conceptType);
  const currentRfpOnlyMode = conceptType !== 'multi_entity_pavilion';
  const learning = buildProposalLearningBrief(currentRfpOnlyMode ? [] : patterns, currentRfpOnlyMode ? [] : avoidanceRules);
  const discoveryBrief = buildStrategicDirectionDiscoveryBrief(analysis, narrative, conceptType, hasMultipleEntities);
  const contextNoun = directionContextNoun(analysis);
  const mk = (index: number, axis: string, rfpEvidence: string, patternLearning: string, lostAvoidance: string): StrategicDirectionPlanItem => {
    const canonicalAxis = canonicalizeDirectionAxis(axis, index - 1);
    return {
      type: canonicalAxis, rfpConceptType: conceptType, secondaryRfpConceptTypes: secondary, label: contextualDirectionLabel(canonicalAxis, contextNoun),
      emphasis: directionStrategicBet(canonicalAxis, contextNoun, rfpEvidence),
      chooseWhen: directionSelectionCriterion(canonicalAxis, contextNoun),
      source: currentRfpOnlyMode ? `primaryRfpConceptType guardrail only / current RFP evidence dominates / proposal_patterns disabled for labels` : `primaryRfpConceptType guardrail only / current RFP evidence dominates / proposal learning modifier only`,
      rfpEvidence, patternLearning, lostAvoidance,
      rfpTypeLensUsed: conceptType,
      rfpEvidenceUsed: rfpEvidence,
      proposalLearningUsed: patternLearning,
      lostPatternAvoided: lostAvoidance,
      discoveryBrief,
      directionAxis: canonicalAxis,
      representativeScene: directionRepresentativeScene(canonicalAxis, contextNoun),
      contextNoun,
    };
  };

  const strongestClaimEvidence = firstEvidence(analysis, narrative, [/평가|목표|성과|KPI|신뢰|전문|리더|선도|차별|강점|value|proof|criteria|objective/i], 'RFP의 핵심 목표와 평가 기준');
  const audienceEvidence = firstEvidence(analysis, narrative, [/방문|관람|타깃|고객|사용자|audience|visitor|customer|journey|experience|memory|인식|행동/i], '대상 경험과 인식 전환 요구');
  const proofEvidence = firstEvidence(analysis, narrative, [/운영|일정|예산|공정|프로세스|산출|범위|실행|안전|리스크|proof|operation|deliverable|schedule/i], '실행 가능성과 증명 요구');
  const positive = learning.positivePrinciples;
  const avoid = learning.lostAvoidance;
  const rawEvidenceByIndex = [strongestClaimEvidence, audienceEvidence, proofEvidence, discoveryBrief.clientUniquePosition, discoveryBrief.evaluatorDecisionRisk];
  // Ensure each direction gets distinct evidence; firstEvidence can otherwise collapse to the same first pool item.
  const evidenceAlternatives = [discoveryBrief.whatMustBeProven, discoveryBrief.categoryShift, discoveryBrief.audiencePerceptionGap, discoveryBrief.hiddenNeed, discoveryBrief.strongestStrategicTension, discoveryBrief.coreRfpChallenge];
  const usedEvidence = new Set<string>();
  const evidenceByIndex = rawEvidenceByIndex.map((evidence) => {
    const primary = (evidence || '').trim();
    if (primary && !usedEvidence.has(primary)) { usedEvidence.add(primary); return evidence; }
    const alt = evidenceAlternatives.map((item) => (item || '').trim()).find((item) => item && !usedEvidence.has(item));
    if (alt) { usedEvidence.add(alt); return alt; }
    return evidence;
  });
  const directions = discoveryBrief.possibleDirectionAxes.slice(0, 5).map((axis, index) => mk(index + 1, axis, evidenceByIndex[index] || strongestClaimEvidence, positive[index] || positive[0], avoid[index] || avoid[0]));

  return directions.map((item, idx) => ({ ...item, label: directions.some((other, j) => j !== idx && other.label === item.label) ? `${item.label} ${idx + 1}` : item.label }));
}
function formatStrategicDirectionPlanForPrompt(plan: StrategicDirectionPlanItem[]) {
  const brief = plan[0]?.discoveryBrief;
  const briefText = brief ? `Strategic Direction Discovery Brief:
- currentProjectCategory: ${brief.currentProjectCategory}
- coreRfpChallenge: ${brief.coreRfpChallenge}
- hiddenNeed: ${brief.hiddenNeed}
- evaluatorDecisionRisk: ${brief.evaluatorDecisionRisk}
- clientUniquePosition: ${brief.clientUniquePosition}
- categoryShift: ${brief.categoryShift}
- audiencePerceptionGap: ${brief.audiencePerceptionGap}
- whatMustBeProven: ${brief.whatMustBeProven}
- strongestStrategicTension: ${brief.strongestStrategicTension}
- possibleDirectionAxes: ${brief.possibleDirectionAxes.join(' / ')}

` : '';
  return `${briefText}${plan.map((item, index) => `C${index + 1}: ${item.label} (${item.type})
- directionAxis: ${item.directionAxis || item.type}
- primaryRfpConceptType: ${item.rfpConceptType}
- secondaryRfpConceptTypes: ${item.secondaryRfpConceptTypes.join(' / ') || 'none'}
- directionSource: ${item.source}
- rfpEvidence: ${item.rfpEvidence}
- proposalPatternLearning: ${item.patternLearning}
- lostPatternAvoidance: ${item.lostAvoidance}
- rfpTypeLensUsed: ${item.rfpTypeLensUsed}
- rfpEvidenceUsed: ${item.rfpEvidenceUsed}
- proposalLearningUsed: ${item.proposalLearningUsed}
- lostPatternAvoided: ${item.lostPatternAvoided}
- hierarchy: primaryRfpConceptType is guardrail/context only; current RFP evidence and confirmed diagnosis define direction axes; proposal_patterns are disabled until outline/proof/risk stages.
- emphasis: ${item.emphasis}
- chooseWhen: ${item.chooseWhen}`).join('\n')}`;
}

function enforceStrategicDirectionGate(concept: ConceptCandidate, planItem: StrategicDirectionPlanItem): ConceptCandidate {
  const fallbackThesis = { ...(concept.winningThesisUse ?? {}), winningClaim: planItem.emphasis };
  const fallbackLeap = { ...(concept.conceptLeap ?? {}), conceptLeap: `${planItem.label} 방향으로 현재 RFP의 브랜드/제품/방문 경험 근거를 대표 장면과 선택 이유로 전환합니다.`, corePromise: planItem.emphasis };
  const fallbackProof = { ...(concept.signatureProofIdea ?? {}), whyThisProvesTheConcept: `${planItem.rfpEvidence}를 방문객이 체감하는 증거 장면으로 보여줍니다.` };
  // Preserve the model's axis/label when valid; otherwise fall back to the canonical plan axis and a clean strategic label.
  const planAxis = canonicalizeDirectionAxis(planItem.directionAxis || planItem.type);
  const modelAxis = concept.directionAxis && (ALLOWED_DIRECTION_AXES as readonly string[]).includes(concept.directionAxis) ? concept.directionAxis : planAxis;
  const planLabel = isRfpFactDirectionText(planItem.label) ? directionAxisLabel(planAxis) : planItem.label;
  const chosenLabel = isValidDirectionLabel(concept.strategicDirectionLabel || '', planItem.rfpConceptType) ? (concept.strategicDirectionLabel || '').trim() : planLabel;
  const gated: ConceptCandidate = {
    ...concept,
    rfpConceptType: planItem.rfpConceptType,
    secondaryRfpConceptTypes: planItem.secondaryRfpConceptTypes,
    strategicDirectionType: planItem.type,
    directionAxis: modelAxis,
    whyThisDirectionExists: concept.whyThisDirectionExists || planItem.emphasis,
    strategicDirectionLabel: chosenLabel,
    directionSource: { rfpEvidence: planItem.rfpEvidence, proposalPatternLearning: planItem.patternLearning, lostPatternAvoidance: planItem.lostAvoidance },
    failurePatternAvoided: concept.failurePatternAvoided || planItem.lostAvoidance,
    winningPatternUsed: concept.winningPatternUsed || planItem.patternLearning,
    directionDebug: { source: planItem.source, failurePatternAvoided: concept.failurePatternAvoided || planItem.lostAvoidance, winningPatternUsed: concept.winningPatternUsed || planItem.patternLearning, confidence: planItem.rfpEvidence && planItem.patternLearning ? 'medium-high' : 'medium' },
    whatThisDirectionEmphasizes: plannerFacingDirectionText(concept.whatThisDirectionEmphasizes || planItem.emphasis),
    oneLineStrategicBet: plannerFacingDirectionText(concept.oneLineStrategicBet || concept.whatThisDirectionEmphasizes || planItem.emphasis),
    whenToChooseThisDirection: plannerFacingDirectionText((concept.whenToChooseThisDirection && !RFP_FACT_DIRECTION_PATTERN.test(concept.whenToChooseThisDirection)) ? concept.whenToChooseThisDirection : planItem.chooseWhen),
  };
  gated.strategicDirectionQualityValidation = buildDirectionQualityValidation(gated, planItem);
  if (planItem.rfpConceptType !== 'multi_entity_pavilion') {
    const joined = [gated.strategicDirectionLabel, gated.whatThisDirectionEmphasizes, gated.whenToChooseThisDirection, gated.strategicApproach, gated.coreMessage, gated.proposalCoreConceptName, gated.proposalCoreConceptSlogan, gated.proposalCoreConceptDefinition, gated.whyThisIsCoreConcept, gated.experiencePrinciple, gated.visitorJourney, gated.contentMediaImplication, gated.mainStrength, gated.mainRisk, gated.conceptLeap?.conceptLeap, gated.conceptLeap?.corePromise, gated.winningThesisUse?.winningClaim, gated.signatureProofIdea?.signatureScene, gated.signatureProofIdea?.signatureContent, gated.signatureProofIdea?.whyThisProvesTheConcept].join(' ');
    if (MULTI_ENTITY_LEAKAGE_PATTERN.test(joined)) {
      gated.strategicDirectionLabel = planItem.label;
      gated.whatThisDirectionEmphasizes = planItem.emphasis;
      gated.whenToChooseThisDirection = planItem.chooseWhen;
      gated.winningThesisUse = fallbackThesis as ConceptCandidate['winningThesisUse'];
      gated.conceptLeap = fallbackLeap as ConceptCandidate['conceptLeap'];
      gated.signatureProofIdea = fallbackProof as ConceptCandidate['signatureProofIdea'];
      gated.proposalCoreConceptName = planItem.label;
      gated.conceptName = planItem.label;
      gated.proposalCoreConceptSlogan = planItem.emphasis;
      gated.proposalCoreConceptDefinition = planItem.emphasis;
      gated.whyThisIsCoreConcept = planItem.emphasis;
      gated.experiencePrinciple = planItem.chooseWhen;
      gated.visitorJourney = '브랜드 이해 → 과정 신뢰 → 제품 가치 체감 → 방문 후 기억';
      gated.contentMediaImplication = planItem.emphasis;
      gated.mainStrength = planItem.emphasis;
      gated.mainRisk = '현재 RFP 근거만으로 방향을 세우므로 세부 연출은 후속 구조 단계에서 보완해야 합니다.';
    }
  }
  const quality = buildDirectionQualityValidation(gated, planItem);
  return quality.isStrategicBet && !quality.isOnlyBasicRequirement && quality.addressesCoreWinningCondition && quality.addressesProofBurden && !quality.couldFitAnyRfp
    ? { ...gated, strategicDirectionQualityValidation: quality }
    : repairBasicStrategicDirection(gated, planItem);
}


function validateDynamicDirections(concepts: ConceptCandidate[]) {
  const labels = concepts.map((concept) => concept.strategicDirectionLabel || '');
  const axes = concepts.map((concept) => concept.directionAxis || concept.strategicDirectionType || '');
  const quality = concepts.map((concept) => concept.strategicDirectionQualityValidation);
  return {
    allDirectionsAreStrategicBets: quality.every((item) => item?.isStrategicBet === true),
    noBasicRequirementDirections: quality.every((item) => item?.isOnlyBasicRequirement === false),
    allDirectionsAddressCoreWinningCondition: quality.every((item) => item?.addressesCoreWinningCondition === true),
    allDirectionsAddressProofBurden: quality.every((item) => item?.addressesProofBurden === true),
    noCouldFitAnyRfpDirections: quality.every((item) => item?.couldFitAnyRfp === false),
    weakDirectionLabels: concepts.filter((concept) => concept.strategicDirectionQualityValidation?.isStrategicBet !== true).map((concept) => concept.strategicDirectionLabel),
    directionsAreRfpSpecific: concepts.every((concept) => Boolean(concept.directionSource?.rfpEvidence || concept.rfpGrounding?.length)),
    noFixedPresetLabels: labels.every((label) => !/^(브랜드 세계관 몰입|제조\/공정 신뢰 증명|방문객 체험 전환|제품 가치 증명|히어로 데모|공동관 정체성|주체별 역할 명확화|통합 임팩트|통합 아이덴티티|통합\+역할 차별화|상징적 리더십|unified identity|unified \+ differentiated roles|symbolic leadership)$/i.test(label.trim())),
    directionAxesAreDistinct: new Set(axes.map((axis) => axis.trim().toLowerCase())).size === axes.length,
    currentRfpEvidenceDominates: concepts.every((concept) => Boolean(concept.directionSource?.rfpEvidence)),
    proposalPatternsOnlyModify: true,
    noCrossRfpContamination: concepts.every((concept) => !/WDS|월드\s*디자인|prior\s*RFP|previous\s*RFP/i.test([concept.strategicDirectionLabel, concept.whatThisDirectionEmphasizes, concept.directionSource?.proposalPatternLearning].join(' '))),
    noInvalidMultiEntityLanguage: concepts.every((concept) => concept.rfpConceptType === 'multi_entity_pavilion' || !MULTI_ENTITY_LEAKAGE_PATTERN.test([concept.strategicDirectionLabel, concept.whatThisDirectionEmphasizes, concept.whenToChooseThisDirection].join(' '))),
    noHardcodedPresetLabels: labels.every((label) => !/^(통합 아이덴티티|통합\+역할 차별화|상징적 리더십|unified identity|unified \+ differentiated roles|symbolic leadership)$/i.test(label.trim())),
    eachDirectionHasPatternReason: concepts.every((concept) => Boolean(concept.winningPatternUsed || concept.directionSource?.proposalPatternLearning)),
    eachDirectionHasRfpEvidence: concepts.every((concept) => Boolean(concept.rfpGrounding?.length || concept.directionSource?.rfpEvidence)),
    directionsAreDistinct: new Set(labels.map((label) => label.trim().toLowerCase())).size === labels.length,
    lostPatternUsedAsAvoidanceOnly: concepts.every((concept) => Boolean(concept.failurePatternAvoided || concept.directionSource?.lostPatternAvoidance)),
    wonPatternUsedAsPositiveReference: concepts.every((concept) => Boolean(concept.winningPatternUsed || concept.directionSource?.proposalPatternLearning)),
  };
}


function enforceDistinctDirectionAxes(concepts: ConceptCandidate[], plan: StrategicDirectionPlanItem[]) {
  const used = new Set<string>();
  return concepts.map((concept, index) => {
    const planItem = plan[index] ?? plan.find((item) => !used.has(item.directionAxis || item.type)) ?? plan[0];
    const candidateAxis = concept.directionAxis && (ALLOWED_DIRECTION_AXES as readonly string[]).includes(concept.directionAxis) ? concept.directionAxis : planItem.directionAxis || planItem.type;
    const axis = used.has(candidateAxis) ? (plan.find((item) => !used.has(item.directionAxis || item.type))?.directionAxis || ALLOWED_DIRECTION_AXES.find((item) => !used.has(item)) || candidateAxis) : candidateAxis;
    used.add(axis);
    return { ...concept, directionAxis: axis };
  });
}

// Guarantee the 3 returned directions carry distinct, user-facing strategic labels.
// Duplicates are disambiguated by suffixing the concept's own label (never an internal axis label).
function dedupeDirectionLabels(concepts: ConceptCandidate[]): ConceptCandidate[] {
  const seen = new Set<string>();
  return concepts.map((concept, index) => {
    const base = (concept.strategicDirectionLabel || '').trim() || `전략 방향 ${index + 1}`;
    let label = base;
    let n = 2;
    while (seen.has(label.toLowerCase())) { label = `${base} ${n}`; n += 1; }
    seen.add(label.toLowerCase());
    return label === concept.strategicDirectionLabel ? concept : { ...concept, strategicDirectionLabel: label };
  });
}

const TEMPLATE_BET_PATTERN = /관점으로 심사자와 관람객이 핵심 가치를 한 번에|관점으로 심사자와 관람객이/;
const TEMPLATE_CRITERION_PATTERN = /가장 중요한 설득 관점이라고 판단될 때|^(?:인식\s*전환|경험\s*이해|가치\s*체험|관점)\S*\s*(?:이|가)?\s*(?:가장\s*)?중요할 때/;
const GENERIC_SCENE_PATTERN = /한눈에 판단되는 대표 증명 장면|한눈에 판단되는 장면/;
const CONCRETE_SCENE_HINT = /(미디어\s*월|미디어월|존|맵|장면|동선|데모|시뮬레이션|라인|연출|타임라인|인터랙티브|히어로|월|여정)/;
const HERO_GENERIC_LABEL = /\bhero\b|히어로/i;

// Card-copy validator (planner-facing): repair ONLY the weak field, never fall back to a generic template.
function validateAndRepairDirectionCards(concepts: ConceptCandidate[], plan: StrategicDirectionPlanItem[]): ConceptCandidate[] {
  const seenLabel = new Set<string>();
  const seenLabelTail = new Set<string>();
  const seenBet = new Set<string>();
  const seenCriterion = new Set<string>();
  const seenScene = new Set<string>();
  const labelTailOf = (value: string) => (value.split(/[\s/·|]+/).filter(Boolean).pop() || '').toLowerCase();
  return concepts.map((concept, index) => {
    const planItem = plan[index] ?? plan[0] ?? ({} as StrategicDirectionPlanItem);
    const axis = concept.directionAxis || planItem.directionAxis || planItem.type || 'category_shift';
    const ctx = planItem.contextNoun || '브랜드';
    const rfpEvidence = planItem.rfpEvidence || '';

    let label = (concept.strategicDirectionLabel || '').trim();
    const labelWords = label.split(/[\s/·|]+/).filter(Boolean).length;
    const labelIsShort = Boolean(label) && labelWords <= 6;
    const labelIsNotHeroGeneric = !HERO_GENERIC_LABEL.test(label);
    INTERNAL_AXIS_PATTERN.lastIndex = 0;
    const labelIsContextual = !isGenericDirectionLabel(label) && !INTERNAL_AXIS_PATTERN.test(label);
    // Reject when blank/long/hero/generic, an exact duplicate, OR shares the same trailing token as another card
    // (so the 3 labels never read as one mechanical pattern).
    if (!label || !labelIsShort || !labelIsNotHeroGeneric || !labelIsContextual || seenLabel.has(label.toLowerCase()) || seenLabelTail.has(labelTailOf(label))) {
      let next = contextualDirectionLabel(axis, ctx);
      let n = 2;
      while (seenLabel.has(next.toLowerCase())) { next = `${contextualDirectionLabel(axis, ctx)} ${n}`; n += 1; }
      label = next;
    }
    seenLabel.add(label.toLowerCase());
    seenLabelTail.add(labelTailOf(label));

    let bet = (concept.oneLineStrategicBet || concept.whatThisDirectionEmphasizes || '').trim();
    const howToPersuadeIsSpecific = Boolean(bet) && bet.length >= 12 && !TEMPLATE_BET_PATTERN.test(bet);
    if (!howToPersuadeIsSpecific || seenBet.has(bet)) bet = directionStrategicBet(axis, ctx, rfpEvidence);
    seenBet.add(bet);

    let criterion = (concept.whenToChooseThisDirection || '').trim();
    const selectionCriterionIsActionable = Boolean(criterion) && criterion.length >= 10 && !TEMPLATE_CRITERION_PATTERN.test(criterion);
    if (!selectionCriterionIsActionable || seenCriterion.has(criterion)) criterion = directionSelectionCriterion(axis, ctx);
    seenCriterion.add(criterion);

    const proof = concept.signatureProofIdea ?? { signatureScene: '', signatureContent: '', signatureSpatialMove: '', signatureMediaOrInteraction: '', whyThisProvesTheConcept: '', whyThisIsNotGeneric: '' };
    let scene = (proof.signatureScene || '').trim();
    const representativeSceneIsConcrete = Boolean(scene) && !GENERIC_SCENE_PATTERN.test(scene) && CONCRETE_SCENE_HINT.test(scene);
    if (!representativeSceneIsConcrete || seenScene.has(scene)) scene = planItem.representativeScene || directionRepresentativeScene(axis, ctx);
    seenScene.add(scene);

    if (label === concept.strategicDirectionLabel && bet === concept.oneLineStrategicBet && criterion === concept.whenToChooseThisDirection && scene === proof.signatureScene) return concept;
    return {
      ...concept,
      strategicDirectionLabel: label,
      oneLineStrategicBet: bet,
      whatThisDirectionEmphasizes: bet,
      whenToChooseThisDirection: criterion,
      signatureProofIdea: { ...proof, signatureScene: scene },
    };
  });
}

function enforceResultMatrixGate(result: ConceptCandidatesResult, params: { primaryType: RfpConceptType; matrixType: MatrixType; plan: StrategicDirectionPlanItem[]; brandExperienceMatrix: BrandExperienceMatrixItem[]; entityMatrix: ReturnType<typeof buildRfpDifferentiationStrategy>['entityDifferentiationMatrix']; sanitizerApplied?: boolean; sanitizerReason?: string; rawMatrixType?: MatrixType; rawPrimaryRfpConceptType?: RfpConceptType; multiEntityEvidenceCount?: number; singleBrandVisitorRoomEvidenceCount?: number }): ConceptCandidatesResult {
  const activeMatrixSummary = summarizeActiveMatrix(params.matrixType, { entityCount: params.matrixType === 'entityDifferentiationMatrix' ? params.entityMatrix.length : 0, brandExperienceMatrix: params.brandExperienceMatrix });
  const sourceConcepts = Array.from({ length: DEFAULT_CONCEPT_COUNT }, (_, index) => result.concepts[index] ?? fallbackCandidate(index + 1, '', { projectOverview: params.plan[index]?.rfpEvidence || params.plan[0]?.rfpEvidence || '', clientChallenge: params.plan[index]?.emphasis || params.plan[0]?.emphasis || '' } as AnalysisResult, { proposalThesis: params.plan[index]?.emphasis || params.plan[0]?.emphasis || '', strategicOpportunity: params.plan[index]?.chooseWhen || params.plan[0]?.chooseWhen || '', coreProblem: '', whyThisConcept: '', unifyingFrame: '', differentiationPrinciple: '' } as ProposalNarrative));
  let concepts: ConceptCandidate[] = enforceDistinctDirectionAxes(sourceConcepts.map((concept, index) => enforceStrategicDirectionGate(concept, params.plan[index] ?? params.plan[0])), params.plan);
  let joined = concepts.map((concept) => [concept.strategicDirectionLabel, concept.whatThisDirectionEmphasizes, concept.whenToChooseThisDirection, concept.winningThesisUse?.winningClaim, concept.conceptLeap?.conceptLeap, concept.signatureProofIdea?.whyThisProvesTheConcept, concept.proposalCoreConceptName, concept.proposalCoreConceptSlogan, concept.proposalCoreConceptDefinition, concept.whyThisIsCoreConcept, concept.experiencePrinciple, concept.visitorJourney, concept.contentMediaImplication, concept.mainStrength, concept.mainRisk].filter(Boolean).join(' ')).join(' ');
  let blockedTerms = params.primaryType === 'multi_entity_pavilion' ? [] : BLOCKED_MULTI_ENTITY_TERMS.filter((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(joined));
  if (params.primaryType !== 'multi_entity_pavilion' && blockedTerms.length) {
    concepts = concepts.map((concept, index) => {
      const planItem = params.plan[index] ?? params.plan[0];
      const thesis = { ...(concept.winningThesisUse ?? {}), winningClaim: concept.winningThesisUse?.winningClaim || compactText(`${planItem.label}: ${planItem.rfpEvidence}`, 150) };
      return {
        ...concept,
        strategicDirectionType: planItem.type,
        strategicDirectionLabel: isValidDirectionLabel(concept.strategicDirectionLabel || '', planItem.rfpConceptType) ? (concept.strategicDirectionLabel || '').trim() : planItem.label,
        whatThisDirectionEmphasizes: planItem.emphasis,
        whenToChooseThisDirection: planItem.chooseWhen,
        winningThesisUse: thesis as ConceptCandidate['winningThesisUse'],
        conceptLeap: buildFallbackConceptLeap(thesis, planItem) as ConceptCandidate['conceptLeap'],
        signatureProofIdea: buildFallbackSignatureProofIdea({ requiredScope: [planItem.rfpEvidence] } as AnalysisResult, planItem, deriveDirectionKeywords(planItem, index)) as ConceptCandidate['signatureProofIdea'],
        mainStrength: planItem.emphasis,
        mainRisk: '현재 RFP 근거만으로 방향을 세우므로 세부 연출은 후속 구조 단계에서 보완해야 합니다.',
        entityDifferentiationUse: { unifyingFrame: planItem.label, distinctEntityRoles: '현재 RFP의 핵심 가치와 체험 접점을 구분', visitorRecognitionLogic: '방문객이 가치와 증거를 순서대로 이해', proofByEntity: planItem.rfpEvidence, riskCheck: '현재 RFP 밖의 다중 주체 표현을 사용하지 않음' },
      };
    });
    joined = concepts.map((concept) => [concept.strategicDirectionLabel, concept.whatThisDirectionEmphasizes, concept.whenToChooseThisDirection, concept.winningThesisUse?.winningClaim, concept.conceptLeap?.conceptLeap, concept.signatureProofIdea?.whyThisProvesTheConcept, concept.mainStrength, concept.mainRisk].filter(Boolean).join(' ')).join(' ');
    blockedTerms = BLOCKED_MULTI_ENTITY_TERMS.filter((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(joined));
  }
  concepts = dedupeDirectionLabels(concepts);
  concepts = validateAndRepairDirectionCards(concepts, params.plan);
  const contaminationCheckPassed = blockedTerms.length === 0;
  return {
    ...result,
    rawPrimaryRfpConceptType: params.rawPrimaryRfpConceptType ?? result.rawPrimaryRfpConceptType ?? params.primaryType,
    primaryRfpConceptType: params.primaryType,
    classificationConfidence: params.primaryType === 'multi_entity_pavilion' ? 'high' : 'high',
    classificationReason: params.primaryType === 'multi_entity_pavilion' ? 'multiple equal-weight proposal-owning entities detected with pavilion/joint structure' : 'single-brand/current-RFP gate prevents multi-entity classification without 2+ owner signals',
    multiEntityEvidenceCount: params.multiEntityEvidenceCount ?? 0,
    singleBrandVisitorRoomEvidenceCount: params.singleBrandVisitorRoomEvidenceCount ?? 0,
    rawMatrixType: params.rawMatrixType ?? result.rawMatrixType ?? result.matrixType,
    matrixType: params.matrixType,
    activeMatrixType: params.matrixType,
    hasEntityDifferentiationMatrix: params.matrixType === 'entityDifferentiationMatrix' && Boolean((result.entityDifferentiationMatrix?.length ? result.entityDifferentiationMatrix : params.entityMatrix).length),
    entityMatrixActive: params.matrixType === 'entityDifferentiationMatrix',
    brandMatrixActive: params.matrixType === 'brandExperienceMatrix',
    proposalPatternsUsedForDirections: false,
    currentRfpOnlyMode: true,
    contaminationCheckPassed,
    blockedTerms,
    sanitizerApplied: Boolean(params.sanitizerApplied),
    sanitizerReason: params.sanitizerReason ?? 'matrix gate enforced from primaryRfpConceptType',
    selectedDirectionLensSet: selectedDirectionLensSet(params.plan),
    activeMatrixSummary,
    brandExperienceMatrix: params.matrixType === 'brandExperienceMatrix' ? params.brandExperienceMatrix : [],
    entityDifferentiationMatrix: params.matrixType === 'entityDifferentiationMatrix' ? (result.entityDifferentiationMatrix?.length ? result.entityDifferentiationMatrix : params.entityMatrix) : [],
    concepts,
    directionValidation: validateDynamicDirections(concepts),
    recommendation: {
      ...result.recommendation,
      recommendedDirectionLabel: result.recommendation.recommendedDirectionLabel || concepts.find((concept) => concept.conceptId === result.recommendation.recommendedConceptId)?.strategicDirectionLabel || concepts[0]?.strategicDirectionLabel,
    },
  };
}

function buildFallbackWinningThesis(analysis: AnalysisResult, narrative: ProposalNarrative, direction?: StrategicDirectionPlanItem) {
  const challenge = compactText(analysis.clientChallenge || narrative.coreProblem || '평가자가 기존 정보 나열만으로는 선택 이유를 확신하기 어려움', 150);
  // Seed the claim/proof from the direction so C1/C2/C3 do not receive a byte-identical winning thesis.
  const thesis = compactText(direction?.emphasis || narrative.proposalThesis || '현재 요구를 실행 가능한 증거와 기억되는 장면으로 증명', 150);
  return {
    contextShift: compactText(narrative.strategicOpportunity || challenge, 150),
    previousBaseline: compactText(analysis.projectOverview || '기존 이해는 요구사항과 산출물 확인에 머물러 있음', 150),
    newReality: compactText(challenge, 150),
    clientUniquePosition: compactText(narrative.differentiationPrinciple || 'RFP 요구를 통합하고 실행 접점으로 전환할 수 있는 주체', 150),
    audiencePerceptionGap: compactText(direction?.label ? `${direction.label} 관점에서 대상이 아직 확신하지 못하는 부분` : (analysis.targetInfo || '대상이 왜 지금 이 제안을 믿어야 하는지 아직 선명하지 않음'), 150),
    winningClaim: thesis,
    whyNow: compactText(analysis.evaluationCriteria?.[0] || '평가 시점에 전략과 실행 증거를 동시에 보여줘야 함', 150),
    whyThisClient: compactText(narrative.unifyingFrame || narrative.differentiationPrinciple || '현재 과제의 요구와 증거를 가장 직접적으로 연결할 수 있음', 150),
    whatMustBeProven: compactText(direction?.rfpEvidence || analysis.requiredDeliverables?.[0] || analysis.requiredScope?.[0] || '공간·콘텐츠·운영 접점에서 핵심 주장이 실제로 작동함', 150),
  };
}

function buildFallbackConceptLeap(thesis: ReturnType<typeof buildFallbackWinningThesis>, direction: StrategicDirectionPlanItem) {
  return {
    fromStatement: compactText(`기존에는 ${thesis.previousBaseline}`, 150),
    toStatement: compactText(`이제는 ${thesis.newReality}`, 150),
    conceptLeap: compactText(`${direction.label} 관점에서 ${thesis.winningClaim}을 기억되는 대표 장면으로 바꿉니다.`, 170),
    corePromise: compactText(thesis.winningClaim, 140),
    emotionalTakeaway: '막연한 이해가 아니라 지금 선택할 수 있다는 확신',
    evaluatorTakeaway: compactText(`${direction.emphasis}이 평가 기준과 실행 증거로 연결됨`, 140),
  };
}

// Per-direction keyword triad so repaired/blocked-term concepts don't share a byte-identical signature scene.
function deriveDirectionKeywords(planItem: StrategicDirectionPlanItem, index: number): [string, string, string] {
  const presets: [string, string, string][] = [['근거', '판단', '확장'], ['대상', '가치', '증명'], ['기준', '접점', '운영']];
  const base = presets[Math.abs(index) % presets.length];
  const axisWord = (directionAxisLabel(planItem.directionAxis || planItem.type).split(/\s+/)[0] || '').trim();
  return [axisWord || base[0], base[1], base[2]];
}

function buildFallbackSignatureProofIdea(analysis: AnalysisResult, direction: StrategicDirectionPlanItem, keywordBase: [string, string, string]) {
  const proofTarget = compactText(analysis.requiredScope?.[0] || analysis.requiredItems?.[0] || analysis.evaluationCriteria?.[0] || '핵심 요구', 90);
  return {
    signatureScene: direction.representativeScene || directionRepresentativeScene(direction.directionAxis || direction.type, direction.contextNoun || keywordBase[0]) || `${proofTarget}이 한눈에 판단되는 대표 증명 장면`,
    signatureContent: `${keywordBase[0]}·${keywordBase[1]}·${keywordBase[2]}를 순서대로 확인하는 핵심 메시지와 증거`,
    signatureSpatialMove: '도입부에서 주장, 중심부에서 증거, 마무리에서 선택 이유가 보이는 압축 동선',
    signatureMediaOrInteraction: '평가자가 하나의 선택 근거를 직접 확인하는 짧은 비교·검증 접점',
    whyThisProvesTheConcept: `${direction.label} 방향의 약속을 추상 설명이 아니라 실제 판단 장면으로 보여줍니다.`,
    whyThisIsNotGeneric: '단순 영상벽이나 키오스크가 아니라 RFP 핵심 요구를 선택 근거로 전환하는 장면이기 때문입니다.',
  };
}

function fallbackCandidate(index: number, name: string, analysis: AnalysisResult, narrative: ProposalNarrative): ConceptCandidate {
  const conceptId = `C${index}`;
  const direction = buildStrategicDirectionPlan(analysis, narrative, Boolean(narrative.entityDifferentiationMatrix?.length && narrative.entityDifferentiationMatrix.length > 1))[(index - 1) % 3];
  const fallbackPresets = [
    { keywords: ['근거', '판단', '확장'] as [string, string, string], slogan: 'RFP 근거가 바로 제안 구조로 이어지게 합니다.', definition: `RFP의 핵심 요구를 판단 기준과 실행 접점으로 변환해 평가자가 선택 이유를 확인하게 하는 콘셉트입니다.`, experienceMechanism: 'RFP 근거를 도입-판단-확장 순서로 배열해 제안의 논리를 따라가게 함', recognitionLogic: '요구 조건과 실행 근거가 같은 기준으로 연결됨을 기억함', nameWhy: '현재 RFP의 구체 근거를 제안 판단 장치로 바꾸는 이름입니다.' },
    { keywords: ['대상', '가치', '증명'] as [string, string, string], slogan: '방문 대상의 기대를 분명한 가치 증명으로 바꿉니다.', definition: `RFP에 등장한 대상의 기대와 가치 포인트를 공간·콘텐츠·운영 증거로 재조합하는 콘셉트입니다.`, experienceMechanism: '대상 기대를 먼저 인식하고 마지막에 가치 증명으로 연결하는 흐름', recognitionLogic: '핵심 요소의 차이와 전체 제안 명제를 동시에 기억함', nameWhy: 'RFP에 있는 대상·가치·평가 근거를 제목의 출처로 삼습니다.' },
    { keywords: ['기준', '접점', '운영'] as [string, string, string], slogan: '평가 기준이 현장 접점과 운영 방식으로 보이게 합니다.', definition: `평가 기준을 콘텐츠 접점과 운영 증거로 번역해 제안서 전체의 검증 흐름을 만드는 콘셉트입니다.`, experienceMechanism: '기준-접점-운영 순서로 평가 언어를 실행 장면으로 전환함', recognitionLogic: '추상 평가 항목이 실제 현장 작동 방식으로 확인됨을 기억함', nameWhy: '평가 기준과 운영 증거라는 RFP 근거에서 파생된 이름입니다.' },
  ];
  const preset = fallbackPresets[(index - 1) % fallbackPresets.length];
  const rfpGrounding = fallbackGrounding(analysis, narrative);
  const seed = fallbackNameSeeds(analysis)[index - 1] || fallbackNameSeeds(analysis)[0] || '판단';
  const repairedName = name || `${seed} ${['프레임', '필드', '아레나'][(index - 1) % 3]}`;
  const keywordBase = preset.keywords;
  const winningThesisUse = buildFallbackWinningThesis(analysis, narrative, direction);
  const conceptLeap = buildFallbackConceptLeap(winningThesisUse, direction);
  const signatureProofIdea = buildFallbackSignatureProofIdea(analysis, direction, keywordBase);
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
    rfpConceptType: direction.rfpConceptType,
    secondaryRfpConceptTypes: direction.secondaryRfpConceptTypes,
    strategicDirectionType: direction.type,
    strategicDirectionLabel: direction.label,
    whatThisDirectionEmphasizes: direction.emphasis,
    whenToChooseThisDirection: direction.chooseWhen,
    proposalCoreConceptName: repairedName,
    proposalCoreConceptSlogan: preset.slogan,
    proposalCoreConceptDefinition: definition,
    winningThesisUse,
    conceptLeap,
    signatureProofIdea,
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
      rfpDiagnosis?: RfpDiagnosis;
      brandProductIntelligence?: BrandProductIntelligence;
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
    if (!body.rfpDiagnosis) {
      return conceptsJson({ error: '제안 전략 진단 확정 후 전략 방향을 생성할 수 있습니다.' }, { status: 400 });
    }
    if (!body.brandProductIntelligence) {
      return conceptsJson({ error: '브랜드/제품 이해 확정 후 전략 방향을 생성할 수 있습니다.' }, { status: 400 });
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
    const maxProposalPatterns = 0; // proposalPatternContext = outline stage only; strategy generation must not retrieve proposal_patterns.
    const proposalNarrative = ensureProposalNarrative(body.proposalNarrative, { input: body.input, analysis: body.analysis, documentText: '' });
    const differentiationStrategy = buildRfpDifferentiationStrategy(body.analysis, proposalNarrative);
    const differentiationSummary = summarizeDifferentiationStrategy(differentiationStrategy);
    const compactAnalysis = buildCompactAnalysis(body.analysis, differentiationSummary, proposalNarrative);
    const balancedEvidenceSummary = buildBalancedEvidenceSummary({ analysis: body.analysis, differentiationStrategy, documentChunks: body.documentChunks ?? [], proposalNarrative });
    const separatedEvidenceLevels = buildSeparatedEvidenceLevels({ analysis: body.analysis, differentiationStrategy, documentChunks: body.documentChunks ?? [], proposalNarrative });
    const hasMultipleEntities = differentiationStrategy.hasMultipleEntities;
    const classificationEvidence = classifyRfpEvidence(rfpEvidenceText(body.analysis, proposalNarrative), hasMultipleEntities);
    const rfpConceptTypes = classifyRfpConceptTypes(body.analysis, proposalNarrative, hasMultipleEntities);
    const selectedRfpConceptType = primaryRfpConceptType(rfpConceptTypes);
    // strategyContext = current RFP + confirmed diagnosis only. proposal_patterns are intentionally not retrieved or passed.
    const proposalPatternGuidance = { patterns: [] as OutlineProposalPattern[], avoidanceRules: [] as string[], summary: { wonStructureCount: 0, lostExternalStructureCount: 0, unknownStructureCount: 0, lostMixedCautionCount: 0, lostQualityAvoidanceRuleCount: 0, lostUsableStructureCount: 0 } as ProposalPatternRetrievalSummary };
    const proposalLearningBrief = buildProposalLearningBrief([], []);
    const strategicDirectionPlan = buildStrategicDirectionPlan(body.analysis, proposalNarrative, hasMultipleEntities, [], []);
    const rawMatrixType = body.analysis.matrixType;
    const preliminaryMatrixType = matrixTypeForRfp(selectedRfpConceptType);
    const preliminaryBrandExperienceMatrix = preliminaryMatrixType === 'brandExperienceMatrix' ? buildBrandExperienceMatrix(body.analysis, proposalNarrative) : [];
    const sanitizedContext = sanitizeConceptContextByRfpType({ primaryRfpConceptType: selectedRfpConceptType, rawPrimaryRfpConceptType: body.analysis.primaryRfpConceptType, matrixType: rawMatrixType ?? preliminaryMatrixType, rawMatrixType, entityDifferentiationMatrix: differentiationStrategy.entityDifferentiationMatrix, brandExperienceMatrix: preliminaryBrandExperienceMatrix });
    const selectedMatrixType = sanitizedContext.matrixType;
    const brandExperienceMatrix = selectedMatrixType === 'brandExperienceMatrix' ? preliminaryBrandExperienceMatrix : [];
    const activeMatrix = getActiveMatrix(sanitizedContext);
    const directionLensSet = selectedDirectionLensSet(strategicDirectionPlan);
    const activeMatrixSummary = summarizeActiveMatrix(selectedMatrixType, { entityCount: selectedMatrixType === 'entityDifferentiationMatrix' ? differentiationStrategy.entityDifferentiationMatrix.length : 0, brandExperienceMatrix });
    console.info('[concepts:gating]', { primaryRfpConceptType: selectedRfpConceptType, matrixType: selectedMatrixType, activeMatrixType: sanitizedContext.activeMatrixType, selectedDirectionLensSet: directionLensSet, sanitizerApplied: sanitizedContext.sanitizerApplied, sanitizerReason: sanitizedContext.sanitizerReason, activeMatrixSummary });
    const proposalPatternDiagnostics = formatProposalPatternDiagnostics(proposalPatternGuidance.summary, hasMultipleEntities);

    const systemPrompt = [
      `Concept Prompt Version: ${conceptPromptVersion}. 이 버전의 Proposal Core Concept hierarchy만 사용한다.`,
      '너는 한국어 제안서 콘셉트를 빠르게 설계하는 크리에이티브 디렉터다.',
      `정확히 ${maxCandidates}개의 전략 방향 후보를 생성한다. 최소 3개의 usable concept를 반환하고, 내부 네이밍 후보 5개는 절대 노출하지 말라.`,
      '3개 후보는 winner-loser 비교가 아니라 서로 다른 전략 방향 옵션이어야 한다.',
      'primaryRfpConceptType은 invalid logic 차단, evidence selection, contamination 방지, matrix/context 선택용 guardrail이다. strategicDirectionLabel을 type preset으로 처방하지 말라. current RFP evidence, hidden need, evaluator risk, client position, category shift, perception gap, required proof, signature opportunity에서 direction axis를 발견한다. proposal_patterns는 이 단계에서 완전히 비활성화되어야 하며 direction source, modifier, caution으로도 사용하지 않는다.',
      '각 후보는 rfpConceptType, secondaryRfpConceptTypes, strategicDirectionType, strategicDirectionLabel, directionSource, whatThisDirectionEmphasizes, oneLineStrategicBet, whenToChooseThisDirection, failurePatternAvoided, winningPatternUsed를 반드시 포함한다. strategicDirectionLabel은 discovery brief의 direction axis와 현재 RFP evidence에서 새로 만든 2~8단어의 짧은 방향명이어야 하며 type별 고정 preset, 과거 RFP 언어, 말줄임표를 금지한다.',
      'oneLineStrategicBet은 사용자에게 보이는 문장이므로 proof/evidence/proof burden 같은 내부 영어를 쓰지 말고 “이 방향은 ___을 통해 ___을 설득하는 전략입니다.” 형식의 자연스러운 한국어 1문장으로 쓴다. whenToChooseThisDirection은 “클라이언트가 ___을 가장 중요하게 볼 때 선택합니다.”에 가까운 실무 선택 기준으로 쓴다. signatureProofIdea의 대표 장면/콘텐츠는 카드에서 대표 체험 장면으로 읽히도록 구체 구 하나로 요약 가능해야 한다.',
      'strategicDirectionLabel은 카드에 보이는 짧은 한국어 방향명이다. 현장의 감각/현장의 신뢰/경험의 증명/가치의 흐름/브랜드 경험 강화/통합적 체험/차별화된 경험 같은 generic label을 금지하고, currentRfpVocabularySet에 해당하는 브랜드·제품·감각·공정·공간·방문자 언어를 우선 사용한다. proposalCoreConceptName/conceptName은 DB/schema 호환을 위한 임시 direction title일 뿐이며 최종 컨셉명이 아니다. 최종 컨셉명은 사용자가 방향 선택 후 별도 naming step에서 생성한다.',
      'strategicDirectionLabel 품질 규칙: 2~6단어의 구체적이고 제안서에 바로 쓸 수 있는 전략 방향명으로 쓴다. 금지 — “Hero/히어로 + 추상명사”(예: Hero 인식 전환, Hero 경험 이해, Hero 가치 체감), axis 직역(예: 카테고리 전환 설득, 관람 이해 전환, 제품 가치 체감), internal directionAxis 라벨, RFP 산출물명/콘텐츠 포맷명/프로젝트명. Hero는 콘텐츠 포맷이지 전략이 아니므로 라벨에 쓰지 말고, 시그니처 장면 방향이면 “메인 장면 각인/대표 장면 선언/압도적 첫인상”처럼 전략적으로 표현한다. 라벨은 현재 RFP의 주제·브랜드·카테고리 언어로 만든다.',
      '특히 “[주어] + 인식 전환 / 경험 이해 / 가치 체험 / 설득 / 이해 / 체감” 형태의 기계적 라벨을 절대 만들지 말라(예: 견학룸 인식 전환, 견학룸 경험 이해, HTWO 가치 체험). 라벨은 [프로젝트유형/클라이언트명/룸·전시·Hero + 일반 축 문구] 조합이 아니라, 제안 전략 진단(strategicIssue, persuasionTask), brand/product intelligence(productOrServiceMeaning, categoryContext, namingImplication), 선택된 direction axis, 대표 설득 장면에서 도출한 전략 명제로 만든다. 좋은 형태의 느낌: 방문관/공정형은 “몸으로 이해하는 수분 / 공정 신뢰 체험화 / 한 병의 여정 / 수분 균형의 기억화”, 수소/에너지형은 “수소사회 현재화 / HTWO 대표성 각인 / 밸류체인 압축 체험 / 미래 기술의 실체화 / 통합 수소 생태계 / 수소 리더십 선언” — 이는 스타일 예시일 뿐 그대로 복사하지 말고 현재 RFP 어휘로 새로 만든다.',
      '3개 방향은 서로 다른 “승리 접근(winning approach)”이어야 한다. perception/understanding/experience 3종 세트로 나누지 말고, 현재 RFP에서 서로 다른 3개의 승리 가설을 추론한다(예: 방문관형 = 제품가치/신체 수분 균형, 공정 신뢰/투명성, 브랜드 기억/방문 후 호감 / 수소형 = 기술 현실성(이미 와 있는 수소사회), 대표 포지션(현대차그룹·HTWO 리더십), 밸류체인/통합 생태계 이해). 이는 추론 패턴이며 고정 출력이 아니다.',
      '카드 본문은 3개가 서로 다른 전략 논리를 가져야 한다. (a) oneLineStrategicBet(어떻게 설득하는가)은 “___ 중심으로 ___ 보여주는/만드는 방향입니다.” 형태의 구체적 한 문장 베팅으로, 축 직역 템플릿(“…관점으로 심사자와 관람객이 핵심 가치를 한 번에…”)을 쓰지 않는다. (b) whenToChooseThisDirection(선택 기준)은 “___이 가장 중요할 때 선택합니다.” 형태의 실무 결정 기준으로, “가장 중요한 설득 관점이라고 판단될 때” 같은 공허한 문구를 금지한다. (c) signatureProofIdea.signatureScene(대표 설득 장면)은 미디어 월/존/맵/동선/시뮬레이션/데모처럼 공간·콘텐츠·미디어가 드러나는 구체 장면으로 쓰고, “…한눈에 판단되는 대표 증명 장면” 같은 추상 문구를 금지한다. 세 카드의 베팅·선택 기준·대표 장면·리스크가 모두 달라야 한다.',
      '추천은 가장 적합한 방향을 설명하되 다른 후보를 나쁘다/부적합하다/틀렸다로 말하지 않는다. 다른 방향의 쓰임과 선택 간 trade-off를 중립적으로 설명한다.',
      '긴 문단을 쓰지 말고 모든 설명은 1문장 또는 짧은 구로 작성한다.',
      '출력은 hiddenNeeds, strategicApproach, entityDifferentiationMatrix, conceptDevelopmentLogic, concepts, recommendation을 포함한다.',
      'Concept generation의 근거는 Confirmed RFP-only Diagnosis, Brand/Product Intelligence, Evidence Level Separation, Compact RFP Analysis뿐이다. primaryRfpConceptType은 guardrail로만 사용한다. proposal_patterns, 과거 이름/고객/프로젝트/슬로건/파일명/raw source text는 절대 사용하지 않는다.',
      'Core Concept Name Evidence Lock: proposalCoreConceptName/proposalCoreConceptSlogan/proposalCoreConceptDefinition/winningThesisUse/conceptLeap은 반드시 proposalLevelEvidence만 사용한다. entityLevelEvidence/contentDetailEvidence/referenceOnlyEvidence/source_text/raw product tables는 이름의 직접 원천으로 쓰지 않는다.',
      '각 후보에는 conceptNameEvidenceLevel=proposalLevel, productSpecificNameDetected=false, coversWholeRfp=true, repairedName, dominantEntityInName을 포함한다. product/equipment/detail/reference 용어가 이름에 감지되면 strategicDirectionLabel/winningThesis/conceptLeap/signatureProofIdea/keywords는 유지하고 이름과 필요한 slogan만 proposalLevelEvidence로 수리한다.',
      hasMultipleEntities ? 'Balanced RFP Evidence Summary의 majorEntities가 2개 이상이면 각 후보에 coveredEntities, missingEntities, dominantEntity, entityBalanceStatus를 포함하고, over-focused이면 반환 전에 balanced로 수리한다.' : '이 RFP는 multi_entity_pavilion이 아니므로 entity role matrix, 역할 구분, 통합+개별 구분, 통합 증명 프레임을 전략 방향으로 강제하지 말라. brand meaning, visitor transformation, product/process proof, spatial journey, signature moment, memory after visit 같은 경험 레이어를 사용한다.',
      'Strategic direction candidates 생성 전에 Winning Thesis를 먼저 만들고, 그 다음 Concept Leap과 Signature Proof Idea를 만든다. 이 단계에서는 최종 네이밍을 완성하지 말고 방향 선택에 필요한 전략 판단 정보만 완성한다.',
      'Winning Thesis 필드(contextShift, previousBaseline, newReality, clientUniquePosition, audiencePerceptionGap, winningClaim, whyNow, whyThisClient, whatMustBeProven)를 각 concepts 항목의 winningThesisUse에 반드시 포함한다.',
      'Concept Leap 필드(fromStatement, toStatement, conceptLeap, corePromise, emotionalTakeaway, evaluatorTakeaway)를 각 concepts 항목에 반드시 포함한다. From/To/Leap은 RFP를 해석해야 하며 기간·장소·예산·제출요건 복사가 아니어야 한다.',
      '각 후보는 signatureProofIdea(signatureScene, signatureContent, signatureSpatialMove, signatureMediaOrInteraction, whyThisProvesTheConcept, whyThisIsNotGeneric)를 반드시 포함한다. generic immersive video/kiosk/media wall/showcase 같은 표현은 구체 대표 장면으로 변환한다.',
      'proposalCoreConceptName은 임시 방향 타이틀로만 사용되며 conceptLeap과 corePromise를 요약해야 한다. classification label, diagram label, section title, product module, generic metaphor, content mechanism, visitor journey label이면 안 된다.',
      'proposalCoreConceptSlogan은 시적 문구보다 전략적 claim, why this client, proposal promise를 명확히 설명한다.',
      '필수 생성 순서: (1) Hidden Needs (2) Strategic Approach (3) RFP Concept Type Classification - primaryRfpConceptType is authoritative (4) Entity Differentiation only when primaryRfpConceptType=multi_entity_pavilion; otherwise use Brand Experience Matrix thinking when useful but do not output Entity Differentiation Matrix (5) Proposal Core Concept (6) Experience Principle (7) Visitor Journey (7) Content/Media Execution (8) Anti-pattern Validation.',
      'Visitor Journey를 Proposal Core Concept보다 먼저 만들거나 Core Concept의 이름으로 승격하지 않는다.',
      '각 concepts 항목은 전략 방향 카드로 읽히도록 proposalCoreConceptName(임시 방향 타이틀), proposalCoreConceptSlogan(임시 방향 설명), proposalCoreConceptDefinition, whyThisIsCoreConcept, experiencePrinciple, visitorJourney, contentMediaImplication을 반드시 분리한다.',
      'legacy 호환을 위해 conceptName은 proposalCoreConceptName과 동일하게, conceptDefinition은 proposalCoreConceptDefinition과 동일하게 출력한다.',
      '이 단계의 Proposal Core Concept 필드는 최종 표지 제목이 아니라 전체 제안서의 전략 방향 프레임이다. client objective, RFP challenge, brand/product meaning, space, content, operation, proof를 연결하되 최종 표지 제목처럼 확정하지 않는다.',
      '각 후보는 conceptNameScopeClassification을 proposal_level, section_level, content_module_level, product_specific_level, generic_label 중 하나로 분류한다. proposalCoreConceptName에는 proposal_level만 허용한다. section/content/product/generic이면 전략 방향은 유지하고 이름만 proposal_level로 수리한 뒤 출력한다.',
      'Proposal Core Concept scope validation을 각 후보에 포함한다: coversWholeProposal, coversMainEntitiesOrScope, expandableToSpace, expandableToContent, expandableToMediaOrInteraction, expandableToOperationOrProof, notProductSpecificOnly, notSectionTitleOnly는 모두 true여야 한다. false가 하나라도 있으면 이름과 정의를 수리한 뒤 true 상태만 출력한다.',
      '전략 방향은 전체 제안 전략, 공간 경험, 콘텐츠 방향, 미디어/인터랙션, 운영/실행 논리, 증명/평가 논리, 최종 발표 스토리라인을 조직할 수 있어야 한다.',
      '네이밍 레벨을 분리한다: Proposal Core Concept Name은 전체 제안서 제목으로 쓰일 최상위 이름, Section/Zone Concept Name은 존·공간·제품군 언어 허용, Content Module Name은 제품·상호작용·장비 언어 허용이다. Section/Zone 또는 Content Module 이름을 Proposal Core Concept Name으로 승격하지 않는다.',
      '제품명 하나, 특정 기술, 특정 존, 특정 체험 모듈, 특정 콘텐츠 섹션, 운영 프로세스명, 개인 병사용 프로토콜, 조준경 매트릭스 같은 이름은 제안 레벨 콘셉트가 아니므로 거부하고 전체 프레임으로 수리한다.',
      hasMultipleEntities ? 'RFP에 여러 기업·제품·존·대상·콘텐츠 카테고리가 있으면 RFP가 명시한 전체 hero가 아닌 한 하나의 제품군이나 섹션만 대표하는 이름을 금지한다.' : 'Non-multi-entity RFP에서는 통합 중심, 통합+개별 구분, 역할 구분, 각 대상의 역할, 통합 증명, 국가관/공동관/그룹/상징적 리더십, Entity Role Matrix 같은 WDS식 다중 주체 표현을 쓰지 않는다. 수소/에너지/모빌리티/미래기술/지속가능 전시는 실제 RFP tension(미래 가능성 vs 현재 실체, 기술 소개 vs 사회/시스템 proof, 추상 기술 vs tangible experience 등)을 근거로 discovery하되 이를 고정 label로 복사하지 않는다.',
      'Core concept naming은 project objective, strategic challenge, evaluation criteria, client intent, main entities/categories, space/content structure, deliverables, constraints, hidden needs, entity differentiation summary를 우선한다. 제품 리스트, 장비 스펙, reference image, referenceOnly chunk, 특정 entity/product/zone 상세 목록은 핵심 네이밍 근거로 쓰지 않는다.',
      'Signature Proof Idea는 다중 entity RFP에서 shared hero scene, system map, command frame, integrated operating field처럼 전체 제안 범위를 증명해야 한다. 한 제품을 hero로 쓰면 그것이 전체 범위를 대표하는 이유를 명시하고, 아니면 단일 제품군 proof를 피한다.',
      '3개 전략 방향 카드와 임시 이름 전반에서 현장/경험/체험/증명/가치/연결/흐름/여정/신뢰/균형 같은 generic hook이 2개 초과 카드의 label/slogan/summary 주어로 반복되면 약한 후보를 현재 RFP 어휘로 재작성한다. 3개 후보의 conceptName은 중복/근접 중복이면 안 된다.',
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
      '3개 전략 방향은 반드시 (1) 반드시 보여줘야 할 것 (2) 해결하는 심사자 우려 (3) 대표 체험 장면 종류 (4) 사용자가 선택할 상황이 달라야 한다. 세 방향이 같은 전략의 표현 차이, 일반 요구 충족, 추상적 설명이면 반환 전에 재생성한다.',
      '각 후보별로 내부적으로 이름 5개를 만들고 specificityToCurrentRfp, symbolicPower, memorability, coverTitlePotential, expandability, nonGenericQuality, notStrategyLabel을 1~5점으로 채점한다. 종합 4 미만이거나 섹션 제목/컨설팅 헤딩/전략 부제/문제해결 문구로도 쓸 수 있으면 이름만 재생성하고 최종 1개만 출력한다. 내부 후보와 점수는 출력하지 않는다.',
      '약한 Core Concept 이름 금지: 증거 루트, 가치 신호, 선택의 이유, 인지의 흐름, 확신의 여정, 경험의 경로, 차별화의 단계, Signal to Proof, Route to Value, Evidence Journey, 혁신의 장면, 차별화된 통합, 명확한 구분, 통합된 경험, Distinct Unity, Focused Identity, Scene of Innovation, The Reason to Choose, Connected Future, Innovation Journey, Experience Hub.',
      'conceptName은 전략 문장/슬라이드 제목/프로젝트 목표/직접 솔루션 문구/캠페인 문구/RFP 요약/회피 규칙 번역처럼 보이면 안 되며, 무관한 RFP에 재사용하면 어색해야 한다.',
      '한국어 conceptName은 가치/증거/신호/루트/이유/선택/차별화/통합/연결/혁신/경험/공명/확신/집중/방향/전략/메시지 중심 이름을 거부하고, 현재 RFP에서만 성립하는 상징 세계·구조 이미지·장면 제목으로 작성한다.',
      '영어 conceptName은 value/proof/signal/route/reason/choice/differentiation/connection/innovation/experience/focus/resonance/strategy/identity/unity/synergy/nexus/pulse/vanguard/frontier/spectrum 중심 이름을 거부한다.',
      'conceptSlogan은 평가자가 이해할 수 있게 RFP 목표와 제안 약속을 1문장으로 설명하되, conceptName 자체는 간결하게 유지한다.',
      'keywordExecutionGuide는 keyword별 spatialUXImplication, designImplication, contentImplication, contentOrMediaImplication, operationImplication을 각각 1개의 짧은 구로 작성하고 conceptMechanism에서 파생한다.',
      'experienceNarrativeFlow는 3~4개의 짧은 단계만 작성한다.',
      'antiPatternValidation은 Core Concept name이 visitor journey label, experience sequence, interaction mechanism, content section title, slide title, strategic instruction인지 점검하며, proposal_patterns 회피 규칙은 이 단계에서 사용하지 않는다.',
      'proposal_patterns에 포함된 과거 프로젝트명, 클라이언트명, 파일명, 고유 상세를 추정하거나 재사용하지 않는다.',
      isEventOperationType ? '행사 운영형 콘셉트도 시스템명/카테고리명이 아니라 행사 목적과 비즈니스 기회를 압축한 이름으로 작성한다.' : '각 후보는 서로 다른 strategic direction axis, 선택 기준, proof idea를 가진다. 반환 전 directionsAreRfpSpecific/noFixedPresetLabels/directionAxesAreDistinct/currentRfpEvidenceDominates/proposalPatternsOnlyModify/noCrossRfpContamination/noInvalidMultiEntityLanguage를 내부 검증하고 실패하면 proposal_patterns 없이 current RFP evidence만으로 수리한다.',
      'mainStrength와 mainRisk는 짧은 중립 문장으로 작성한다. mainRisk는 결함이 아니라 해당 방향 선택 시 보완할 trade-off로 설명한다.',
    ].join('\n');

    const userPrompt = `제안서 유형: ${proposalTypeLabels[effectiveProposalType]}

Request Debug Metadata (캐시 방지 및 재생성 추적):
${JSON.stringify(metadata, null, 2)}

RFP Concept Type Classification (current RFP evidence only):
- primaryRfpConceptType: ${selectedRfpConceptType}
- secondaryRfpConceptTypes: ${rfpConceptTypes.filter((type) => type !== selectedRfpConceptType).join(' / ') || 'none'}
- selectedDirectionLensSet: ${directionLensSet.join(' / ')}
- rawPrimaryRfpConceptType: ${sanitizedContext.rawPrimaryRfpConceptType}
- rawMatrixType: ${sanitizedContext.rawMatrixType || 'none'}
- matrixType: ${selectedMatrixType}
- activeMatrixType: ${sanitizedContext.activeMatrixType}
- sanitizerApplied: ${sanitizedContext.sanitizerApplied}
- sanitizerReason: ${sanitizedContext.sanitizerReason}
- hasMultipleEntities: ${hasMultipleEntities}

Strategic Direction Discovery + Direction Axes (primaryRfpConceptType은 guardrail일 뿐이며, 아래 possibleDirectionAxes 중 현재 RFP winning condition에 가장 중요한 3개로 C1/C2/C3를 생성):
${formatStrategicDirectionPlanForPrompt(strategicDirectionPlan)}

Compact RFP Analysis JSON (이 필드만 RFP 근거로 사용):
${JSON.stringify(compactAnalysis, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${inputQuality.missingItems.slice(0, 5).map((item) => `${item.label}: ${item.description}`).join(' / ') || '없음'}
- AI missingInfo: ${compactList(body.analysis.missingInfo ?? [], 5).join(' / ') || '없음'}

Proposal Narrative 요약:
${compactText(summarizeProposalNarrative(proposalNarrative), 700)}

Evidence Level Separation (STRICT):
${JSON.stringify(separatedEvidenceLevels, null, 2)}

Balanced RFP Evidence Summary (entity balancing only; core concept naming은 coreEvidence/groups[role=core]만 보조 검증):
${JSON.stringify(balancedEvidenceSummary, null, 2)}

RFP Matrix Gate (${selectedMatrixType}):
${selectedMatrixType === 'entityDifferentiationMatrix' ? `Active Matrix JSON: ${JSON.stringify(activeMatrix, null, 2)}` : selectedMatrixType === 'brandExperienceMatrix' ? `Brand Experience Matrix JSON to use as the only matrix reasoning source: ${JSON.stringify(activeMatrix, null, 2)}. Fields: brandMeaning, visitorQuestion, experienceStage, processOrProofPoint, spatialMoment, sensoryOrEmotionalCue, memoryAfterVisit. Entity Differentiation Matrix를 출력하거나 전략 방향 렌즈로 사용하지 않는다.` : selectedMatrixType === 'productExperienceMatrix' || selectedMatrixType === 'operationTrustMatrix' ? `Active matrix type is ${selectedMatrixType}; Entity Differentiation Matrix를 전략 방향 렌즈로 사용하지 않는다.` : '현재 RFP primary type상 Entity Differentiation Matrix를 전략 방향 렌즈로 사용하지 않는다.'}

Confirmed RFP-only Diagnosis (authoritative strategy source):
${JSON.stringify(body.rfpDiagnosis, null, 2)}

Brand/Product Intelligence (separate post-diagnosis layer; use for category tone, vocabulary, strategy/naming implications):
${JSON.stringify(body.brandProductIntelligence, null, 2)}

proposalLearningBrief: disabled for diagnosis/strategy/naming; proposal_patterns are outline-stage only.
[]

Direction validation required before return:
- output strategicDirectionQualityValidation for each direction with isStrategicBet, isOnlyBasicRequirement, addressesCoreWinningCondition, addressesStrategicTension, addressesProofBurden, hasDistinctPointOfView, couldFitAnyRfp, validationReason.
- required pass values: isStrategicBet=true, isOnlyBasicRequirement=false, addressesCoreWinningCondition=true, addressesProofBurden=true, couldFitAnyRfp=false. If any fails, regenerate only that direction from Confirmed RFP-only Diagnosis and current RFP evidence.
- reject basic execution directions: satisfying requirements, covering scope, organizing information, stable operation, balanced planning, basic feasibility, simple content delivery, general visitor understanding, generic brand communication. These may be proof details, not main direction cards.
- each direction must explicitly connect to confirmed diagnosis: coreWinningCondition, strategicTension, proofBurden, genericProposalFailureReason
- each direction must use brandProductIntelligence to keep category tone and vocabulary correct; avoid wordsToAvoid and wrong-category tone
- classify directionAxis with one allowed value: representative_position, audience_understanding, signature_scene, product_value_proof, process_trust, category_shift, system/ecosystem_proof, spatial_journey, brand_memory, operational_confidence, evaluator_clarity, emotional_affinity, technology_reality_proof
- the 3 directionAxis values must be distinct; if duplicated, regenerate the weaker direction with another axis derived from diagnosis + brandProductIntelligence
- the 3 directions must differ in what they prove, who/what they persuade, mechanism, solved risk, and signature scene; reject if all could use the same concept name
- each direction must address at least one requiredProofElement in requiredProofElementsAddressed
- no direction may rely on proposal_patterns or old project language
- no direction may be generic enough to fit any RFP
- noHardcodedPresetLabels: true
- eachDirectionHasDiagnosisReason: true
- eachDirectionHasRfpEvidence: true
- directionsAreDistinct: true
- proposalPatternsNotUsed: true
- noOldProposalLanguage: true
If any item fails, repair only the weak direction.

proposal_patterns direction usage: DISABLED for all RFP types. Do not use proposal_patterns, previous proposal language, won/lost outcomes, old slogans, old project structures, old client names, or old categories for diagnosis, strategic direction generation, or final concept naming.

Generation order reminder: Confirm diagnosis → Dynamic Strategic Direction Option → Hidden Needs → Strategic Approach → Winning Thesis → Concept Leap → Signature Proof Idea → Entity/Content/Audience Differentiation if applicable → Strategic Direction Option → Winning Thesis → Concept Leap → Signature Proof Idea → Proposal Core Concept → Experience Principle → Visitor Journey → Content/Media Execution → Anti-pattern Validation. Do not generate Visitor Journey before Proposal Core Concept. Choose recommendation by best-fit strategic direction, RFP specificity, originality, whole-proposal organizing power, expandability to space/content/media/operation, evaluator clarity, and anti-pattern avoidance. recommendation.whyNotOthers must use neutral trade-off language and must explain what the other directions are useful for, not why they are bad.`;

    try {
      const generated = await createStructuredJson<ConceptCandidatesResult>({
        schemaName: 'proposal_concept_candidates',
        schema: conceptCandidatesJsonSchema,
        system: systemPrompt,
        user: userPrompt,
        timeoutMs: CONCEPT_GENERATION_TIMEOUT_MS,
      });

      let result = withNeutralDirectionRecommendation(normalizeConceptCandidatesResult(enforceResultMatrixGate({
        ...generated,
        conceptPromptVersion,
        regenerationId: metadata.regenerationId,
        generationAttempt: metadata.generationAttempt,
        generatedAt: metadata.generatedAt,
        concepts: generated.concepts.slice(0, maxCandidates),
      }, { primaryType: selectedRfpConceptType, matrixType: selectedMatrixType, plan: strategicDirectionPlan, brandExperienceMatrix, entityMatrix: differentiationStrategy.entityDifferentiationMatrix, sanitizerApplied: sanitizedContext.sanitizerApplied, sanitizerReason: sanitizedContext.sanitizerReason, rawMatrixType: sanitizedContext.rawMatrixType, rawPrimaryRfpConceptType: sanitizedContext.rawPrimaryRfpConceptType, multiEntityEvidenceCount: classificationEvidence.multiEntityEvidenceCount, singleBrandVisitorRoomEvidenceCount: classificationEvidence.singleBrandVisitorRoomEvidenceCount })));
      result.rfpDiagnosis = body.rfpDiagnosis;
      result.brandProductIntelligence = body.brandProductIntelligence;
      result.proposalPatternsUsedForDirections = false;
      result.currentRfpOnlyMode = true;
      result = applyNonBlockingConceptNamingGuard(result, { input: body.input, analysis: body.analysis, proposalNarrative, documentChunks: body.documentChunks ?? [], avoidanceRules: [] });
      result = repairEntityBalance(result, balancedEvidenceSummary);
      return conceptsJson(attachGenerationMetadata(result, metadata));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'generation timeout';
      const fallbackBase = buildFallbackConcepts(body.analysis, proposalNarrative, reason, metadata);
      const fallbackSeed = withNeutralDirectionRecommendation(enforceResultMatrixGate(fallbackBase, { primaryType: selectedRfpConceptType, matrixType: selectedMatrixType, plan: strategicDirectionPlan, brandExperienceMatrix, entityMatrix: differentiationStrategy.entityDifferentiationMatrix, sanitizerApplied: sanitizedContext.sanitizerApplied, sanitizerReason: sanitizedContext.sanitizerReason, rawMatrixType: sanitizedContext.rawMatrixType, rawPrimaryRfpConceptType: sanitizedContext.rawPrimaryRfpConceptType, multiEntityEvidenceCount: classificationEvidence.multiEntityEvidenceCount, singleBrandVisitorRoomEvidenceCount: classificationEvidence.singleBrandVisitorRoomEvidenceCount }));
      fallbackSeed.rfpDiagnosis = body.rfpDiagnosis;
      fallbackSeed.brandProductIntelligence = body.brandProductIntelligence;
      fallbackSeed.proposalPatternsUsedForDirections = false;
      fallbackSeed.currentRfpOnlyMode = true;
      const fallback = repairEntityBalance(applyNonBlockingConceptNamingGuard(fallbackSeed, { input: body.input, analysis: body.analysis, proposalNarrative, documentChunks: body.documentChunks ?? [], avoidanceRules: [] }), balancedEvidenceSummary);
      return conceptsJson(attachGenerationMetadata(fallback, metadata));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉 생성 시간이 초과되었습니다. 후보 수와 참고 패턴을 줄여 다시 시도해 주세요.';
    return conceptsJson({ error: message, conceptPromptVersion }, { status: 500 });
  }
}
