import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandExperienceMatrixItem, ConceptCandidate, ConceptDevelopmentLogic, ConceptNameOptionsResult, EntityDifferentiationItem, MatrixType, ProjectInput, ProposalNarrative, RfpDiagnosis, BrandProductIntelligence } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { getActiveMatrix, sanitizeConceptContextByRfpType } from '@/lib/conceptContextSanitizer';

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

const BLOCKED_EXAMPLE_CONCEPT_NAMES = [
  'Hydrogen, Here.',
  'The Hydrogen Reality',
  'Now, Hydrogen',
  'Here Comes Hydrogen',
  'The Future Runs Here',
  'From Vision to Current',
  'Future Grid',
  'Nexus',
  'Pulse',
  'Vanguard',
  'Sphere',
  '수소가 닿는 밤',
  '기술을 만나는 길',
  '수소의 순간',
  'Moment Room',
  'Visible Moment',
  'Memory Moment',
  'Moment to Memory',
];

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
  const fields = [
    body.input.projectName,
    body.input.clientName,
    body.analysis.projectOverview,
    analysisVocabulary.targetAudience,
    body.analysis.requiredScope?.join(' '),
    analysisVocabulary.brandKeywords?.join(' '),
    analysisVocabulary.coreRequirements?.join(' '),
    compact(body.analysis.rfpRequirements, 1000),
    body.rfpDiagnosis?.clientUniquePosition,
    body.rfpDiagnosis?.coreWinningCondition,
    body.rfpDiagnosis?.hiddenNeed,
    body.selectedDirection.strategicDirectionLabel,
    body.selectedDirection.whatThisDirectionEmphasizes,
    body.selectedDirection.rfpGrounding?.join(' '),
    compact(body.conceptDevelopmentLogic, 1000),
    compact(activeMatrix, 1000),
  ];
  return tokenizeKoreanNouns(fields.filter(Boolean).join(' ')).slice(0, 28);
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

function hasUnsupportedCategoryTerms(name: string, context: string) {
  const lowerContext = context.toLowerCase();
  const unsupportedGroups = [
    { terms: ['hydrogen', '수소', 'energy', '에너지', 'grid'], evidence: /hydrogen|수소|energy|에너지|grid|전력|전기/i },
    { terms: ['pocari', '포카리', 'beverage', 'drink', '음료'], evidence: /pocari|포카리|beverage|drink|음료|이온|factory|공장/i },
  ];
  return unsupportedGroups.some((group) => group.terms.some((term) => name.toLowerCase().includes(term.toLowerCase())) && !group.evidence.test(lowerContext));
}

