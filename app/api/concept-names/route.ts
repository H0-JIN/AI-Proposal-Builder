import { NextResponse } from 'next/server';
import { conceptNameOptionsJsonSchema } from '@/lib/schemas';
import type { AnalysisResult, BrandExperienceMatrixItem, ConceptCandidate, ConceptDevelopmentLogic, ConceptNameOptionsResult, EntityDifferentiationItem, MatrixType, ProjectInput, ProposalNarrative, RfpDiagnosis } from '@/lib/types';
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

function successResponse(result: ConceptNameOptionsResult) {
  return { ok: true, nameOptions: result.options, ...result };
}

function errorResponse(error: string, details?: string) {
  return { ok: false, error, ...(details ? { details } : {}) };
}

function fallbackOptions(direction: ConceptCandidate): ConceptNameOptionsResult {
  const type = direction.rfpConceptType || 'unknown';
  const base = direction.strategicDirectionLabel || direction.directionLabel || direction.proposalCoreConceptName || direction.conceptName || '전략 방향';
  const thesis = direction.winningThesisUse?.winningClaim || direction.conceptLeap?.corePromise || direction.whatThisDirectionEmphasizes || '선택 방향의 전략 명제를 제안서 표지용 이름으로 압축합니다.';
  const visitorNames = ['현실 증명', '체감 전환', '신뢰 장면화', '기억의 구조', '가치의 현장', '판단의 순간', '현재화된 미래', '확신의 장면'];
  const names = type === 'multi_entity_pavilion'
    ? ['대표성 각인', '관계의 구조화', '압도적 증명', '공동의 장면', '도메인의 지도', '신뢰 장면화', 'The Proof Field', 'Shared Front']
    : visitorNames;
  return {
    selectedDirectionId: direction.conceptId,
    recommendedOptionIndex: 0,
    generationNote: 'AI naming generation fallback options. 사용자가 직접 보정해 최종 컨셉명으로 확정하세요.',
    options: names.slice(0, 8).map((conceptName, index) => ({
      id: `${direction.conceptId || 'direction'}-fallback-${index + 1}`,
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
      namingStyle: (['Direct strategic', 'Brand / sensory', 'Spatial / system', 'Symbolic', 'Global English / bilingual'] as const)[index % 5],
      mainRisk: 'Fallback 후보라서 RFP 고유 표현으로 한 번 더 다듬어야 합니다.',
    })),
  };
}

