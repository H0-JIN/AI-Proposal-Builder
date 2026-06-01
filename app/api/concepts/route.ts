import { NextResponse } from 'next/server';
import { conceptCandidatesJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ProjectInput } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult };

    if (!body.input || !body.analysis) {
      return NextResponse.json({ error: '프로젝트 입력값과 분석 결과가 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const result = await createStructuredJson<{ concepts: ConceptCandidate[] }>({
      schemaName: 'proposal_concept_candidates',
      schema: conceptCandidatesJsonSchema,
      system: [
        '너는 한국어 전시/브랜드 체험관 제안서의 콘셉트 후보를 설계하는 크리에이티브 디렉터다.',
        'AI 분석 결과를 바탕으로 제안서 전체를 이끌 수 있는 서로 다른 콘셉트 후보 3안을 만든다.',
        '각 콘셉트는 이름만 다른 안이 아니라 경험 구조, 핵심 체험 자산 방향, 타깃 설득 논리가 명확히 달라야 한다.',
        'conceptId는 concept-1, concept-2, concept-3 형식으로 순서대로 작성하라.',
        'conceptNameKR은 한국어 제안서에 바로 쓸 수 있는 짧고 선명한 이름으로, conceptNameEN은 발표용 영문/슬로건형 이름으로 작성하라.',
        'oneLineDefinition은 한 문장으로 콘셉트의 체험 약속을 정의하라.',
        'experienceLogic은 방문객이 어떤 흐름으로 메시지를 체감하는지 행동과 감정의 순서가 보이게 작성하라.',
        'keyExperienceAssetDirection은 이후 Key Experience Asset, Spatial / Content Plan, Media / Interactive Plan으로 확장 가능한 대표 자산 방향을 구체적으로 제시하라.',
        '근거 없는 정량 효과나 RFP에 없는 수치 예측은 금지한다.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n분석 결과 JSON:\n${JSON.stringify(body.analysis, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}`,
    });

    return NextResponse.json(result.concepts);
  } catch (error) {
    const message = error instanceof Error ? error.message : '콘셉트 후보 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
