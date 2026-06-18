import { NextResponse } from 'next/server';
import { rfpDiagnosisJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, RfpDiagnosis } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';

export const dynamic = 'force-dynamic';

function compact(value: unknown, max = 9000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...truncated` : text;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult };
    if (!body.input || !body.analysis) return NextResponse.json({ error: 'RFP 분석 결과가 필요합니다.' }, { status: 400 });

    // diagnosisContext = current RFP only. Do not retrieve proposal_patterns or reference proposal data here.
    const diagnosisContext = {
      input: { projectName: body.input.projectName, clientName: body.input.clientName, proposalType: body.input.proposalType, briefText: body.input.briefText },
      analysis: body.analysis,
    };

    const result = await createStructuredJson<RfpDiagnosis>({
      schemaName: 'rfp_only_diagnosis',
      schema: rfpDiagnosisJsonSchema,
      system: [
        '너는 제안 전략 진단가다. 현재 RFP 분석만 사용해 이번 제안의 고유 승부처를 한국어로 진단한다.',
        '절대 사용 금지: proposal_patterns, previous proposals, reference projects, won/lost outcomes, outcomeReason, old concept names, old slogans, old proposal structures, old client names.',
        '전략 방향을 만들지 말고, 전략 방향 생성을 위한 진단만 작성한다.',
        '모든 사용자-facing 필드는 한국어 제안 기획 언어로 작성한다. “This proposal wins if...” 같은 영어 문장을 쓰지 않는다.',
        'coreWinningCondition은 반드시 “이 제안은 ___을 단순히 설명하는 것이 아니라, ___로 증명할 때 이긴다.”처럼 승부 조건을 한 문장으로 작성한다.',
        'requiredProofElements는 3~7개, rfpEvidenceAnchors는 현재 RFP 분석에서 나온 짧은 근거만 작성한다.',
      ].join('\n'),
      user: `diagnosisContext = current RFP only\n${compact(diagnosisContext)}`,
      timeoutMs: 12_000,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '진단 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
