import { NextResponse } from 'next/server';
import { brandProductIntelligenceJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandProductIntelligence, ProjectInput, RfpDiagnosis, UploadedDocument } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';

export const dynamic = 'force-dynamic';

function compact(value: unknown, max = 9000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...truncated` : text;
}

function brandMaterialSummary(documents: UploadedDocument[] = []) {
  return documents
    .filter((doc) => doc.documentRole === 'reference' || doc.documentRole === 'memo')
    .map((doc) => ({ fileName: doc.fileName, role: doc.documentRole, text: (doc.documentAnalysisText || doc.extractedText || '').slice(0, 1800) }))
    .filter((doc) => doc.text.trim())
    .slice(0, 6);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; rfpDiagnosis: RfpDiagnosis; uploadedDocuments?: UploadedDocument[]; additionalInfo?: unknown };
    if (!body.input || !body.analysis || !body.rfpDiagnosis) return NextResponse.json({ error: 'RFP 분석과 확정된 승부처 진단이 필요합니다.' }, { status: 400 });
    const materials = brandMaterialSummary(body.uploadedDocuments);
    const result = await createStructuredJson<BrandProductIntelligence>({
      schemaName: 'brand_product_intelligence',
      schema: brandProductIntelligenceJsonSchema,
      system: [
        '너는 제안 전략을 위한 브랜드/제품 인텔리전스 편집자다.',
        'RFP-only diagnosis 이후, 전략 방향 생성 이전에 별도 브랜드/제품/카테고리 이해 레이어를 만든다.',
        '사용 가능: current RFP analysis, current RFP text, confirmed diagnosis, user-provided additional information, uploaded brand/product/reference materials.',
        '절대 사용 금지: proposal_patterns, previous proposals, old proposal content, previous concept names, old project language, old client names, won/lost outcomes.',
        '외부 기업/제품 조사는 아직 연결되지 않았다. 웹 조사나 출처 확인을 한 것처럼 쓰지 말라.',
        '자료가 부족해 RFP에서 추론한 내용은 문장 안에 “AI 보완”을 붙여 사용자가 편집할 수 있게 표시한다.',
        '수소/에너지/미래 기술 전시는 대표성, 시스템, 기술 현실감, 공공성, 몰입, 리더십, 신뢰/검토 중심 톤을 우선하고, RFP 근거 없는 음료/신체감각형 표현을 피한다.',
        '방문자룸/공장견학/음료 브랜드형 RFP는 감각, 교육, 청결, 신뢰, 신체적 체감, 프로세스 톤을 허용하되 국가관/에너지 전환/시스템 지배 언어를 피한다.',
      ].join('\n'),
      user: `Current RFP text: ${body.input.briefText}\nCurrent RFP analysis: ${compact(body.analysis, 6000)}\nConfirmed RFP-only Diagnosis: ${compact(body.rfpDiagnosis, 2200)}\nUser additional information: ${compact(body.additionalInfo ?? {}, 1200)}\nUploaded brand/product/reference materials: ${materials.length ? compact(materials, 6000) : '없음 - RFP 기준으로만 AI 보완 표시'}`,
      timeoutMs: 12_000,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '브랜드/제품 이해 생성 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
