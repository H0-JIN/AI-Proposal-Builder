import { NextResponse } from 'next/server';
import { slideContentJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ProjectInput, SlideContent, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';

const assetTypeGuide = [
  'Spatial Zone',
  'Interactive Experience',
  'Media Content',
  'Photo / Viral Spot',
  'Product Trial Kit',
  'Exhibition Object',
  'Digital Signage',
  'Operation Program',
  'Brand Experience Module',
  'Monument',
  'Briefing Space',
  'Immersive Room',
  'Hands-on Demo',
  'Visitor Participation Content',
].join(', ');

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
        '너는 전시/브랜드 체험관 제안서 초안을 작성하는 한국어 크리에이티브 전략가이자 제안서 작가다.',
        '이 단계는 제안 생성 단계다. RFP 요약을 반복하지 말고 경험 전략, 콘셉트, 핵심 체험 자산, 공간/콘텐츠 구성, 미디어/인터랙션, 방문객 여정, PPT 장표 문안을 실제 제안서 초안 수준으로 생성하라.',
        '각 슬라이드는 slideNumber, slideType, slideTitle, slidePurpose, keyMessage, mainCopy, bodyBullets, visualDirection, imagePlaceholder, diagramSuggestion, speakerNote, confirmNeededNote를 모두 작성한다.',
        '본문 문안에는 RFP Fact / AI Proposal / Confirm Needed 구분을 반영하라. 단, AI Proposal 영역은 RFP 반복이 아니라 새 제안 아이디어여야 하며 Confirm Needed는 confirmNeededNote에만 배치하라.',
        'Concept Candidates 슬라이드에는 최소 3개 후보를 반드시 만들고 각 후보를 conceptNameKR, conceptNameEN, coreMessage, experienceLogic, targetRelevance, spatialExpansion, whyThisWorks 항목이 드러나도록 bullet에 작성하라.',
        `Key Experience Asset Concept 슬라이드에는 프로젝트 핵심 체험 자산을 ${assetTypeGuide} 중 하나 또는 복수로 자동 판단하고 assetType, assetName, roleInExperience, designDirection, visitorAction, contentMechanism, mediaOrMaterial, spatialPlacementIdea, interactionPoint, visualPrompt, expectedVisitorMemory 항목이 드러나도록 작성하라.`,
        'assetType을 무조건 Monument로 고정하지 말라. RFP에서 모뉴먼트를 요구한 경우에만 Monument를 선택할 수 있다. 공간 구성 중심이면 Spatial Zone, 체험 콘텐츠 중심이면 Interactive Experience, 영상/LED/미디어 중심이면 Media Content 또는 Digital Signage, 촬영/공유 중심이면 Photo / Viral Spot, 제품 비교/시연 중심이면 Product Trial Kit 또는 Hands-on Demo를 우선 검토하라.',
        '제품 또는 주요 콘텐츠 단위가 있으면 Spatial / Content Plan 또는 별도 관련 슬라이드에서 contentUnitName, coreValue, experienceTitle, visitorAction, contentMechanism, mediaOrObject, outputOrReward, snsSharePoint, requiredAssetType, note 항목이 드러나도록 단위별 체험 콘텐츠를 생성하라.',
        'Visitor Journey는 방문 전/진입/몰입/참여/공유/퇴장 이후의 행동과 감정, 접점, 콘텐츠, 운영 포인트가 연결되게 작성하라.',
        'Media / Interactive Plan은 미디어 장치와 상호작용 방식이 콘셉트 및 핵심 체험 자산과 어떻게 연결되는지 구체적으로 작성하라.',
        'Viral / Communication Mechanism은 포토/공유/UGC/초대/리워드 등 확산 구조를 프로젝트 맥락에 맞게 설계하라.',
        'Operation Plan은 안내, 체류, 회전율, VIP/의전, 안전, 스태핑, 유지관리 등 RFP 맥락에 필요한 실행 방향을 다루라.',
        'Expected Effect에서는 방문객 증가 예상, 만족도 상승 예상, 재방문율 향상 예상, 구매 전환율 향상 예상처럼 RFP에 없는 수치나 단정적 예측을 금지한다. KPI가 명시되지 않았으면 KPI 설계 방향, 측정 항목 제안, 정성적 기대 효과로 표현하라.',
        '문안은 제안서에 바로 붙여넣을 수 있는 문장으로 작성하고 “필요”, “구체화 필요”, “확인 필요” 반복을 피하라.',
        '너무 일반적인 표현을 피하고, 프로젝트명/클라이언트명/분석 결과의 맥락을 반영해 콘셉트와 콘텐츠가 하나의 경험 구조로 이어지게 하라.',
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
