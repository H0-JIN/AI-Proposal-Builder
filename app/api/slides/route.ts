import { NextResponse } from 'next/server';
import { slideContentJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ProjectInput, SlideContent, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline, experienceDetailFields, experienceScenarioSteps, extractProductCodes, keyExperienceAssetFields } from '@/lib/experiencePlan';

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
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedConcept: ConceptCandidate; outline: SlideOutline[] };

    if (!body.input || !body.analysis || !body.selectedConcept || !body.outline?.length) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 선택된 콘셉트, 아웃라인이 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const productCodes = extractProductCodes({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept });
    const expandedOutline = expandExperiencePlanOutline(body.outline, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept });

    const result = await createStructuredJson<{ slides: SlideContent[] }>({
      schemaName: 'proposal_slide_contents',
      schema: slideContentJsonSchema,
      system: [
        '너는 전시/브랜드 체험관 제안서 초안을 작성하는 한국어 크리에이티브 전략가이자 제안서 작가다.',
        '이 단계는 제안 생성 단계다. RFP 요약을 반복하지 말고 경험 전략, 콘셉트, 핵심 체험 자산, 공간/콘텐츠 구성, 미디어/인터랙션, 방문객 여정, PPT 장표 문안을 실제 제안서 초안 수준으로 생성하라.',
        `각 슬라이드는 slideNumber, slideType, slideTitle, slidePurpose, keyMessage, mainCopy, bodyBullets, visualDirection, visitorAction, contentMechanism, spatialPlacement, mediaOrObject, outputOrReward, imagePlaceholder, visualPrompt, diagramSuggestion, productExperienceDetails, keyExperienceAssets, experienceScenarioSteps, speakerNote, confirmNeededNote를 모두 작성한다. 일반 슬라이드에서 해당 배열이 없으면 빈 배열을 넣는다. 제품/콘텐츠 상세 장표는 ${experienceDetailFields.join(', ')} 항목을 productExperienceDetails에 명확히 작성하라.`,
        '본문 문안에는 RFP Fact / AI Proposal / Confirm Needed 구분을 반영하라. 단, AI Proposal 영역은 RFP 반복이 아니라 새 제안 아이디어여야 하며 Confirm Needed는 confirmNeededNote에만 배치하라.',
        '사용자가 선택한 콘셉트만 기준으로 작성하라. 후보 비교 슬라이드를 새로 만들지 말고 Core Concept 장표에는 selectedConcept의 conceptNameKR, conceptNameEN, oneLineDefinition, coreMessage, experienceLogic, targetRelevance, whyThisWorks가 명확히 드러나게 작성하라.',
        `Key Experience Asset Concept 슬라이드에는 selectedConcept.keyExperienceAssetDirection을 기준으로 프로젝트 핵심 체험 자산을 반드시 1~3개로 압축해 keyExperienceAssets 배열에 작성하라. 각 asset은 ${keyExperienceAssetFields.join(', ')} 항목을 포함한다. 일반 assetType 후보 목록은 bodyBullets에 나열하지 말라. 참고 가능한 assetType 범위는 ${assetTypeGuide}이지만 PPT에는 선택된 1~3개만 보이게 작성하라.`,
        'assetType을 무조건 Monument로 고정하지 말라. RFP에서 모뉴먼트를 요구한 경우에만 Monument를 선택할 수 있다. 공간 구성 중심이면 Spatial Zone, 체험 콘텐츠 중심이면 Interactive Experience, 영상/LED/미디어 중심이면 Media Content 또는 Digital Signage, 촬영/공유 중심이면 Photo / Viral Spot, 제품 비교/시연 중심이면 Product Trial Kit 또는 Hands-on Demo를 우선 검토하라.',
        '제품 또는 주요 콘텐츠 단위가 있으면 각 단위별 Product Experience Detail 장표를 반드시 생성하고 productExperienceDetails 배열에 productCode, productNameOrRole, coreValue, experienceTitle, oneLineExperience, visitorMission, visitorAction, contentMechanism, mediaOrObject, spatialPlacement, outputOrReward, snsSharePoint, visualDirection, imagePlaceholder, diagramSuggestion을 채워라. 단순 제품 설명이 아니라 방문객이 무엇을 어떻게 체험하는지 중심으로 작성하라.',
        'Spatial / Content Plan은 선택된 콘셉트와 핵심 체험 자산을 기준으로 최소 5장 구조를 반드시 유지한다. Zone Detail 01 같은 일반 제목은 최종 slideTitle로 사용하지 말고 Q8 멀티태스킹 챌린지, H8 4:3 몰입 콘텐츠 체험, B8 플렉스캠 셀피 스튜디오, 폴더블 매칭 테이블, SNS 인증 결과물 생성존처럼 실제 체험명으로 바꿔라.',
        'Spatial / Content Plan의 Main Experience Image 장표에는 imagePlaceholder는 대표 이미지 삽입 영역으로 쓰고, 실제 이미지 생성용 visualPrompt는 내부 데이터 및 speakerNote에만 유지하라. 본문 bullet에는 Prompt 전문을 노출하지 말라.',
        `Spatial / Content Plan의 Experience Scenario 장표는 ${experienceScenarioSteps.join(' → ')} 6단계를 experienceScenarioSteps 배열로 작성하고, 각 단계별 visitorAction, systemResponse, mediaOrObject, output, designNote가 표/플로우처럼 읽히게 하라.`,
        'Media / Interactive Plan은 선택된 콘셉트와 핵심 체험 자산을 기준으로 최소 5장 구조를 반드시 유지한다: Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share. 미디어/인터랙션 요소가 많은 경우 추가된 아웃라인에 맞춰 자산별 상세 장표를 작성하라.',
        'Media / Interactive Plan은 관람객 행동 → 센서/입력 → 미디어 반응 → 결과물 → 공유가 보이도록 visitorAction, contentMechanism, mediaOrObject, outputOrReward, diagramSuggestion을 연결해 작성하라.',
        'Visitor Journey는 방문 전/진입/몰입/참여/공유/퇴장 이후의 행동과 감정, 접점, 콘텐츠, 운영 포인트가 연결되게 작성하라.',
        'Media / Interactive Plan은 미디어 장치와 상호작용 방식이 콘셉트 및 핵심 체험 자산과 어떻게 연결되는지 구체적으로 작성하라.',
        'Viral / Communication Mechanism은 포토/공유/UGC/초대/리워드 등 확산 구조를 프로젝트 맥락에 맞게 설계하라.',
        'Operation Plan은 안내, 체류, 회전율, VIP/의전, 안전, 스태핑, 유지관리 등 RFP 맥락에 필요한 실행 방향을 다루라.',
        'Expected Effect에서는 RFP에 명시된 KPI만 수치로 사용하라. RFP에 없는 방문객 증가 예상, 만족도 상승 예상, 재방문율 향상 예상, 구매 전환율 향상 예상 같은 수치/단정 예측을 금지한다. 그 외 효과는 측정 방향, 운영 지표, 데이터 수집 항목으로 표현하라.',
        '문안은 제안서에 바로 붙여넣을 수 있는 문장으로 작성하고 “필요”, “구체화 필요”, “확인 필요” 반복을 피하라.',
        '너무 일반적인 표현을 피하고, 프로젝트명/클라이언트명/분석 결과의 맥락을 반영해 콘셉트와 콘텐츠가 하나의 경험 구조로 이어지게 하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n분석 결과:\n${JSON.stringify(body.analysis, null, 2)}\n\n선택된 콘셉트:\n${JSON.stringify(body.selectedConcept, null, 2)}\n\n슬라이드 아웃라인:\n${JSON.stringify(expandedOutline, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}
- 감지된 제품/콘텐츠 코드: ${productCodes.length ? productCodes.join(' / ') : '없음'}`,
    });

    return NextResponse.json(result.slides);
  } catch (error) {
    const message = error instanceof Error ? error.message : '장표 문안 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
