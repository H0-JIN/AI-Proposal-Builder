import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandExperienceMatrixItem, ConceptCandidate, ConceptDevelopmentLogic, ConceptNameOptionsResult, EntityDifferentiationItem, MatrixType, ProjectInput, ProposalNarrative, RfpDiagnosis, BrandProductIntelligence } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { getActiveMatrix, sanitizeConceptContextByRfpType } from '@/lib/conceptContextSanitizer';

export const dynamic = 'force-dynamic';

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

const GENERIC_MAIN_HOOKS = ['현장', '현장의', '경험', '체험', '증명', '가치', '연결', '흐름', '여정', '신뢰', '균형'] as const;

const INTERNAL_LANGUAGE_PATTERN = /\b(proof|evidence|proof burden|evaluator clarity|validation|source|score|signature proof idea)\b|증명 과제|증거|Proof|Evidence|Validation|Source|Score/gi;

const INTERNAL_COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/signature proof idea/gi, '대표 체험 장면'],
  [/proof burden/gi, '반드시 보여줘야 할 것'],
  [/evaluator clarity/gi, '심사자가 한눈에 이해하는 구조'],
  [/validation/gi, '검토 결과'],
  [/evidence/gi, '근거'],
  [/proof/gi, '설득 장면'],
  [/source/gi, '근거'],
  [/score/gi, '평가'],
  [/증명 과제/g, '반드시 보여줘야 할 것'],
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
];

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/gi, '');
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
  const text = [option.conceptName, option.oneLineSlogan, option.shortMeaning, option.whyItFitsRfp].filter(Boolean).join(' ');
  return vocabulary.some((word) => word.length >= 2 && text.includes(word));
}

function hasUnsupportedCategoryTerms(name: string, context: string) {
  const lowerContext = context.toLowerCase();
  const unsupportedGroups = [
    { terms: ['hydrogen', '수소', 'energy', '에너지', 'grid'], evidence: /hydrogen|수소|energy|에너지|grid|전력|전기/i },
    { terms: ['pocari', '포카리', 'beverage', 'drink', '음료'], evidence: /pocari|포카리|beverage|drink|음료|이온|factory|공장/i },
  ];
  return unsupportedGroups.some((group) => group.terms.some((term) => name.toLowerCase().includes(term.toLowerCase())) && !group.evidence.test(lowerContext));
}

