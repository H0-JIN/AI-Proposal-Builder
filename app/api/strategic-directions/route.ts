import { NextResponse } from 'next/server';
import { strategicDirectionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandProductIntelligence, ProjectInput, RfpDiagnosis, StrategicDirectionsResult, SupplementalInfo } from '@/lib/types';
import { normalizeProposalType, proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const strategicDirectionPromptVersion = 'strategic-directions-v1';

function compact(value: unknown, max = 6000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...truncated` : text;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      input: ProjectInput;
      analysis: AnalysisResult;
      rfpDiagnosis: RfpDiagnosis;
      brandProductIntelligence: BrandProductIntelligence;
      supplementalInfo?: SupplementalInfo;
    };

    if (!body.input || !body.analysis) {
      return NextResponse.json({ error: 'RFP 분석 결과가 필요합니다.' }, { status: 400 });
    }
    if (!body.rfpDiagnosis) {
      return NextResponse.json({ error: '확정된 제안 전략 진단이 필요합니다.' }, { status: 400 });
    }
    if (!body.brandProductIntelligence) {
      return NextResponse.json({ error: '확정된 브랜드/제품 이해가 필요합니다.' }, { status: 400 });
    }

    const effectiveProposalType = normalizeProposalType(body.analysis.inferredProposalType ?? body.input.proposalType);

    const result = await createStructuredJson<{ directions: StrategicDirectionsResult['directions'] }>({
      schemaName: 'strategic_directions',
      schema: strategicDirectionsJsonSchema,
      system: [
        '너는 제안 전략 디렉터다. 이 단계의 유일한 임무는 현재 RFP에 맞는 전략 방향(strategic direction) 3개를 만드는 것이다.',
        '전략 방향은 "이 제안서를 어떤 전략적 승부수로 끌고 갈 것인가"이다. 최종 컨셉명/슬로건/표지명이 아니다.',
        '입력만 사용: 현재 RFP 분석, 확정된 RFP-only 진단, 확정된 브랜드/제품 이해, 사용자 추가 가정(있을 때), 현재 프로젝트/RFP 메타데이터.',
        '절대 금지: 최종 컨셉명/네이밍 생성, proposal_patterns, 과거 제안서 원문/이름/구조/고객/카테고리, 웹 조사, 외부 출처 확인하는 척하기.',
        '절대 금지: 제안 유형 프리셋 템플릿, 명사 치환식 라벨(예: "[키워드] 현재화", "[주체] 대표성 각인", "통합 [키워드] 생태계"), 고정 축 세트, 반복 repair/검증 루프.',
        '제안 유형은 톤/범위의 guardrail로만 쓰고, 방향 라벨을 유형에서 기계적으로 만들지 말라.',
        '3개 방향은 서로 명확히 달라야 한다: 무엇을 증명하는지, 누구/무엇을 설득하는지, 설득 메커니즘, 해소하는 리스크, 대표 설득 장면이 각기 달라야 한다.',
        '각 방향은 확정 진단의 coreWinningCondition / strategicTension / proofBurden 중 최소 하나에 명시적으로 연결되어야 한다.',
        '각 방향은 현재 RFP 근거(evidenceUsed)에 기반해야 하며, 어떤 RFP에나 들어맞는 일반론이면 안 된다.',
        'strategicDirectionLabel은 현재 RFP 고유의 짧은 전략 방향명으로 쓰되, 컨셉 표지명이나 시적 슬로건이 아니라 전략적 입장을 드러내야 한다.',
        'conceptLeap, signatureProofIdea는 이 방향 수준의 한두 문장 설명(문자열)으로 쓴다. 최종 컨셉명을 만들지 말라.',
        '자료가 부족해 RFP에서 추론한 부분은 문장 안에 "AI 보완"을 붙여 사용자가 편집할 수 있게 표시한다.',
        'id는 "D1","D2","D3"으로 부여한다.',
      ].join('\n'),
      user: [
        `제안서 유형 (guardrail only): ${proposalTypeLabels[effectiveProposalType]}`,
        `프로젝트/RFP 메타데이터: ${compact({ projectName: body.input.projectName, clientName: body.input.clientName }, 600)}`,
        `현재 RFP 원문: ${(body.input.briefText || '').slice(0, 4000)}`,
        `현재 RFP 분석: ${compact(body.analysis, 6000)}`,
        `확정된 RFP-only 진단 (authoritative strategy source): ${compact(body.rfpDiagnosis, 2400)}`,
        `확정된 브랜드/제품 이해 (카테고리 톤/어휘/전략 함의): ${compact(body.brandProductIntelligence, 2400)}`,
        `사용자 추가 가정: ${body.supplementalInfo ? compact(body.supplementalInfo, 1200) : '없음 - RFP 기준으로만 AI 보완 표시'}`,
        '',
        '위 입력만으로 현재 RFP 고유의 전략 방향 3개(D1/D2/D3)를 만들어라. 최종 컨셉명/슬로건은 만들지 말라.',
      ].join('\n'),
      timeoutMs: 30_000,
    });

    const directions = (result.directions ?? []).slice(0, 3).map((direction, index) => ({
      ...direction,
      id: direction.id?.trim() || `D${index + 1}`,
    }));

    if (directions.length < 3) {
      return NextResponse.json({ error: '전략 방향이 3개 생성되지 않았습니다. 다시 시도해 주세요.' }, { status: 502 });
    }

    const response: StrategicDirectionsResult = {
      directions,
      generatedAt: new Date().toISOString(),
      promptVersion: strategicDirectionPromptVersion,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : '전략 방향 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
