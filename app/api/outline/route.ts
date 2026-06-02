import { NextResponse } from 'next/server';
import { outlineJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptDevelopmentLogic, ProjectInput, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline, extractProductCodes } from '@/lib/experiencePlan';
import { removeInternalConceptComparisonSlides } from '@/lib/internalSlides';
import { ensureRfpRequirementCoverage } from '@/lib/rfpRequirements';

const styleGuides = {
  basic: '프로젝트 이해, 과제 정의, 경험 전략, 콘셉트, 공간/콘텐츠 구성, 운영 및 기대 효과가 이어지는 기본형 구조.',
  cheil: '브랜드 과제, 소비자 인사이트, 경험 전략, 캠페인형 공간 아이디어, 확산/바이럴 포인트, 실행 계획을 강조하는 제일기획형 구조.',
  innocean: '브랜드/제품 맥락, 타깃 행동 분석, 체험 시나리오, 공간/미디어 연출, 운영 및 실행 가능성을 강조하는 이노션형 구조.',
  hyundai: '기업 비전, 기술/사업 가치, 신뢰감 있는 체험 구조, 공간/콘텐츠 전달 방식, 의전/운영 고려사항을 강조하는 현대차그룹형 구조.',
  mice_event_operation: '행사 목적, 운영 전략, 프로그램/등록/부스/케이터링/시스템/인력/리스크/설치·철거/견적 대응을 강조하는 MICE 행사 운영형 구조.',
  conference_forum: '컨퍼런스 아젠다, 세션/연사/발표 시스템, 등록/네트워킹/파트너 부스, 현장 운영, 의전, 리스크 관리와 성과를 강조하는 포럼형 구조.',
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
    const effectiveProposalType = body.analysis.inferredProposalType ?? body.input.proposalType;
    const isEventOperationType = effectiveProposalType === 'mice_event_operation' || effectiveProposalType === 'conference_forum';

    const result = await createStructuredJson<{ slides: SlideOutline[] }>({
      schemaName: 'proposal_outline',
      schema: outlineJsonSchema,
      system: [
        '너는 한국어 제안서 전체 구조를 설계하는 크리에이티브 디렉터다. 전시/브랜드 체험관과 MICE/컨퍼런스 운영 제안서를 RFP 유형에 따라 구분한다.',
        '이 단계는 제안 생성 단계의 아웃라인 설계다. RFP 요약이나 확인 필요 장표가 아니라 실제 제안 내용을 담을 20~40장 슬라이드 구조를 만든다.',
        isEventOperationType ? 'MICE/컨퍼런스 운영형 기본 흐름은 Cover, Project Understanding, Strategic Approach, Event Identity, Program Overview, Operation Framework, Registration & Entry Plan, Session System Operation, Partner Pavilion Plan, Networking / Catering Plan, Moving Line Plan, Setup / Conversion Plan, Staffing Plan, Risk Management, Schedule, Budget Summary, Portfolio / Organization, Closing이다.' : '기본 흐름은 Cover, Project Understanding, Key Challenge, Experience Strategy, Core Concept, Key Experience Asset Concept, Visitor Journey, Spatial / Content Plan 복수 장표, Media / Interactive Plan 복수 장표, Viral / Communication Mechanism, Operation Plan, Expected Effect, Closing이다.',
        'RFP 성격에 맞게 슬라이드 제목은 자동 조정하라. 예: 폴더블 제품별 체험 저니, 기업 홍보관 비전 전달 공간, 팝업 포토/바이럴 구조, 미디어 전시 몰입형 시나리오, 의전시설 VIP 동선.',
        isEventOperationType ? '사용자가 이미 선택한 콘셉트만 기준으로 구조를 설계하라. Concept Candidates, 후보 비교, 내부 평가 점수표는 절대 포함하지 말라. 행사 운영형에서는 Experience Structure, Main Experience Image, Key Experience Asset, Visitor Action, Interactive Flow, Content Mechanism, Output & Share, Viral Communication Strategy, Media Experience Overview, Key Media Scene, Photo / Viral Spot, Hands-on Demo 장표를 기본 생성하지 말고 Strategic Approach, Event Identity, Program Overview, Operation Framework 등 운영형 장표로 대체하라. “선택된 콘셉트”, “콘셉트 후보”, “후보 비교”, “C1 / C2 / C3”, “추천 콘셉트” 표현은 쓰지 말라.' : '사용자가 이미 선택한 콘셉트만 기준으로 구조를 설계하라. Concept Candidates, 콘셉트 후보 3안 비교, 3개 콘셉트 비교표, 선택되지 않은 콘셉트 설명, 내부 평가 점수표 장표는 최종 제안서 구조에 절대 포함하지 말라. 대신 Experience Approach, Core Concept, Experience Structure 장표를 이 순서로 포함하고, 핵심 과제를 해결하기 위한 경험 접근과 핵심 콘셉트의 필연성, 공간·콘텐츠·미디어·공유 구조로의 확장을 제안서 톤으로 보여줘라. “선택된 콘셉트”, “콘셉트 후보”, “콘셉트 도출 과정”, “후보 비교”, “C1 / C2 / C3”, “추천 콘셉트”, 고정 제목 “Monument Design Concept”은 최종 제안서 장표 제목이나 본문에 사용하지 말라.',
        'proposalType별 템플릿보다 analysis.requiredDeliverables와 analysis.scopeOfWork가 우선이다. 제안서 구조와 제품/콘텐츠/체험 단위 추출은 analysis.requiredDeliverables 및 analysis.taskSections[].requiredDeliverables를 최우선 기준으로 삼고 analysis.scopeOfWork, analysis.requiredScope, analysis.productInfo를 기준으로만 한다. analysis.referenceOnly, analysis.doNotTreatAsScope, analysis.existingAssets에 들어간 항목은 Product Experience Detail, 독립 체험 장표, 신규 모듈 장표로 만들지 말라.',
        '최종 PPT 구조 생성 전에 RFP Requirement Coverage Check를 수행한다고 가정하고 requirement, sourceCategory(requiredDeliverables/scopeOfWork/evaluationCriteria/constraints), mappedSlideTitle, coverageStatus, note 관점으로 모든 1순위/2순위 요구사항을 점검하라.',
        'analysis.requiredDeliverables와 analysis.scopeOfWork는 우선 RFP Requirement Response / 과업 대응표 1~2장 및 관련 본문 섹션에 매핑하라. 각 항목을 Required Deliverable Response 또는 Scope Response 단독 장표로 무조건 생성하지 말고, 중요도가 높은 항목만 본문 장표로 확장하며 나머지는 과업 대응표 row로 처리하라.',
        'analysis.scopeOfWork의 주요 과업 범위도 반드시 반영하라. 단순 요약으로 끝내지 말고 운영 계획, 제작 범위, 공간 구성, 시스템 계획, 일정, 예산, 인력 운영 중 적절한 장표에서 실행 계획 또는 대응 방향으로 변환하라. 과업 범위가 많으면 Scope Response Matrix 또는 RFP Requirement Response / 과업 대응표 장표를 포함하라.',
        'requiredDeliverables 또는 scopeOfWork에 누락이 있으면 먼저 기존 장표의 mainCopy 또는 confirmNeededNote에 매핑하고, 불가능한 경우에만 Portfolio / Organization, Budget & Scope, System / Equipment, Setup / Dismantling, Content Production, Hospitality / Reception, Compliance / Exclusions 등 유사 항목 보완 섹션으로 묶어 생성하라.',
        'referenceOnly가 있으면 Reference Insight 또는 Design Reference Direction 장표를 선택적으로 포함해 referenceName, referenceType, whatToLearn, howToApply, caution 관점으로 정리하라. 단, 이 장표는 참고 사례를 과업으로 오해하지 않도록 “참고 방향/레퍼런스 인사이트”로 표현하라.',
        'FF7 모뉴먼트, S26 쇼케이스, 기존 슈퍼스테디, 뉴페이스셀피, 기존 게임사 팝업, 기존 러닝/야구 스튜디오 같은 referenceOnly/doNotTreatAsScope 항목을 FF7 체험 상세, S26 체험 상세, C2 체험 상세 같은 장표로 생성하지 말라.',
        'Key Experience Asset은 프로젝트를 대표하는 1~3개 핵심 체험 자산만 압축해 보여주는 장표로 설계하라. 일반 assetType 후보 목록을 나열하지 말고, 각 자산의 이름/역할/방문객 행동/작동 방식/공간 배치/결과물을 중심으로 구성하라.',
        '모뉴먼트가 RFP에 명시되지 않았다면 Monument를 핵심 자산으로 고정하지 말라.',
        '확인 필요 사항은 confirmNeededNote에만 작게 넣고 slideTitle, slidePurpose, keyMessage의 중심은 실제 제안 내용으로 구성하라.',
        '근거 없는 정량 효과 예측을 금지한다. KPI/Expected Effect 장표에는 analysis.numericInfo.targetKPI로 명확히 분류된 목표 KPI만 수치 목표로 사용하라. analysis.numericInfo.pastPerformance, lessonLearned, referenceMetric 수치는 목표처럼 표현하지 말고 Project Understanding, Key Challenge, Reference Insight의 배경/문제/인사이트 맥락으로만 사용하라. targetKPI가 비어 있으면 임의 수치를 만들지 말고 측정 항목 제안 장표로 구성하라.',
        isEventOperationType ? '행사 운영형에서는 Spatial / Content Plan, Main Experience Image, Media / Interactive Plan, Interactive Flow, Content Mechanism 등 체험관형 장표를 생성하지 말고 프로그램/등록/세션/부스/네트워킹/동선/설치전환/인력/리스크/예산 중심으로 구성하라.' : 'Spatial / Content Plan은 절대 1장으로 요약하지 말고 최소 5장(Spatial Overview, Main Experience Image, 실제 체험명 기반 상세 장표, Experience Scenario)으로 구성하라. 동일 제품/동일 체험 상세 장표는 중복 생성하지 말고 제품당 1~2장으로 제한하라. Q8/H8/B8처럼 복수 제품이 있으면 제품별 상세 장표가 균형 있게 나오도록 배치하고, 포괄적인 폴더블 갤럭시 제품 체험 모듈 하나로 병합하지 말라. 같은 제품의 상세 장표가 여러 개 필요할 때는 Q8 체험 개요, Q8 체험 시나리오처럼 역할을 명확히 분리하라.',
        isEventOperationType ? '행사 운영형의 성과 장표는 운영 품질 관리 지표와 측정 체계를 중심으로 구성하고 체험 산출/공유 장표로 대체하지 말라.' : 'Media / Interactive Plan은 절대 1장으로 요약하지 말고 최소 5장(Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share)으로 구성하라. Content Mechanism과 콘텐츠 작동 원리 및 메커니즘처럼 같은 의미의 장표를 중복 생성하지 말라. 미디어/인터랙션 요소가 많으면 핵심 체험 자산별 상세 장표를 추가하라.',
        '공간 구성과 콘텐츠 구성을 한 장에 뭉뚱그리지 말고 핵심 체험 단위별로 분리하라.',
        'RFP나 분석 결과의 taskSections.requiredDeliverables/requiredScope/productInfo에 제품/서비스 단위가 있으면 그 단위별 Product Experience Detail 장표를 포함하되, “제작”, “개발”, “운영”, “구성”, “기획”, “제안” 같은 과업/업무 범위 표현은 체험 콘텐츠명으로 사용하지 말라. 체험 상세 장표는 방문객 행동, 시스템 반응, 결과물이 명확한 콘텐츠만 생성한다. referenceOnly/doNotTreatAsScope/existingAssets에서만 감지된 참고 사례, 기존 캠페인, 레슨런드 항목은 제품별 체험 상세 장표로 만들지 말라. 포괄적인 “폴더블 갤럭시 체험존” 대신 대화면 멀티태스킹 체험, 미디어 최적화 폼팩터 체험, 전면 디스플레이 셀피 체험처럼 방문객 행동 중심의 구체 제목을 사용하라.',
        'slideNumber는 1부터 순서대로 부여하라. 각 슬라이드에는 사용자가 수정할 수 있는 mainCopy를 포함하고, mainCopy에는 해당 장표의 본문 방향 또는 대표 제안서 문장을 1~2문장으로 작성하라.',
      ].join('\n'),
      user: `사용자 선택 제안서 유형: ${proposalTypeLabels[body.input.proposalType]}
RFP 분석 기반 유형: ${proposalTypeLabels[effectiveProposalType]}
유형별 구조 가이드: ${styleGuides[effectiveProposalType]}
프로젝트명: ${body.input.projectName}
클라이언트명: ${body.input.clientName}

분석 결과 JSON:
${JSON.stringify(body.analysis, null, 2)}

경험 접근 로직 JSON:
${JSON.stringify(body.conceptDevelopmentLogic ?? null, null, 2)}

핵심 콘셉트 JSON:
${JSON.stringify(body.selectedConcept, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}
- 감지된 제품/콘텐츠 코드: ${productCodes.length ? productCodes.join(' / ') : '없음'}`,
    });

    const expandedSlides = expandExperiencePlanOutline(result.slides, { input: body.input, analysis: body.analysis, selectedConcept: body.selectedConcept, conceptDevelopmentLogic: body.conceptDevelopmentLogic });
    const coverageCheckedSlides = ensureRfpRequirementCoverage(removeInternalConceptComparisonSlides(expandedSlides), body.analysis);

    return NextResponse.json(coverageCheckedSlides);
  } catch (error) {
    const message = error instanceof Error ? error.message : '아웃라인 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
