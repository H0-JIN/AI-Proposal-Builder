import { NextResponse } from 'next/server';
import { conceptCandidatesJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidatesResult, ProjectInput, ProposalNarrative } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { formatCategoryEvidenceGroupsForPrompt, retrieveCategoryEvidenceGroups } from '@/lib/rag';
import { buildReferenceGuardInstruction } from '@/lib/referenceGuard';
import { ensureProposalNarrative, summarizeProposalNarrative } from '@/lib/proposalNarrative';
import { applyNonBlockingConceptNamingGuard, buildConceptNamingRetryInstruction, normalizeConceptCandidatesResult, validateConceptNaming } from '@/lib/conceptNamingGuard';
import { buildRfpDifferentiationStrategy, summarizeDifferentiationStrategy } from '@/lib/rfpDifferentiation';
import { formatProposalAvoidanceRulesForPrompt, formatProposalPatternDiagnostics, formatProposalPatternsForOutlinePrompt, retrieveProposalPatternsForOutline } from '@/lib/proposalPatternOutline';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; proposalNarrative?: ProposalNarrative; documentChunks?: DocumentChunk[] };

    if (!body.input || !body.analysis) {
      return NextResponse.json({ error: '프로젝트 입력값과 분석 결과가 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const effectiveProposalType = body.analysis.inferredProposalType ?? body.input.proposalType;
    const isEventOperationType = effectiveProposalType === 'mice_event_operation' || effectiveProposalType === 'conference_forum';
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);
    const conceptEvidenceGroups = retrieveCategoryEvidenceGroups({
      stage: 'concept',
      proposalType: effectiveProposalType,
      query: `${body.input.projectName} ${body.input.clientName}`,
      chunks: body.documentChunks ?? [],
      groups: [
        { label: '콘셉트 필수 산출물 (40)', categories: ['requiredDeliverables'], description: 'concept weighted retrieval 40: 콘셉트가 반드시 대응해야 할 과제/산출물 기준', limit: 5 },
        { label: '성과 목표 (20)', categories: ['performanceGoal'], description: 'concept weighted retrieval 20: 콘셉트의 성과 방향과 기대 효과 기준', limit: 3 },
        { label: '공간 조건 (15)', categories: ['venue'], description: 'concept weighted retrieval 15: 공간 적용성, 동선, 장소 제약 기준', limit: 4 },
        { label: '현재 프로젝트 참고 레퍼런스 (15)', categories: ['referenceOnly', 'designDirection'], description: 'concept weighted retrieval 15: 현재 업로드된 RFP/제안 자료에 명시된 레퍼런스만 벤치마크 인사이트로 사용', limit: 5 },
        { label: '제약 조건 (10)', categories: ['constraints'], description: 'concept weighted retrieval 10: 실행/운영/제작 제약 기준', limit: 3 },
        { label: '제품 특징', categories: ['productFeature'], description: '현재 RFP에 명시된 제품/서비스별 핵심 기능과 가치 제안을 콘셉트 차별화 근거로 사용', limit: 4 },
      ],
    });
    const retrievalContext = formatCategoryEvidenceGroupsForPrompt(conceptEvidenceGroups, 9000);
    const referenceGuardInstruction = buildReferenceGuardInstruction(body.analysis, body.documentChunks ?? []);
    const proposalNarrative = ensureProposalNarrative(body.proposalNarrative, { input: body.input, analysis: body.analysis, documentText: body.input.briefText });
    const differentiationStrategy = buildRfpDifferentiationStrategy(body.analysis, proposalNarrative);
    const proposalPatternGuidance = await retrieveProposalPatternsForOutline({ limit: 10, antiPatternLimit: 10 });
    const proposalPatternContext = formatProposalPatternsForOutlinePrompt(proposalPatternGuidance.patterns);
    const proposalAvoidanceRuleContext = formatProposalAvoidanceRulesForPrompt(proposalPatternGuidance.avoidanceRules);
    const hasMultipleEntities = differentiationStrategy.hasMultipleEntities;
    const proposalPatternDiagnostics = formatProposalPatternDiagnostics(proposalPatternGuidance.summary, hasMultipleEntities);

    const systemPrompt = [
      '너는 전시, 브랜드 체험관, 팝업스토어, 플래그십 공간, MICE/컨퍼런스 운영 제안의 핵심 콘셉트를 설계하는 한국어 크리에이티브 디렉터다.',
      'AI 분석 완료 후 Strategic Message Extraction과 Proposal Narrative를 기준으로 사용자가 선택할 수 있는 콘셉트 후보를 정확히 3개 생성하라.',
      '반드시 다음 순서로 사고하고 출력하라: 1) current RFP evidence와 user-provided info만 읽기 2) Hidden Needs(surfaceRequest, hiddenNeed, clientAnxiety, decisionTrigger, evaluationRisk, realWinningCondition) 추출 3) Strategic Approach(strategicTension, winningApproach, differentiationLogic, audiencePerceptionShift, proofLogic) 생성 4) RFP에 회사/브랜드/제품/서비스/존/관객/콘텐츠/이해관계자/경험 모듈 등 복수 entity가 있으면 conceptName 이전에 entityDifferentiationMatrix를 확정 5) Proposal Narrative의 proposalThesis 식별 6) 핵심 audience transformation 식별 7) 클라이언트/브랜드가 관람객에게 만들고 싶은 믿음 식별 8) strategic metaphor 또는 core experience promise 식별 9) conceptRationale 생성 10) conceptName 생성 11) conceptSlogan/conceptTagline 생성 12) conceptDefinition 생성 13) thesisProof 생성 14) execution strategy로서 experienceStructure 및 flexible experienceNarrativeFlow 생성 15) antiPatternValidation으로 검증. 절대 booth constraints, media types, content mechanisms, object lists, RFP deliverables, lost proposal avoidance rule에서 이름을 시작하지 말라.',
      '출력은 hiddenNeeds, strategicApproach, entityDifferentiationMatrix, conceptDevelopmentLogic, concepts, recommendation을 모두 포함한다. hiddenNeeds는 current RFP evidence와 user-provided information에서만 도출하고 unsupported business facts를 만들지 말라. strategicApproach는 hiddenNeeds 이후에 생성하며 strategicTension, winningApproach, differentiationLogic, audiencePerceptionShift, proofLogic을 current RFP 근거와 연결하라. conceptDevelopmentLogic에는 winningStrategyBrief, proposalThesis, experienceLogic, clientIntent, audienceTakeaway, strategicTension, conceptSeed, coreChallenge, targetInsight, brandOrProductValue, experienceOpportunity, strategicApproach, conceptNecessity, selectedConceptReason을 작성하라. winningStrategyBrief는 RFP 과제와 선택/추천될 콘셉트를 잇는 승리 전략 요약, proposalThesis는 제안서 전체를 관통하는 핵심 주장, experienceLogic은 제안서 단계에서 보존할 경험 흐름 메타데이터로 작성하라.',
      'conceptDevelopmentLogic은 기준 나열이 아니라 전략 메시지 추출 → 핵심 과제 → 타깃 인사이트 → 제품/브랜드 가치 → 경험 기회 → strategic metaphor/core experience promise → 콘셉트 필연성 → 실행 연결의 논리 흐름으로 작성하라. clientIntent는 클라이언트가 궁극적으로 해결하려는 의도, audienceTakeaway는 관람객/참석자가 반드시 가져가야 할 인식·감정·행동 변화, strategicTension은 현재 과제와 목표 사이의 전략적 긴장, conceptSeed는 콘셉트가 태어나는 한 줄 씨앗 문장으로 작성하라. selectedConceptReason은 추천 콘셉트가 공간/콘텐츠/미디어로 확장되는 실행 연결을 제안서 문장 톤으로 설명하라.',
      isEventOperationType ? '행사 운영형 콘셉트명도 시스템명/카테고리명처럼 만들지 말고 행사 목적, 브랜드 메시지, 파트너십, 기술 공유, 비즈니스 기회를 압축한 2~5단어 정체성 이름으로 도출하라.' : '각 후보는 서로 다른 전략적 관점, 경험 구조, 핵심 체험 자산 방향을 가져야 하며, 반드시 conceptDevelopmentLogic의 과제와 경험 기회에 근거해 도출되어야 한다.',
      '각 후보에는 conceptId, conceptName, conceptSlogan, conceptTagline, conceptDefinition, hiddenNeedResolved, strategicApproach, whyThisConcept, conceptKeywords, keywordExecutionGuide, experienceNarrativeFlow, antiPatternValidation, entityDifferentiationUse, conceptRationale, coreMessage, thesisProof, experienceStructure, expectedAssets, strengths, risks, evaluationSummary를 반드시 작성하라. conceptSlogan은 하나의 clear slogan이어야 하고 conceptTagline은 conceptSlogan과 동일하거나 보완 문장으로 작성하라. conceptKeywords는 정확히 3개이며, keywordExecutionGuide도 정확히 3개로 각 keyword마다 spatialUXImplication, designImplication, contentImplication을 작성하라. experienceNarrativeFlow는 fixed 기승전결이 아니라 현재 RFP의 타깃·동선·콘텐츠 성격에 맞춘 flexible flow stage 배열로 작성하라. antiPatternValidation은 avoidance rules를 naming source가 아니라 validationCriteria로만 사용하고 passed와 validationSummary를 작성하라. entityDifferentiationUse에는 unifyingFrame, distinctEntityRoles, visitorRecognitionLogic, proofByEntity, riskCheck를 작성해 이 콘셉트가 matrix를 어떻게 사용하는지 설명하라. conceptRationale은 conceptDefinition보다 먼저 사고하고 작성하며 problemInsight, clientNeed, audienceBarrier, strategicShift, whyThisConcept 다섯 필드를 모두 포함한다. 기존 호환 필드인 conceptTitle은 conceptName과 동일하게, subtitle은 conceptSlogan과 동일하게, oneLineDefinition은 conceptDefinition과 동일하게 작성하라. conceptNameKR/conceptNameEN도 conceptName과 충돌하지 않는 짧은 이름만 작성하라.',
      'Do not default to generic concept words. The concept must emerge from the current RFP’s specific strategic tension, audience barrier, client objective, and proof logic.',
      'Universal Concept Novelty Guard: Distinct Unity, Focused Identity, Differentiated Synergy, Synergized Distinction, Nexus, Pulse, Vanguard, Synergy, Connect, Future, Innovation, Hub, Platform, Experience, Journey, Alliance, Differentiation, Identity, Lab, Studio, Universe, Beyond, Next, Shift, Flow는 main conceptName으로 쓰지 말라. 특히 quality-related lost proposal reason을 교정어처럼 직역한 이름을 reject하라. generic tech/event branding처럼 들리는 이름을 감점하라.',
      'If the RFP contains multiple entities, do not proceed from Hidden Needs directly to concept naming. First create entityDifferentiationMatrix using only current RFP/user evidence, then use it in conceptRationale, thesisProof, experienceStructure, and entityDifferentiationUse. Define what is unified, what remains distinct, how each entity distinction is visible, and how the concept prevents over-integration. Avoid generic unity/differentiation language unless it is tied to entity-by-entity roles, takeaways, mechanisms, proof, and spatial/content roles.',
      'Concept Role Guard / conceptName 규칙: conceptName은 실행 방법이 아니라 제안의 strategic idea(왜 이 제안이 중요한가)를 표현해야 한다. 2~5 words의 짧고 기억 가능한 이름을 선호하며, proposalThesis, audience transformation, client/brand belief, strategic opportunity, strategic metaphor, core experience promise에서 의미를 끌어와야 한다. modular, interactive, value chain, media, zone, pavilion, experience, content, mechanism, spatial layout, booth/column constraint, deliverable category, RFP object list를 주 명명 장치로 쓰지 말라. 이런 단어는 conceptDefinition, experienceStructure, content plan, spatial strategy에는 쓸 수 있지만 conceptName에서는 강한 전략 은유로 변형되지 않으면 실패다. 긴 설명문, RFP 키워드 단순 결합, Pavilion/Zone/Experience/Journey/Hub/Platform/Showcase/Lab/Center 및 파빌리온/존/체험/여정/허브/플랫폼/쇼케이스/랩/센터/공간/전시 같은 카테고리 단어를 주 명명 장치로 쓰지 말라. "~을 위한", "~와 함께하는", "~중심의", "~기반의", "~플랫폼", "~공간", "~체험", "~전시" 구조를 쓰지 말라.',
      'conceptRationale 작성 규칙: 반드시 1) 관람객이 이해하기 어려운 것 2) 클라이언트가 관람객에게 믿게 해야 하는 것 3) 프로젝트의 전략적 기회 4) 그 간극을 해결하는 경험 원칙 5) 선택 콘셉트가 그 원칙을 다른 선택지보다 더 잘 표현하는 이유의 논리 순서로 작성하라. Concept Rationale은 전략 콘셉트와 실행 전략을 분리해 설명해야 하며, 콘셉트명은 큰 생각이고 modular zoning, interactive media, value-chain content, B2B/public visitor path, spatial constraint response는 그 아래 실행 전략이라고 명시하라. problemInsight는 audience understanding barrier에서 출발하고, clientNeed는 발주처가 남겨야 할 믿음을 정의하며, strategicShift는 전략적 기회와 경험 원칙을 제시하고, whyThisConcept는 proposalNarrative.proposalThesis와 conceptName을 직접 연결해 콘셉트의 필연성을 증명하라.',
      'conceptRationale은 일반 RFP 요약을 반복하지 말고 “왜 이 콘셉트가 필연적인가”를 간결하게 증명하라. columns, booth size, venue limits, schedule, budget 등 공간·일정·운영 제약은 콘셉트의 출발점으로 쓰지 말고 implementation challenge, feasibility proof, risk mitigation 맥락에서만 언급하라. 공간 전략 섹션 전에는 columns/booth constraints를 프로젝트 제약으로 최대 1회만 언급하고 proposalThesis, conceptRationale, coreMessage, early slide title을 지배하게 하지 말라.',
      'conceptTagline은 conceptName보다 설명적이어도 되지만 한 개의 간결한 문장으로 방향을 설명하라. conceptDefinition은 2~3문장으로 콘셉트의 의미를 설명하고 proposalNarrative.proposalThesis에 직접 연결하라.',
      'Concept Source Priority Guard: 콘셉트는 반드시 1) client vision 2) current RFP brand/client message 3) 프로젝트 고유 가치 흐름 4) audience transformation 5) strategic opportunity 6) proposal thesis 7) core experience promise에서 우선 도출하라. RFP 키워드 조합, 산업 범주어 조합, 외부 프로젝트명/무관한 사례명 차용으로 콘셉트를 만들지 말라.',
      'Concept Source Rejection Guard: technical description처럼 읽히는 이름, execution term 2개 이상 결합, modular interactive를 주 명명 장치로 쓰는 이름, value chain을 주 명명 장치로 쓰는 이름, 5 words 초과 이름(강한 이유 없는 경우), slide title처럼 들리는 이름, proposalThesis가 아니라 constraints에서 출발한 이름은 reject/regenerate하라. columns, booth constraints, venue limitations, schedule, budget, required deliverables, equipment names, media types, operation conditions, object lists, floor plan limitations는 conceptName이나 핵심 콘셉트 출처가 될 수 없다. 이런 요소는 spatial strategy, feasibility proof, risk mitigation, implementation detail, experience design solution에서만 다뤄라.',
      'Bad conceptName patterns: execution-method lists, constraint-based phrases, generic category names, Future Experience Zone, Immersive Brand Experience, generic Flow/Nexus/Pulse/Hub/Platform/Journey names, or any name reusable across unrelated RFPs. Better naming source: the current RFP strategic tension, audience barrier, client objective, product/service logic, spatial/content mechanism, perception shift, and evaluation proof logic. Do not copy examples; derive a new name from the current RFP.',
      '콘셉트 후보 생성 retrieval은 category 가중치 requiredDeliverables 40, performanceGoal 20, venue 15, referenceOnly 15, constraints 10 순으로 참고하되, requiredDeliverables/venue/constraints는 콘셉트 출처가 아니라 대응성·공간 적용성·실행 가능성 검증 기준으로 사용하라.',
      'proposal_patterns는 structure reference only다. slide order, concept buildup, problem→insight→strategy→concept→content→proof 관계, proof placement 같은 구조 원칙만 참고하라. old proposal copy, old project names, old client names, old slogans, filenames, proprietary content는 절대 재사용하지 말라. quality-related lost proposal reasons는 anti-pattern validation criteria only로 사용하고 conceptName, conceptSlogan, conceptKeywords의 source로 사용하지 말라.',
      'Anti-pattern validation rule: lost proposal avoidance guidance such as “entities were not differentiated clearly” means 검증 질문(각 entity의 distinct role, visitor takeaway, spatial/content role, proof point가 명확한가? integration logic이 differences를 지우지 않는가?)으로만 전환하라. Distinct Unity, Synergized Distinction, Focused Identity처럼 avoidance rule을 직접 반복한 conceptName을 만들면 실패다.',
      'referenceOnly category 근거는 현재 프로젝트 evidence에 명시된 경우에만 참고 원칙으로 반영하고, 현재 RFP에 없는 프로젝트명/브랜드명/사례명은 절대 사용하지 말라. venue category 근거가 있으면 콘셉트 출처가 아니라 spatialApplication과 executionFeasibility 검증에만 반영하라.',
      referenceGuardInstruction,
      '모든 콘셉트는 proposalNarrative.proposalThesis를 증명해야 한다. thesisProof에는 이 콘셉트가 제안 명제를 어떻게 증명하는지 명시하고, 일반적인 RFP 요구 반복으로 채우지 말라. experienceStructure에는 콘텐츠 목록이 아니라 관람객의 문제 인식→참여 행동→감정/인식 변화→브랜드 확신으로 이어지는 narrative 또는 behavioral transformation을 작성하라.',
      'evaluationScores는 rfpFitScore, targetFitScore, differentiationScore, spatialFeasibilityScore, viralPotentialScore, operationFeasibilityScore를 각각 1~5점 숫자로 작성하라.',
      'keyExperienceAssetDirection은 Spatial Zone, Interactive Experience, Media Content, Photo / Viral Spot, Product Trial Kit, Exhibition Object, Digital Signage, Operation Program, Brand Experience Module, Monument, Briefing Space, Immersive Room, Hands-on Demo, Visitor Participation Content 중 프로젝트에 맞는 방향으로 작성하되 conceptName의 출처로 삼지 말라.',
      'analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets의 항목은 참고 방향 또는 설계 원칙으로만 활용하고 신규 체험 모듈명/제품 단위/콘셉트 핵심 자산명으로 만들지 말라.',
      'referenceOnly 항목을 사용할 때는 “임팩트 있는 전시 요소 참고 방향”, “기존 캠페인에서 확인된 성공 요소”, “참고 사례 기반 설계 원칙”, “레퍼런스 인사이트”처럼 표현하고, 현재 RFP에 없는 레퍼런스 체험 상세를 실제 과업처럼 쓰지 말라.',
      'RFP가 모뉴먼트를 요구하지 않았다면 Monument를 고정 자산으로 제안하지 말라.',
      'recommendation에는 recommendedConceptId, recommendationReason, whyNotOthers를 작성하라. 추천은 Hidden Needs 충족도, Strategic Approach 적합성, RFP evidence 부합성, anti-pattern validation 통과성, execution feasibility, evaluator clarity를 종합해 선택하라. AI 추천은 제공하지만 최종 선택은 사용자가 직접 한다는 전제로 추천 이유와 비추천/보류 이유를 균형 있게 작성하라.',
      '사용자가 선택할 핵심 콘셉트가 이후 제안서 구조, 장표 문안, PPTX의 기준이 되므로 실무 제안서에 바로 사용할 수 있게 구체적으로 작성하라.',
    ].join('\n');

    const userPrompt = `사용자 선택 제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
RFP 분석 기반 유형: ${proposalTypeLabels[effectiveProposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

검색된 category 우선 근거 chunk:
${retrievalContext || '검색된 chunk 없음'}

분석 결과 JSON:
${JSON.stringify(body.analysis, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}

Proposal Narrative JSON (반드시 먼저 읽고 proposalThesis를 증명하는 콘셉트만 생성):
${JSON.stringify(proposalNarrative, null, 2)}

Proposal Narrative 요약:
${summarizeProposalNarrative(proposalNarrative)}

RFP Entity Differentiation Matrix / Strategy (hasMultipleEntities=false이면 빈 matrix를 유지하고 강제 차별화하지 말 것):
${summarizeDifferentiationStrategy(differentiationStrategy)}

proposal_patterns 구조 참고 진단(구조 참고/검증 용도만):
${proposalPatternDiagnostics}

proposal_patterns 구조 참고 JSON(원문/프로젝트명/클라이언트명/파일명 재사용 금지, structure reference only):
${proposalPatternContext}

품질 관련 미수주 회피 규칙(anti-pattern validation criteria only, conceptName/source로 사용 금지):
${proposalAvoidanceRuleContext}`;

    const generateConcepts = (extraSystemInstruction = '') => createStructuredJson<ConceptCandidatesResult>({
      schemaName: 'proposal_concept_candidates',
      schema: conceptCandidatesJsonSchema,
      system: extraSystemInstruction ? `${systemPrompt}\n\n${extraSystemInstruction}` : systemPrompt,
      user: userPrompt,
    });

    let result = normalizeConceptCandidatesResult(await generateConcepts());
    result = normalizeConceptCandidatesResult({
      ...result,
      entityDifferentiationMatrix: differentiationStrategy.hasMultipleEntities
        ? (result.entityDifferentiationMatrix?.length ? result.entityDifferentiationMatrix : differentiationStrategy.entityDifferentiationMatrix)
        : [],
    });
    const namingGuardContext = { input: body.input, analysis: body.analysis, proposalNarrative, avoidanceRules: proposalPatternGuidance.avoidanceRules };
    let validation = validateConceptNaming(result, namingGuardContext);

    for (let attempt = 0; attempt < 2 && !validation.ok && validation.violations.length >= result.concepts.length; attempt += 1) {
      const nameRetry = normalizeConceptCandidatesResult(await generateConcepts(buildConceptNamingRetryInstruction(validation.violations)));
      result = normalizeConceptCandidatesResult({
        ...result,
        concepts: result.concepts.map((candidate, index) => {
          const retryName = nameRetry.concepts[index]?.conceptName?.trim();
          return retryName
            ? {
                ...candidate,
                conceptName: retryName,
                conceptTitle: retryName,
                conceptNameKR: nameRetry.concepts[index]?.conceptNameKR || retryName,
                conceptNameEN: nameRetry.concepts[index]?.conceptNameEN || retryName,
              }
            : candidate;
        }),
      });
      validation = validateConceptNaming(result, namingGuardContext);
    }

    const guardedResult = applyNonBlockingConceptNamingGuard(result, namingGuardContext);
    const response = guardedResult.concepts.length ? guardedResult : applyNonBlockingConceptNamingGuard({ ...result, concepts: result.concepts.slice(0, 1) }, namingGuardContext);

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : '콘셉트 후보 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
