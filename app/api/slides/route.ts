import { NextResponse } from 'next/server';
import { slideContentJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptDevelopmentLogic, ProjectInput, SlideContent, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline, experienceDetailFields, experienceScenarioSteps, extractProductCodes, keyExperienceAssetFields } from '@/lib/experiencePlan';
import { sanitizeKpiSlides } from '@/lib/kpiGuard';
import { removeInternalConceptComparisonSlides } from '@/lib/internalSlides';
import { sanitizeGeneratedSlides } from '@/lib/slideSanitizer';


function withValue(label: string, value?: string) {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : `${label}: 프로젝트 맥락에 맞춰 장표 문안에서 구체화`;
}

function enhanceConceptFlowSlides(slides: SlideContent[], logic?: ConceptDevelopmentLogic, concept?: ConceptCandidate) {
  return slides.map((slide) => {
    const slideKey = `${slide.slideType} ${slide.slideTitle}`;

    if (/experience approach|경험 설계 접근/i.test(slideKey)) {
      return {
        ...slide,
        slideTitle: 'Experience Approach',
        bodyBullets: [
          withValue('coreChallenge', logic?.coreChallenge),
          withValue('targetInsight', logic?.targetInsight),
          withValue('brandOrProductValue', logic?.brandOrProductValue),
          withValue('experienceOpportunity', logic?.experienceOpportunity),
          withValue('strategicApproach', logic?.strategicApproach),
          withValue('conceptNecessity', logic?.conceptNecessity),
        ],
      };
    }

    if (/^core concept|핵심 콘셉트/i.test(slideKey)) {
      return {
        ...slide,
        slideTitle: concept?.conceptNameEN ? `Core Concept: ${concept.conceptNameEN}` : 'Core Concept',
        bodyBullets: [
          withValue('conceptNameKR', concept?.conceptNameKR),
          withValue('conceptNameEN', concept?.conceptNameEN),
          withValue('oneLineDefinition', concept?.oneLineDefinition),
          withValue('coreMessage', concept?.coreMessage),
          withValue('experienceLogic', concept?.experienceLogic),
          withValue('roleInProposal', concept?.whyThisWorks || concept?.keyExperienceAssetDirection),
        ],
      };
    }

    if (/experience structure/i.test(slideKey)) {
      return {
        ...slide,
        slideTitle: 'Experience Structure',
        bodyBullets: [
          withValue('Spatial Zone', concept?.spatialApplication),
          withValue('Hands-on Demo / Interactive Experience', concept?.experienceLogic),
          withValue('Media / Signage', concept?.mediaInteractionPotential),
          withValue('Photo / Viral Spot', concept?.viralPotential),
          withValue('Output / Share', concept?.keyExperienceAssetDirection),
        ],
      };
    }

    return slide;
  });
}

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
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedConcept: ConceptCandidate; outline: SlideOutline[]; conceptDevelopmentLogic?: ConceptDevelopmentLogic };

    if (!body.input || !body.analysis || !body.selectedConcept || !body.outline?.length) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 선택된 콘셉트, 아웃라인이 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const productCodes = extractProductCodes({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });
    const expandedOutline = expandExperiencePlanOutline(body.outline, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });

    const result = await createStructuredJson<{ slides: SlideContent[] }>({
      schemaName: 'proposal_slide_contents',
      schema: slideContentJsonSchema,
      system: [
        '너는 전시/브랜드 체험관 제안서 초안을 작성하는 한국어 크리에이티브 전략가이자 제안서 작가다.',
        '이 단계는 제안 생성 단계다. 사용자가 수정한 슬라이드 아웃라인을 최종 기준으로 삼아 RFP 요약을 반복하지 말고 경험 전략, 콘셉트, 핵심 체험 자산, 공간/콘텐츠 구성, 미디어/인터랙션, 방문객 여정, PPT 장표 문안을 실제 제안서 초안 수준으로 생성하라. 아웃라인의 slideTitle, slidePurpose, keyMessage, mainCopy 수정 내용은 반드시 반영하라.',
        `각 슬라이드는 slideNumber, slideType, slideTitle, slidePurpose, keyMessage, mainCopy, bodyBullets, visualDirection, visitorAction, contentMechanism, spatialPlacement, mediaOrObject, outputOrReward, imagePlaceholder, visualPrompt, diagramSuggestion, productExperienceDetails, keyExperienceAssets, experienceScenarioSteps, referenceInsights, speakerNote, confirmNeededNote를 모두 작성한다. 일반 슬라이드에서 해당 배열이 없으면 빈 배열을 넣는다. 제품/콘텐츠 상세 장표는 ${experienceDetailFields.join(', ')} 항목을 productExperienceDetails에 명확히 작성하라.`,
        '본문 문안에는 RFP Fact / AI Proposal / Confirm Needed 구분을 반영하라. 단, AI Proposal 영역은 RFP 반복이 아니라 새 제안 아이디어여야 하며 Confirm Needed는 confirmNeededNote에만 배치하라.',
        '사용자가 선택한 하나의 핵심 콘셉트만 이후 실행 장표의 기준으로 작성하라. 선택되지 않은 콘셉트, 후보 간 비교, 평가 점수, 보류 사유는 어떤 장표에서도 언급하지 말라. Concept Candidates, 콘셉트 후보 3안 비교, 3개 콘셉트 비교표, 선택되지 않은 콘셉트 설명, 내부 평가 점수표 장표는 절대 작성하지 말라. Experience Approach 장표에는 coreChallenge, targetInsight, brandOrProductValue, experienceOpportunity, strategicApproach, conceptNecessity를 포함하고, “후보 중 선택”이 아니라 “이 과제를 해결하려면 이러한 경험 접근이 필요하고 따라서 이 핵심 콘셉트로 전개해야 한다”는 논리로 작성하라. Core Concept 장표에는 selectedConcept의 conceptNameKR, conceptNameEN, oneLineDefinition, coreMessage, experienceLogic, roleInProposal을 하나의 콘셉트만 기준으로 명확히 작성하라. Experience Structure 장표에는 Spatial Zone, Hands-on Demo / Interactive Experience, Media / Signage, Photo / Viral Spot, Output / Share 항목을 포함해 핵심 콘셉트의 확장 구조를 보여줘라.',
        '제안 아이디어와 장표 문안은 analysis.taskSections[].requiredDeliverables를 최우선 기준으로 삼고 analysis.requiredScope와 analysis.productInfo 중심으로만 생성하라. analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets 항목은 독립 체험 모듈/제품 상세/신규 콘텐츠 단위로 생성하지 말고 참고 방향 또는 레퍼런스 인사이트로만 사용하라.',
        'Reference Insight 또는 Design Reference Direction 장표가 있으면 referenceInsights 배열에 referenceName, referenceType, whatToLearn, howToApply, caution을 채워라. caution에는 “실제 제안 범위가 아닌 참고 사례”라는 의미가 분명히 드러나야 한다.',
        '참고 사례를 다룰 때는 “임팩트 있는 전시 요소 참고 방향”, “기존 캠페인에서 확인된 성공 요소”, “참고 사례 기반 설계 원칙”, “레퍼런스 인사이트”처럼 표현하라. FF7 체험 상세, S26 체험 상세, C2 체험 상세, 기존 캠페인명 체험 상세 같은 신규 모듈 장표 또는 productExperienceDetails를 만들지 말라.',
        `Key Experience Asset Concept 슬라이드에는 selectedConcept.keyExperienceAssetDirection을 기준으로 프로젝트 핵심 체험 자산을 반드시 1~3개로 압축해 keyExperienceAssets 배열에 작성하라. 각 asset은 ${keyExperienceAssetFields.join(', ')} 항목을 포함한다. 일반 assetType 후보 목록은 bodyBullets에 나열하지 말라. 참고 가능한 assetType 범위는 ${assetTypeGuide}이지만 PPT에는 선택된 1~3개만 보이게 작성하라.`,
        'assetType을 무조건 Monument로 고정하지 말라. RFP에서 모뉴먼트를 요구한 경우에만 Monument를 선택할 수 있다. 공간 구성 중심이면 Spatial Zone, 체험 콘텐츠 중심이면 Interactive Experience, 영상/LED/미디어 중심이면 Media Content 또는 Digital Signage, 촬영/공유 중심이면 Photo / Viral Spot, 제품 비교/시연 중심이면 Product Trial Kit 또는 Hands-on Demo를 우선 검토하라.',
        '제품 또는 주요 콘텐츠 단위는 analysis.taskSections.requiredDeliverables, analysis.requiredScope 또는 analysis.productInfo에 명시된 제품/서비스 단위만 기준으로 삼아 각 단위별 Product Experience Detail 장표를 반드시 생성하라. Q8/H8/B8처럼 제품 코드가 복수로 감지되면 Q8, H8, B8 각각의 상세 장표 또는 제품별 비교표를 만들고, “폴더블 갤럭시 제품 체험 모듈”처럼 포괄 이름 하나로 병합하지 말라. 동일 제품/동일 체험 장표는 중복 생성하지 말고 제품당 1~2장으로 제한하라. Q8/H8/B8처럼 복수 제품이 있으면 한 제품에 상세 장표가 몰리지 않도록 균형 있게 배치하라. 같은 제품에 2장이 필요할 때만 “체험 개요”와 “체험 시나리오”처럼 역할을 명확히 분리하라. productExperienceDetails 배열에는 productCode, productRole, coreValue, experienceTitle, oneLineExperience, visitorMission, visitorAction, systemResponse, mediaOrObject, spatialPlacement, outputOrReward, snsSharePoint, visualDirection, imagePlaceholder, diagramSuggestion을 채워라. 단순 제품 설명이 아니라 방문객 행동, 시스템 반응, 결과물이 명확한 콘텐츠만 작성하라. referenceOnly/doNotTreatAsScope/existingAssets의 참고 사례, 기존 캠페인, 레슨런드 항목은 제외하라. “제작”, “개발”, “운영”, “구성”, “기획”, “제안” 같은 과업/업무 범위 표현은 체험 콘텐츠명으로 사용하지 말고 실행 계획, 제작 범위, 운영 계획 장표에서만 다루라.',
        'Spatial / Content Plan은 핵심 콘셉트와 핵심 체험 자산을 기준으로 최소 5장 구조를 반드시 유지한다. 제품별 체험 상세 장표는 동일 제품/동일 체험을 반복하지 말고 유사 장표는 병합하라. Zone Detail 01 같은 일반 제목은 최종 slideTitle로 사용하지 말고 Q8 체험 개요, H8 체험 시나리오, B8 셀피 체험 개요처럼 제품과 역할이 분명한 실제 체험명으로 바꿔라.',
        'Spatial / Content Plan의 Main Experience Image 장표에는 imagePlaceholder를 파일명형 placeholder가 아니라 “대표 이미지 삽입 영역” 또는 자연어 1줄 이미지 설명으로 작성하라. 실제 이미지 생성용 visualPrompt는 내부 데이터 및 speakerNote에만 유지하라. 본문 bullet에는 Prompt 전문이나 cover_image_placeholder 같은 파일명형 텍스트를 노출하지 말라.',
        `Spatial / Content Plan의 Experience Scenario 장표는 ${experienceScenarioSteps.join(' → ')} 6단계를 experienceScenarioSteps 배열로 작성하고, 각 단계별 visitorAction, systemResponse, mediaOrObject, output, designNote가 표/플로우처럼 읽히게 하라.`,
        'Media / Interactive Plan은 핵심 콘셉트와 핵심 체험 자산을 기준으로 최소 5장 구조를 반드시 유지한다: Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share. Content Mechanism과 콘텐츠 작동 원리 및 메커니즘처럼 의미가 같은 장표를 중복 생성하지 말라. 미디어/인터랙션 요소가 많은 경우 추가된 아웃라인에 맞춰 자산별 상세 장표를 작성하라.',
        'Media / Interactive Plan은 관람객 행동 → 센서/입력 → 미디어 반응 → 결과물 → 공유가 보이도록 visitorAction, contentMechanism, mediaOrObject, outputOrReward, diagramSuggestion을 연결해 작성하라.',
        'Visitor Journey는 방문 전/진입/몰입/참여/공유/퇴장 이후의 행동과 감정, 접점, 콘텐츠, 운영 포인트가 연결되게 작성하라.',
        'Media / Interactive Plan은 미디어 장치와 상호작용 방식이 콘셉트 및 핵심 체험 자산과 어떻게 연결되는지 구체적으로 작성하라.',
        'Viral / Communication Mechanism은 포토/공유/UGC/초대/리워드 등 확산 구조를 프로젝트 맥락에 맞게 설계하라.',
        'Operation Plan은 안내, 체류, 회전율, VIP/의전, 안전, 스태핑, 유지관리 등 RFP 맥락에 필요한 실행 방향을 다루라.',
        'KPI/Expected Effect 장표에는 analysis.numericInfo.targetKPI로 명확히 분류된 수치와 analysis.numericInfo.proposedMeasurement의 측정 방식만 자연스러운 제안서 문장으로 표시하라. “RFP에 명시된 목표 KPI와 측정 방식만 정량 목표로 제시합니다.” 같은 내부 지시문은 본문에 쓰지 말라. analysis.numericInfo.pastPerformance, lessonLearned, referenceMetric 수치는 목표처럼 표현하지 말고 Project Understanding, Key Challenge, Reference Insight의 배경 인사이트로만 사용하라. targetKPI가 비어 있으면 임의 수치를 만들지 말고 “방문객 수, 체험 참여율, SNS 버즈량을 중심으로 운영 성과를 측정합니다.”처럼 측정 항목 제안으로 표현하라. Background insight only 문구는 PPT 본문에 직접 표시하지 말고 “배경 인사이트”로 자연스럽게 변환하거나 speakerNote로만 처리하라. RFP에 없는 방문객 증가 예상, 만족도 상승 예상, 재방문율 향상 예상, 구매 전환율 향상 예상 같은 수치/단정 예측을 금지한다.',
        '문안은 제안서에 바로 붙여넣을 수 있는 문장으로 작성하고 “필요”, “구체화 필요”, “확인 필요” 반복을 피하라. “3개 후보 중 가장 적합”, “다른 후보 대비”, “RFP 적합도 점수” 같은 내부 의사결정 표현을 금지하고, 핵심 콘셉트가 프로젝트 과제에서 자연스럽게 귀결되는 제안서 톤으로 작성하라. 최종 PPTX 노출 문안에는 “선택된 콘셉트”, “콘셉트 후보”, “콘셉트 도출 과정”, “후보 비교”, “C1 / C2 / C3”, “추천 콘셉트” 표현을 쓰지 말라.',
        '너무 일반적인 표현을 피하고, 프로젝트명/클라이언트명/분석 결과의 맥락을 반영해 콘셉트와 콘텐츠가 하나의 경험 구조로 이어지게 하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

분석 결과:
${JSON.stringify(body.analysis, null, 2)}

경험 접근 로직:
${JSON.stringify(body.conceptDevelopmentLogic ?? null, null, 2)}

핵심 콘셉트:
${JSON.stringify(body.selectedConcept, null, 2)}

슬라이드 아웃라인:
${JSON.stringify(expandedOutline, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}
- 감지된 제품/콘텐츠 코드: ${productCodes.length ? productCodes.join(' / ') : '없음'}`,
    });

    return NextResponse.json(sanitizeGeneratedSlides(removeInternalConceptComparisonSlides(sanitizeKpiSlides(enhanceConceptFlowSlides(result.slides, body.conceptDevelopmentLogic, body.selectedConcept), body.analysis)), productCodes));
  } catch (error) {
    const message = error instanceof Error ? error.message : '장표 문안 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