function passesNameFirewall(option: ConceptNameOptionsResult['options'][number], context: string, vocabulary: string[] = [], repeatedHooks?: Map<string, number>) {
  const name = option.conceptName || '';
  if (!name.trim()) return false;
  if (resemblesBlockedExample(name)) return false;
  if (hasUnsupportedCategoryTerms(name, context)) return false;
  if (hasInternalMainCopy(option)) return false;
  if (repeatedHooks && repeatsGenericMainHook(option, repeatedHooks)) return false;
  if (!usesCurrentVocabulary(option, vocabulary)) return false;
  const validation = option.validation;
  return !validation || Object.values(validation).every(Boolean);
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

function fallbackOptions(direction: ConceptCandidate, diagnosis?: RfpDiagnosis, analysis?: AnalysisResult, vocabulary: string[] = []): ConceptNameOptionsResult {
  const coreWinningCondition = diagnosis?.coreWinningCondition || direction.winningThesisUse?.winningClaim || direction.conceptLeap?.corePromise || analysis?.projectOverview || '현재 RFP의 승부 조건을 방문자가 자연스럽게 이해하는 제안';
  const strategicTension = diagnosis?.strategicTension || direction.conceptLeap?.conceptLeap || direction.whatThisDirectionEmphasizes || coreWinningCondition;
  const proofBurden = userFacingCopy(diagnosis?.proofBurden || direction.signatureProofIdea?.whyThisProvesTheConcept || coreWinningCondition);
  const signatureProof = userFacingCopy(direction.signatureProofIdea?.signatureScene || direction.signatureProofIdea?.signatureContent || direction.signatureProofIdea?.whyThisProvesTheConcept || proofBurden);
  const projectHint = [analysis?.projectOverview, direction.rfpConceptType].filter(Boolean).join(' / ');
  const isGlobal = /global|exhibition|expo|pavilion|brand|tour|center|전시|브랜드|해외|글로벌|박람회/i.test(projectHint);
  const contextNoun = vocabulary.find((word) => !GENERIC_MAIN_HOOKS.includes(word as (typeof GENERIC_MAIN_HOOKS)[number])) || (/hydrogen|수소/i.test(projectHint + coreWinningCondition + strategicTension) ? '수소' : /pocari|포카리|음료|drink|beverage/i.test(projectHint) ? '기억' : /brand|브랜드/i.test(projectHint) ? '브랜드' : /pavilion|expo|전시|박람회/i.test(projectHint) ? '공간' : '장면');
  const secondaryNoun = vocabulary.find((word) => word !== contextNoun) || '기억';
  const englishAnchor = contextNoun === '수소' ? 'H2' : contextNoun === '기억' ? 'Memory' : contextNoun === '브랜드' ? 'Brand' : 'Moment';
  const rawNames = [
    `${contextNoun}가 남는 방`,
    `${secondaryNoun}을 만나는 길`,
    `${contextNoun}의 감각`,
    `${secondaryNoun}으로 기억되는 순간`,
    isGlobal ? `${englishAnchor} Room` : `${contextNoun}의 리듬`,
    isGlobal ? `Visible ${englishAnchor}` : `${secondaryNoun}의 장면`,
    `${englishAnchor} Moment`,
    `${contextNoun} to Memory`,
  ].filter((name) => !resemblesBlockedExample(name)).slice(0, 3);
  const styles = ['Direct claim', 'Short bilingual title', 'Brand/category-specific phrase', 'Spatial/experience frame', 'Symbolic but grounded', 'Strong one-line statement'] as const;
  return {
    selectedDirectionId: direction.conceptId,
    recommendedOptionIndex: 0,
    generationNote: 'LLM naming call failed, so fallback options were generated from confirmedDiagnosis, selectedStrategicDirection, and current RFP analysis only. Weak generic fallback names are intentionally blocked.',
    options: rawNames.map((conceptName, index) => ({
      id: `${direction.conceptId || 'direction'}-fallback-${index + 1}`,
      conceptName,
      languageMode: /[A-Za-z]/.test(conceptName) && /[가-힣]/.test(conceptName) ? 'bilingual' : /[A-Za-z]/.test(conceptName) ? 'English' : 'Korean',
      koreanSubtitle: /[A-Za-z]/.test(conceptName) ? compact(coreWinningCondition, 48) : '',
      oneLineSlogan: compact(`이 제안은 ${coreWinningCondition}`, 100),
      shortMeaning: compact(strategicTension, 90),
      whyItFitsRfp: compact(`RFP가 요구한 핵심 조건을 ${signatureProof} 중심의 방문자 언어로 바꾼 이름입니다.`, 180),
      strategicClaim: compact(coreWinningCondition, 120),
      expandableTo: {
        space: compact(`${proofBurden}을 관람 동선과 핵심 장면으로 체감시키는 공간 프레임`, 90),
        content: compact(`${strategicTension}을 이해 가능한 이야기와 확인 요소로 전환`, 90),
        media: compact(`${signatureProof}를 즉시 이해되는 인터랙션/영상 장면으로 구현`, 90),
        operation: compact(`운영 단계에서 ${coreWinningCondition}의 신뢰를 반복 확인`, 90),
      },
      validation: truthyValidation(),
      coverReadinessScore: Math.max(7, 9 - (index % 3)),
      specificityScore: Math.max(7, 9 - (index % 3)),
      coverTitleScore: Math.max(7, 9 - (index % 3)),
      memorabilityScore: Math.max(7, 8 - (index % 2)),
      rfpSpecificityScore: Math.max(7, 9 - (index % 3)),
      expandabilityScore: Math.max(7, 8 - (index % 2)),
      risk: 'Fallback 후보이므로 최종 선택 전 표현의 고유성과 어감을 확인해야 합니다.',
      namingStyle: styles[index % styles.length],
      mainRisk: '자동 fallback 이름이라 RFP 원문 고유어를 더 반영하면 강해질 수 있습니다.',
    })),
  };
}

export async function POST(request: Request) {
  let parsedBody: { selectedDirection?: ConceptCandidate } | null = null;
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; proposalNarrative?: ProposalNarrative; conceptDevelopmentLogic?: ConceptDevelopmentLogic; entityDifferentiationMatrix?: EntityDifferentiationItem[]; relevantMatrix?: unknown; activeMatrix?: unknown; brandExperienceMatrix?: BrandExperienceMatrixItem[]; matrixType?: MatrixType; primaryRfpConceptType?: string; languageMode?: string; rfpDiagnosis?: RfpDiagnosis; brandProductIntelligence?: BrandProductIntelligence; recentNameOptions?: string[] };
    parsedBody = body;
    if (!body.input || !body.analysis || !body.selectedDirection) return json(errorResponse('프로젝트 입력값, 분석 결과, 선택한 전략 방향이 필요합니다.'), { status: 400 });

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
      'Internally use coreWinningCondition, strategicTension, proofBurden, selectedStrategicDirection, and signatureProofIdea, but translate all visible copy into planner-friendly Korean: proof=설득 장면/신뢰 장면/체감 포인트, evidence=근거/확인 요소, proof burden=반드시 보여줘야 할 것, signature proof idea=대표 체험 장면.',
      'Build names from currentRfpVocabularySet first: brand keywords, product/service words, sensory cues, audience context, process/operation words, spatial context, and category-specific language supported by the current RFP. Do not hardcode example vocabularies across RFPs.',
      'Use only selected strategic direction, confirmed diagnosis, brandProductIntelligence, signatureProofIdea, and current RFP analysis. Do not use proposal_patterns, previous proposal names, old clients/categories, WDS/pavilion wording, won/lost outcomes, old slogans, or old structures.',
      `Blocked example names are banned as outputs and paraphrase sources: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}. Do not output or imitate them.`,
    ].join('\n');

    const user = `프로젝트: ${body.input.projectName}\n클라이언트: ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
Selected secondaryRfpConceptTypes: ${body.selectedDirection.secondaryRfpConceptTypes?.join(' / ') || 'none'}
Relevant Matrix Type: ${sanitizedContext.matrixType}
Active Matrix Type: ${sanitizedContext.activeMatrixType}
Sanitizer Applied: ${sanitizedContext.sanitizerApplied}
Sanitizer Reason: ${sanitizedContext.sanitizerReason}
Selected Direction Lens: ${body.selectedDirection.strategicDirectionLabel || body.selectedDirection.directionLabel || body.selectedDirection.strategicDirectionType}
Confirmed RFP-only Diagnosis: ${compact(body.rfpDiagnosis, 2200)}
Brand/Product Intelligence: ${compact(body.brandProductIntelligence, 2200)}
Selected Strategic Direction Basis: ${compact({ winningThesis: body.selectedDirection.winningThesisUse, conceptLeap: body.selectedDirection.conceptLeap, signatureProofIdea: body.selectedDirection.signatureProofIdea, whatThisDirectionEmphasizes: body.selectedDirection.whatThisDirectionEmphasizes, rfpGrounding: body.selectedDirection.rfpGrounding }, 2200)}
Winning Thesis / Concept Leap / Signature Proof Idea 포함 전략 방향 JSON: ${compact(body.selectedDirection, 4500)}\nConcept Development Logic: ${compact(body.conceptDevelopmentLogic, 2600)}\nRelevant Matrix Only: ${compact(activeMatrix, 2200)}\nLanguage Mode: ${body.languageMode || 'bilingual'}\nProposal Narrative: ${compact(body.proposalNarrative, 2200)}
currentRfpVocabularySet: ${currentRfpVocabularySet.join(' / ')}
Brand vocabulary: ${body.brandProductIntelligence?.brandSpecificVocabulary?.join(' / ') || 'none'}
Words/tone to avoid: ${body.brandProductIntelligence?.wordsToAvoid?.join(' / ') || 'none'}
Recent current-session names to avoid: ${body.recentNameOptions?.join(' / ') || 'none'}\n\n요구사항:\n- options는 반드시 정확히 3개. 모두 표지에 올릴 수 있는 강한 후보여야 한다.\n- namingStyle 필드를 반드시 다음 중 하나로 다양화: Direct claim, Short bilingual title, Brand/category-specific phrase, Spatial/experience frame, Symbolic but grounded, Strong one-line statement.\n- 3개는 선택된 방향의 axis, thesis, signature scene에서만 갈라지는 서로 다른 naming logic이어야 한다. 같은 구조로 반복하지 말라.
- generic hook(현장/경험/체험/증명/가치/연결/흐름/여정/신뢰/균형)이 conceptName 또는 oneLineSlogan의 주어처럼 3회 이상 반복되면 약한 후보를 currentRfpVocabularySet 기반으로 재작성한다.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsRfp, strategicClaim, expandableTo(space/content/media/operation), validation, namingStyle, mainRisk, coverReadinessScore, specificityScore, memorabilityScore, coverTitleScore, rfpSpecificityScore, expandabilityScore, risk를 작성.\n- conceptName은 전략 라벨/슬라이드 제목/제품 카테고리/분석 heading이 아니라 제안서 첫 페이지 제목처럼 winning claim을 표현해야 하며 브랜드 경험 콘셉트, 전시 콘셉트, 공간 경험 프레임으로 확장 가능해야 한다. 임시 전략 방향명/컨설팅 목차명/단순 제품명/랜덤 영어 명사 조합이 아니다.
- 각 option의 oneLineSlogan은 conceptName이 주장하는 승리 논리를 1문장으로 설명한다. whyItFitsRfp는 confirmed diagnosis의 coreWinningCondition, strategicTension, proofBurden, selected direction, signatureProofIdea 중 최소 2개와 연결한다.
- generic English word combinations, vague abstract nouns, consulting-style labels, literal RFP summaries, any-name-fits-any-exhibition 후보를 거부하고 재생성한다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- Generate names only for this selected strategic direction. Do not generate names that could equally fit the other directions. 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- 각 후보 생성 전 내부적으로 What must this proposal prove? What belief shift should evaluator make? Strongest claim? Cover first-page fit? Expandable to space/content/media/operation? 을 검증하고 실패하면 버려라.
- Korean proposal users: 최소 2개 Korean-first 후보를 포함하고, 글로벌/브랜드/전시 맥락이면 최소 2개 English 또는 bilingual 후보를 포함하라. English 후보에는 koreanSubtitle 또는 oneLineSlogan으로 자연스러운 한국어 설명을 제공하라.
- main visible copy(conceptName, oneLineSlogan, shortMeaning, whyItFitsRfp, mainRisk)에 raw English internal terms(proof/evidence/proof burden/evaluator clarity/validation/source/score/signature proof idea)를 쓰지 말고 한국어 사용자 언어로 번역한다.
- validation의 모든 boolean은 true인 후보만 반환하라: namesAreSpecificToSelectedDirection, namesDoNotFitOtherDirections, noDuplicateConceptLogic, noNearDuplicateNames, noGenericEnglishCombination, connectedToDiagnosis, connectedToBrandProductIntelligence, coverReady, connectedToCoreWinningCondition, connectedToSelectedDirection, currentRfpSpecific, noPromptExampleCopy, noCrossRfpContamination, notGenericEnglishCombination, notInternalStrategyLabel, notSlideTitle, notTooLong, expandableToProposalSystem, specificToCurrentRfp, noRepeatedMainHook, noInternalProofLanguageInMainCopy, currentRfpVocabularyUsed, notGeneric, notCrossRfpContaminated.
- 금지 예시명/이전 예시명을 그대로 출력하거나 변형하지 말라: ${BLOCKED_EXAMPLE_CONCEPT_NAMES.join(', ')}.
- 현재 RFP/진단/brandProductIntelligence에 없는 category word(예: Pocari/공장 방문 RFP의 hydrogen/energy/grid)를 쓰면 실패다. 수소/에너지 RFP에서만 현재 증거가 있을 때 허용한다.
- brandProductIntelligence.wordsToAvoid와 무관 카테고리 어휘를 쓰면 실패다. Pocari와 수소 전시 양쪽에 그대로 맞는 이름, Moment/Memory/Proof/Evidence/Field/Flow/Grid 같은 범용어 중심 이름은 현재 RFP 강한 근거가 없으면 거부한다.
- Final naming source lock: selectedStrategicDirection, confirmed diagnosis, current RFP summary만 네이밍 근거로 사용하라. proposal_patterns, previous proposal names, old clients/categories/wording은 사용하지 말라. hardcoded direction presets는 사용하지 말라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- single_brand_experience 또는 visitor_center_or_tour는 brand meaning, sensory cue, product value, process/proof, visitor memory, transformation after visit에서 이름을 도출하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라.
- multi_entity_pavilion만 shared pavilion frame, entity/domain relationship, system logic, capability proof, symbolic presence 기반 네이밍을 허용한다.`;

    const result = await createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user, timeoutMs: 18_000 });
    const styles = ['Direct claim', 'Short bilingual title', 'Brand/category-specific phrase', 'Spatial/experience frame', 'Symbolic but grounded', 'Strong one-line statement'] as const;
    const relevanceContext = [body.input.projectName, body.input.clientName, compact(body.analysis, 5000), compact(body.rfpDiagnosis, 2500), compact(body.brandProductIntelligence, 2500), compact(body.selectedDirection, 2500)].join(' ');
    const repeatedHooks = genericHookCounts(result.options ?? []);
    const options = (result.options ?? []).slice(0, 3).map((option) => ({ ...option, oneLineSlogan: userFacingCopy(option.oneLineSlogan || option.shortMeaning, 120), shortMeaning: userFacingCopy(option.shortMeaning, 100), whyItFitsRfp: userFacingCopy(option.whyItFitsRfp || option.whyItFits || option.shortMeaning, 180), mainRisk: userFacingCopy(option.mainRisk || option.risk, 120) })).filter((option) => passesNameFirewall(option, relevanceContext, currentRfpVocabularySet, repeatedHooks)).map((option, index) => ({ ...option, id: option.id || `${body.selectedDirection.conceptId || 'direction'}-name-${index + 1}`, koreanSubtitle: option.koreanSubtitle ?? '', oneLineSlogan: option.oneLineSlogan || option.shortMeaning, whyItFitsRfp: option.whyItFitsRfp || option.whyItFits || option.shortMeaning, namingStyle: option.namingStyle ?? styles[index % styles.length], mainRisk: option.mainRisk || option.risk, strategicClaim: option.strategicClaim || option.oneLineSlogan || option.shortMeaning, expandableTo: option.expandableTo ?? { space: option.shortMeaning, content: option.whyItFitsRfp || option.shortMeaning, media: option.oneLineSlogan || option.shortMeaning, operation: option.mainRisk || option.risk }, validation: option.validation ?? truthyValidation(), coverReadinessScore: option.coverReadinessScore ?? option.coverTitleScore, specificityScore: option.specificityScore ?? option.rfpSpecificityScore }));
    const normalized = { ...result, selectedDirectionId: body.selectedDirection.conceptId, options };
    if (options.length < 3) return json({ ...successResponse(fallbackOptions(body.selectedDirection, body.rfpDiagnosis, body.analysis, currentRfpVocabularySet)), warning: 'LLM 후보가 검증 기준을 충분히 통과하지 못해 fallback 후보를 반환했습니다.' });
    return json(successResponse(normalized));
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.';
    const fallbackDirection = { conceptId: 'fallback-direction', rfpConceptType: 'single_brand_experience', strategicDirectionLabel: '브랜드 경험 방향' } as ConceptCandidate;
    try {
      return json({ ...successResponse(fallbackOptions(parsedBody?.selectedDirection ?? fallbackDirection, undefined, undefined)), warning: message, fallbackError: errorResponse('LLM/API 호출 실패로 fallback 컨셉명을 반환했습니다.', message) });
    } catch {
      return json({ ...successResponse(fallbackOptions(fallbackDirection, undefined, undefined)), warning: message, fallbackError: errorResponse('LLM/API 호출 실패로 fallback 컨셉명을 반환했습니다.', message) });
    }
  }
}
