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
        '출력 내부에서 RFP Fact, AI Proposal, Confirm Needed를 명확히 구분하되, 분석 단계의 aiProposal에는 새 아이디어가 아니라 “제안 생성 단계에서 다룰 전략적 해석 방향”만 짧게 적어라.',
        '명시되지 않은 내용은 추정하지 말고 confirmNeeded와 missingInfo로 보조 정리하라. 단, 확인 필요 항목을 과도하게 본문 중심으로 확대하지 말라.',
        'requiredItems에는 RFP가 요구한 산출물/공간/콘텐츠/운영 요구를 넣고, constraints에는 예산/일정/공간/법규/브랜드 가이드 등 제약을 넣어라.',
        'targetInfo, spatialCondition, contentCondition, operationCondition은 각각 타깃, 공간, 콘텐츠, 운영 조건을 분리해 작성하라.',
        'kpiScheduleConstraints에는 RFP에 명시된 KPI, 일정, 납품 조건, 정량 기준만 넣어라. RFP에 없는 방문객 증가율, 만족도 상승률, 재방문율, 구매전환율 같은 수치를 절대 만들지 말라.',
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
