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
  const type = direction.rfpConceptType || 'unknown';
  const base = direction.strategicDirectionLabel || '전략 방향';
  const thesis = direction.winningThesisUse?.winningClaim || direction.conceptLeap?.corePromise || direction.whatThisDirectionEmphasizes || '선택 방향의 전략 명제를 제안서 표지용 이름으로 압축합니다.';
  const names = type === 'multi_entity_pavilion'
    ? ['Pavilion Atlas', 'One Field, Many Signals', '공동의 장면', 'Capability Grid', 'The Shared Front', '도메인의 지도', 'Proof Pavilion', 'United Stage']
    : ['Brand Room', 'Memory Loop', 'Proof Walk', '감각의 약속', 'After Visit', 'Trust Route', 'The Taste of Proof', '기억의 방'];
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
      namingStyle: (['Direct strategic', 'Brand / sensory', 'Spatial / system', 'Symbolic', 'Global English / bilingual'] as const)[index % 5],
      mainRisk: 'Fallback 후보라서 RFP 고유 표현으로 한 번 더 다듬어야 합니다.',
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
      'Avoid consulting labels, analysis headings, internal strategy phrases, generic abstract nouns, awkward translated phrases, product-specific names, one-zone-specific names, one-entity-specific names, unsupported poetic metaphors, and generic tech/event slogans.',
      'Names must be proposal-level titles that can organize outline and PPT generation.',
    ].join('\n');

    const user = `프로젝트: ${body.input.projectName}\n클라이언트: ${body.input.clientName}\nRFP 분석 요약: ${compact(body.analysis, 5000)}\nSelected primaryRfpConceptType: ${body.selectedDirection.rfpConceptType || 'unknown'}
Selected secondaryRfpConceptTypes: ${body.selectedDirection.secondaryRfpConceptTypes?.join(' / ') || 'none'}
Relevant Matrix Type: ${sanitizedContext.matrixType}
Active Matrix Type: ${sanitizedContext.activeMatrixType}
Sanitizer Applied: ${sanitizedContext.sanitizerApplied}
Sanitizer Reason: ${sanitizedContext.sanitizerReason}
Selected Direction Lens: ${body.selectedDirection.strategicDirectionLabel || body.selectedDirection.strategicDirectionType}
Selected Strategic Direction Learning Basis: ${compact({ directionSource: body.selectedDirection.directionSource, failurePatternAvoided: body.selectedDirection.failurePatternAvoided, winningPatternUsed: body.selectedDirection.winningPatternUsed, winningThesis: body.selectedDirection.winningThesisUse, conceptLeap: body.selectedDirection.conceptLeap, signatureProofIdea: body.selectedDirection.signatureProofIdea }, 2200)}
Winning Thesis / Concept Leap / Signature Proof Idea 포함 전략 방향 JSON: ${compact(body.selectedDirection, 4500)}\nConcept Development Logic: ${compact(body.conceptDevelopmentLogic, 2600)}\nRelevant Matrix Only: ${compact(activeMatrix, 2200)}\nLanguage Mode: ${body.languageMode || 'bilingual'}\nProposal Narrative: ${compact(body.proposalNarrative, 2200)}\n\n요구사항:\n- options는 반드시 8~12개.\n- namingStyle 필드를 반드시 다음 중 하나로 작성하고 8~12개를 그룹이 섞이도록 다양화: Direct strategic, Brand / sensory, Spatial / system, Symbolic, Global English / bilingual.\n- 10개가 같은 단어 변형처럼 보이면 실패.\n- 각 option은 conceptName, languageMode(Korean/English/bilingual), koreanSubtitle(없으면 빈 문자열), oneLineSlogan, shortMeaning, whyItFitsRfp, namingStyle, mainRisk, coverTitleScore, memorabilityScore, rfpSpecificityScore, expandabilityScore, risk를 작성.\n- conceptName은 제안서 표지 제목, 브랜드 경험 콘셉트, 전시 콘셉트, 공간 경험 프레임처럼 느껴져야 하며 임시 전략 방향명/컨설팅 목차명이 아니다.\n- final slogan 후보는 oneLineSlogan에 쓰되, conceptName에 슬로건 문장을 넣지 말라.\n- 전체 전략 방향 3안을 재생성하지 말고 선택한 primaryRfpConceptType과 선택한 전략 방향 하나만 기반으로 네이밍하라.
- selectedStrategicDirection의 proposal learning basis, failurePatternAvoided, winningPatternUsed, winningThesis, conceptLeap, signatureProofIdea, current RFP summary를 네이밍 근거로 사용하라. hardcoded direction presets는 사용하지 말라.
- matrixType이 entityDifferentiationMatrix가 아니면 Entity Differentiation Matrix, 역할 구분, 통합+역할 차별화, 상징적 리더십을 네이밍 근거로 사용하지 말라.
- single_brand_experience 또는 visitor_center_or_tour는 brand meaning, sensory cue, product value, process/proof, visitor memory, transformation after visit에서 이름을 도출하고 multi-entity role separation, pavilion leadership, stakeholder integration으로 네이밍하지 말라.
- multi_entity_pavilion만 shared pavilion frame, entity/domain relationship, system logic, capability proof, symbolic presence 기반 네이밍을 허용한다.`;

    const result = await createStructuredJson<ConceptNameOptionsResult>({ schemaName: 'concept_name_options', schema: conceptNameOptionsJsonSchema, system, user, timeoutMs: 18_000 });
    const styles = ['Direct strategic', 'Brand / sensory', 'Spatial / system', 'Symbolic', 'Global English / bilingual'] as const;
    const options = (result.options ?? []).slice(0, 12).map((option, index) => ({ ...option, koreanSubtitle: option.koreanSubtitle ?? '', oneLineSlogan: option.oneLineSlogan || option.shortMeaning, whyItFitsRfp: option.whyItFitsRfp || option.whyItFits || option.shortMeaning, namingStyle: option.namingStyle ?? styles[index % styles.length], mainRisk: option.mainRisk || option.risk }));
    if (options.length < 8) return json(fallbackOptions(body.selectedDirection));
    return json({ ...result, selectedDirectionId: body.selectedDirection.conceptId, options });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '컨셉명 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
