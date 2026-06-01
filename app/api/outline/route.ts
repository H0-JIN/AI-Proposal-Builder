import { NextResponse } from 'next/server';
import { outlineJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';

const styleGuides = {
  basic: '문제 정의, 전략, 공간/콘텐츠 구성, 실행 계획, 기대효과가 균형 있게 이어지는 범용 제안서 구조.',
  cheil: '브랜드 인사이트와 캠페인 아이디어를 강하게 제시하고, 경험 시나리오와 통합 커뮤니케이션 관점을 강조하는 구조.',
  innocean: '모빌리티/라이프스타일 맥락, 고객 여정, 체험 콘텐츠 운영성, 성과 측정 지표를 체계적으로 제시하는 구조.',
  hyundai: '그룹 브랜드 톤에 맞춰 비전, 고객 가치, 기술/공간 완성도, 안전/운영 리스크 관리까지 명확히 보여주는 구조.',
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult };

    if (!body.input || !body.analysis) {
      return NextResponse.json({ error: '프로젝트 입력값과 분석 결과가 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const result = await createStructuredJson<{ slides: SlideOutline[] }>({
      schemaName: 'proposal_outline',
      schema: outlineJsonSchema,
      system: [
        '너는 한국어 제안서 전체 구조를 설계하는 크리에이티브 디렉터다.',
        '8~12장의 슬라이드 아웃라인을 만들고 slideNumber는 1부터 순서대로 부여하라.',
        '각 장표는 중복 없이 설득 흐름이 이어져야 한다.',
        '분석 결과의 missingInfo와 입력 품질 진단에서 부족하다고 표시된 항목을 적극적으로 반영하라.',
        '확인되지 않은 조건은 임의로 가정하지 말고 keyMessage나 slidePurpose에 확인 필요라고 명시하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}\n유형별 구조 가이드: ${styleGuides[body.input.proposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n분석 결과 JSON:\n${JSON.stringify(body.analysis, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}`,
    });

    return NextResponse.json(result.slides);
  } catch (error) {
    const message = error instanceof Error ? error.message : '아웃라인 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
