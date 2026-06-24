import { NextResponse } from 'next/server';
import { outlineJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ConceptDevelopmentLogic, ProjectInput, ProposalNarrative, RfpDiagnosis, SlideOutline } from '@/lib/types';
import { extractRfpConceptHierarchy, formatRfpHierarchyAnchor } from '@/lib/rfpConceptHierarchy';
import type { ChunkCategory, DocumentChunk } from '@/lib/rag';
import { normalizeProposalType, proposalTypeDescriptions, proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline, extractProductCodes } from '@/lib/experiencePlan';
import { removeInternalConceptComparisonSlides } from '@/lib/internalSlides';
import { ensureRfpRequirementCoverage } from '@/lib/rfpRequirements';
import { formatCategoryEvidenceGroupsForPrompt, retrieveCategoryEvidenceGroups } from '@/lib/rag';
import { applyProposalStructureGuardToOutline, buildConstraintPriorityGuardInstruction, buildProposalStructureGuard, buildSelectedConceptDominanceInstruction, proposalScopeTypeLabels } from '@/lib/proposalStructureGuard';
import { applyReferenceGuardToOutline, buildReferenceGuardInstruction, isReferenceSlideExplicitlyRequested, strategicMessageFieldsFromLogic } from '@/lib/referenceGuard';
import { buildStrategyLayerMetadata } from '@/lib/strategyLayer';
import { ensureProposalNarrative, summarizeProposalNarrative } from '@/lib/proposalNarrative';
import { getConceptTagline, getPresentationConceptName } from '@/lib/conceptNamingGuard';
import { buildPatternLearningSummary, formatProposalAvoidanceRulesForPrompt, formatProposalPatternDiagnostics, formatProposalPatternsForOutlinePrompt, formatProposalSuccessPatternComparisonForPrompt, retrieveProposalPatternsForOutline } from '@/lib/proposalPatternOutline';
import { buildRfpDifferentiationStrategy, summarizeDifferentiationStrategy } from '@/lib/rfpDifferentiation';
import { applyDeckStructure, buildDeckDesignGuide, validateDeckStructure, type DeckSlideSeed } from '@/lib/deckStructure';

// Factory used by applyDeckStructure to synthesize a Cover / Table of Contents slide as a full SlideOutline.
function makeOutlineDeckSlide(seed: DeckSlideSeed): SlideOutline {
  return {
    slideNumber: seed.slideNumber,
    slideType: seed.slideType,
    slideTitle: seed.slideTitle,
    slidePurpose: seed.slidePurpose,
    slideRole: '',
    relationToThesis: '',
    whyThisSlideExists: '',
    sourceEvidence: [],
    referenceAllowed: false,
    keyMessage: seed.keyMessage,
    mainCopy: seed.mainCopy,
    confirmNeededNote: '',
    slideSection: seed.slideSection,
  };
}


function normalizeOutlineSourceEvidence(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  return [];
}

function sanitizeOutlineSlides(slides: SlideOutline[] = []) {
  return slides.map((slide) => ({
    ...slide,
    sourceEvidence: normalizeOutlineSourceEvidence((slide as { sourceEvidence?: unknown }).sourceEvidence),
    referenceAllowed: Boolean(slide.referenceAllowed),
  }));
}


function normalizeSlideRoleText(value?: string) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\s\-/_:()\[\]{}.,]+/g, '')
    .replace(/대상관객|타깃관객|targetaudience/g, 'audience')
    .replace(/전략적기회|strategicdirection/g, 'strategicopportunity')
    .replace(/coreconcept|핵심콘셉트/g, 'concept')
    .replace(/conceptrationale|컨셉도출|콘셉트도출/g, 'conceptrationale')
    .trim();
}

function duplicateRoleKey(slide: SlideOutline) {
  const roleText = normalizeSlideRoleText(`${slide.slideRole} ${slide.slideTitle} ${slide.slidePurpose}`);
  if (/audience.*insight|insight.*audience|관객.*인사이트|타깃.*인사이트/.test(roleText)) return 'audience-insight';
  if (/strategicopportunity|전략.*기회/.test(roleText)) return 'strategic-opportunity';
  if (/conceptrationale|컨셉.*도출|콘셉트.*도출|왜.*컨셉|whythisconcept/.test(roleText)) return 'concept-rationale';
  if (/\bconcept\b|핵심콘셉트/.test(roleText)) return 'core-concept';
  if (/contentmechanism|콘텐츠.*메커니즘|작동원리/.test(roleText)) return 'content-mechanism';
  return normalizeSlideRoleText(slide.slideTitle);
}

function mergeDuplicateSlideRoles(slides: SlideOutline[] = []) {
  const seen = new Map<string, SlideOutline>();
  const merged: SlideOutline[] = [];

  for (const slide of slides) {
    const key = duplicateRoleKey(slide);
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, slide);
      merged.push(slide);
      continue;
    }

    previous.keyMessage = [previous.keyMessage, slide.keyMessage].filter(Boolean).join(' / ');
    previous.mainCopy = [previous.mainCopy, slide.mainCopy].filter(Boolean).join(' ');
    previous.sourceEvidence = Array.from(new Set([...(previous.sourceEvidence ?? []), ...(slide.sourceEvidence ?? [])])).slice(0, 8);
    previous.confirmNeededNote = [previous.confirmNeededNote, slide.confirmNeededNote].filter(Boolean).join(' / ');
  }

  return merged.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

function ensureEntityDifferentiationOutlineSlide(slides: SlideOutline[], differentiationStrategy: ReturnType<typeof buildRfpDifferentiationStrategy>, analysis: AnalysisResult) {
  if (analysis.primaryRfpConceptType !== 'multi_entity_pavilion' || analysis.matrixType !== 'entityDifferentiationMatrix' || !differentiationStrategy.hasMultipleEntities || differentiationStrategy.entityDifferentiationMatrix.length < 2) return slides;
  const hasDifferentiationSlide = slides.some((slide) => /entity|differentiation|role.*matrix|message.*matrix|차별화|역할.*매트릭스|메시지.*매트릭스/i.test(`${slide.slideType} ${slide.slideTitle} ${slide.slideRole} ${slide.keyMessage}`));
  if (hasDifferentiationSlide) return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));

  const conceptIndex = slides.findIndex((slide) => /concept rationale|core concept|컨셉|콘셉트/i.test(`${slide.slideTitle} ${slide.slideType}`));
  const insertIndex = conceptIndex >= 0 ? conceptIndex : Math.min(6, slides.length);
  const entityNames = differentiationStrategy.entityDifferentiationMatrix.map((item) => item.entityName).join(' / ');
  const newSlide: SlideOutline = {
    slideNumber: insertIndex + 1,
    slideType: 'Strategic Approach - Entity Differentiation Matrix',
    slideTitle: 'Entity Differentiation Strategy',
    slidePurpose: 'Strategy',
    slideRole: 'entity differentiation strategy / role-message matrix',
    relationToThesis: differentiationStrategy.differentiationPrinciple,
    whyThisSlideExists: '복수 entity의 역할, 메시지, 증거, 공간·콘텐츠 역할을 콘셉트 선언 전에 분리해 과잉 통합을 방지합니다.',
    sourceEvidence: differentiationStrategy.entityDifferentiationMatrix.map((item) => item.sourceEvidence).filter(Boolean).slice(0, 8),
    referenceAllowed: false,
    keyMessage: `${differentiationStrategy.unifyingFrame} 아래 ${entityNames}의 역할과 관객 인식 포인트를 분리합니다.`,
    mainCopy: differentiationStrategy.entityDifferentiationMatrix.map((item) => `${item.entityName}: ${item.roleInProject} → ${item.audienceTakeaway || item.distinctMessage}`).join(' / '),
    confirmNeededNote: '',
  };

  return [...slides.slice(0, insertIndex), newSlide, ...slides.slice(insertIndex)].map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

