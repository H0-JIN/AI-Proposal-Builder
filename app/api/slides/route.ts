import { NextResponse } from 'next/server';
import { slideContentJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptCandidatesResult, ConceptDevelopmentLogic, ProjectInput, ProposalNarrative, SlideContent, SlideOutline } from '@/lib/types';
import type { ChunkCategory, DocumentChunk } from '@/lib/rag';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline, experienceDetailFields, experienceScenarioSteps, extractProductCodes, keyExperienceAssetFields } from '@/lib/experiencePlan';
import { sanitizeKpiSlides } from '@/lib/kpiGuard';
import { removeInternalConceptComparisonSlides } from '@/lib/internalSlides';
import { sanitizeGeneratedSlides } from '@/lib/slideSanitizer';
import { ensureRfpRequirementCoverage } from '@/lib/rfpRequirements';
import { formatChunksForPrompt, retrieveRelevantChunks } from '@/lib/rag';
import { applyProposalStructureGuardToOutline, applyProposalStructureGuardToSlides, buildProposalStructureGuard, proposalScopeTypeLabels } from '@/lib/proposalStructureGuard';
import { applyReferenceGuardToSlides, buildReferenceGuardInstruction, strategicMessageFieldsFromLogic } from '@/lib/referenceGuard';
import { buildStrategyLayerMetadata } from '@/lib/strategyLayer';
import { ensureProposalNarrative, summarizeProposalNarrative } from '@/lib/proposalNarrative';
import { getConceptDefinition, getPresentationConceptName } from '@/lib/conceptNamingGuard';


