import { NextResponse } from 'next/server';
import { analysisJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, RetrievalEvidenceItem } from '@/lib/types';
import type { DocumentChunk } from '@/lib/rag';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { buildEvidenceItems, flattenCategoryEvidenceGroups, formatCategoryEvidenceGroupsForPrompt, retrieveCategoryEvidenceGroups } from '@/lib/rag';
import { refineAnalysisConfirmationNeeds } from '@/lib/confirmationNeeds';
import { buildProposalStructureGuard } from '@/lib/proposalStructureGuard';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ProjectInput | { input: ProjectInput; documentChunks?: DocumentChunk[] };
    const input = 'input' in payload ? payload.input : payload;
    const documentChunks = 'input' in payload ? payload.documentChunks ?? [] : [];
    const categoryEvidenceGroups = retrieveCategoryEvidenceGroups({
      projectId: input.projectName,
      stage: 'analysis',
      proposalType: input.proposalType,
      query: `${input.projectName} ${input.clientName} ${input.briefText}`,
      chunks: documentChunks,
      groups: [
        { label: '필수 산출물/과업 구조 (25)', categories: ['requiredDeliverables'], description: 'AI analysis weighted retrieval 25: requiredDeliverables, requiredItems, taskSections.requiredDeliverables 추출에만 사용', limit: 5 },
        { label: '프로젝트 목적 (20)', categories: ['projectObjective'], description: 'AI analysis weighted retrieval 20: projectObjective와 clientChallenge 분석에 사용', limit: 4 },
        { label: '성과 목표 (20)', categories: ['performanceGoal'], description: 'AI analysis weighted retrieval 20: performanceGoal, numericInfo.targetKPI, kpiObjectives 분석에 사용', limit: 4 },
        { label: '평가 기준 (15)', categories: ['evaluationCriteria'], description: 'AI analysis weighted retrieval 15: evaluationCriteria 및 평가 대응 관점에만 사용', limit: 3 },
        { label: '제약 조건 (10)', categories: ['constraints'], description: 'AI analysis weighted retrieval 10: constraints, contentCondition, operationCondition 분석에 사용', limit: 3 },
        { label: '일정 (10)', categories: ['schedule'], description: 'AI analysis weighted retrieval 10: schedule과 kpiTimelineConstraints 분석에 사용', limit: 3 },
        { label: '제품 특징', categories: ['productFeature'], description: 'Q8/H8/B8 제품, 핵심 기능, value proposition 추출에 사용', limit: 4 },
        { label: '공간/기존 자산/운영 조건', categories: ['venue', 'existingAsset', 'operationDirection'], description: 'spatialCondition, existingAssets, operationCondition 분석에 사용', limit: 4 },
        { label: '디자인 방향/배경 인사이트/참고 자료', categories: ['designDirection', 'backgroundInsight', 'referenceOnly'], description: 'designDirection, backgroundInsight, referenceOnly, doNotTreatAsScope 분리에만 사용', limit: 4 },
      ],
    });
    const retrievedChunks = flattenCategoryEvidenceGroups(categoryEvidenceGroups);
    const retrievalContext = formatCategoryEvidenceGroupsForPrompt(categoryEvidenceGroups);
    const evidence = buildEvidenceItems(retrievedChunks) as RetrievalEvidenceItem[];

    if (!input.projectName || !input.clientName || (!input.briefText && !retrievedChunks.length)) {
      return NextResponse.json({ error: '프로젝트명, 클라이언트명, 업로드 자료 또는 추가 메모를 모두 입력하세요.' }, { status: 400 });
    }

    const result = await createStructuredJson<AnalysisResult>({
      schemaName: 'proposal_analysis',
      schema: analysisJsonSchema,
      system: [
        '너는 전시, 브랜드 체험관, 팝업스토어, 플래그십 공간 제안서를 전문적으로 기획하는 한국어 전략 플래너다.',
        '이 단계는 AI 분석 단계다. 제안 콘셉트나 장표 문안을 만들지 말고 RFP/브리프에 명시된 사실, 과제, 조건, 제약, 확인 필요 항목만 정리하라.',
        '가장 먼저 RFP의 상위 과제 구조를 파악해 taskSections 배열로 추출하라. 개별 문장을 바로 제품/체험 단위로 해석하지 말고 과제 1, 과제 2, Phase 1, Phase 2, 제안 요청사항, 요청 범위, 필수 제안 항목, 제출 범위, Scope, Deliverables 같은 상위 구분을 최우선 구조로 삼아라.',
        'RFP 원문을 우선순위에 따라 분리하라: 1) 제안서 필수 항목/제출 요구사항/Deliverables, 2) 대행 범위/과업 범위/Scope of Work, 3) 평가 기준, 4) 프로젝트 개요/목적/기대효과, 5) 운영 조건/장소/일정/예산/제약, 6) 참고 사례/기존 자료/예시, 7) 키워드 기반 보조 신호.',
        '검색 근거는 category별로 섹션화되어 제공되며 AI analysis retrieval 가중치는 requiredDeliverables 25, projectObjective 20, performanceGoal 20, evaluationCriteria 15, constraints 10, schedule 10 순이다. 각 분석 섹션은 지정된 관련 category 근거만 사용하라: requiredDeliverables는 필수 산출물/과업 구조, kpi/performanceGoal은 KPI/성과 목표, evaluationCriteria는 평가 기준, constraints/existingAsset/operationDirection은 실행 제약과 기존 자산, venue는 공간 조건, referenceOnly/designDirection/backgroundInsight는 참고 방향과 배경 인사이트로만 사용하고, productFeature는 Q8/H8/B8 등 제품별 product/key feature/value proposition 추출에만 사용한다.',
        '서로 다른 category 근거를 섞어 추론하지 말라. 특히 referenceOnly/backgroundInsight/existingAsset 근거를 requiredDeliverables, requiredScope, productInfo, targetKPI로 승격하지 말고, requiredDeliverables/kpi/evaluationCriteria에 없는 내용을 해당 분석 섹션에 만들지 말라.',
        'requiredDeliverables에는 제안서 필수 항목, 제출 요구사항, Deliverables, 반드시 포함해야 하는 제안 내용을 구조화해 넣어라. scopeOfWork에는 대행 범위, 과업 범위, 제작/운영/설치/철거/운송/시스템/콘텐츠 포함 범위를 구조화해 넣어라. evaluationCriteria에는 평가 기준만 넣어라.',
        'proposalType은 단순 키워드 빈도가 아니라 requiredDeliverables와 scopeOfWork를 최우선 근거로 inferredProposalType에 분류하라. 평가 기준은 보조 근거, 개요/목적/기대효과와 장소/일정/예산은 후순위 근거, 참고 사례/기존 자료/예시는 핵심 근거에서 제외하라.',
        '필수 항목 또는 제출 요구사항에 행사 운영안, 프로그램 운영안, 장소별 시스템 운영 계획, 발표 LED/음향/조명/프롬프터 운영, 쉬는 시간 및 네트워킹 동선 관리, 등록 키오스크 운영안, 사전 등록 DB 활용, 현장 등록 계획, 파트너 부스 운영안, 케이터링/만찬 운영, 전체 추진 일정, 설치/철거 계획, 운영 인력 계획, 리스크 관리, 예상 견적이 포함되면 mice_event_operation 또는 conference_forum을 우선 검토하라. 단, 같은 표현이 참고 사례/기존 사례/예시에만 있으면 proposalType 핵심 근거로 쓰지 말고 referenceOnly로만 분류하라.',
        '각 taskSections 항목에는 taskId, taskTitle, phase, requiredDeliverables, target, keyRequirements, referenceMentions, existingAssets, constraints, kpi, schedule, confirmNeeded를 모두 채워라. 명시 정보가 없으면 빈 배열 또는 빈 문자열을 사용하라.',
        '출력 내부에서 RFP Fact, AI Proposal, Confirm Needed를 명확히 구분하되, 분석 단계의 aiProposal에는 새 아이디어가 아니라 “제안 생성 단계에서 다룰 전략적 해석 방향”만 짧게 적어라.',
        '명시되지 않은 내용은 추정하지 말고 confirmNeeded와 missingInfo로 보조 정리하라. 단, RFP chunk 근거가 있는 항목, requiredDeliverables/kpiObjectives/schedule/evaluationCriteria에 이미 잡힌 항목은 확인 필요로 올리지 말고, 실제 사용자 보완이 필요한 핵심 항목만 8~12개 이내로 병합하라.',
        'requiredItems에는 requiredDeliverables를 포함해 RFP가 요구한 산출물/공간/콘텐츠/운영 요구를 넣고, requiredScope에는 scopeOfWork와 taskSections.requiredDeliverables를 기준으로 실제 제안·제작·운영 범위로 명시된 항목만 넣어라. referenceOnly, existingAssets, doNotTreatAsScope에 들어간 항목은 requiredDeliverables/scopeOfWork/requiredScope에 중복해서 넣지 말라.',
        'referenceOnly에는 참고 사례, 예시, 벤치마크, 참고 방향, 레퍼런스 맥락으로 언급된 항목을 넣어라. 다음 표현이 포함된 문장 또는 항목은 기본적으로 referenceOnly 또는 existingAssets 후보로 분류하라: 참고 사례, 참고, 예시, 예:, 예를 들어, 등, 기존, 기존 운영, 기존 사례, 상반기, 하반기 Lesson learned, Lesson learned, 사례, 벤치마크, 레퍼런스, 활용 가능, 유사 사례, 이전 캠페인, 보유 재원, 기존 집기, 기존 공간, 기존 콘텐츠.',
        'existingAssets에는 RFP에 언급된 기존 공간, 기존 집기, 기존 시스템, 기존 콘텐츠, 기존 캠페인, 기존 운영물, 보유 재원, 활용 가능 자산을 넣되, 신규로 제안해야 하는 독립 체험 모듈로 오해될 수 있으면 doNotTreatAsScope에도 넣어라.',
        'productInfo에는 실제 제안 범위 또는 제품 정보로 명시된 제품/서비스 단위만 넣어라. productFeatures에는 Q8, H8, B8이 감지된 경우 각 제품별로 product, keyFeature, valueProposition을 분리해 추출하라. 제품 코드가 있지만 핵심 기능 또는 가치 제안이 원문에 없으면 임의로 만들지 말고 원문 근거가 있는 범위만 간결히 작성하라. 참고 사례명, 기존 캠페인명, 예시명은 제품처럼 보이는 코드가 있더라도 productInfo에 넣지 말고 referenceOnly 또는 doNotTreatAsScope로 분리하라.',
        'RFP 내 모든 수치/정량 정보를 numericInfo에 반드시 분류하라: pastPerformance=기존 운영 결과/과거 방문객/기존 성과, lessonLearned=레슨런드 및 이전 운영에서 도출된 정량 인사이트, currentIssue=현재 문제/부족/리스크를 설명하는 수치, targetKPI=목표/달성/성과 기준으로 명확히 지시되고 OCR/추출 신뢰도가 높은 KPI 수치, referenceMetric=참고 사례/벤치마크/유사 캠페인 수치, proposedMeasurement=목표값 없이 측정 방식 또는 측정 항목으로 제안 가능한 지표. 같은 수치를 targetKPI와 pastPerformance/referenceMetric/lessonLearned에 중복 분류하지 말라.',
        'kpiObjectives에는 numericInfo.targetKPI로 명확히 분류된 목표 KPI만 넣어라. OCR/추출이 불확실하거나 확정되지 않은 수치는 confirmNeeded에 “확인 필요”로 넣고 targetKPI/kpiObjectives에는 넣지 말라. 기존 운영 결과, 기존 방문객, 타깃 비중, 참고 사례 수치, 레슨런드 수치는 kpiObjectives에 넣지 말고 numericInfo.pastPerformance/lessonLearned/referenceMetric/currentIssue로 분리하라. constraints에는 예산/공간/운영/법규/브랜드 가이드 등 제약을 넣어라. schedule에는 제출 일정, 보고 일정, 오픈 일정, 운영 일정을 분리해 넣어라. 최상위 confirmNeeded에는 실제 과업 범위와 참고 사례 구분이 모호하거나 추가 확인이 필요한 항목만 넣어라.',
        '“등” 앞에 나열된 명사는 기본적으로 taskSections.referenceMentions 및 referenceOnly 후보로 분류하라. 단, 같은 문장 또는 상위 과제 구조에서 명확히 제작, 개발, 구성, 제안, 필수 포함 대상으로 지정된 경우에만 requiredScope/taskSections.requiredDeliverables에 포함하라.',
        '“참고/기존/사례/예시/등” 맥락의 항목은 실제 제안 범위가 아니라 referenceOnly 및 doNotTreatAsScope로 분류하라. 현재 RFP 원문에 없는 과거 프로젝트명이나 예시 프로젝트명을 분석 결과에 추가하지 말라.',
        'proposalScopeTypes에는 RFP 범위에 맞는 복수 유형을 분류하라: contentDevelopment, boothExhibition, experienceMarketing, brandActivation, operationOnly, designBuild, publicTender. World Hydrogen EXPO처럼 “컨텐츠 개발 부문”, “전시 기획/운영 및 컨텐츠 개발/제작”, “Hero 컨텐츠 개발”, “주요 전시물 컨텐츠 개발 필수 포함” 근거가 있으면 contentDevelopment와 boothExhibition을 반드시 함께 포함하라.',
        'proposalStructureGuard에는 감지한 proposalScopeTypes에 따른 구조 제한을 한 문장으로 작성하라. 콘텐츠 개발 중심이면 Hero Content, Sub Content, Zoning & Flow, Schedule, Credential을 우선하고, RFP에 명시되지 않은 Viral/Communication Strategy, KPI/Performance Goal, Operation Plan, Output & Share, Visitor Reward, SNS Sharing, Marketing Campaign을 별도 장표로 확장하지 않는다고 명시하라.',
        'targetInfo, spatialCondition, contentCondition, operationCondition은 각각 타깃, 공간, 콘텐츠, 운영 조건을 분리해 작성하라.',
        'kpiScheduleConstraints에는 numericInfo.targetKPI, 일정, 납품 조건, 정량 기준만 넣어라. pastPerformance, lessonLearned, referenceMetric에 해당하는 수치는 목표처럼 표현하지 말고 배경/문제/인사이트 맥락으로만 표현하라. RFP에 명시된 목표 KPI가 없으면 임의 수치를 만들지 말고 numericInfo.proposedMeasurement에 측정 항목 제안으로 정리하라. RFP에 없는 방문객 증가율, 만족도 상승률, 재방문율, 구매전환율 같은 수치를 절대 만들지 말라.',
        'missingInfo에는 실제 RFP에 없는 보완 정보만 넣어라. 우선순위는 예산 세부 배분, 제작/운영 포함·제외 범위, 최종 공간 도면/실측 자료, 사용 가능 집기 상세 리스트, 브랜드 톤앤매너/디자인 가이드, 보안 검수 및 설치 가능 범위, 콘텐츠 제작 범위/매체별 스펙, 현장 운영 인력 규모 순으로 판단하라. RFP에 일정, 평가 기준, KPI, 필수 제안 항목이 명시되어 있으면 missingInfo/confirmNeeded에 반복하지 말라.',
        '문장은 실무 제안서에 바로 연결될 수 있도록 간결하고 구체적인 한국어로 작성하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[input.proposalType]}
프로젝트명: ${input.projectName}
클라이언트명: ${input.clientName}

검색된 category별 근거 chunk:
${retrievalContext || '검색된 chunk 없음 - 사용자 추가 메모만 사용'}

사용자 추가 메모:
${input.briefText}`,
    });

    const refinedResult = refineAnalysisConfirmationNeeds(result, documentChunks);
    const structureGuard = buildProposalStructureGuard(input, refinedResult);
    const guardedResult: AnalysisResult = {
      ...refinedResult,
      proposalScopeTypes: structureGuard.proposalScopeTypes,
      proposalStructureGuard: [
        refinedResult.proposalStructureGuard,
        structureGuard.proposalScopeTypes.includes('contentDevelopment')
          ? `콘텐츠 개발형 제안서는 기본 18~22장, 최대 ${structureGuard.maxSlideCount ?? 24}장 이내로 구성하고 Hero/Sub Content·시나리오·레퍼런스·일정·실적 중심으로 제한합니다.`
          : '',
        structureGuard.hasExplicitKpi ? 'RFP에 명시된 정량 KPI 또는 평가 지표 요구가 있어 KPI 장표를 허용합니다.' : '정량 KPI 또는 성과지표 평가 요구가 없으면 KPI는 별도 장표가 아니라 프로젝트 목표 문장에만 반영합니다.',
        structureGuard.hasExplicitOperationPlan ? 'RFP에 운영 계획 요구가 있어 운영 장표를 허용합니다.' : '현장 운영·인력·안전·유지관리 요구가 없으면 운영 계획은 별도 장표가 아니라 일정 중심으로만 반영합니다.',
      ].filter(Boolean).join(' '),
    };

    return NextResponse.json({ result: guardedResult, evidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
