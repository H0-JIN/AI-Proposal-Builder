import { NextResponse } from 'next/server';
import { slideContentJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, SlideContent, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; outline: SlideOutline[] };

    if (!body.input || !body.analysis || !body.outline?.length) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 아웃라인이 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const result = await createStructuredJson<{ slides: SlideContent[] }>({
      schemaName: 'proposal_slide_contents',
      schema: slideContentJsonSchema,
      system: [
        '너는 전시/브랜드 체험관 제안서 장표 카피를 쓰는 한국어 제안서 작가다.',
        '각 슬라이드별 title, subtitle, bodyBullets, imagePlaceholder, diagramSuggestion을 생성하라.',
        'bodyBullets는 핵심 메시지 중심으로 3~5개, 실무 제안서 톤으로 작성하라.',
        'imagePlaceholder와 diagramSuggestion은 디자이너가 바로 이해할 수 있는 시각화 지시문으로 작성하라.',
        '분석 결과의 missingInfo와 입력 품질 진단의 부족 항목을 장표 문안에 적극적으로 반영하라.',
        '확인되지 않은 공간, 타깃, 일정, 예산, 톤앤매너, 제외 사항은 추정하지 말고 bullet 또는 subtitle에 확인 필요라고 표시하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n분석 결과:\n${JSON.stringify(body.analysis, null, 2)}\n\n슬라이드 아웃라인:\n${JSON.stringify(body.outline, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}`,
    });

    return NextResponse.json(result.slides);
  } catch (error) {
    const message = error instanceof Error ? error.message : '장표 문안 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
