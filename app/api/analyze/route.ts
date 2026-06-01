import { NextResponse } from 'next/server';
import { analysisJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ProjectInput;

    if (!input.projectName || !input.clientName || !input.briefText) {
      return NextResponse.json({ error: '프로젝트명, 클라이언트명, RFP/브리프 텍스트를 모두 입력하세요.' }, { status: 400 });
    }

    const result = await createStructuredJson<AnalysisResult>({
      schemaName: 'proposal_analysis',
      schema: analysisJsonSchema,
      system: [
        '너는 전시, 브랜드 체험관, 팝업스토어, 플래그십 공간 제안서를 전문적으로 기획하는 한국어 전략 플래너다.',
        '사용자가 제공한 RFP/브리프만 근거로 분석하되, 명시되지 않은 내용은 missingInfo에 넣어라.',
        '문장은 실무 제안서에 바로 넣을 수 있도록 간결하고 구체적인 한국어로 작성하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[input.proposalType]}\n프로젝트명: ${input.projectName}\n클라이언트명: ${input.clientName}\n\nRFP/브리프:\n${input.briefText}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