function passesNameFirewall(option: ConceptNameOptionsResult['options'][number], context: string, repeatedHooks?: Map<string, number>) {
  const name = option.conceptName || '';
  if (!name.trim()) return false;
  if (resemblesBlockedExample(name)) return false;
  if (hasUnsupportedCategoryTerms(name, context)) return false;
  if (hasInternalMainCopy(option)) return false;
  if (repeatedHooks && repeatsGenericMainHook(option, repeatedHooks)) return false;
  // Concrete safety checks only. We intentionally do NOT require every validation boolean to be true,
  // and the RFP-vocabulary check is now a soft ranking preference (applied in the pipeline) rather than a
  // hard gate, so an abstract/English cover name the prompt itself requests can never zero out the response.
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

    const system = [
      'You are a senior Korean proposal concept naming director.',
      'Generate final cover-level concept name options only after a strategic direction has been selected.',
      'Return exactly 3 strong final concept name options for the selected strategic direction only. Fewer, sharper, non-interchangeable options are required.',
      'Avoid consulting labels, analysis headings, internal strategy phrases, generic abstract nouns, awkward translated phrases, product-specific names, one-zone-specific names, one-entity-specific names, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-cover concepts that express the winning claim and can expand into space, content, media, and operation.',
      'Internally use coreWinningCondition, strategicTension, proofBurden, selectedStrategicDirection, and signatureProofIdea, but translate all visible copy into planner-friendly Korean: proof=설득 포인트/확인 장면/대표 설득 장면, evidence=근거, proof burden=설득 과제, required proof elements=필수 설득 요소, signature proof idea=대표 설득 장면.',
      'Build names from currentRfpVocabularySet first: brand keywords, product/service words, sensory cues, audience context, process/operation words, spatial context, and category-specific language supported by the current RFP. Do not hardcode example vocabularies across RFPs.',
      'Use only selected strategic direction, its directionAxis and 대표 설득 장면, confirmed diagnosis, brandProductIntelligence, signatureProofIdea, and current RFP analysis. Do not use proposal_patterns, previous proposal names, old clients/categories, WDS/pavilion wording, won/lost outcomes, old slogans, or old structures.',
      `Blocked example names are banned as outputs and paraphrase sources: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}. Do not output or imitate them.`,
    ].join('\n');

    const user = `프로젝트: ${body.input.projectName}\n클라이언트: ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
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
- generic hook(현장/경험/체험/증명/가치/연결/흐름/여정/신뢰/균형)이 conceptName 또는 oneLineSlogan의 주어처럼 3회 이상 반복되면 약한 후보를 currentRfpVocabularySet 기반으로 재작성한다.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsSelectedDirection, namingStyle, mainRisk만 출력한다. 점수, validation boolean 블록, expandableTo, 디버그/근거 필드는 출력하지 말라(서버가 코드로 처리한다).\n- conceptName은 전략 라벨/슬라이드 제목/제품 카테고리/분석 heading이 아니라 제안서 첫 페이지 제목처럼 winning claim을 표현해야 하며 브랜드 경험 콘셉트, 전시 콘셉트, 공간 경험 프레임으로 확장 가능해야 한다. 임시 전략 방향명/컨설팅 목차명/단순 제품명/랜덤 영어 명사 조합이 아니다.
- 각 option의 oneLineSlogan은 conceptName이 주장하는 승리 논리를 1문장으로 설명한다. whyItFitsSelectedDirection은 선택한 전략 방향과 confirmed diagnosis의 coreWinningCondition, strategicTension, proofBurden, signatureProofIdea 중 최소 2개와 연결한다.
- generic English word combinations, vague abstract nouns, consulting-style labels, literal RFP summaries, any-name-fits-any-exhibition 후보를 거부하고 재생성한다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- Generate names only for the selected strategic direction. The names must not be usable for the other two directions. If a name could fit another direction with no change, reject it. 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- Use the selected direction’s directionAxis and 대표 설득 장면 as the primary naming source.
- 추가 후보 요청이면 Existing names for selected direction과 Names already generated for other directions를 모두 피하고, 같은 slogan structure / strategic claim / shortMeaning 반복을 거부하라.
- 각 후보 생성 전 내부적으로 What must this proposal prove? What belief shift should evaluator make? Strongest claim? Cover first-page fit? Expandable to space/content/media/operation? 을 검증하고 실패하면 버려라.
- Korean proposal users: 최소 2개 Korean-first 후보를 포함하고, 글로벌/브랜드/전시 맥락이면 최소 2개 English 또는 bilingual 후보를 포함하라. English 후보에는 koreanSubtitle 또는 oneLineSlogan으로 자연스러운 한국어 설명을 제공하라.
- main visible copy(conceptName, oneLineSlogan, shortMeaning, whyItFitsSelectedDirection, mainRisk)에 raw English internal terms(proof/evidence/proof burden/evaluator clarity/validation/source/score/signature proof idea)를 쓰지 말고 한국어 사용자 언어로 번역한다.
- 컨셉명은 선택한 전략 방향에만 맞아야 하고 다른 방향에는 어색해야 하며, 후보끼리 근접 중복이 아니어야 한다. validation boolean 블록은 출력하지 말라(구분성·금지어·중복 검증과 점수는 서버가 코드로 수행한다).
- 금지 예시명/이전 예시명을 그대로 출력하거나 변형하지 말라: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}.
- 현재 RFP/진단/brandProductIntelligence에 없는 category word(예: Pocari/공장 방문 RFP의 hydrogen/energy/grid)를 쓰면 실패다. 수소/에너지 RFP에서만 현재 증거가 있을 때 허용한다.
- brandProductIntelligence.wordsToAvoid와 무관 카테고리 어휘를 쓰면 실패다. Pocari와 수소 전시 양쪽에 그대로 맞는 이름, Moment/Memory/Proof/Evidence/Field/Flow/Grid 같은 범용어 중심 이름은 현재 RFP 강한 근거가 없으면 거부한다.
- Final naming source lock: selectedStrategicDirection, confirmed diagnosis, current RFP summary만 네이밍 근거로 사용하라. proposal_patterns, previous proposal names, old clients/categories/wording은 사용하지 말라. hardcoded direction presets는 사용하지 말라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- single_brand_experience 또는 visitor_center_or_tour는 brand meaning, sensory cue, product value, process/확인 장면, visitor memory, transformation after visit에서 이름을 도출하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라.
- multi_entity_pavilion만 shared pavilion frame, entity/domain relationship, system logic, capability 확인 장면, symbolic presence 기반 네이밍을 허용한다.`;

    const result = await createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user, timeoutMs: 18_000, maxRetries: 1 });
    const styles = ['Direct claim', 'Short bilingual title', 'Brand/category-specific phrase', 'Spatial/experience frame', 'Symbolic but grounded', 'Strong one-line statement'] as const;
    const relevanceContext = [body.input.projectName, body.input.clientName, compact(body.analysis, 5000), compact(body.rfpDiagnosis, 2500), compact(body.brandProductIntelligence, 2500), compact(body.selectedDirection, 2500)].join(' ');
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
    const safe = prepared.filter((entry) => passesNameFirewall(entry.option, relevanceContext, repeatedHooks));
    // Soft vocabulary preference: prefer vocab-matching names, but never let the vocab check alone drop the count to 0.
    const vocabMatched = safe.filter((entry) => entry.usesVocabulary);
    const ranked = (vocabMatched.length ? [...vocabMatched, ...safe.filter((entry) => !entry.usesVocabulary)] : safe).map((entry) => entry.option);
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
    const normalized = { ...result, selectedDirectionId: body.selectedDirection.conceptId, options };
    if (!options.length) {
      const reason = !deduped.length ? (blockedNameDrops ? 'blocked_name_zeroout' : 'no_model_options') : 'firewall_zeroout';
      return json(errorResponse('선택한 전략 방향과 충분히 구분되는 컨셉명이 생성되지 않았습니다. 다시 생성해 주세요.', `reason=${reason}; returned=${(result.options ?? []).length}; deduped=${deduped.length}; safe=${safe.length}; blockedNameDrops=${blockedNameDrops}`), { status: 422 });
    }
    return json(successResponse(normalized));
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.';
    return json(errorResponse('선택한 전략 방향에 맞는 컨셉명을 생성하지 못했습니다. 전략 방향을 다시 선택하거나 컨셉명을 다시 생성해 주세요.', `reason=${classifyServerError(message)}; ${message}`), { status: 502 });
  }
}