const styleGuides = proposalTypeDescriptions;

// Internal deck narrative spine: decides page order and gives each page a distinct role so the deck does not restate
// the same thesis. Built deterministically from the selected concept + direction + diagnosis + current RFP (concise).
function buildDeckNarrativeSpine(args: { finalConceptName: string; finalConceptSlogan: string; selectedDirection: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis; analysis: AnalysisResult }): string {
  const { finalConceptName, finalConceptSlogan, selectedDirection, rfpDiagnosis, analysis } = args;
  const sig = selectedDirection.signatureProofIdea;
  const t = (value?: string, max = 140) => ((value || '').replace(/\s+/g, ' ').trim().slice(0, max)) || '없음';
  return [
    '=== Deck Narrative Spine (내부 설계용. 페이지 순서와 각 페이지의 고유 역할을 결정한다. UI에 길게 노출하지 말 것) ===',
    `openingProblem: ${t(analysis.clientChallenge || rfpDiagnosis?.hiddenNeed)}`,
    `selectedStrategicDirectionLogic: ${t(selectedDirection.oneLineStrategicBet || selectedDirection.whatThisDirectionEmphasizes)}`,
    `finalConceptDeclaration: ${t(finalConceptName, 60)} — ${t(finalConceptSlogan, 100)}`,
    `conceptPromise: ${t(rfpDiagnosis?.coreWinningCondition || selectedDirection.whatThisDirectionEmphasizes)}`,
    `proofSequence: ${t(rfpDiagnosis?.proofBurden || (rfpDiagnosis?.requiredProofElements ?? []).join(' / '))}`,
    `signatureExperienceLogic: ${t(sig?.signatureScene || sig?.signatureContent)}`,
    `contentArchitectureLogic: ${t(analysis.contentCondition || sig?.signatureSpatialMove)}`,
    `operationProofLogic: ${t(analysis.operationCondition || (analysis.kpiScheduleConstraints ?? []).join(' / '))}`,
    `closingClaim: ${t(rfpDiagnosis?.coreWinningCondition || finalConceptSlogan)}`,
    '각 페이지는 이 spine의 서로 다른 단계를 전개한다. 같은 thesis/컨셉 선언/RFP 요약/시장 맥락/전략 기회/경험 원칙/비주얼 방향을 여러 페이지에 반복하지 말고, 페이지마다 하나의 고유 질문(이 페이지가 푸는 문제 / 증명하는 것 / 컨셉을 전진시키는 방식 / 다음 페이지를 준비하는 이유)에 답한다.',
  ].join('\n');
}

function normalizeBoilerplateText(value?: string): string {
  return (value || '').toLowerCase().replace(/[^가-힣a-z0-9]+/g, ' ').trim();
}
function splitIntoSentences(value?: string): string[] {
  return (value || '').split(/(?<=[.!?。…])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 8);
}

