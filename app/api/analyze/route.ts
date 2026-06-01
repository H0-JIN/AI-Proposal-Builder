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
        '사용자가 제공한 업로드 자료와 추가 메모만 근거로 분석하되, 명시되지 않은 내용은 절대 추정하지 말고 해당 필드에는 확인 필요라고 써라.',
        'missingInfo에는 프로젝트 목적, 공간 위치/규모, 타깃, 필수 체험 요소, 제품/브랜드 핵심 메시지, 일정, 예산/제작 범위, 디자인 톤앤매너, 제외 사항 중 확인되지 않은 항목을 적극적으로 모두 넣어라.',
        '입력 자료가 짧을수록 일반적인 업계 관행을 보완하지 말고 확인 필요 항목을 더 엄격하게 표시하라.',
        '문장은 실무 제안서에 바로 넣을 수 있도록 간결하고 구체적인 한국어로 작성하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[input.proposalType]}\n프로젝트명: ${input.projectName}\n클라이언트명: ${input.clientName}\n\n업로드 자료 및 사용자 추가 메모:\n${input.briefText}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
