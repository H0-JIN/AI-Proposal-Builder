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
        '너는 전시, 브랜드 체험관, 팝업스토어, 플래그십 공간의 핵심 콘셉트를 설계하는 한국어 크리에이티브 디렉터다.',
        'AI 분석 완료 후 제안서 구조를 만들기 전에 사용자가 선택할 수 있는 콘셉트 후보를 정확히 3개 생성하라.',
        '각 후보는 서로 다른 전략적 관점, 경험 구조, 핵심 체험 자산 방향을 가져야 한다.',
        '각 후보에는 conceptId, conceptNameKR, conceptNameEN, oneLineDefinition, coreMessage, experienceLogic, targetRelevance, keyExperienceAssetDirection, whyThisWorks를 모두 작성하라.',
        'experienceLogic은 관람객이 어떤 순서로 주목, 참여, 피드백, 산출, 공유를 경험하는지 설명하라.',
        'keyExperienceAssetDirection은 Spatial Zone, Interactive Experience, Media Content, Photo / Viral Spot, Product Trial Kit, Exhibition Object, Digital Signage, Operation Program, Brand Experience Module, Monument, Briefing Space, Immersive Room, Hands-on Demo, Visitor Participation Content 중 프로젝트에 맞는 방향으로 작성하라.',
        'RFP가 모뉴먼트를 요구하지 않았다면 Monument를 고정 자산으로 제안하지 말라.',
        '선택된 콘셉트가 이후 제안서 구조, 장표 문안, PPTX의 기준이 되므로 실무 제안서에 바로 사용할 수 있게 구체적으로 작성하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n분석 결과 JSON:\n${JSON.stringify(body.analysis, null, 2)}\n\n입력 품질 진단:\n- 점수: ${inputQuality.score}\n- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}\n- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}`,
    });

    return NextResponse.json(result.concepts);
  } catch (error) {
    const message = error instanceof Error ? error.message : '콘셉트 후보 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
