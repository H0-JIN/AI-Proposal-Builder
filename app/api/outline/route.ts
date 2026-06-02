import { NextResponse } from 'next/server';
import { outlineJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptDevelopmentLogic, ProjectInput, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline, extractProductCodes } from '@/lib/experiencePlan';
import { removeInternalConceptComparisonSlides } from '@/lib/internalSlides';

const styleGuides = {
  basic: '프로젝트 이해, 과제 정의, 경험 전략, 콘셉트, 공간/콘텐츠 구성, 운영 및 기대 효과가 이어지는 기본형 구조.',
  cheil: '브랜드 과제, 소비자 인사이트, 경험 전략, 캠페인형 공간 아이디어, 확산/바이럴 포인트, 실행 계획을 강조하는 제일기획형 구조.',
  innocean: '브랜드/제품 맥락, 타깃 행동 분석, 체험 시나리오, 공간/미디어 연출, 운영 및 실행 가능성을 강조하는 이노션형 구조.',
  hyundai: '기업 비전, 기술/사업 가치, 신뢰감 있는 체험 구조, 공간/콘텐츠 전달 방식, 의전/운영 고려사항을 강조하는 현대차그룹형 구조.',
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedConcept: ConceptCandidate; conceptDevelopmentLogic?: ConceptDevelopmentLogic };

    if (!body.input || !body.analysis || !body.selectedConcept) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 선택된 콘셉트가 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const productCodes = extractProductCodes({ input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });

    const result = await createStructuredJson<{ slides: SlideOutline[] }>({
      schemaName: 'proposal_outline',
      schema: outlineJsonSchema,
      system: [
        '너는 한국어 전시/브랜드 체험관 제안서 전체 구조를 설계하는 크리에이티브 디렉터다.',
        '이 단계는 제안 생성 단계의 아웃라인 설계다. RFP 요약이나 확인 필요 장표가 아니라 실제 제안 내용을 담을 20~40장 슬라이드 구조를 만든다.',
        '기본 흐름은 Cover, Project Understanding, Key Challenge, Experience Strategy, Core Concept, Key Experience Asset Concept, Visitor Journey, Spatial / Content Plan 복수 장표, Media / Interactive Plan 복수 장표, Viral / Communication Mechanism, Operation Plan, Expected Effect, Closing이다.',
        'RFP 성격에 맞게 슬라이드 제목은 자동 조정하라. 예: 폴더블 제품별 체험 저니, 기업 홍보관 비전 전달 공간, 팝업 포토/바이럴 구조, 미디어 전시 몰입형 시나리오, 의전시설 VIP 동선.',
        '사용자가 이미 선택한 콘셉트만 기준으로 구조를 설계하라. Concept Candidates, 콘셉트 후보 3안 비교, 3개 콘셉트 비교표, 선택되지 않은 콘셉트 설명, 내부 평가 점수표 장표는 최종 제안서 구조에 절대 포함하지 말라. 대신 Concept Development Logic과 Selected Concept Rationale 장표를 포함하고, 선택된 콘셉트가 필연적으로 도출된 논리와 실행 연결을 보여줘라. 고정 제목 “Monument Design Concept”은 사용하지 말라.',
        '제안서 구조와 제품/콘텐츠/체험 단위 추출은 analysis.taskSections[].requiredDeliverables를 최우선 기준으로 삼고 analysis.requiredScope와 analysis.productInfo를 기준으로만 한다. analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets에 들어간 항목은 Product Experience Detail, 독립 체험 장표, 신규 모듈 장표로 만들지 말라.',
        'referenceOnly가 있으면 Reference Insight 또는 Design Reference Direction 장표를 선택적으로 포함해 referenceName, referenceType, whatToLearn, howToApply, caution 관점으로 정리하라. 단, 이 장표는 참고 사례를 과업으로 오해하지 않도록 “참고 방향/레퍼런스 인사이트”로 표현하라.',
        'FF7 모뉴먼트, S26 쇼케이스, 기존 슈퍼스테디, 뉴페이스셀피, 기존 게임사 팝업, 기존 러닝/야구 스튜디오 같은 referenceOnly/doNotTreatAsScope 항목을 FF7 체험 상세, S26 체험 상세, C2 체험 상세 같은 장표로 생성하지 말라.',
        'Key Experience Asset은 프로젝트를 대표하는 1~3개 핵심 체험 자산만 압축해 보여주는 장표로 설계하라. 일반 assetType 후보 목록을 나열하지 말고, 각 자산의 이름/역할/방문객 행동/작동 방식/공간 배치/결과물을 중심으로 구성하라.',
        '모뉴먼트가 RFP에 명시되지 않았다면 Monument를 핵심 자산으로 고정하지 말라.',
        '확인 필요 사항은 confirmNeededNote에만 작게 넣고 slideTitle, slidePurpose, keyMessage의 중심은 실제 제안 내용으로 구성하라.',
        '근거 없는 정량 효과 예측을 금지한다. KPI/Expected Effect 장표에는 analysis.numericInfo.targetKPI로 명확히 분류된 목표 KPI만 수치 목표로 사용하라. analysis.numericInfo.pastPerformance, lessonLearned, referenceMetric 수치는 목표처럼 표현하지 말고 Project Understanding, Key Challenge, Reference Insight의 배경/문제/인사이트 맥락으로만 사용하라. targetKPI가 비어 있으면 임의 수치를 만들지 말고 측정 항목 제안 장표로 구성하라.',
        'Spatial / Content Plan은 절대 1장으로 요약하지 말고 최소 5장(Spatial Overview, Main Experience Image, 실제 체험명 기반 상세 장표, Experience Scenario)으로 구성하라. 동일 제품/동일 체험 상세 장표는 중복 생성하지 말고 제품당 1~2장으로 제한하라. Q8/H8/B8처럼 복수 제품이 있으면 제품별 상세 장표가 균형 있게 나오도록 배치하라. 같은 제품의 상세 장표가 여러 개 필요할 때는 Q8 체험 개요, Q8 체험 시나리오처럼 역할을 명확히 분리하라.',
        'Media / Interactive Plan은 절대 1장으로 요약하지 말고 최소 5장(Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share)으로 구성하라. 미디어/인터랙션 요소가 많으면 핵심 체험 자산별 상세 장표를 추가하라.',
        '공간 구성과 콘텐츠 구성을 한 장에 뭉뚱그리지 말고 핵심 체험 단위별로 분리하라.',
        'RFP나 분석 결과의 taskSections.requiredDeliverables/requiredScope/productInfo에 제품/서비스 단위가 있으면 그 단위별 Product Experience Detail 장표를 포함하되, “제작”, “개발”, “운영”, “구성”, “기획”, “제안” 같은 과업/업무 범위 표현은 체험 콘텐츠명으로 사용하지 말라. 체험 상세 장표는 방문객 행동, 시스템 반응, 결과물이 명확한 콘텐츠만 생성한다. referenceOnly/doNotTreatAsScope/existingAssets에서만 감지된 참고 사례, 기존 캠페인, 레슨런드 항목은 제품별 체험 상세 장표로 만들지 말라. 포괄적인 “폴더블 갤럭시 체험존” 대신 대화면 멀티태스킹 체험, 미디어 최적화 폼팩터 체험, 전면 디스플레이 셀피 체험처럼 방문객 행동 중심의 구체 제목을 사용하라.',
        'slideNumber는 1부터 순서대로 부여하라. 각 슬라이드에는 사용자가 수정할 수 있는 mainCopy를 포함하고, mainCopy에는 해당 장표의 본문 방향 또는 대표 제안서 문장을 1~2문장으로 작성하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
유형별 구조 가이드: ${styleGuides[body.input.proposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

분석 결과 JSON:
${JSON.stringify(body.analysis, null, 2)}

컨셉 도출 로직 JSON:
${JSON.stringify(body.conceptDevelopmentLogic ?? null, null, 2)}

선택된 콘셉트 JSON:
${JSON.stringify(body.selectedConcept, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}
- 감지된 제품/콘텐츠 코드: ${productCodes.length ? productCodes.join(' / ') : '없음'}`,
    });

    return NextResponse.json(removeInternalConceptComparisonSlides(expandExperiencePlanOutline(result.slides, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic })));
  } catch (error) {
    const message = error instanceof Error ? error.message : '아웃라인 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