export async function POST(request: Request) {
  let parsedBody: { selectedDirection?: ConceptCandidate } | null = null;
  try {
    const body = (await request.json()) as { input: ProjectInput; analysis: AnalysisResult; selectedDirection: ConceptCandidate; proposalNarrative?: ProposalNarrative; conceptDevelopmentLogic?: ConceptDevelopmentLogic; entityDifferentiationMatrix?: EntityDifferentiationItem[]; relevantMatrix?: unknown; activeMatrix?: unknown; brandExperienceMatrix?: BrandExperienceMatrixItem[]; matrixType?: MatrixType; primaryRfpConceptType?: string; languageMode?: string; rfpDiagnosis?: RfpDiagnosis };
    parsedBody = body;
    if (!body.input || !body.analysis || !body.selectedDirection) return json(errorResponse('프로젝트 입력값, 분석 결과, 선택한 전략 방향이 필요합니다.'), { status: 400 });

    const sanitizedContext = sanitizeConceptContextByRfpType({
      primaryRfpConceptType: body.selectedDirection.rfpConceptType || body.primaryRfpConceptType || body.analysis.primaryRfpConceptType || 'unknown',
      rawPrimaryRfpConceptType: body.analysis.primaryRfpConceptType,
      matrixType: body.matrixType ?? body.analysis.matrixType,
      rawMatrixType: body.matrixType ?? body.analysis.matrixType,
      entityDifferentiationMatrix: body.entityDifferentiationMatrix,
      brandExperienceMatrix: body.brandExperienceMatrix ?? (body.matrixType === 'brandExperienceMatrix' ? (body.activeMatrix ?? body.relevantMatrix) as BrandExperienceMatrixItem[] : undefined),
    });
    const activeMatrix = body.activeMatrix ?? getActiveMatrix(sanitizedContext) ?? body.relevantMatrix ?? null;
    const currentRfpOnlyMode = true; // final naming context = selected direction + confirmed diagnosis + current RFP only; proposal_patterns are not allowed.

    const system = [
      'You are a senior Korean proposal concept naming director.',
      'Generate final cover-level concept name options only after a strategic direction has been selected.',
      'Return 8 to 12 diverse final concept name options for the selected direction only, grouped by namingStyle.',
      'Avoid consulting labels, analysis headings, internal strategy phrases, generic abstract nouns, awkward translated phrases, product-specific names, one-zone-specific names, one-entity-specific names, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-cover concepts that express the winning claim and can expand into space, content, media, and operation.',
      'Derive names from coreWinningCondition, strategicTension, proofBurden, selected strategic direction, and signatureProofIdea—not generic category words, random English nouns, internal strategy labels, product names, or proposal_patterns.',
      'Use only selected strategic direction, confirmed diagnosis, and current RFP analysis. Do not use proposal_patterns, previous proposal names, old clients/categories, WDS/pavilion wording, won/lost outcomes, old slogans, or old structures.',
    ].join('\n');

    const user = `프로젝트: ${body.input.projectName}\n클라이언트: ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
Selected secondaryRfpConceptTypes: ${body.selectedDirection.secondaryRfpConceptTypes?.join(' / ') || 'none'}
Relevant Matrix Type: ${sanitizedContext.matrixType}
Active Matrix Type: ${sanitizedContext.activeMatrixType}
Sanitizer Applied: ${sanitizedContext.sanitizerApplied}
Sanitizer Reason: ${sanitizedContext.sanitizerReason}
Selected Direction Lens: ${body.selectedDirection.strategicDirectionLabel || body.selectedDirection.directionLabel || body.selectedDirection.strategicDirectionType}
Confirmed RFP-only Diagnosis: ${compact(body.rfpDiagnosis, 2200)}
Selected Strategic Direction Basis: ${compact({ winningThesis: body.selectedDirection.winningThesisUse, conceptLeap: body.selectedDirection.conceptLeap, signatureProofIdea: body.selectedDirection.signatureProofIdea, whatThisDirectionEmphasizes: body.selectedDirection.whatThisDirectionEmphasizes, rfpGrounding: body.selectedDirection.rfpGrounding }, 2200)}
Winning Thesis / Concept Leap / Signature Proof Idea 포함 전략 방향 JSON: ${compact(body.selectedDirection, 4500)}\nConcept Development Logic: ${compact(body.conceptDevelopmentLogic, 2600)}\nRelevant Matrix Only: ${compact(activeMatrix, 2200)}\nLanguage Mode: ${body.languageMode || 'bilingual'}\nProposal Narrative: ${compact(body.proposalNarrative, 2200)}\n\n요구사항:\n- options는 반드시 8~12개.\n- namingStyle 필드를 반드시 다음 중 하나로 작성하고 8~12개를 style 그룹별로 다양화: Direct strategic, Brand / sensory, Spatial / system, Symbolic, Global English / bilingual.\n- 10개가 같은 단어 변형처럼 보이면 실패.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsRfp, namingStyle, mainRisk, coverTitleScore, memorabilityScore, rfpSpecificityScore, expandabilityScore, risk를 작성.\n- conceptName은 제안서 표지 제목처럼 winning claim을 표현해야 하며 브랜드 경험 콘셉트, 전시 콘셉트, 공간 경험 프레임으로 확장 가능해야 한다. 임시 전략 방향명/컨설팅 목차명/단순 제품명/랜덤 영어 명사 조합이 아니다.
- 각 option의 oneLineSlogan은 conceptName이 주장하는 승리 논리를 1문장으로 설명한다. whyItFitsRfp는 confirmed diagnosis의 coreWinningCondition, strategicTension, proofBurden, selected direction, signatureProofIdea 중 최소 2개와 연결한다.
- generic English word combinations, vague abstract nouns, consulting-style labels, literal RFP summaries, any-name-fits-any-exhibition 후보를 거부하고 재생성한다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- Final naming source lock: selectedStrategicDirection, confirmed diagnosis, current RFP summary만 네이밍 근거로 사용하라. proposal_patterns, previous proposal names, old clients/categories/wording은 사용하지 말라. hardcoded direction presets는 사용하지 말라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- single_brand_experience 또는 visitor_center_or_tour는 brand meaning, sensory cue, product value, process/proof, visitor memory, transformation after visit에서 이름을 도출하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라.
- multi_entity_pavilion만 shared pavilion frame, entity/domain relationship, system logic, capability proof, symbolic presence 기반 네이밍을 허용한다.`;

    const result = await createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user, timeoutMs: 18_000 });
    const styles = ['Direct strategic', 'Brand / sensory', 'Spatial / system', 'Symbolic', 'Global English / bilingual'] as const;
    const options = (result.options ?? []).slice(0, 12).map((option, index) => ({ ...option, id: option.id || `${body.selectedDirection.conceptId || 'direction'}-name-${index + 1}`, koreanSubtitle: option.koreanSubtitle ?? '', oneLineSlogan: option.oneLineSlogan || option.shortMeaning, whyItFitsRfp: option.whyItFitsRfp || option.whyItFits || option.shortMeaning, namingStyle: option.namingStyle ?? styles[index % styles.length], mainRisk: option.mainRisk || option.risk }));
    const normalized = { ...result, selectedDirectionId: body.selectedDirection.conceptId, options };
    if (options.length < 8) return json(successResponse(fallbackOptions(body.selectedDirection)));
    return json(successResponse(normalized));
  } catch (error) {
    const message = error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.';
    const fallbackDirection = { conceptId: 'fallback-direction', rfpConceptType: 'single_brand_experience', strategicDirectionLabel: '브랜드 경험 방향' } as ConceptCandidate;
    try {
      return json({ ...successResponse(fallbackOptions(parsedBody?.selectedDirection ?? fallbackDirection)), warning: message, fallbackError: errorResponse('LLM/API 호출 실패로 fallback 컨셉명을 반환했습니다.', message) });
    } catch {
      return json({ ...successResponse(fallbackOptions(fallbackDirection)), warning: message, fallbackError: errorResponse('LLM/API 호출 실패로 fallback 컨셉명을 반환했습니다.', message) });
    }
  }
}
