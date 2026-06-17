import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandExperienceMatrixItem, ConceptCandidate, ConceptDevelopmentLogic, ConceptNameOptionsResult, EntityDifferentiationItem, MatrixType, ProjectInput, ProposalNarrative } from '@/lib/types';
import { createStructuredJson } from '@/lib/openai';
import { getActiveMatrix, sanitizeConceptContextByRfpType } from '@/lib/conceptContextSanitizer';

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
      koreanSubtitle: /[A-Za-z]/.test(conceptName) ? compact(thesis, 42) : '',
      oneLineSlogan: compact(direction.conceptLeap?.corePromise || thesis, 80),
      shortMeaning: compact(thesis, 90),
      whyItFitsRfp: compact(direction.conceptLeap?.conceptLeap || direction.signatureProofIdea?.whyThisProvesTheConcept || thesis, 160),
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
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; proposalNarrative?: ProposalNarrative; conceptDevelopmentLogic?: ConceptDevelopmentLogic; entityDifferentiationMatrix?: EntityDifferentiationItem[]; relevantMatrix?: unknown; brandExperienceMatrix?: BrandExperienceMatrixItem[]; matrixType?: MatrixType; languageMode?: string };
    if (!body.input || !body.analysis || !body.selectedDirection) return json({ error: '프로젝트 입력값, 분석 결과, 선택한 전략 방향이 필요합니다.' }, { status: 400 });

    const sanitizedContext = sanitizeConceptContextByRfpType({
      primaryRfpConceptType: body.selectedDirection.rfpConceptType || body.analysis.primaryRfpConceptType || 'unknown',
      rawPrimaryRfpConceptType: body.analysis.primaryRfpConceptType,
      matrixType: body.matrixType ?? body.analysis.matrixType,
      rawMatrixType: body.matrixType ?? body.analysis.matrixType,
      entityDifferentiationMatrix: body.entityDifferentiationMatrix,
      brandExperienceMatrix: body.brandExperienceMatrix ?? (body.matrixType === 'brandExperienceMatrix' ? body.relevantMatrix as BrandExperienceMatrixItem[] : undefined),
    });
    const activeMatrix = getActiveMatrix(sanitizedContext) ?? body.relevantMatrix ?? null;

    const system = [
      'You are a senior Korean proposal concept naming director.',
      'Generate final cover-level concept name options only after a strategic direction has been selected.',
      'Return 8 to 12 diverse final concept name options for the selected direction only.',
      'Avoid product-specific, one-zone-specific, one-entity-specific, abstract noun pairs, report section titles, journey labels, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-level titles that can organize outline and PPT generation.',
    ].join('\n');

    const user = `프로젝트: ${body.input.projectName}\n클라이언트: ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
Selected secondaryRfpConceptTypes: ${body.selectedDirection.secondaryRfpConceptTypes?.join(' / ') || 'none'}
Relevant Matrix Type: ${sanitizedContext.matrixType}
Active Matrix Type: ${sanitizedContext.activeMatrixType}
Sanitizer Applied: ${sanitizedContext.sanitizerApplied}
Sanitizer Reason: ${sanitizedContext.sanitizerReason}
Selected Direction Lens: ${body.selectedDirection.strategicDirectionLabel || body.selectedDirection.strategicDirectionType}
Winning Thesis / Concept Leap / Signature Proof Idea 포함 전략 방향 JSON: ${compact(body.selectedDirection, 4500)}\nConcept Development Logic: ${compact(body.conceptDevelopmentLogic, 2600)}\nRelevant Matrix Only: ${compact(activeMatrix, 2200)}\nLanguage Mode: ${body.languageMode || 'bilingual'}\nProposal Narrative: ${compact(body.proposalNarrative, 2200)}\n\n요구사항:\n- options는 반드시 8~12개.\n- naming style을 다양화: direct strategic, metaphor-based, spatial/system-based, action-oriented, symbolic, English global title if supported, Korean title if supported, bilingual if useful.\n- 10개가 같은 단어 변형처럼 보이면 실패.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsRfp, coverTitleScore, memorabilityScore, rfpSpecificityScore, expandabilityScore, risk를 작성.\n- conceptName은 표지 제목으로 쓸 수 있어야 하며 임시 전략 방향명이 아니다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- visitor_center_or_tour는 brand world, visitor journey, process/proof, sensory experience, memory after visit에 기반하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라.
- multi_entity_pavilion만 shared pavilion identity, entity/domain role clarity, unified system logic, symbolic group presence, collaborative proof 기반 네이밍을 허용한다.`;

    const result = await createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user, timeoutMs: 18_000 });
    const options = (result.options ?? []).slice(0, 12).map((option) => ({ ...option, koreanSubtitle: option.koreanSubtitle ?? '', oneLineSlogan: option.oneLineSlogan || option.shortMeaning, whyItFitsRfp: option.whyItFitsRfp || option.whyItFits || option.shortMeaning }));
    if (options.length < 8) return json(fallbackOptions(body.selectedDirection));
    return json({ ...result, selectedDirectionId: body.selectedDirection.conceptId, options });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
