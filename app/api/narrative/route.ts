import { NextResponse } from 'next/server';
import { proposalNarrativeJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, ProposalNarrative, UploadedDocument } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';
import { createStructuredJson } from '@/lib/openai';
import { formatCategoryEvidenceGroupsForPrompt, retrieveCategoryEvidenceGroups } from '@/lib/rag';
import { buildFallbackProposalNarrative, ensureProposalNarrative } from '@/lib/proposalNarrative';
import { buildRfpDifferentiationStrategy, summarizeDifferentiationStrategy } from '@/lib/rfpDifferentiation';
import { proposalTypeLabels } from '@/lib/types';

export async function POST(request: Request) {
  let body: {
      input: ProjectInput;
      analysis: AnalysisResult;
      uploadedDocuments?: UploadedDocument[];
      documentChunks?: DocumentChunk[];
    } | undefined;

  try {
    body = (await request.json()) as {
      input: ProjectInput;
      analysis: AnalysisResult;
      uploadedDocuments?: UploadedDocument[];
      documentChunks?: DocumentChunk[];
    };

    if (!body.input || !body.analysis) {
      return NextResponse.json({ error: '프로젝트 입력값과 분석 결과가 필요합니다.' }, { status: 400 });
    }

    const effectiveProposalType = body.analysis.inferredProposalType ?? body.input.proposalType;
    const evidenceGroups = retrieveCategoryEvidenceGroups({
      stage: 'concept',
      proposalType: effectiveProposalType,
      query: `${body.input.projectName} ${body.input.clientName} ${body.analysis.projectOverview} ${body.analysis.clientChallenge}`,
      chunks: body.documentChunks ?? [],
      groups: [
        { label: '시장/배경 맥락', categories: ['projectObjective', 'backgroundInsight'], description: 'proposal narrative: 시장 변화, 프로젝트 배경, 왜 지금 이 제안이 필요한지 판단하는 근거', limit: 5 },
        { label: '핵심 문제/클라이언트 과제', categories: ['requiredDeliverables', 'performanceGoal'], description: 'proposal narrative: 클라이언트가 해결해야 할 문제와 성과 방향', limit: 5 },
        { label: '전략 기회/평가 대응', categories: ['evaluationCriteria', 'designDirection'], description: 'proposal narrative: 심사 기준과 차별화 방향을 제안 명제로 전환하는 근거', limit: 4 },
        { label: '실행 조건', categories: ['venue', 'constraints', 'operationDirection'], description: 'proposal narrative: 공간, 운영, 제약 조건을 실행 가능한 경험 전략으로 전환하는 근거', limit: 4 },
      ],
    });
    const retrievalContext = formatCategoryEvidenceGroupsForPrompt(evidenceGroups, 9000);
    const differentiationStrategy = buildRfpDifferentiationStrategy(body.analysis);

    const generated = await createStructuredJson<ProposalNarrative>({
      schemaName: 'proposal_narrative',
      schema: proposalNarrativeJsonSchema,
      system: [
        '너는 기업 제안서의 설득 구조를 설계하는 한국어 proposal strategist다.',
        '이 단계는 RFP 분석과 콘셉트 후보 생성 사이에 위치하는 Proposal Narrative 생성 단계다.',
        '전시 실행 항목 목록을 만들지 말고 Problem Definition → Strategic Declaration → Experience Strategy → Content Proposal → Proof & Impact로 이어지는 제안서 내러티브를 설계하라.',
        'marketContext, coreProblem, strategicOpportunity, proposalThesis, whyNow, whyUs, whyThisConcept, narrativeFlow를 모두 작성하라.',
        'Proposal Narrative에는 unifyingFrame, differentiationPrinciple, entityDifferentiationMatrix, riskOfOverIntegration, howToAvoidSimilarity, currentRfpSpecificity를 반드시 포함하라. entityDifferentiationMatrix 각 항목은 entityName, entityType, sourceEvidence, roleInProject, keyOffering, audienceTakeaway, distinctMessage, proofPoint, spatialOrContentRole, experienceMechanism, visualOrToneCue, relationshipToOtherEntities, riskIfUndifferentiated를 모두 current RFP evidence 기반으로 작성하라.',
        'If the RFP contains multiple entities, do not solve the proposal only with unity. Define what is unified and what remains distinct.',
        '제안 명제는 무엇을 통합해야 하는지, 무엇은 구분되어야 하는지, 왜 그 구분이 평가에 중요한지, 그 차이가 audience에게 어떻게 보이는지를 답해야 한다.',
        '다중 회사뿐 아니라 브랜드, 제품/서비스, 존, 타깃, 방문객 유형, 콘텐츠 카테고리, 이해관계자, 평가 우선순위에도 같은 차별화 원칙을 적용하라. 단순 RFP라면 불필요한 차별화를 강제하지 말라.',
        'proposalThesis는 이후 콘셉트 후보가 증명해야 하는 제안서 전체의 핵심 주장으로 작성하라.',
        'whyThisConcept는 아직 특정 콘셉트가 선택되지 않았더라도 어떤 방향의 콘셉트가 이 명제를 증명해야 하는지 설명하라.',
        'narrativeFlow는 최소 5개 단계로 작성하고 반드시 Problem Definition, Strategic Declaration, Experience Strategy, Content Proposal, Proof & Impact 순서를 우선하라.',
        'KPI, Operation, Budget, Company Introduction, Schedule, RFP Requirement Table 같은 일반 장표는 RFP가 명시하거나 proposalThesis 증명에 직접 연결될 때만 내러티브상 필요하다고 설명하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[effectiveProposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

검색된 내러티브 근거:
${retrievalContext || '검색된 chunk 없음'}

분석 결과 JSON:
${JSON.stringify(body.analysis, null, 2)}

감지된 RFP 다중 요소 차별화 전략(현재 RFP evidence만 사용):
${summarizeDifferentiationStrategy(differentiationStrategy)}

사용자 추가 메모:
${body.input.briefText || '없음'}`,
    });

    return NextResponse.json(ensureProposalNarrative(generated, { input: body.input, analysis: body.analysis, uploadedDocuments: body.uploadedDocuments }));
  } catch (error) {
    const fallbackMessage = error instanceof Error ? error.message : '제안 내러티브 생성 중 오류가 발생했습니다.';
    if (body?.input) {
      return NextResponse.json(buildFallbackProposalNarrative({ input: body.input, analysis: body.analysis, uploadedDocuments: body.uploadedDocuments, documentText: body.input.briefText }));
    }
    return NextResponse.json({ error: fallbackMessage }, { status: 500 });
  }
}
