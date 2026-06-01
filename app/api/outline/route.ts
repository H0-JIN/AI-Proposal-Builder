import { NextResponse } from 'next/server';
import { outlineJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ProjectInput, SlideOutline } from '@/lib/types';
import { proposalTypeLabels } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { assessInputQuality } from '@/lib/inputQuality';
import { expandExperiencePlanOutline } from '@/lib/experiencePlan';

const styleGuides = {
  basic: '프로젝트 이해, 과제 정의, 경험 전략, 콘셉트, 공간/콘텐츠 구성, 운영 및 기대 효과가 이어지는 기본형 구조.',
  cheil: '브랜드 과제, 소비자 인사이트, 경험 전략, 캠페인형 공간 아이디어, 확산/바이럴 포인트, 실행 계획을 강조하는 제일기획형 구조.',
  innocean: '브랜드/제품 맥락, 타깃 행동 분석, 체험 시나리오, 공간/미디어 연출, 운영 및 실행 가능성을 강조하는 이노션형 구조.',
  hyundai: '기업 비전, 기술/사업 가치, 신뢰감 있는 체험 구조, 공간/콘텐츠 전달 방식, 의전/운영 고려사항을 강조하는 현대차그룹형 구조.',
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedConcept: ConceptCandidate };

    if (!body.input || !body.analysis || !body.selectedConcept) {
      return NextResponse.json({ error: '프로젝트 입력값, 분석 결과, 선택된 콘셉트가 필요합니다.' }, { status: 400 });
    }

    const inputQuality = assessInputQuality(body.input, body.analysis);
    const missingInfoSummary = inputQuality.missingItems.map((item) => `${item.label}: ${item.description}`);

    const result = await createStructuredJson<{ slides: SlideOutline[] }>({
      schemaName: 'proposal_outline',
      schema: outlineJsonSchema,
      system: [
        '너는 한국어 전시/브랜드 체험관 제안서 전체 구조를 설계하는 크리에이티브 디렉터다.',
        '이 단계는 제안 생성 단계의 아웃라인 설계다. RFP 요약이나 확인 필요 장표가 아니라 실제 제안 내용을 담을 20~40장 슬라이드 구조를 만든다.',
        '기본 흐름은 Cover, Project Understanding, Key Challenge, Experience Strategy, Core Concept, Key Experience Asset Concept, Visitor Journey, Spatial / Content Plan 복수 장표, Media / Interactive Plan 복수 장표, Viral / Communication Mechanism, Operation Plan, Expected Effect, Closing이다.',
        'RFP 성격에 맞게 슬라이드 제목은 자동 조정하라. 예: 폴더블 제품별 체험 저니, 기업 홍보관 비전 전달 공간, 팝업 포토/바이럴 구조, 미디어 전시 몰입형 시나리오, 의전시설 VIP 동선.',
        '사용자가 이미 선택한 콘셉트를 기준으로 구조를 설계하라. 후보 비교 장표를 다시 만들지 말고, 반드시 Core Concept과 Key Experience Asset Concept을 포함하라. 고정 제목 “Monument Design Concept”은 사용하지 말라.',
        'Key Experience Asset은 RFP 맥락에 따라 Spatial Zone, Interactive Experience, Media Content, Photo / Viral Spot, Product Trial Kit, Exhibition Object, Digital Signage, Operation Program, Brand Experience Module, Monument, Briefing Space, Immersive Room, Hands-on Demo, Visitor Participation Content 중 하나 또는 복수로 판단하는 장표가 되도록 설계하라.',
        '모뉴먼트가 RFP에 명시되지 않았다면 Monument를 핵심 자산으로 고정하지 말라.',
        '확인 필요 사항은 confirmNeededNote에만 작게 넣고 slideTitle, slidePurpose, keyMessage의 중심은 실제 제안 내용으로 구성하라.',
        '근거 없는 정량 효과 예측을 금지한다. RFP에 없는 수치는 Expected Effect에서 KPI 설계 방향 또는 측정 항목 제안으로만 다뤄라.',
        'Spatial / Content Plan은 절대 1장으로 요약하지 말고 최소 5장(Spatial Overview, Main Experience Image, Zone Detail 01, Zone Detail 02, Experience Scenario)으로 구성하라. RFP와 제안 내용에 핵심 체험 자산이 많으면 Zone Detail을 추가해 5장 이상으로 확장하라.',
        'Media / Interactive Plan은 절대 1장으로 요약하지 말고 최소 5장(Media Experience Overview, Key Media Scene, Interactive Flow, Content Mechanism, Output & Share)으로 구성하라. 미디어/인터랙션 요소가 많으면 핵심 체험 자산별 상세 장표를 추가하라.',
        '공간 구성과 콘텐츠 구성을 한 장에 뭉뚱그리지 말고 핵심 체험 단위별로 분리하라.',
        'slideNumber는 1부터 순서대로 부여하라.',
      ].join('\n'),
      user: `제안서 유형: ${proposalTypeLabels[body.input.proposalType]}\n유형별 구조 가이드: ${styleGuides[body.input.proposalType]}\n프로젝트명: ${body.input.projectName}\n클라이언트명: ${body.input.clientName}\n\n분석 결과 JSON:\n${JSON.stringify(body.analysis, null, 2)}\n\n선택된 콘셉트 JSON:\n${JSON.stringify(body.selectedConcept, null, 2)}

입력 품질 진단:
- 점수: ${inputQuality.score}
- 부족 항목: ${missingInfoSummary.length ? missingInfoSummary.join(' / ') : '없음'}
- AI missingInfo: ${body.analysis.missingInfo.length ? body.analysis.missingInfo.join(' / ') : '없음'}`,
    });

    return NextResponse.json(expandExperiencePlanOutline(result.slides));
  } catch (error) {
    const message = error instanceof Error ? error.message : '아웃라인 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
