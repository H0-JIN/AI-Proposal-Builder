import { NextResponse } from 'next/server';
import { analysisJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ProjectInput;

    if (!input.projectName || !input.clientName || !input.briefText) {
      return NextResponse.json({ error: '프로젝트명, 클라이언트명, 업로드 자료 또는 추가 메모를 모두 입력하세요.' }, { status: 400 });
    }

    const result = await createStructuredJson<AnalysisResult>({
      schemaName: 'proposal_analysis',
      schema: analysisJsonSchema,
      system: [
        '너는 전시, 브랜드 체험관, 팝업스토어, 플래그십 공간 제안서를 전문적으로 기획하는 한국어 전략 플래너다.',
        '이 단계는 AI 분석 단계다. 제안 콘셉트나 장표 문안을 만들지 말고 RFP/브리프에 명시된 사실, 과제, 조건, 제약, 확인 필요 항목만 정리하라.',
        '가장 먼저 RFP의 상위 과제 구조를 파악해 taskSections 배열로 추출하라. 개별 문장을 바로 제품/체험 단위로 해석하지 말고 과제 1, 과제 2, Phase 1, Phase 2, 제안 요청사항, 요청 범위, 필수 제안 항목, 제출 범위, Scope, Deliverables 같은 상위 구분을 최우선 구조로 삼아라.',
        '각 taskSections 항목에는 taskId, taskTitle, phase, requiredDeliverables, target, keyRequirements, referenceMentions, existingAssets, constraints, kpi, schedule, confirmNeeded를 모두 채워라. 명시 정보가 없으면 빈 배열 또는 빈 문자열을 사용하라.',
        '출력 내부에서 RFP Fact, AI Proposal, Confirm Needed를 명확히 구분하되, 분석 단계의 aiProposal에는 새 아이디어가 아니라 “제안 생성 단계에서 다룰 전략적 해석 방향”만 짧게 적어라.',
        '명시되지 않은 내용은 추정하지 말고 confirmNeeded와 missingInfo로 보조 정리하라. 단, 확인 필요 항목을 과도하게 본문 중심으로 확대하지 말라.',
        'requiredItems에는 RFP가 요구한 산출물/공간/콘텐츠/운영 요구를 넣고, requiredScope에는 taskSections.requiredDeliverables를 기준으로 실제 제안·제작·운영 범위로 명시된 항목만 넣어라. referenceOnly, existingAssets, doNotTreatAsScope에 들어간 항목은 requiredScope에 중복해서 넣지 말라.',
        'referenceOnly에는 참고 사례, 예시, 벤치마크, 참고 방향, 레퍼런스 맥락으로 언급된 항목을 넣어라. 다음 표현이 포함된 문장 또는 항목은 기본적으로 referenceOnly 또는 existingAssets 후보로 분류하라: 참고 사례, 참고, 예시, 예:, 예를 들어, 등, 기존, 기존 운영, 기존 사례, 상반기, 하반기 Lesson learned, Lesson learned, 사례, 벤치마크, 레퍼런스, 활용 가능, 유사 사례, 이전 캠페인, 보유 재원, 기존 집기, 기존 공간, 기존 콘텐츠.',
        'existingAssets에는 RFP에 언급된 기존 공간, 기존 집기, 기존 시스템, 기존 콘텐츠, 기존 캠페인, 기존 운영물, 보유 재원, 활용 가능 자산을 넣되, 신규로 제안해야 하는 독립 체험 모듈로 오해될 수 있으면 doNotTreatAsScope에도 넣어라.',
        'productInfo에는 실제 제안 범위 또는 제품 정보로 명시된 제품/서비스 단위만 넣어라. 참고 사례명, 기존 캠페인명, 예시명은 제품처럼 보이는 코드가 있더라도 productInfo에 넣지 말고 referenceOnly 또는 doNotTreatAsScope로 분리하라.',
        'RFP 내 모든 수치/정량 정보를 numericInfo에 반드시 분류하라: pastPerformance=기존 운영 결과/과거 방문객/기존 성과, lessonLearned=레슨런드 및 이전 운영에서 도출된 정량 인사이트, currentIssue=현재 문제/부족/리스크를 설명하는 수치, targetKPI=목표/달성/성과 기준으로 명확히 지시된 KPI 수치, referenceMetric=참고 사례/벤치마크/유사 캠페인 수치, proposedMeasurement=목표값 없이 측정 방식 또는 측정 항목으로 제안 가능한 지표. 같은 수치를 targetKPI와 pastPerformance/referenceMetric/lessonLearned에 중복 분류하지 말라.',
        'kpiObjectives에는 numericInfo.targetKPI로 명확히 분류된 목표 KPI만 넣어라. 기존 운영 결과, 기존 방문객, 타깃 비중, 참고 사례 수치, 레슨런드 수치는 kpiObjectives에 넣지 말고 numericInfo.pastPerformance/lessonLearned/referenceMetric/currentIssue로 분리하라. constraints에는 예산/공간/운영/법규/브랜드 가이드 등 제약을 넣어라. schedule에는 제출 일정, 보고 일정, 오픈 일정, 운영 일정을 분리해 넣어라. 최상위 confirmNeeded에는 실제 과업 범위와 참고 사례 구분이 모호하거나 추가 확인이 필요한 항목만 넣어라.',
        '“등” 앞에 나열된 명사는 기본적으로 taskSections.referenceMentions 및 referenceOnly 후보로 분류하라. 단, 같은 문장 또는 상위 과제 구조에서 명확히 제작, 개발, 구성, 제안, 필수 포함 대상으로 지정된 경우에만 requiredScope/taskSections.requiredDeliverables에 포함하라.',
        'FF7 모뉴먼트, S26 쇼케이스, 기존 슈퍼스테디, 뉴페이스셀피, 기존 게임사 팝업, 기존 러닝/야구 스튜디오처럼 “참고/기존/사례/예시/등” 맥락의 항목은 실제 제안 범위가 아니라 referenceOnly 및 doNotTreatAsScope로 분류하라.',
        'targetInfo, spatialCondition, contentCondition, operationCondition은 각각 타깃, 공간, 콘텐츠, 운영 조건을 분리해 작성하라.',
        'kpiScheduleConstraints에는 numericInfo.targetKPI, 일정, 납품 조건, 정량 기준만 넣어라. pastPerformance, lessonLearned, referenceMetric에 해당하는 수치는 목표처럼 표현하지 말고 배경/문제/인사이트 맥락으로만 표현하라. RFP에 명시된 목표 KPI가 없으면 임의 수치를 만들지 말고 numericInfo.proposedMeasurement에 측정 항목 제안으로 정리하라. RFP에 없는 방문객 증가율, 만족도 상승률, 재방문율, 구매전환율 같은 수치를 절대 만들지 말라.',
        'missingInfo에는 프로젝트 목적, 공간 위치/규모, 타깃, 필수 체험 요소, 제품/브랜드 핵심 메시지, 일정, 예산/제작 범위, 디자인 톤앤매너, 제외 사항 중 확인되지 않은 항목을 넣어라.',
        '문장은 실무 제안서에 바로 연결될 수 있도록 간결하고 구체적인 한국어로 작성하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[input.proposalType]}\n프로젝트명: ${input.projectName}\n클라이언트명: ${input.clientName}\n\n업로드 자료 및 사용자 추가 메모:\n${input.briefText}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
