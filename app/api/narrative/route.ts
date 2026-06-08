import { NextResponse } from 'next/server';
import { proposalNarrativeJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, ProposalNarrative, UploadedDocument } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';
import { createStructuredJson } from '@/lib/openai';
import { formatCategoryEvidenceGroupsForPrompt, retrieveCategoryEvidenceGroups } from '@/lib/rag';
import { buildFallbackProposalNarrative, ensureProposalNarrative } from '@/lib/proposalNarrative';
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

    const generated = await createStructuredJson<ProposalNarrative>({
      schemaName: 'proposal_narrative',
      schema: proposalNarrativeJsonSchema,
      system: [
        '너는 기업 제안서의 설득 구조를 설계하는 한국어 proposal strategist다.',
        '이 단계는 RFP 분석과 콘셉트 후보 생성 사이에 위치하는 Proposal Narrative 생성 단계다.',
        '전시 실행 항목 목록을 만들지 말고 Problem Definition → Strategic Declaration → Experience Strategy → Content Proposal → Proof & Impact로 이어지는 제안서 내러티브를 설계하라.',
        'marketContext, coreProblem, strategicOpportunity, proposalThesis, whyNow, whyUs, whyThisConcept, narrativeFlow를 모두 작성하라.',
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