// Repair repeated boilerplate across pages: drop sentences in mainCopy that already appeared VERBATIM earlier in the
// deck (keep at least one), and count pages whose body collapsed or whose keyMessage duplicates another. Deterministic,
// content-preserving (never empties a page), and used to decide if the deck is too template-like to return.
function repairRepeatedOutlineBoilerplate(slides: SlideOutline[]): { slides: SlideOutline[]; duplicateBodySlides: number } {
  const seenSentence = new Set<string>();
  const seenKeyMessage = new Set<string>();
  let duplicateBodySlides = 0;
  const repaired = slides.map((slide) => {
    const sentences = splitIntoSentences(slide.mainCopy);
    const kept: string[] = [];
    let removed = 0;
    for (const sentence of sentences) {
      const key = normalizeBoilerplateText(sentence);
      if (key.length >= 14 && seenSentence.has(key)) { removed += 1; continue; }
      if (key.length >= 14) seenSentence.add(key);
      kept.push(sentence);
    }
    const newMainCopy = kept.length ? kept.join(' ') : slide.mainCopy;
    const keyMessageKey = normalizeBoilerplateText(slide.keyMessage);
    const keyMessageDuplicate = keyMessageKey.length >= 12 && seenKeyMessage.has(keyMessageKey);
    if (keyMessageKey.length >= 12) seenKeyMessage.add(keyMessageKey);
    if (keyMessageDuplicate || (removed >= 2 && !kept.length)) duplicateBodySlides += 1;
    return { ...slide, mainCopy: newMainCopy };
  });
  return { slides: repaired, duplicateBodySlides };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedConcept: ConceptCandidate; selectedStrategicDirection?: ConceptCandidate; rfpDiagnosis?: RfpDiagnosis; conceptDevelopmentLogic?: ConceptDevelopmentLogic; conceptGenerationResult?: ConceptCandidatesResult; proposalNarrative?: ProposalNarrative; documentChunks?: DocumentChunk[]; projectId?: string | null; documentIds?: string[] };

    if (!body.input || !body.analysis || !body.selectedConcept) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 선택된 콘셉트가 필요합니다.' }, { status: 400 });
    }

    // Outline drivers (current RFP + selected concept dominate). finalConceptName/slogan + selected direction + diagnosis
    // + RFP-provided hierarchy are surfaced as a dedicated prompt block, not buried in a JSON dump.
    const finalConceptName = getPresentationConceptName(body.selectedConcept);
    const finalConceptSlogan = getConceptTagline(body.selectedConcept);
    const selectedDirection = body.selectedStrategicDirection ?? body.selectedConcept.selectedDirection ?? body.selectedConcept;
    const rfpDiagnosis = body.rfpDiagnosis ?? body.conceptGenerationResult?.rfpDiagnosis;
    const rfpHierarchy = extractRfpConceptHierarchy(body.input.briefText);
    const deckNarrativeSpine = buildDeckNarrativeSpine({ finalConceptName, finalConceptSlogan, selectedDirection, rfpDiagnosis, analysis: body.analysis });

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const productCodes = extractProductCodes({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });
    const effectiveProposalType = normalizeProposalType(body.analysis.inferredProposalType ?? body.input.proposalType);
    const isEventOperationType = effectiveProposalType === 'mice_event_operation' || effectiveProposalType === 'conference_forum';
    const structureGuard = buildProposalStructureGuard(body.input, body.analysis);
    const scopeLabelText = structureGuard.proposalScopeTypes.map((scope) => proposalScopeTypeLabels[scope]).join(' + ') || '감지된 세부 범위 없음';
    const allowReferenceSlides = isReferenceSlideExplicitlyRequested(body.input);
    const outlineEvidenceGroups = retrieveCategoryEvidenceGroups({
      stage: 'outline',
      proposalType: effectiveProposalType,
      query: `${body.input.projectName} ${getPresentationConceptName(body.selectedConcept) || `${body.selectedConcept.conceptNameKR} ${body.selectedConcept.conceptNameEN}`}`,
      chunks: body.documentChunks ?? [],
      groups: [
        { label: '필수 목차 (35)', categories: ['requiredDeliverables'], description: 'proposal structure weighted retrieval 35: requiredDeliverables를 필수 목차/요구 대응 장표로 매핑', limit: 5 },
        { label: '평가 대응 전략 (20)', categories: ['evaluationCriteria'], description: 'proposal structure weighted retrieval 20: 평가 기준별 대응 전략, 차별화 장표, 챕터 구조에 필수 반영', limit: 4 },
        { label: '성과 목표 (20)', categories: ['performanceGoal'], description: 'proposal structure weighted retrieval 20: KPI/성과 측정 장표와 대응 메시지 생성에 사용', limit: 4 },
        { label: '실행 제약 (15)', categories: ['constraints'], description: 'proposal structure weighted retrieval 15: 제약 조건을 실행 가능성/운영 계획에 반영', limit: 3 },
        { label: '공간 전략 (10)', categories: ['venue'], description: 'proposal structure weighted retrieval 10: 공간 구성, 동선, 장소별 적용 장표에 사용', limit: 3 },
        { label: '제품 특징', categories: ['productFeature'], description: 'Q8/H8/B8 제품별 핵심 기능/가치 제안을 제품별 장표 구조에 반영', limit: 4 },
        ...(allowReferenceSlides ? [{ label: '현재 프로젝트 참고 레퍼런스', categories: ['referenceOnly', 'designDirection'] as ChunkCategory[], description: '사용자 명시 요청 시에만 현재 업로드된 RFP/제안 자료에 명시된 레퍼런스를 reference insight로 반영하고, 근거 없는 프로젝트명은 제외', limit: 4 }] : []),
      ],
    });
    const retrievalContext = formatCategoryEvidenceGroupsForPrompt(outlineEvidenceGroups, 11000);
    const referenceGuardInstruction = buildReferenceGuardInstruction(body.analysis, body.documentChunks ?? []);
    const strategyLayerMetadata = buildStrategyLayerMetadata({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic, conceptGenerationResult: body.conceptGenerationResult });
    const strategicMessageSummary = strategicMessageFieldsFromLogic(body.conceptDevelopmentLogic);
    const proposalNarrative = ensureProposalNarrative(body.proposalNarrative, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, documentText: body.input.briefText });
    const differentiationStrategy = buildRfpDifferentiationStrategy(body.analysis, proposalNarrative);
    // Scope proposal_patterns to the CURRENT project's own uploaded reference proposals only. When no project/document
    // scope is available, retrieveProposalPatternsForOutline skips the global read (no cross-project / orphan patterns).
    const proposalPatternGuidance = await retrieveProposalPatternsForOutline({ limit: 16, projectId: body.projectId ?? null, documentIds: body.documentIds ?? [], currentProposalType: effectiveProposalType });
    const outlineProposalPatterns = proposalPatternGuidance.patterns;
    const proposalPatternContext = formatProposalPatternsForOutlinePrompt(outlineProposalPatterns);
    const proposalAvoidanceRuleContext = formatProposalAvoidanceRulesForPrompt(proposalPatternGuidance.avoidanceRules);
    const proposalPatternDiagnostics = formatProposalPatternDiagnostics(proposalPatternGuidance.summary, differentiationStrategy.hasMultipleEntities);
    // Phase 3: structured won-vs-lost learning (Priority 2 — advisory only, never overrides the current RFP / concept).
    const successComparisonContext = formatProposalSuccessPatternComparisonForPrompt(proposalPatternGuidance.comparison);
    const patternLearningSummary = buildPatternLearningSummary(proposalPatternGuidance.comparison);

    const result = await createStructuredJson<{ slides: SlideOutline[] }>({
      schemaName: 'proposal_outline',
      schema: outlineJsonSchema,
      system: [
        '너는 한국어 제안서 전체 구조를 설계하는 크리에이티브 디렉터다. 전시/브랜드 체험관과 MICE/컨퍼런스 운영 제안서를 RFP 유형에 따라 구분한다.',
        '이 산출물은 AI 분석 리포트가 아니라 실제 제안 발표 덱이다. 서버가 Cover, 목차(Table of Contents), 섹션 밴드(overview→approach→concept→conceptStrategy→content→contentDetail→operation→closing)와 장표별 레이아웃을 자동 부여한다. 너는 각 장표를 slide-ready 제안 문안으로 작성하는 데 집중한다.',
        '내부 설계 라벨을 사용자-facing 문안에 노출하지 말라: slidePurpose/slideRole/relationToThesis/whyThisSlideExists, "이 페이지의 역할", "왜 이 장표가 존재하는가", "이 장표가 증명하는 것", "Purpose/Role/Relation" 같은 메타 설명을 slideTitle/keyMessage/mainCopy에 쓰지 말고 완성된 제안 슬라이드 문장(짧은 제목 + 한 줄 핵심 메시지 + 3~5개 간결 불릿)으로만 작성한다.',
        '섹션 흐름: 1) Overview(프로젝트 배경·시장/행사 맥락·현황·강점/한계·기회) 2) Approach(선택된 전략 방향과 그 필요성: 핵심 RFP 과제, 평소 제안 논리가 부족한 이유, 선택한 전략 방향이 왜 정답인지, 평가자 관심·관객 인식 간극·클라이언트 목표 연결) 3) Concept(최종 컨셉 선언) 4) Concept Strategy(컨셉 전개·경험 원칙·공간/콘텐츠 전략·증명 구조) 5) Content 6) Content Detail/Scenario 7) Operation/Closing. Approach는 반드시 Concept보다 먼저 오고, Approach 장표의 제목·본문에 최종 컨셉명을 먼저 공개하지 말라(컨셉명은 Concept 섹션에서 처음 등장). Approach는 컨셉이 아니라 선택된 전략 방향을 설명한다.',
        'Concept 선언 이전(Overview/Approach) 장표는 텍스트 주도로 간결·전문적으로 쓰고, Concept 선언 이후(Content/Content Detail) 장표는 비주얼 우선으로 한 장의 히어로 콘텐츠와 짧은 오버레이 카피 중심으로 쓴다. 콘텐츠 장표를 분석 카드/UX 리서치 표/폼 출력/필드 덤프처럼 쓰지 말라.',
        structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '이 단계는 콘텐츠 개발형 제안 생성 단계의 아웃라인 설계다. 기본 18~22장, 하드캡 24장 이내로 실제 제안 내용을 담는 슬라이드 구조를 만든다.' : '이 단계는 제안 생성 단계의 아웃라인 설계다. RFP 요약이나 확인 필요 장표가 아니라 실제 제안 내용을 담을 20~40장 슬라이드 구조를 만든다.',
        isEventOperationType ? 'MICE/컨퍼런스 운영형 기본 흐름은 Cover, Project Understanding, Strategic Approach, Event Identity, Program Overview, Operation Framework, Registration & Entry Plan, Session System Operation, Partner Pavilion Plan, Networking / Catering Plan, Moving Line Plan, Setup / Conversion Plan, Staffing Plan, Risk Management, Schedule, Budget Summary, Portfolio / Organization, Closing이다.' : structureGuard.proposalScopeTypes.includes('contentDevelopment') && structureGuard.proposalScopeTypes.includes('boothExhibition') ? '콘텐츠 개발 + 부스/전시형 기본 흐름은 Cover/Intro, Project Understanding, Approach, Main Theme, Strategy & Goals, Hero Content, Sub Content, Zoning & Flow, Content Scenario, Schedule, Credential, Closing이다. 필요 시 과업 대응표를 1장 포함하되 일반 체험 마케팅 슬라이드로 확장하지 말라.' : '기본 흐름은 Cover, Project / Market Context, Core Problem or Challenge, Audience Insight, Strategic Opportunity / Strategic Direction, Concept Rationale, Core Concept, Key Experience Asset Concept, Visitor Journey, Spatial / Content Plan 복수 장표, Media / Interactive Plan 복수 장표, Viral / Communication Mechanism, Operation Plan, Expected Effect, Closing이다.',
        '아웃라인은 Proposal Narrative의 5단계 구조를 최우선으로 따른다: Phase 1 Problem Definition(시장/산업 맥락, 프로젝트 배경, 클라이언트 과제, audience insight) → Phase 2 Strategic Declaration(전략 기회, proposal thesis, concept rationale, core concept) → Phase 3 Experience Strategy(경험 원칙, visitor journey, spatial strategy) → Phase 4 Content Proposal(hero experience, main experience, media/interactive content, key proof points) → Phase 5 Proof & Impact(expected impact, differentiation, feasibility, 필요한 경우에만 operation/RFP response table).',
        'Proposal patterns are structure references only. Do not reuse old proposal copy, old project names, client names, slogans, filenames, or proprietary content. Translate only the reusable structural principle into a new outline suited to the current RFP.',
        'proposal_patterns는 구조 참고 자료일 뿐이며 현재 RFP evidence가 항상 1차 원천이다. 원문, old body copy, old client/project names, slogans, filenames, copyright/confidential text는 절대 사용하지 말라.',
        'A lost proposal is not always a poor proposal. If the loss reason is external, such as budget or procurement conditions, its structure can still be used as reference. If the loss reason is quality-related, use it as an anti-pattern.',
        'Pattern priority: won patterns first, lost_external second, unknown neutral third, lost_mixed with caution fourth, lost_quality only as anti-patterns. Budget-only or external-only losses are not proposal quality failures.',
        'Quality-related lost proposal reasons must become avoidance rules for generic concept, weak differentiation, over-integrated story, unclear client benefit, weak audience insight, weak proof of feasibility, missing operational detail, content list without hierarchy, visuals/media without reason, concept before rationale, or copied old structure without current relevance.',
        'proposal_patterns는 구조적 흐름만 참고한다. 현재 RFP 분석을 최우선 원천으로 삼고, 패턴은 slide order, concept buildup, core concept 선언 타이밍, problem→insight→strategy→concept→content→proof→operation 관계, 각 장표의 존재 이유, operation/credential 장표 배치를 개선하는 보조 가이드로만 사용하라.',
        '"수주/미수주 패턴 비교"(Priority 2) 블록이 제공되면: 수주 차별 포인트는 Approach·Concept Strategy·Content·증명 섹션의 구조와 논리를 강화하는 데 쓰고, 콘텐츠/미디어 적용 패턴은 컨셉 선언 이후 콘텐츠 페이지를 더 구체적으로 만드는 데만 쓰며, 미수주 회피 리스크는 같은 약점을 반복하지 않기 위한 리스크 경고로만 쓴다. 이 비교는 advisory이며 현재 RFP·선택 전략 방향·최종 컨셉명/슬로건·RFP 위계를 절대 덮어쓰지 않는다. 과거 제안의 컨셉명/슬로건/원문/클라이언트명/프로젝트명을 복사하지 말고, 비슷한 패턴이 없으면 현재 RFP·전략·컨셉 근거만으로 생성한다.',
        'Do not default to generic concept words. The concept must emerge from the current RFP’s specific strategic tension, audience barrier, client objective, and proof logic.',
        'If the RFP contains multiple entities, do not solve the proposal only with unity. Define what is unified and what remains distinct. Include one or more entity differentiation slides before/around Concept Rationale: entity differentiation strategy, role/message matrix, entity-by-entity content strategy, and integration logic that connects entities without erasing their differences.',
        'Before finalizing, detect duplicate slide roles or near-duplicate titles such as Audience Insight + 대상 관객 인사이트, Strategic Opportunity + 전략적 기회, Concept Rationale + Core Concept with repeated bullets; merge or remove duplicates instead of outputting both. Every slide needs a clear role, why it exists, sourceEvidence from the current RFP when possible, and explicit relation to proposalThesis. Operation/proof/credential slides appear only where they support the thesis.',
        'Cover 다음 첫 전략 섹션은 반드시 1) Project / Market Context 2) Core Problem / Challenge 3) Audience Insight 4) Strategic Opportunity 5) Concept Rationale 6) Core Concept 7) Experience Principle / Visitor Journey 순서로 배치하라. Strategic Opportunity, Experience Principle, Visitor Journey, Media Overview, Spatial Overview, Content Mechanism은 Project / Market Context와 Core Problem보다 앞에 절대 두지 말라. Core Concept는 Project / Market Context, Core Problem, Audience Insight, Strategic Opportunity, Concept Rationale이 모두 설명된 뒤에만 배치하라.',
        'Concept Rationale은 공간 제약에서 시작하지 말고 1) hydrogen처럼 보이지 않는 시스템 기반 가치 2) HTWO/hydrogen value chain의 복잡성 3) B2B와 public audience의 다른 이해 수준 4) Hyundai Motor Group hydrogen leadership을 신뢰 가능하고 체험 가능하게 만들어야 하는 필요 5) 선택 콘셉트가 그 간극을 가장 잘 표현하는 이유 순서로 작성하라. Case Insight가 유용할 때는 Concept Rationale의 전략 근거로만 활용하고 콘텐츠 제안 섹션 뒤에 두지 말라. Columns, booth constraints, venue limitations, layout constraints는 Spatial Strategy 이전에 한 번의 supporting challenge로만 언급할 수 있으며 early slide title이나 Concept Rationale의 주된 근거가 되어서는 안 된다.',
        '각 outline slide는 slidePurpose를 Problem, Insight, Strategy, Concept, Experience, Content, Proof, Impact 중 하나로만 지정하고 slideRole, relationToThesis, whyThisSlideExists를 반드시 작성하라. sourceEvidence는 문자열 배열로 작성하고, 현재 프로젝트 근거가 없으면 반드시 빈 배열 []을 넣어라. referenceAllowed는 Reference Guard가 허용한 현재 프로젝트 레퍼런스 근거가 있을 때만 true이고 기본값은 false다.',
        'Company capability/company introduction, KPI/performance goal, Operation plan, VIP support plan, Schedule, Confirmation needs/additional request, RFP requirement table은 현재 RFP가 명시적으로 요구하거나 proposalThesis 증명에 강하게 연결될 때만 포함한다. 포함 시 relationToThesis와 whyThisSlideExists에 thesis 지원 논리를 명확히 작성하라.',
        'RFP 성격에 맞게 슬라이드 제목은 자동 조정하라. 예: 폴더블 제품별 체험 저니, 기업 홍보관 비전 전달 공간, 팝업 포토/바이럴 구조, 미디어 전시 몰입형 시나리오, 의전시설 VIP 동선.',
        '아웃라인 retrieval은 proposal structure 가중치 requiredDeliverables 35, evaluationCriteria 20, performanceGoal 20, constraints 15, venue 10 순서와 category별 목적에 맞춰 사용하라. requiredDeliverables는 필수 목차와 RFP Requirement Response, evaluationCriteria는 평가 항목별 챕터 순서·차별화 장표·심사 대응 메시지, performanceGoal은 KPI 대응 및 성과 측정, constraints는 실행 전략과 운영/제작 가능성, venue는 공간 전략과 동선/장소 적용 장표에만 우선 사용한다.',
        'evaluationCriteria category 근거가 있으면 proposal structure의 주요 챕터와 chapter generation용 장표 목적에 반드시 반영하라. 필수 category 근거가 있는 경우 해당 장표를 반드시 구조에 반영하되, referenceOnly나 backgroundInsight에서만 나온 항목을 requiredDeliverables, KPI, 평가 기준, 필수 공간 장표로 승격하지 말라.',
        isEventOperationType ? '사용자가 이미 선택한 콘셉트만 기준으로 구조를 설계하라. Concept Candidates, 후보 비교, 내부 평가 점수표는 절대 포함하지 말라. 행사 운영형에서는 Experience Structure, Main Experience Image, Key Experience Asset, Visitor Action, Interactive Flow, Content Mechanism, Output & Share, Viral Communication Strategy, Media Experience Overview, Key Media Scene, Photo / Viral Spot, Hands-on Demo 장표를 기본 생성하지 말고 Strategic Approach, Event Identity, Program Overview, Operation Framework 등 운영형 장표로 대체하라. “선택된 콘셉트”, “콘셉트 후보”, “후보 비교”, “C1 / C2 / C3”, “추천 콘셉트” 표현은 쓰지 말라.' : '사용자가 이미 선택한 콘셉트만 기준으로 구조를 설계하라. Concept Candidates, 콘셉트 후보 3안 비교, 3개 콘셉트 비교표, 선택되지 않은 콘셉트 설명, 내부 평가 점수표 장표는 최종 제안서 구조에 절대 포함하지 말라. 대신 Experience Approach, Concept Rationale, Core Concept, Experience Structure 장표를 이 순서로 포함하고, 핵심 과제를 해결하기 위한 경험 접근과 핵심 콘셉트의 필연성, 공간·콘텐츠·미디어·공유 구조로의 확장을 제안서 톤으로 보여줘라. “선택된 콘셉트”, “콘셉트 후보”, “콘셉트 도출 과정”, “후보 비교”, “C1 / C2 / C3”, “추천 콘셉트”, 고정 제목 “Monument Design Concept”은 최종 제안서 장표 제목이나 본문에 사용하지 말라.',
        'proposalType별 템플릿보다 analysis.requiredDeliverables와 analysis.scopeOfWork가 우선이다. 제안서 구조와 제품/콘텐츠/체험 단위 추출은 analysis.requiredDeliverables 및 analysis.taskSections[].requiredDeliverables를 최우선 기준으로 삼고 analysis.scopeOfWork, analysis.requiredScope, analysis.productInfo, analysis.productFeatures를 기준으로만 한다. analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets에 들어간 항목은 Product Experience Detail, 독립 체험 장표, 신규 모듈 장표로 만들지 말라.',
        '최종 PPT 구조 생성 전에 RFP Requirement Coverage Check를 수행한다고 가정하고 requirement, sourceCategory(requiredDeliverables/scopeOfWork/evaluationCriteria/constraints), mappedSlideTitle, coverageStatus, note 관점으로 모든 1순위/2순위 요구사항을 점검하라.',
        'analysis.requiredDeliverables와 requiredDeliverables category 근거는 우선 필수 목차로 반영하고 RFP Requirement Response / 과업 대응표 1~2장 및 관련 본문 섹션에 매핑하라. 각 항목을 Required Deliverable Response 또는 Scope Response 단독 장표로 무조건 생성하지 말고, 중요도가 높은 항목만 본문 장표로 확장하며 나머지는 과업 대응표 row로 처리하라.',
        'analysis.scopeOfWork의 주요 과업 범위도 반드시 반영하라. 단순 요약으로 끝내지 말고 운영 계획, 제작 범위, 공간 구성, 시스템 계획, 일정, 예산, 인력 운영 중 적절한 장표에서 실행 계획 또는 대응 방향으로 변환하라. 과업 범위가 많으면 Scope Response Matrix 또는 RFP Requirement Response / 과업 대응표 장표를 포함하라.',
        'requiredDeliverables 또는 scopeOfWork에 누락이 있으면 먼저 기존 장표의 mainCopy 또는 confirmNeededNote에 매핑하고, 불가능한 경우에만 Portfolio / Organization, Budget & Scope, System / Equipment, Setup / Dismantling, Content Production, Hospitality / Reception, Compliance / Exclusions 등 유사 항목 보완 섹션으로 묶어 생성하라.',
        'Reference Insight, Design Reference Direction, 참고 방향 및 레퍼런스 인사이트 장표는 기본 목차에 포함하지 말라. 사용자가 레퍼런스 장표를 명시적으로 요청한 경우에만 현재 프로젝트 evidence에 명시된 reference를 referenceName, referenceType, whatToLearn, howToApply, caution, sourceEvidence, referenceAllowed 관점으로 정리하라. sourceEvidence가 없으면 Reference 장표를 만들지 말라. 단, Case Insight / Benchmark Insight는 레퍼런스 목록이 아니라 콘셉트 도출을 정당화하는 전략 인사이트 장표로만 허용하며, case name이 current evidence로 검증되지 않으면 특정 이름 없이 추상 원칙으로 작성하라.',
        referenceGuardInstruction,
        buildConstraintPriorityGuardInstruction(),
        buildSelectedConceptDominanceInstruction(),
        '아래 "제안서 구조 1순위 드라이버" 블록(최종 컨셉명·슬로건·선택된 전략 방향·제안 전략 진단·RFP 제공 컨셉 위계)이 proposal_patterns와 일반 덱 구조보다 우선한다. 오프닝은 최종 컨셉명과 직접 연결하고, 섹션 흐름은 슬로건이 약속하는 논리를 따라가며, 모든 slideTitle/keyMessage가 선택된 컨셉과 정렬되어야 한다. 증명 섹션은 선택된 전략 방향을 뒷받침하고, 클로징은 새로운 메시지가 아니라 같은 컨셉을 재강조한다. proposal_patterns는 페이지 리듬·증명 배치·섹션 순서·리스크 체크 같은 구조 참고로만 쓰고 컨셉/방향/위계를 바꾸지 않는다.',
        'RFP에 명시된 컨셉 위계/메인 테마/존 구조/레벨 구조/필수 섹션/평가 기준/공식 프레임이 있으면 그 구조를 아웃라인에 보존·매핑하고 proposal_patterns로 덮어쓰지 말라. 선택된 최종 컨셉이 그 RFP 요구를 어떻게 해석·강화하는지 드러나게 배치한다. 명시 위계가 없으면 제안 전략 진단·선택된 전략 방향·최종 컨셉명·제안서 유형에서 구조를 도출한다.',
        '사용자 선택 제안서 유형을 구조 가드로 사용한다(라벨·예시 제목은 하드코딩하지 말 것): 다중 주체/공동관형이면 공동 메시지·참여 주체 역할 구분·통합 역량·증명 흐름 중심으로 구성하되 한 참여 주체가 전체 이야기를 차지하지 않게 한다. 전시/콘텐츠/기술형이면 관객 이해·콘텐츠 경험·시스템/가치 증명·시그니처 장면·필요 시 운영 신뢰 중심으로 구성한다. 방문관/공장견학/쇼룸형이면 방문 동선·제품/공정/신뢰 증명·감각 경험·방문 후 기억 중심으로 구성한다. 국가관/엑스포형이면 테마·국가/문화 프레임·참여 여정·상징 경험·글로벌 관객 이해 중심으로 구성한다.',
        '아래 Deck Narrative Spine을 페이지 순서와 역할의 기준으로 삼는다. 각 페이지는 spine의 서로 다른 단계를 전개하며 고유 역할을 갖는다. 같은 thesis·컨셉 선언·RFP 요약·시장 맥락·전략 기회·경험 원칙·비주얼 방향을 여러 페이지에 반복하지 말라. 제목이 달라도 내용이 사실상 같은 페이지를 만들지 말라.',
        '페이지 메시지는 slide-ready로 쓴다: slideTitle은 문장이 아니라 짧은 제목, keyMessage는 한 줄 설득 주장 하나, mainCopy는 3~5개의 간결한 불릿(줄바꿈으로 구분, 긴 문단/중복 요약 금지)으로 쓴다. RFP 분석 원문·컨셉 rationale 원문·시장 맥락 문장을 그대로 복붙하지 말고 이 페이지에 필요한 핵심만 압축한다. “이미지 영역 삽입” 같은 placeholder 문구를 쓰지 말라.',
        '콘텐츠/체험 상세 페이지는 visitor action / system response / placement / media·object / output·reward 같은 동일 모듈 필드를 모든 페이지에 반복하지 말라. 콘텐츠 페이지는 각각 다른 목적을 갖는다: 경험 아키텍처 정의 / 시그니처 장면 / 밸류체인·시스템 로직 증명 / 디지털·피지컬 통합 / 관객별 운영 / 실행 가능성 증명 등. 동일 템플릿을 여러 페이지에 복제하지 말고, module-spec 전용 페이지일 때만 모듈 필드를 상세히 쓴다.',
        '최종 컨셉명을 모든 페이지 제목에 붙여 반복하지 말라. 컨셉은 narrative spine·페이지 논리·증명 순서·비주얼 톤·클로징 주장으로 작동시키고, 컨셉명 자체는 꼭 필요한 페이지(오프닝/코어 컨셉/클로징 등)에만 노출한다.',
        '각 페이지는 현재 RFP의 구체 재료(타깃, 필수 산출물, 행사/부스/전시 조건, 콘텐츠 요구, 평가 관심사, 운영 제약, 증명 요구)를 사용하고 일반 구조에만 의존하지 말라.',
        'referenceOnly/doNotTreatAsScope 항목은 현재 RFP에 명시된 경우에도 신규 체험 상세, 제품 상세 장표, 기본 참고 방향 장표로 생성하지 말고 배경 맥락으로만 다루라. FF7/MDW/SFF/SAFE/Samsung Foundry/Galaxy/teamLab/Delight 등 현재 evidence에 없는 프로젝트명은 사용하지 말라.',
        'Key Experience Asset은 프로젝트를 대표하는 1~3개 핵심 체험 자산만 압축해 보여주는 장표로 설계하라. 일반 assetType 후보 목록을 나열하지 말고, 각 자산의 이름/역할/방문객 행동/작동 방식/공간 배치/결과물을 중심으로 구성하라.',
        '모뉴먼트가 RFP에 명시되지 않았다면 Monument를 핵심 자산으로 고정하지 말라.',
        '확인 필요 사항은 confirmNeededNote에만 작게 넣고 slideTitle, slidePurpose, keyMessage의 중심은 실제 제안 내용으로 구성하라.',
        '감지된 proposalScopeTypes와 proposalStructureGuard를 최우선 구조 가드로 적용하라. contentDevelopment + boothExhibition이면 Intro, Approach, Main Theme, Strategy & Goals, Hero Content, Sub Content, Zoning & Flow, Schedule, Credential을 우선하고, content concept, narrative, media mechanism, hero/sub content, scenario, schedule, credential 중심의 문안으로 설계하라.',
        'contentDevelopment + boothExhibition에서는 RFP에 명시되지 않은 Viral / Communication Strategy, KPI / Performance Goal, Operation Plan, Output & Share, Visitor Reward, SNS Sharing, Marketing Campaign을 만들지 말라. Interactive Flow, Content Mechanism, Output & Share, Visitor Journey 같은 일반 체험 슬라이드는 RFP 또는 선택 콘셉트가 직접 요구할 때만 1회 이하로 제한하라.',
        'KPI 장표는 analysis.numericInfo.targetKPI가 있거나 evaluationCriteria가 performance metrics를 명시적으로 요구할 때만 생성하라. RFP가 “이해도 제고” 또는 “브랜드 인지도 상승”만 말하면 Project Objective/Strategy & Goals 본문에 녹이고 별도 KPI 장표로 만들지 말라.',
        'Operation Plan 장표는 부스 운영 계획, staffing, onsite operation, visitor flow operation, maintenance, safety operation이 RFP에 명시된 경우에만 생성하라. 그 외에는 Schedule 장표만 포함하라.',
        '근거 없는 정량 효과 예측을 금지한다. KPI/Expected Effect 장표에는 kpi category 근거와 analysis.numericInfo.targetKPI로 명확히 분류된 목표 KPI만 수치 목표로 사용하라. analysis.numericInfo.pastPerformance, lessonLearned, referenceMetric 수치는 목표처럼 표현하지 말고 Project Understanding 또는 Key Challenge의 배경/문제/인사이트 맥락으로만 사용하라. targetKPI가 비어 있으면 임의 수치를 만들지 말고 측정 항목 제안 장표로 구성하라.',
        isEventOperationType ? '행사 운영형에서는 Spatial / Content Plan, Main Experience Image, Media / Interactive Plan, Interactive Flow, Content Mechanism 등 체험관형 장표를 생성하지 말고 프로그램/등록/세션/부스/네트워킹/동선/설치전환/인력/리스크/예산 중심으로 구성하라.' : structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '콘텐츠 개발형에서는 Spatial / Content Plan을 일반 체험 상세로 과확장하지 말고 Zoning & Flow, Hero Content, Sub Content, Content Scenario 중심으로 필요한 장표만 구성하라.' : 'Spatial / Content Plan은 절대 1장으로 요약하지 말고 최소 5장(Spatial Overview, Main Experience Image, 실제 체험명 기반 상세 장표, Experience Scenario)으로 구성하라. 동일 제품/동일 체험 상세 장표는 중복 생성하지 말고 제품당 1~2장으로 제한하라. Q8/H8/B8처럼 복수 제품이 있으면 제품별 상세 장표가 균형 있게 나오도록 배치하고, 포괄적인 폴더블 갤럭시 제품 체험 모듈 하나로 병합하지 말라. 같은 제품의 상세 장표가 여러 개 필요할 때는 Q8 체험 개요, Q8 체험 시나리오처럼 역할을 명확히 분리하라.',
        isEventOperationType ? '행사 운영형의 성과 장표는 운영 품질 관리 지표와 측정 체계를 중심으로 구성하고 체험 산출/공유 장표로 대체하지 말라.' : structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '콘텐츠 개발형에서는 Media / Interactive Plan을 5장으로 강제 확장하지 말고 hero/sub content의 media mechanism과 scenario를 설명하는 범위로 제한하라. Output & Share는 RFP가 명시할 때만 생성하라.' : 'Media / Interactive Plan은 절대 1장으로 요약하지 말고 최소 5장(Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share)으로 구성하라. Content Mechanism과 콘텐츠 작동 원리 및 메커니즘처럼 같은 의미의 장표를 중복 생성하지 말라. 미디어/인터랙션 요소가 많으면 핵심 체험 자산별 상세 장표를 추가하라.',
        'Spatial zoning, Media Overview, Content Mechanism, Key Media Scene, Hero Image, detailed content modules는 Core Concept 이후 실행 전략 섹션에서만 다루고, Core Concept 이전의 문제/인사이트/전략 근거 섹션에는 배치하지 말라.',
        '공간 구성과 콘텐츠 구성을 한 장에 뭉뚱그리지 말고 핵심 체험 단위별로 분리하라.',
        'RFP나 Entity Differentiation Matrix 또는 분석 결과의 taskSections.requiredDeliverables/requiredScope/productInfo에 제품/서비스/회사/브랜드/존/관객/콘텐츠 단위가 있으면 그 단위별 Product Experience Detail 장표를 포함하되, “제작”, “개발”, “운영”, “구성”, “기획”, “제안” 같은 과업/업무 범위 표현은 체험 콘텐츠명으로 사용하지 말라. 체험 상세 장표는 matrix의 roleInProject, keyOffering, audienceTakeaway, experienceMechanism에서 mechanism을 파생하고 방문객 행동, 시스템 반응, 결과물이 명확한 콘텐츠만 생성한다. 모든 entity에 visitor mission/kiosk/video/result report 같은 동일 템플릿을 반복하지 말라. referenceOnly/doNotTreatAsScope/existingAssets에서만 감지된 참고 사례, 기존 캠페인, 레슨런드 항목은 제품별 체험 상세 장표로 만들지 말라. 포괄적인 제품명+체험존 제목 대신, 현재 RFP에 명시된 제품/서비스별 방문객 행동·시스템 반응·인식 변화가 드러나는 구체 제목을 사용하라.',
        'winningStrategyBrief / proposalThesis / experienceLogic은 Winning Strategy Layer 메타데이터다. 제공된 값이 있으면 보존해 제안서 구조의 전략 흐름에 반영하고, 없으면 서버에서 생성된 fallback 값을 사용하라. 이 메타데이터가 없다는 이유로 아웃라인 생성을 중단하거나 빈 장표를 만들지 말라.',
        'slideNumber는 1부터 순서대로 부여하라. 각 슬라이드에는 사용자가 수정할 수 있는 mainCopy를 포함하고, mainCopy에는 해당 장표의 본문 방향 또는 대표 제안서 문장을 1~2문장으로 작성하라. 모든 slide item은 schema의 모든 필드를 빠짐없이 채워야 하며 sourceEvidence가 없을 때도 []로 채워 생성 실패를 방지하라.',
      ].join('\n'),
      user: `=== 제안서 구조 1순위 드라이버 (proposal_patterns/일반 덱 구조보다 우선) ===
최종 컨셉명: ${finalConceptName || '없음'}
최종 컨셉 슬로건: ${finalConceptSlogan || '없음'}
선택된 전략 방향: ${selectedDirection.strategicDirectionLabel || selectedDirection.directionLabel || '없음'} / 베팅: ${(selectedDirection.oneLineStrategicBet || selectedDirection.whatThisDirectionEmphasizes || '없음').slice(0, 200)}
제안 전략 진단(핵심): 승리 조건=${(rfpDiagnosis?.coreWinningCondition || '없음').slice(0, 180)} · 전략적 긴장=${(rfpDiagnosis?.strategicTension || '없음').slice(0, 180)} · 설득 과제=${(rfpDiagnosis?.persuasionTask || rfpDiagnosis?.proofBurden || '없음').slice(0, 180)}
${rfpHierarchy ? formatRfpHierarchyAnchor(rfpHierarchy) : 'RFP 제공 컨셉 위계: 명시 없음 (제안 전략 진단·선택된 전략 방향·최종 컨셉명·제안서 유형에서 구조를 도출한다)'}
요구: 오프닝=최종 컨셉명 연결, 섹션 흐름=슬로건 논리, 모든 페이지 제목=선택 컨셉과 정렬, 증명 섹션=선택 전략 방향 뒷받침, 클로징=같은 컨셉 재강조.

${deckNarrativeSpine}

사용자 선택 제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
RFP 분석 기반 유형: ${proposalTypeLabels[effectiveProposalType]}
제안 구조 유형 가이드: ${styleGuides[effectiveProposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

검색된 category별 구조 근거 chunk:
${retrievalContext || '검색된 chunk 없음'}

참고한 구조 패턴: ${outlineProposalPatterns.length}개
수주 제안서 패턴 우선 반영: ${outlineProposalPatterns.some((pattern) => pattern.outcome === 'won') ? '예' : '아니오'}
내부 진단 요약(사용자-facing 제안서에는 old proposal 세부정보 노출 금지):
${proposalPatternDiagnostics}
proposal_patterns 구조 참고 JSON(허용된 구조 필드만 포함, 원문/source_text/제목/요약/파일명 제외):
${proposalPatternContext}

품질 관련 미수주 회피 규칙 JSON(현재 RFP에 맞는 회피 원칙으로만 사용):
${proposalAvoidanceRuleContext}

수주/미수주 패턴 비교 (Priority 2 — 구조·논리 참고용. 현재 RFP·선택 전략 방향·최종 컨셉·RFP 위계를 절대 변경하지 않는다):
${successComparisonContext}

RFP Entity / Content Differentiation Strategy JSON:
${summarizeDifferentiationStrategy(differentiationStrategy)}

분석 결과 JSON:
${JSON.stringify(body.analysis, null, 2)}

전략 메시지 추출 요약:
${strategicMessageSummary || '전략 메시지 추출 필드 없음'}

Winning Strategy Layer 메타데이터(제공값 우선, 누락 시 서버 fallback):
${JSON.stringify(strategyLayerMetadata, null, 2)}

Proposal Narrative:
${summarizeProposalNarrative(proposalNarrative)}

경험 접근 로직 JSON:
${JSON.stringify(body.conceptDevelopmentLogic ?? null, null, 2)}

핵심 콘셉트 JSON:
${JSON.stringify(body.selectedConcept, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}
- 감지된 제품/콘텐츠 코드: ${productCodes.length ? productCodes.join(' / ') : '없음'}
- 감지된 proposalScopeTypes: ${scopeLabelText}
- 구조 가드: ${body.analysis.proposalStructureGuard || '없음'}
- KPI 장표 허용: ${structureGuard.hasExplicitKpi ? '예' : '아니오'}
- Operation Plan 장표 허용: ${structureGuard.hasExplicitOperationPlan ? '예' : '아니오'}`,
    });

    const sanitizedSlides = mergeDuplicateSlideRoles(ensureEntityDifferentiationOutlineSlide(sanitizeOutlineSlides(result.slides), differentiationStrategy, body.analysis));
    const expandedSlides = expandExperiencePlanOutline(sanitizedSlides, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });
    const coverageCheckedSlides = mergeDuplicateSlideRoles(ensureRfpRequirementCoverage(removeInternalConceptComparisonSlides(expandedSlides), body.analysis, body.documentChunks ?? []));
    const guardedSlides = applyReferenceGuardToOutline(
      applyProposalStructureGuardToOutline(coverageCheckedSlides, body.input, body.analysis, { selectedConcept: body.selectedConcept, proposalNarrative, conceptDevelopmentLogic: body.conceptDevelopmentLogic }),
      body.analysis,
      body.documentChunks ?? [],
      { allowReferenceSlides },
    );

    const finalSlides = mergeDuplicateSlideRoles(ensureEntityDifferentiationOutlineSlide(guardedSlides, differentiationStrategy, body.analysis));
    // §5/§9/§10: repair repeated boilerplate (drop verbatim-duplicated sentences across pages, keeping at least one).
    // If the deck is still overwhelmingly template-like (most pages duplicate body/keyMessage), return the compression
    // error instead of a repetitive generic deck. Conservative threshold (>50% of >=8 pages) avoids false failures.
    const { slides: dedupedSlides, duplicateBodySlides } = repairRepeatedOutlineBoilerplate(finalSlides);
    if (dedupedSlides.length >= 8 && duplicateBodySlides / dedupedSlides.length > 0.5) {
      return NextResponse.json({ error: '선택한 컨셉을 제안서 페이지 구조로 충분히 압축하지 못했습니다. 제안서 구조를 다시 생성해 주세요.', reason: 'repeated_boilerplate' }, { status: 422 });
    }
    // §8/§9: the outline must visibly carry the selected final concept. If the concept name is ENTIRELY absent from the
    // outline text, the structure did not transfer the concept — return the conversion error, not a generic deck.
    const conceptTokens = (finalConceptName || '').split(/[\s/·|]+/).map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, '')).filter((token) => token.length >= 2);
    if (conceptTokens.length) {
      const outlineText = dedupedSlides.map((slide) => [slide.slideTitle, slide.keyMessage, slide.relationToThesis, slide.mainCopy, slide.whyThisSlideExists].filter(Boolean).join(' ')).join(' ').toLowerCase();
      const conceptCarried = conceptTokens.some((token) => outlineText.includes(token.toLowerCase()));
      if (!conceptCarried) {
        return NextResponse.json({ error: '선택한 컨셉을 제안서 구조로 충분히 전개하지 못했습니다. 제안서 구조를 다시 생성해 주세요.', reason: 'concept_not_carried' }, { status: 422 });
      }
    }
    // Deterministic proposal-deck assembly: guarantee Cover (1) + Table of Contents (2), assign section bands + per-slide
    // layout (text-led before concept, visual-first after), strip the concept name from the Approach band. This converts
    // the model's analysis-ordered pages into a real proposal deck without relying on the LLM to emit structural fields.
    const proposalTypeLabel = proposalTypeLabels[normalizeProposalType(body.input.proposalType)];
    const deckSlides = applyDeckStructure(dedupedSlides, { finalConceptName, finalConceptSlogan, projectName: body.input.projectName, clientName: body.input.clientName, proposalTypeLabel, makeSlide: makeOutlineDeckSlide });
    const designGuide = buildDeckDesignGuide(body.input);
    console.info('[outline:deck-structure]', validateDeckStructure(deckSlides, finalConceptName));
    return NextResponse.json({ slides: deckSlides, designGuide, patternLearningSummary });
  } catch (error) {
    const message = error instanceof Error ? error.message : '아웃라인 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