function normalizeSentence(value?: string) {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return /[.!?。！？…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function sectionLine(label: string, value?: string, fallback?: string) {
  return `${label}: ${normalizeSentence(value) || fallback}`;
}

function combineSentences(values: (string | undefined)[], fallback: string) {
  const combined = values.map(normalizeSentence).filter(Boolean).join(' ');
  return combined || fallback;
}

function limitToTwoSentences(value: string) {
  const sentences = value.match(/[^.!?。！？…]+[.!?。！？…]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  return sentences.slice(0, 2).join(' ') || value;
}

function conciseSectionLine(label: string, value?: string, fallback?: string) {
  return `${label}: ${limitToTwoSentences(normalizeSentence(value) || fallback || '')}`;
}

const rawAssetTypeListPattern = /^(?:Spatial Zone|Interactive Experience|Media Content|Photo\s*\/\s*Viral Spot|Product Trial Kit|Exhibition Object|Digital Signage|Operation Program|Brand Experience Module|Monument|Briefing Space|Immersive Room|Hands-on Demo|Visitor Participation Content)(?:\s*,\s*(?:Spatial Zone|Interactive Experience|Media Content|Photo\s*\/\s*Viral Spot|Product Trial Kit|Exhibition Object|Digital Signage|Operation Program|Brand Experience Module|Monument|Briefing Space|Immersive Room|Hands-on Demo|Visitor Participation Content)){1,}\.?$/i;

function outputShareSentence(value?: string) {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  if (!normalized || rawAssetTypeListPattern.test(normalized)) {
    return '체험 결과를 셀피 콘텐츠, 개인화 메시지, SNS 공유 이미지로 전환해 방문 경험이 온라인 버즈로 확장되도록 설계합니다.';
  }
  return normalized;
}

function buildExperienceApproachBullets(logic?: ConceptDevelopmentLogic) {
  return [
    sectionLine(
      'Client Intent',
      logic?.clientIntent,
      '클라이언트가 해결하려는 목적과 기대 효과를 하나의 전략 의도로 정리합니다.',
    ),
    sectionLine(
      'Audience Takeaway',
      logic?.audienceTakeaway,
      '방문객이 경험 후 가져가야 할 인식, 감정, 행동 변화를 명확히 정의합니다.',
    ),
    sectionLine(
      'Strategic Tension',
      logic?.strategicTension,
      '현재 과제와 목표 사이의 간극을 콘셉트가 풀어야 할 긴장으로 정리합니다.',
    ),
    sectionLine(
      'Concept Seed',
      logic?.conceptSeed,
      '핵심 콘셉트가 출발하는 한 줄 전략 씨앗을 제안합니다.',
    ),
    sectionLine(
      'Challenge',
      logic?.coreChallenge,
      '방문객 유입과 체류를 만들기 위해서는 단순 정보 전달이 아니라 방문 자체가 목적이 되는 경험 구조가 필요합니다.',
    ),
    sectionLine(
      'Insight',
      logic?.targetInsight,
      '타깃은 기능 설명보다 자신의 생활 맥락에서 활용 가능하고 공유할 수 있는 경험에 더 강하게 반응합니다.',
    ),
    `Opportunity: ${combineSentences(
      [logic?.brandOrProductValue, logic?.experienceOpportunity],
      '브랜드와 제품의 차별 가치를 공간 안에서 탐색하고 체감하는 참여형 경험으로 전환할 수 있습니다.',
    )}`,
    `Approach: ${combineSentences(
      [logic?.strategicApproach, logic?.conceptNecessity],
      '따라서 본 제안은 핵심 콘셉트를 중심으로 공간, 체험, 미디어, 공유가 하나의 여정으로 연결되는 전략적 경험 구조로 전개합니다.',
    )}`,
  ];
}

function buildCoreConceptBullets(concept?: ConceptCandidate, logic?: ConceptDevelopmentLogic) {
  const conceptNames = getPresentationConceptName(concept) || [concept?.conceptNameEN, concept?.conceptNameKR].map((name) => name?.trim()).filter(Boolean).join(' / ') || '핵심 경험 콘셉트';
  return [
    `Concept Name: ${conceptNames}`,
    sectionLine('Concept Statement', getConceptDefinition(concept), '프로젝트 과제를 하나의 전시 주제로 압축해 방문객이 직관적으로 이해하고 참여할 수 있도록 선언합니다.'),
    sectionLine('Core Message', concept?.coreMessage, '브랜드가 전달해야 할 핵심 메시지를 방문객의 행동과 감정으로 체감하게 합니다.'),
    sectionLine('Experience Logic', concept?.experienceLogic, '방문객의 선택, 체험, 반응, 결과물, 공유가 순차적으로 연결되는 경험 흐름으로 설계합니다.'),
    `Why This Concept: ${combineSentences(
      [logic?.coreChallenge, logic?.targetInsight, concept?.whyThisWorks || concept?.keyExperienceAssetDirection],
      '이 콘셉트는 핵심 과제와 타깃 인사이트를 동시에 해결하면서 브랜드 가치를 공간 안의 참여 경험과 공유 가능한 결과물로 전환하기 때문에 필요합니다.',
    )}`,
  ];
}

function buildExperienceStructureBullets(concept?: ConceptCandidate) {
  return [
    conciseSectionLine('Spatial Zone', concept?.spatialApplication, '콘셉트 메시지가 단계적으로 드러나는 진입, 탐색, 체험, 공유 존으로 공간을 구성합니다.'),
    conciseSectionLine('Hands-on Demo / Interactive Experience', concept?.experienceLogic, '방문객이 직접 선택하고 조작하며 즉각적인 반응을 확인하는 참여형 체험으로 전개합니다.'),
    conciseSectionLine('Media / Signage', concept?.mediaInteractionPotential, '미디어와 사이니지는 안내를 넘어 방문객 행동에 반응하고 콘셉트 메시지를 시각적으로 증폭하는 장치로 활용합니다.'),
    conciseSectionLine('Photo / Viral Spot', concept?.viralPotential, '촬영하고 공유하고 싶은 대표 장면을 설계해 현장 경험이 자연스럽게 SNS 확산으로 이어지게 합니다.'),
    conciseSectionLine('Output / Share', outputShareSentence(concept?.keyExperienceAssetDirection), '체험 결과를 셀피 콘텐츠, 개인화 메시지, SNS 공유 이미지로 전환해 방문 경험이 온라인 버즈로 확장되도록 설계합니다.'),
  ];
}

function enhanceConceptFlowSlides(slides: SlideContent[], logic?: ConceptDevelopmentLogic, concept?: ConceptCandidate) {
  return slides.map((slide) => {
    const slideKey = `${slide.slideType} ${slide.slideTitle}`;

    if (/experience approach|경험 설계 접근/i.test(slideKey)) {
      return {
        ...slide,
        slideTitle: 'Experience Approach',
        bodyBullets: buildExperienceApproachBullets(logic),
      };
    }

    if (/^core concept|핵심 콘셉트/i.test(slideKey)) {
      return {
        ...slide,
        slideTitle: getPresentationConceptName(concept) ? `Core Concept: ${getPresentationConceptName(concept)}` : 'Core Concept',
        bodyBullets: buildCoreConceptBullets(concept, logic),
      };
    }

    if (/experience structure/i.test(slideKey)) {
      return {
        ...slide,
        slideTitle: 'Experience Structure',
        bodyBullets: buildExperienceStructureBullets(concept),
      };
    }

    return slide;
  });
}

const assetTypeGuide = [
  'Spatial Zone',
  'Interactive Experience',
  'Media Content',
  'Photo / Viral Spot',
  'Product Trial Kit',
  'Exhibition Object',
  'Digital Signage',
  'Operation Program',
  'Brand Experience Module',
  'Monument',
  'Briefing Space',
  'Immersive Room',
  'Hands-on Demo',
  'Visitor Participation Content',
].join(', ');

type SlideRetrievalMetadata = {
  slideNumber: number;
  slideTitle: string;
  retrievalQuery: string;
  matchedCategories: ChunkCategory[];
  evidenceCount: number;
};

type OutlineWithEvidence = SlideOutline & {
  retrievalQuery?: string;
  matchedCategories?: ChunkCategory[];
  evidenceCount?: number;
  evidenceSnippets?: string;
};

const slideCategoryPriorities = [
  {
    pattern: /rfp|summary|overview|project understanding|objective|background|요약|개요|프로젝트|배경|이해/i,
    categories: ['projectObjective', 'backgroundInsight', 'operationDirection'] as ChunkCategory[],
  },
  {
    pattern: /required|requirement|scope|task|deliverable|과업|요구|범위|산출|필수|대응표/i,
    categories: ['requiredDeliverables', 'constraints', 'existingAsset'] as ChunkCategory[],
  },
  {
    pattern: /kpi|goal|performance|effect|성과|목표|지표|기대효과/i,
    categories: ['kpi', 'performanceGoal'] as ChunkCategory[],
  },
  {
    pattern: /schedule|timeline|evaluation|criteria|심사|평가|일정|마일스톤/i,
    categories: ['schedule', 'evaluationCriteria'] as ChunkCategory[],
  },
  {
    pattern: /spatial|space|zone|venue|moving line|placement|layout|공간|동선|배치|존|장소/i,
    categories: ['venue', 'existingAsset', 'constraints', 'referenceOnly'] as ChunkCategory[],
  },
  {
    pattern: /operation|execution|setup|conversion|staff|risk|registration|session|pavilion|catering|운영|실행|설치|전환|인력|리스크|등록|세션|케이터링/i,
    categories: ['operationDirection', 'constraints', 'schedule', 'existingAsset'] as ChunkCategory[],
  },
  {
    pattern: /concept|experience strategy|experience approach|content|interactive|media|journey|viral|콘셉트|경험|체험|콘텐츠|인터랙션|미디어|여정|공유/i,
    categories: ['requiredDeliverables', 'productFeature', 'venue', 'referenceOnly', 'designDirection'] as ChunkCategory[],
  },
];

function inferSlidePriorityCategories(slide: SlideOutline) {
  const slideKey = [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage].join(' ');
  const matched = slideCategoryPriorities.find((priority) => priority.pattern.test(slideKey))?.categories ?? [];
  return Array.from(new Set<ChunkCategory>(matched.length ? matched : ['requiredDeliverables', 'projectObjective', 'constraints', 'performanceGoal']));
}

function buildSlideCategoryWeights(categories: ChunkCategory[]) {
  return categories.reduce<Partial<Record<ChunkCategory, number>>>((weights, category, index) => {
    weights[category] = Math.max(18, 52 - index * 7);
    return weights;
  }, {});
}

function buildSlideRetrievalQuery(input: ProjectInput, slide: SlideOutline) {
  return [input.projectName, slide.slideType, slide.slideTitle, slide.slidePurpose].filter(Boolean).join(' / ');
}

function buildSlideEvidenceOutline(input: ProjectInput, outline: SlideOutline[], chunks: DocumentChunk[], proposalType: ProjectInput['proposalType']) {
  const maxEvidenceCharsPerSlide = Math.max(700, Math.min(1400, Math.floor(28000 / Math.max(outline.length, 1))));
  const metadata: SlideRetrievalMetadata[] = [];
  const outlineWithEvidence: OutlineWithEvidence[] = outline.map((slide) => {
    const categories = inferSlidePriorityCategories(slide);
    const retrievalQuery = buildSlideRetrievalQuery(input, slide);
    const evidenceChunks = retrieveRelevantChunks({
      stage: 'slide',
      proposalType,
      slideTitle: slide.slideTitle,
      query: retrievalQuery,
      categories,
      categoryWeights: buildSlideCategoryWeights(categories),
      categoryMatchMode: 'filter',
      limit: 4,
      chunks,
    });
    const matchedCategories = Array.from(new Set(evidenceChunks.flatMap((chunk) => chunk.categories ?? [chunk.category]).filter((category) => categories.includes(category))));
    metadata.push({ slideNumber: slide.slideNumber, slideTitle: slide.slideTitle, retrievalQuery, matchedCategories, evidenceCount: evidenceChunks.length });

    return {
      ...slide,
      retrievalQuery,
      matchedCategories,
      evidenceCount: evidenceChunks.length,
      evidenceSnippets: formatChunksForPrompt(evidenceChunks, maxEvidenceCharsPerSlide),
    };
  });

  return { outlineWithEvidence, metadata };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedConcept: ConceptCandidate; outline: SlideOutline[]; conceptDevelopmentLogic?: ConceptDevelopmentLogic; conceptGenerationResult?: ConceptCandidatesResult; proposalNarrative?: ProposalNarrative; documentChunks?: DocumentChunk[] };

    if (!body.input || !body.analysis || !body.selectedConcept || !body.outline?.length) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 선택된 콘셉트, 아웃라인이 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const effectiveProposalType = body.analysis.inferredProposalType ?? body.input.proposalType;
    const isEventOperationType = effectiveProposalType === 'mice_event_operation' || effectiveProposalType === 'conference_forum';
    const structureGuard = buildProposalStructureGuard(body.input, body.analysis);
    const scopeLabelText = structureGuard.proposalScopeTypes.map((scope) => proposalScopeTypeLabels[scope]).join(' + ') || '감지된 세부 범위 없음';
    const productCodes = isEventOperationType ? [] : extractProductCodes({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });
    const expandedOutline = applyProposalStructureGuardToOutline(ensureRfpRequirementCoverage(
      removeInternalConceptComparisonSlides(expandExperiencePlanOutline(body.outline, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic })),
      body.analysis,
      body.documentChunks ?? [],
    ), body.input, body.analysis);
    const { outlineWithEvidence, metadata: slideRetrievalMetadata } = buildSlideEvidenceOutline(
      body.input,
      expandedOutline,
      body.documentChunks ?? [],
      effectiveProposalType,
    );
    const hasSlideEvidence = slideRetrievalMetadata.some((metadata) => metadata.evidenceCount > 0);
    const referenceGuardInstruction = buildReferenceGuardInstruction(body.analysis);
    const strategyLayerMetadata = buildStrategyLayerMetadata({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic, conceptGenerationResult: body.conceptGenerationResult });
    const strategicMessageSummary = strategicMessageFieldsFromLogic(body.conceptDevelopmentLogic);
    const proposalNarrative = ensureProposalNarrative(body.proposalNarrative, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, documentText: body.input.briefText });
    const fallbackRetrievedChunks = retrieveRelevantChunks({
      stage: 'slide',
      proposalType: effectiveProposalType,
      query: `${body.input.projectName} ${expandedOutline.map((slide) => slide.slideTitle).join(' ')}`,
      limit: 18,
      chunks: body.documentChunks ?? [],
    });
    const fallbackRetrievalContext = hasSlideEvidence ? '' : formatChunksForPrompt(fallbackRetrievedChunks, 11000);

    const result = await createStructuredJson<{ slides: SlideContent[] }>({
      schemaName: 'proposal_slide_contents',
      schema: slideContentJsonSchema,
      system: [
        '너는 전시/브랜드 체험관 및 MICE/컨퍼런스 운영 제안서 초안을 작성하는 한국어 크리에이티브 전략가이자 제안서 작가다.',
        isEventOperationType ? '이 단계는 행사 운영형 제안 생성 단계다. 사용자가 수정한 슬라이드 아웃라인을 최종 기준으로 삼아 RFP 요약을 반복하지 말고 행사 목적, 브랜드 메시지, 프로그램, 등록/입장, 세션 시스템, 파트너 부스, 네트워킹/케이터링, 동선, 설치/전환, 인력, 리스크, 예산 문안을 실제 제안서 초안 수준으로 생성하라.' : structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '이 단계는 콘텐츠 개발형 제안 생성 단계다. 사용자가 수정한 슬라이드 아웃라인을 최종 기준으로 삼아 RFP 요약을 반복하지 말고 content concept, narrative, media mechanism, hero content, sub content, scenario, reference, schedule, credential 중심의 PPT 장표 문안을 실제 제안서 초안 수준으로 생성하라.' : '이 단계는 제안 생성 단계다. 사용자가 수정한 슬라이드 아웃라인을 최종 기준으로 삼아 RFP 요약을 반복하지 말고 경험 전략, 콘셉트, 핵심 체험 자산, 공간/콘텐츠 구성, 미디어/인터랙션, 방문객 여정, PPT 장표 문안을 실제 제안서 초안 수준으로 생성하라. 아웃라인의 slideTitle, slidePurpose, keyMessage, mainCopy 수정 내용은 반드시 반영하라.',
        '각 슬라이드는 Proposal Narrative와 outline metadata를 보존한다. slidePurpose는 Problem, Insight, Strategy, Concept, Experience, Content, Proof, Impact 중 하나만 사용하고 slideRole, relationToThesis, whyThisSlideExists를 반드시 작성하라.',
        `각 슬라이드는 slideNumber, slideType, slideTitle, slidePurpose, slideRole, relationToThesis, whyThisSlideExists, keyMessage, mainCopy, bodyBullets, visualDirection, visitorAction, contentMechanism, spatialPlacement, mediaOrObject, outputOrReward, imagePlaceholder, visualPrompt, diagramSuggestion, productExperienceDetails, keyExperienceAssets, experienceScenarioSteps, referenceInsights, speakerNote, confirmNeededNote를 모두 작성한다. 일반 슬라이드에서 해당 배열이 없으면 빈 배열을 넣는다. 제품/콘텐츠 상세 장표는 ${experienceDetailFields.join(', ')} 항목을 productExperienceDetails에 명확히 작성하라.`,
        '모든 content/detail slide의 mainCopy와 bodyBullets는 Why → What → How → Proof 흐름으로 작성하라. RFP object를 raw list로 제시하지 말고 RFP object → experience role → visitor meaning → proof of client capability로 변환하라.',
        'KPI, Operation, Budget, Company Introduction, Schedule, RFP Requirement Table, Media Experience Overview, Content Mechanism 장표는 RFP가 명시하거나 proposalThesis에 직접 연결될 때만 작성하고, relationToThesis와 whyThisSlideExists에서 그 이유를 설명하라.',
        '본문 문안에는 RFP Fact / AI Proposal / Confirm Needed 구분을 반영하라. 단, AI Proposal 영역은 RFP 반복이 아니라 새 제안 아이디어여야 하며 Confirm Needed는 confirmNeededNote에만 배치하라.',
        '각 슬라이드 문안은 슬라이드 아웃라인에 포함된 retrievalQuery와 evidenceSnippets를 우선 근거로 사용하라. evidenceSnippets는 해당 slideTitle, slideType, slidePurpose로 검색된 슬라이드별 RFP/RAG 근거이며, 다른 슬라이드의 evidenceSnippets를 해당 슬라이드의 RFP 사실처럼 전용하지 말라.',
        'winningStrategyBrief / proposalThesis / experienceLogic은 Winning Strategy Layer 메타데이터다. 제공된 값이 있으면 보존해 제안서 문안의 전략 축에 반영하고, 없으면 서버 fallback 값을 사용하라. 이 메타데이터가 없다는 이유로 장표 문안 생성을 중단하지 말라.',
        'evidenceSnippets에 있는 chunk category와 importance를 반영해 high 중요도 및 해당 슬라이드 matchedCategories 근거를 우선 사용하라. evidenceCount가 0이거나 관련 근거가 없으면 기존처럼 분석 결과, 콘셉트, 아웃라인을 사용하되 RFP 사실이라고 단정하지 말고 제안 가정/운영 가정으로 표현하라.',
        referenceGuardInstruction,
        'RFP에 명시되지 않은 필수 요구사항, KPI 수치, 일정, 평가 기준, 공간 제약은 만들지 말라. 근거가 부족한 내용은 “제안 가정상”, “운영 설계 기준으로”, “추후 발주처 확인 후”처럼 가정 또는 확인 필요 문장으로 작성하라.',
        'proposalScopeTypes와 proposalStructureGuard를 준수하라. contentDevelopment + boothExhibition에서는 Hero Content, Sub Content, Zoning & Flow, Content Scenario, Reference, Schedule, Credential 문안에 집중하고, RFP에 명시되지 않은 Viral/Communication Strategy, KPI/Performance Goal, Operation Plan, Output & Share, Visitor Reward, SNS Sharing, Marketing Campaign 내용으로 확장하지 말라.',
        'KPI는 정량 targetKPI 또는 평가 기준의 performance metrics 요구가 있을 때만 별도 장표 본문으로 작성한다. “이해도 제고”, “브랜드 인지도 상승”은 프로젝트 목표/전략 문장으로만 처리한다. Operation Plan은 부스 운영 계획, staffing, onsite operation, visitor flow operation, maintenance, safety operation이 명시된 경우에만 작성하고 그렇지 않으면 Schedule로 제한한다.',
        isEventOperationType ? '사용자가 선택한 하나의 핵심 콘셉트만 이후 실행 장표의 기준으로 작성하라. 콘셉트는 단순 시스템명이나 운영 플랫폼명이 아니라 행사 목적, 브랜드 메시지, 파트너십, 기술 공유, 비즈니스 기회를 압축한 행사 정체성으로 표현하라. Experience Structure, Main Experience Image, Key Experience Asset, Visitor Action, Interactive Flow, Content Mechanism, Output & Share, Viral Communication Strategy, Media Experience Overview, Key Media Scene, Photo / Viral Spot, Hands-on Demo 장표와 본문 표현은 생성하지 말라. Operation Framework 장표는 등록, 세션, 파트너 부스, 네트워킹, 동선, 인력, 리스크를 연결하는 운영 체계로 작성하라.' : '사용자가 선택한 하나의 핵심 콘셉트만 이후 실행 장표의 기준으로 작성하라. 선택되지 않은 콘셉트, 후보 간 비교, 평가 점수, 보류 사유는 어떤 장표에서도 언급하지 말라. Concept Candidates, 콘셉트 후보 3안 비교, 3개 콘셉트 비교표, 선택되지 않은 콘셉트 설명, 내부 평가 점수표 장표는 절대 작성하지 말라. Experience Approach 장표는 내부 분석 항목명이 아니라 Challenge, Insight, Opportunity, Approach 네 항목의 제안서 문장으로 작성하고, “후보 중 선택”이 아니라 “이 과제를 해결하려면 이러한 경험 접근이 필요하고 따라서 이 핵심 콘셉트로 전개해야 한다”는 논리로 작성하라. Core Concept 장표는 단순 소개가 아니라 Concept Name, Concept Statement, Core Message, Experience Logic, Why This Concept 구성의 전시 주제 선언으로 작성하라. Why This Concept에는 핵심 과제와 타깃 인사이트를 해결하기 위해 왜 이 콘셉트가 필요한지 설명하라. Experience Structure 장표에는 Spatial Zone, Hands-on Demo / Interactive Experience, Media / Signage, Photo / Viral Spot, Output / Share 항목을 포함하되 각 항목은 1~2문장 이내로 핵심 콘셉트의 실행 확장 구조를 보여줘라. 최종 본문에는 내부 JSON 필드명 또는 camelCase 항목명을 노출하지 말라.',
        '제안 아이디어와 장표 문안은 analysis.requiredDeliverables, analysis.scopeOfWork, analysis.taskSections[].requiredDeliverables를 최우선 기준으로 삼고 analysis.requiredScope, analysis.productInfo, analysis.productFeatures 중심으로만 생성하라. proposalType별 템플릿보다 RFP 필수 항목과 과업 범위가 우선이다. analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets 항목은 독립 체험 모듈/제품 상세/신규 콘텐츠 단위로 생성하지 말고 참고 방향 또는 레퍼런스 인사이트로만 사용하라.',
        'RFP Requirement Response / 과업 대응표 장표는 RFP 요구사항, 대응 장표, 제안 방향, 비고 형식의 표처럼 읽히게 작성하라. requiredDeliverables와 scopeOfWork는 개별 단독 장표를 과도하게 만들지 말고 먼저 과업 대응표 row와 기존 본문 장표 bullet/note에 매핑하라. 그래도 불가능한 경우에만 유사 항목을 묶은 보완 장표에 요구사항명을 명시하라.',
        'Evaluation Criteria 관련 장표와 각 chapter 문안은 analysis.evaluationCriteria 및 evaluationCriteria retrieval chunk를 근거로 심사 기준에 어떻게 대응하는지 드러나게 작성하라. Reference Insight 또는 Design Reference Direction 장표가 있으면 FF7, S26 Showcase, MDW Art Wall, Foldable Monument를 우선 참고해 referenceInsights 배열에 referenceName, referenceType, whatToLearn, howToApply, caution을 채워라. caution에는 “실제 제안 범위가 아닌 참고 사례”라는 의미가 분명히 드러나야 한다.',
        '참고 사례를 다룰 때는 “임팩트 있는 전시 요소 참고 방향”, “기존 캠페인에서 확인된 성공 요소”, “참고 사례 기반 설계 원칙”, “레퍼런스 인사이트”처럼 표현하라. FF7 체험 상세, S26 체험 상세, C2 체험 상세, 기존 캠페인명 체험 상세 같은 신규 모듈 장표 또는 productExperienceDetails를 만들지 말라.',
        `Key Experience Asset Concept 슬라이드에는 selectedConcept.keyExperienceAssetDirection을 기준으로 프로젝트 핵심 체험 자산을 반드시 1~3개로 압축해 keyExperienceAssets 배열에 작성하라. 각 asset은 ${keyExperienceAssetFields.join(', ')} 항목을 포함한다. 일반 assetType 후보 목록은 bodyBullets에 나열하지 말라. 참고 가능한 assetType 범위는 ${assetTypeGuide}이지만 PPT에는 선택된 1~3개만 보이게 작성하라.`,
        'assetType을 무조건 Monument로 고정하지 말라. RFP에서 모뉴먼트를 요구한 경우에만 Monument를 선택할 수 있다. 공간 구성 중심이면 Spatial Zone, 체험 콘텐츠 중심이면 Interactive Experience, 영상/LED/미디어 중심이면 Media Content 또는 Digital Signage, 촬영/공유 중심이면 Photo / Viral Spot, 제품 비교/시연 중심이면 Product Trial Kit 또는 Hands-on Demo를 우선 검토하라.',
        '제품 또는 주요 콘텐츠 단위는 analysis.productFeatures의 product/keyFeature/valueProposition을 우선 반영하고 analysis.requiredDeliverables, analysis.scopeOfWork, analysis.taskSections.requiredDeliverables, analysis.requiredScope, analysis.productInfo 또는 analysis.productFeatures에 명시된 제품/서비스 단위만 기준으로 삼아 각 단위별 Product Experience Detail 장표를 반드시 생성하라. Q8/H8/B8처럼 제품 코드가 복수로 감지되면 Q8, H8, B8 각각의 상세 장표 또는 제품별 비교표를 만들고, “폴더블 갤럭시 제품 체험 모듈”처럼 포괄 이름 하나로 병합하지 말라. 동일 제품/동일 체험 장표는 중복 생성하지 말고 제품당 1~2장으로 제한하라. Q8/H8/B8처럼 복수 제품이 있으면 한 제품에 상세 장표가 몰리지 않도록 균형 있게 배치하라. 같은 제품에 2장이 필요할 때만 “체험 개요”와 “체험 시나리오”처럼 역할을 명확히 분리하라. productExperienceDetails 배열에는 productCode, productRole, coreValue, experienceTitle, oneLineExperience, visitorMission, visitorAction, systemResponse, mediaOrObject, spatialPlacement, outputOrReward, snsSharePoint, visualDirection, imagePlaceholder, diagramSuggestion을 채워라. 단순 제품 설명이 아니라 방문객 행동, 시스템 반응, 결과물이 명확한 콘텐츠만 작성하라. referenceOnly/doNotTreatAsScope/existingAssets의 참고 사례, 기존 캠페인, 레슨런드 항목은 제외하라. “제작”, “개발”, “운영”, “구성”, “기획”, “제안” 같은 과업/업무 범위 표현은 체험 콘텐츠명으로 사용하지 말고 실행 계획, 제작 범위, 운영 계획 장표에서만 다루라.',
        isEventOperationType ? '행사 운영형에서는 Spatial / Content Plan, Main Experience Image, Product Experience Detail을 생성하지 말고 Event Identity, Program Overview, Operation Framework, Registration & Entry Plan, Session System Operation, Partner Pavilion Plan, Networking / Catering Plan, Moving Line Plan, Setup / Conversion Plan, Staffing Plan, Risk Management, Schedule, Budget Summary 문안으로 작성하라.' : structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '콘텐츠 개발형에서는 Spatial / Content Plan을 일반 체험 상세로 과확장하지 말고 Zoning & Flow, Hero Content, Sub Content, Content Scenario의 공간/동선/콘텐츠 역할만 구체화하라.' : 'Spatial / Content Plan은 핵심 콘셉트와 핵심 체험 자산을 기준으로 최소 5장 구조를 반드시 유지한다. 제품별 체험 상세 장표는 동일 제품/동일 체험을 반복하지 말고 유사 장표는 병합하라. Zone Detail 01 같은 일반 제목은 최종 slideTitle로 사용하지 말고 Q8 체험 개요, H8 체험 시나리오, B8 셀피 체험 개요처럼 제품과 역할이 분명한 실제 체험명으로 바꿔라.',
        'imagePlaceholder는 파일명형 placeholder가 아니라 “대표 이미지 삽입 영역” 또는 자연어 1줄 이미지 설명으로 작성하라. 실제 이미지 생성용 visualPrompt와 diagramSuggestion은 내부 데이터용 필드에만 유지하고 PPT 본문, bullet, speakerNote에 노출하지 말라.',
        `Spatial / Content Plan의 Experience Scenario 장표는 ${experienceScenarioSteps.join(' → ')} 6단계를 experienceScenarioSteps 배열로 작성하고, 각 단계별 visitorAction, systemResponse, mediaOrObject, output, designNote가 표/플로우처럼 읽히게 하라.`,
        isEventOperationType ? '행사 운영형에서는 Media / Interactive Plan, Interactive Flow, Content Mechanism, Output & Share를 생성하지 말고 세션 시스템 운영, 발표 장비 백업, 등록 시스템, 운영 커뮤니케이션 체계로 표현하라.' : structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '콘텐츠 개발형에서는 Media / Interactive Plan을 최소 5장으로 강제하지 말고 Hero/Sub Content의 media mechanism, narrative scenario, reference 적용만 작성하라. Output & Share는 RFP가 명시할 때만 작성하라.' : 'Media / Interactive Plan은 핵심 콘셉트와 핵심 체험 자산을 기준으로 최소 5장 구조를 반드시 유지한다: Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share. Content Mechanism과 콘텐츠 작동 원리 및 메커니즘처럼 의미가 같은 장표를 중복 생성하지 말라. 미디어/인터랙션 요소가 많은 경우 추가된 아웃라인에 맞춰 자산별 상세 장표를 작성하라.',
        'Media / Interactive Plan은 관람객 행동 → 센서/입력 → 미디어 반응 → 결과물 → 공유가 보이도록 visitorAction, contentMechanism, mediaOrObject, outputOrReward, diagramSuggestion을 연결해 작성하라.',
        'Visitor Journey는 방문 전/진입/몰입/참여/공유/퇴장 이후의 행동과 감정, 접점, 콘텐츠, 운영 포인트가 연결되게 작성하라.',
        'Media / Interactive Plan은 미디어 장치와 상호작용 방식이 콘셉트 및 핵심 체험 자산과 어떻게 연결되는지 구체적으로 작성하라.',
        structureGuard.proposalScopeTypes.includes('contentDevelopment') ? '콘텐츠 개발형에서는 Viral / Communication Mechanism, 포토/공유/UGC/초대/리워드 확산 문안을 RFP가 직접 요구하지 않으면 작성하지 말라.' : 'Viral / Communication Mechanism은 포토/공유/UGC/초대/리워드 등 확산 구조를 프로젝트 맥락에 맞게 설계하라.',
        structureGuard.hasExplicitOperationPlan ? 'Operation Plan은 RFP가 명시한 부스 운영 계획, 안내, 동선 운영, 안전, 스태핑, 유지관리 범위 안에서만 작성하라.' : 'Operation Plan은 별도 장표/본문으로 확장하지 말고 필요한 실행 일정은 Schedule에만 반영하라.',
        'KPI/Expected Effect 장표에는 analysis.numericInfo.targetKPI로 명확히 분류된 수치와 analysis.numericInfo.proposedMeasurement의 측정 방식만 자연스러운 제안서 문장으로 표시하라. 내부 지시문은 본문에 쓰지 말라. targetKPI가 비어 있으면 임의 수치를 만들지 말고 “RFP에 별도 정량 KPI가 없는 경우, 운영 품질을 측정할 수 있는 관리 지표를 제안합니다.” 및 “운영 성과는 등록 처리 속도, 세션 운영 안정성, 참석자 만족도, 네트워킹 참여도, 현장 이슈 대응률을 중심으로 측정합니다.”처럼 측정 항목 제안으로 표현하라. RFP에 없는 방문객 증가 예상, 만족도 상승 예상, 재방문율 향상 예상, 구매 전환율 향상 예상 같은 수치/단정 예측을 금지한다.',
        '문안은 제안서에 바로 붙여넣을 수 있는 문장으로 작성하고 “필요”, “구체화 필요”, “확인 필요” 반복을 피하라. “3개 후보 중 가장 적합”, “다른 후보 대비”, “RFP 적합도 점수” 같은 내부 의사결정 표현을 금지하고, 핵심 콘셉트가 프로젝트 과제에서 자연스럽게 귀결되는 제안서 톤으로 작성하라. 최종 PPTX 노출 문안에는 “선택된 콘셉트”, “콘셉트 후보”, “콘셉트 도출 과정”, “후보 비교”, “C1 / C2 / C3”, “추천 콘셉트” 표현을 쓰지 말라.',
        '너무 일반적인 표현을 피하고, 프로젝트명/클라이언트명/분석 결과의 맥락을 반영해 콘셉트와 콘텐츠가 하나의 경험 구조로 이어지게 하라.',
      ].join('\n'),
      user: `사용자 선택 제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
RFP 분석 기반 유형: ${proposalTypeLabels[effectiveProposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

슬라이드별 검색 근거:
${hasSlideEvidence ? '각 슬라이드 객체의 evidenceSnippets, retrievalQuery, matchedCategories, evidenceCount를 사용한다.' : '슬라이드별 검색 근거 없음. 아래 fallback 근거와 분석 결과를 사용하되 RFP 사실 단정은 피한다.'}

Fallback 검색 근거 chunk:
${fallbackRetrievalContext || '검색된 chunk 없음'}

분석 결과:
${JSON.stringify(body.analysis, null, 2)}

전략 메시지 추출 요약:
${strategicMessageSummary || '전략 메시지 추출 필드 없음'}

Winning Strategy Layer 메타데이터(제공값 우선, 누락 시 서버 fallback):
${JSON.stringify(strategyLayerMetadata, null, 2)}

Proposal Narrative:
${summarizeProposalNarrative(proposalNarrative)}

경험 접근 로직:
${JSON.stringify(body.conceptDevelopmentLogic ?? null, null, 2)}

핵심 콘셉트:
${JSON.stringify(body.selectedConcept, null, 2)}

슬라이드 아웃라인 + slideTitle 기반 evidence:
${JSON.stringify(outlineWithEvidence, null, 2)}

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

    const sanitizedSlides = applyReferenceGuardToSlides(
      applyProposalStructureGuardToSlides(
        sanitizeGeneratedSlides(removeInternalConceptComparisonSlides(sanitizeKpiSlides(enhanceConceptFlowSlides(result.slides, body.conceptDevelopmentLogic, body.selectedConcept), body.analysis)), productCodes),
        body.input,
        body.analysis,
      ),
      body.analysis,
    );
    return NextResponse.json(sanitizedSlides.map((slide) => ({
      ...slide,
      retrievalMetadata: slideRetrievalMetadata.find((metadata) => metadata.slideNumber === slide.slideNumber || metadata.slideTitle === slide.slideTitle),
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : '장표 문안 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
