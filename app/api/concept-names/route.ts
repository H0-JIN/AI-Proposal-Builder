import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, ConceptCandidate, ConceptNameOptionsResult, ProjectInput, ProposalNarrative } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' };

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) } });
}

function compact(value: unknown, maxLength = 900) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function fallbackOptions(direction: ConceptCandidate): ConceptNameOptionsResult {
  const base = direction.strategicDirectionLabel || '전략 방향';
  const thesis = direction.winningThesisUse?.winningClaim || direction.conceptLeap?.corePromise || direction.whatThisDirectionEmphasizes || '선택 방향의 전략 명제를 제안서 표지용 이름으로 압축합니다.';
  const names = [
    `${base} 선언`, `${base} 프레임`, `${base} Proof`, `The ${base}`, `${base} Map`, `${base} Action`, `${base} Signal`, `${base} System`, `${base} Canvas`, `${base} Moment`, `${base} Blueprint`, `${base} Agenda`,
  ];
  return {
    selectedDirectionId: direction.conceptId,
    recommendedOptionIndex: 0,
    generationNote: 'AI naming generation fallback options. 사용자가 직접 보정해 최종 컨셉명으로 확정하세요.',
    options: names.slice(0, 8).map((conceptName, index) => ({
      conceptName,
      languageMode: /[A-Za-z]/.test(conceptName) ? 'bilingual' : 'Korean',
      shortMeaning: compact(thesis, 90),
      whyItFits: compact(direction.conceptLeap?.conceptLeap || direction.signatureProofIdea?.whyThisProvesTheConcept || thesis, 160),
      coverTitleScore: Math.max(6, 9 - (index % 4)),
      memorabilityScore: Math.max(6, 8 - (index % 3)),
      rfpSpecificityScore: Math.max(6, 9 - (index % 3)),
      expandabilityScore: Math.max(6, 8 - (index % 2)),
      risk: 'Fallback name이므로 추상성/섹션 제목처럼 보이는지 수동 검토가 필요합니다.',
    })),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; proposalNarrative?: ProposalNarrative };
    if (!body.input || !body.analysis || !body.selectedDirection) return json({ error: '프로젝트 입력값, 분석 결과, 선택한 전략 방향이 필요합니다.' }, { status: 400 });

    const system = [
      'You are a senior Korean proposal concept naming director.',
      'Generate final cover-level concept name options only after a strategic direction has been selected.',
      'Return 8 to 12 diverse final concept name options for the selected direction only.',
      'Avoid product-specific, one-zone-specific, one-entity-specific, abstract noun pairs, report section titles, journey labels, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-level titles that can organize outline and PPT generation.',
    ].join('\n');

    const user = `프로젝트: ${body.input.projectName}\n클라이언트: ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nProposal Narrative: ${compact(body.proposalNarrative, 2200)}\n선택한 전략 방향 JSON: ${compact(body.selectedDirection, 4500)}\n\n요구사항:\n- options는 반드시 8~12개.\n- naming style을 다양화: direct strategic, metaphor-based, spatial/system-based, action-oriented, symbolic, English global title if supported, Korean title if supported, bilingual if useful.\n- 10개가 같은 단어 변형처럼 보이면 실패.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), shortMeaning, whyItFits, coverTitleScore, memorabilityScore, rfpSpecificityScore, expandabilityScore, risk를 작성.\n- conceptName은 표지 제목으로 쓸 수 있어야 하며 임시 전략 방향명이 아니다.\n- final slogan 후보는 whyItFits/shortMeaning에서 유추 가능하게 쓰되, conceptName에 슬로건 문장을 넣지 말라.`;

    const result = await createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user, timeoutMs: 18_000 });
    const options = (result.options ?? []).slice(0, 12);
    if (options.length < 8) return json(fallbackOptions(body.selectedDirection));
    return json({ ...result, selectedDirectionId: body.selectedDirection.conceptId, options });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
