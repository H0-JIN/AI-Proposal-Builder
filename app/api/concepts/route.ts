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
        { label: '우선 참고 레퍼런스 (15)', categories: ['referenceOnly', 'designDirection'], description: 'concept weighted retrieval 15: FF7, S26 Showcase, MDW Art Wall, Foldable Monument를 우선 참고하되 벤치마크 인사이트로만 사용', limit: 5 },
        { label: '제약 조건 (10)', categories: ['constraints'], description: 'concept weighted retrieval 10: 실행/운영/제작 제약 기준', limit: 3 },
        { label: '제품 특징', categories: ['productFeature'], description: 'Q8/H8/B8 제품별 핵심 기능과 가치 제안을 콘셉트 차별화 근거로 사용', limit: 4 },
      ],
    });
    const retrievalContext = formatCategoryEvidenceGroupsForPrompt(conceptEvidenceGroups, 9000);
    const referenceGuardInstruction = buildReferenceGuardInstruction(body.analysis);
    const proposalNarrative = ensureProposalNarrative(body.proposalNarrative, { input: body.input, analysis: body.analysis, documentText: body.input.briefText });

    const result = await createStructuredJson<ConceptCandidatesResult>({
      schemaName: 'proposal_concept_candidates',
      schema: conceptCandidatesJsonSchema,
      system: [
        '너는 전시, 브랜드 체험관, 팝업스토어, 플래그십 공간, MICE/컨퍼런스 운영 제안의 핵심 콘셉트를 설계하는 한국어 크리에이티브 디렉터다.',
        'AI 분석 완료 후 Strategic Message Extraction과 Proposal Narrative를 기준으로 사용자가 선택할 수 있는 콘셉트 후보를 정확히 3개 생성하라.',
        '출력은 conceptDevelopmentLogic, concepts, recommendation을 모두 포함한다. conceptDevelopmentLogic에는 winningStrategyBrief, proposalThesis, experienceLogic, clientIntent, audienceTakeaway, strategicTension, conceptSeed, coreChallenge, targetInsight, brandOrProductValue, experienceOpportunity, strategicApproach, conceptNecessity, selectedConceptReason을 작성하라. winningStrategyBrief는 RFP 과제와 선택/추천될 콘셉트를 잇는 승리 전략 요약, proposalThesis는 제안서 전체를 관통하는 핵심 주장, experienceLogic은 제안서 단계에서 보존할 경험 흐름 메타데이터로 작성하라.',
        'conceptDevelopmentLogic은 기준 나열이 아니라 전략 메시지 추출 → 핵심 과제 → 타깃 인사이트 → 제품/브랜드 가치 → 경험 기회 → 전략 접근 → 콘셉트 필연성 → 실행 연결의 논리 흐름으로 작성하라. clientIntent는 클라이언트가 궁극적으로 해결하려는 의도, audienceTakeaway는 관람객/참석자가 반드시 가져가야 할 인식·감정·행동 변화, strategicTension은 현재 과제와 목표 사이의 전략적 긴장, conceptSeed는 콘셉트가 태어나는 한 줄 씨앗 문장으로 작성하라. selectedConceptReason은 추천 콘셉트가 공간/콘텐츠/미디어로 확장되는 실행 연결을 제안서 문장 톤으로 설명하라.',
        isEventOperationType ? '행사 운영형 콘셉트는 Smart Networking Hub, Smart Integrated Operation Platform처럼 단순 시스템명으로 만들지 말고 행사 목적, 브랜드 메시지, 파트너십, 기술 공유, 비즈니스 기회를 압축한 행사 정체성 문장으로 도출하라.' : '각 후보는 서로 다른 전략적 관점, 경험 구조, 핵심 체험 자산 방향을 가져야 하며, 반드시 conceptDevelopmentLogic의 과제와 경험 기회에 근거해 도출되어야 한다.',
        '각 후보에는 conceptId, conceptTitle, subtitle, conceptNameKR, conceptNameEN, oneLineDefinition, coreMessage, thesisProof, experienceStructure, expectedAssets, strengths, risks, evaluationSummary, experienceLogic, keyExperienceAssetDirection, targetRelevance, spatialApplication, mediaInteractionPotential, viralPotential, executionFeasibility, whyThisWorks, riskOrCaution, evaluationScores를 모두 작성하라. conceptTitle/subtitle은 전략적 제안 방향명이어야 하며 conceptNameEN/KR과 호환되게 작성하라.',
        '콘셉트 후보 생성 retrieval은 category 가중치 requiredDeliverables 40, performanceGoal 20, venue 15, referenceOnly 15, constraints 10 순으로 우선한다. requiredDeliverables는 콘셉트가 반드시 대응해야 할 과제/산출물 기준, performanceGoal은 성과 방향, venue는 공간 적용성과 동선/장소 제약, constraints는 실행 가능성, designDirection은 시각/공간 톤앤매너, referenceOnly는 벤치마크 인사이트로만 사용하라.',
        'referenceOnly category 근거는 FF7, S26 Showcase, MDW Art Wall, Foldable Monument를 우선 참고해 콘셉트와 spatialApplication의 참고 원칙으로 반영하되, 신규 산출물/체험 모듈/제품 단위처럼 명명하지 말라. venue category 근거가 있으면 spatialApplication과 executionFeasibility에 반드시 반영하라.',
        referenceGuardInstruction,
        '모든 콘셉트는 proposalNarrative.proposalThesis를 증명해야 한다. thesisProof에는 이 콘셉트가 제안 명제를 어떻게 증명하는지 명시하고, experienceStructure에는 문제→전략→경험→콘텐츠→증명의 구조를 작성하라. expectedAssets는 필요한 핵심 자산만, strengths/risks는 배열로 작성하라.',
        'evaluationScores는 rfpFitScore, targetFitScore, differentiationScore, spatialFeasibilityScore, viralPotentialScore, operationFeasibilityScore를 각각 1~5점 숫자로 작성하라.',
        'Hydrogen Tech Pavilion, Future Experience Zone, Immersive Brand Experience처럼 키워드 조합형/전시 카테고리형 콘셉트명을 금지한다. 콘셉트는 generic exhibition category가 아니라 심사자를 설득하는 strategic proposal direction이어야 한다.',
        'keyExperienceAssetDirection은 Spatial Zone, Interactive Experience, Media Content, Photo / Viral Spot, Product Trial Kit, Exhibition Object, Digital Signage, Operation Program, Brand Experience Module, Monument, Briefing Space, Immersive Room, Hands-on Demo, Visitor Participation Content 중 프로젝트에 맞는 방향으로 작성하라.',
        '콘셉트 아이디어는 analysis.requiredDeliverables와 analysis.scopeOfWork 및 analysis.taskSections[].requiredDeliverables를 최우선 기준으로 삼고, analysis.requiredScope, analysis.productInfo, analysis.productFeatures 중심으로만 생성하라. proposalType별 템플릿보다 RFP 필수 항목과 과업 범위가 우선이다. analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets의 항목은 참고 방향 또는 설계 원칙으로만 활용하고 신규 체험 모듈명/제품 단위/콘셉트 핵심 자산명으로 만들지 말라.',
        'referenceOnly 항목을 사용할 때는 “임팩트 있는 전시 요소 참고 방향”, “기존 캠페인에서 확인된 성공 요소”, “참고 사례 기반 설계 원칙”, “레퍼런스 인사이트”처럼 표현하고, FF7 체험 상세/S26 체험 상세/C2 체험 상세 같은 실제 과업처럼 쓰지 말라.',
        'RFP가 모뉴먼트를 요구하지 않았다면 Monument를 고정 자산으로 제안하지 말라.',
        'recommendation에는 recommendedConceptId, recommendationReason, whyNotOthers를 작성하라. AI 추천은 제공하지만 최종 선택은 사용자가 직접 한다는 전제로 추천 이유와 비추천/보류 이유를 균형 있게 작성하라.',
        '사용자가 선택할 핵심 콘셉트가 이후 제안서 구조, 장표 문안, PPTX의 기준이 되므로 실무 제안서에 바로 사용할 수 있게 구체적으로 작성하라.',
      ].join('\n'),
      user: `사용자 선택 제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
RFP 분석 기반 유형: ${proposalTypeLabels[effectiveProposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n검색된 category 우선 근거 chunk:\n${retrievalContext || '검색된 chunk 없음'}\n\n분석 결과 JSON:\n${JSON.stringify(body.analysis, null, 2)}\n\n입력 품질 진단:\n- 점수: ${inputQuality.score}\n- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}\n- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '콘셉트 후보 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
