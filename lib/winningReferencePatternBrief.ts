import 'server-only';

import { createStructuredJson } from './openai';
import type { DocumentChunk } from './rag';
import type { WinningReferencePatternBrief } from './types';

// Strict JSON schema — logic-only fields + a forbiddenCopyTerms deny-list (the reference's OWN names/slogans/titles).
const winningReferenceBriefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    strategicReframingPattern: { type: 'string' },
    conceptEmergencePattern: { type: 'string' },
    audienceQuestionPattern: { type: 'string' },
    brandTonePattern: { type: 'string' },
    signatureExperiencePattern: { type: 'string' },
    contentArchitecturePattern: { type: 'string' },
    mediaAndInteractionPattern: { type: 'string' },
    spatialJourneyPattern: { type: 'string' },
    operationProofPattern: { type: 'string' },
    proofPattern: { type: 'string' },
    deckStructurePattern: { type: 'string' },
    whatMadeItPersuasive: { type: 'string' },
    reusableLogicOnly: { type: 'string' },
    forbiddenCopyTerms: { type: 'array', items: { type: 'string' } },
  },
  required: ['strategicReframingPattern', 'conceptEmergencePattern', 'audienceQuestionPattern', 'brandTonePattern', 'signatureExperiencePattern', 'contentArchitecturePattern', 'mediaAndInteractionPattern', 'spatialJourneyPattern', 'operationProofPattern', 'proofPattern', 'deckStructurePattern', 'whatMadeItPersuasive', 'reusableLogicOnly', 'forbiddenCopyTerms'],
} as const;

function referenceText(chunks: DocumentChunk[]): string {
  return chunks
    .map((chunk) => [chunk.sectionTitle, chunk.slideTitle, chunk.slidePurpose, chunk.keyMessage, chunk.usefulPattern, chunk.chunkText].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')
    .slice(0, 14000);
}

const PLACEHOLDER = /^(?:없음|n\/?a|none|null|undefined|미정|-)?$/i;
function hasMeaning(value?: string): boolean {
  return Boolean(value && value.trim().length >= 4 && !PLACEHOLDER.test(value.trim()));
}

// Distil the current project's OWN uploaded reference proposal into transferable concept-LOGIC structure (no copy).
// Returns usable=false (and brief=null) when there is no reference text or nothing transferable — callers fall back to
// the current RFP only (no fabrication). currentProjectScoped only: chunks are the caller-filtered reference chunks.
export async function buildWinningReferencePatternBrief(args: { referenceChunks: DocumentChunk[]; currentRfpContext: string }): Promise<{ hasReference: boolean; usable: boolean; brief: WinningReferencePatternBrief | null }> {
  const chunks = (args.referenceChunks ?? []).filter((chunk) => chunk && typeof chunk.chunkText === 'string');
  if (!chunks.length) return { hasReference: false, usable: false, brief: null };
  const text = referenceText(chunks);
  if (text.trim().length < 80) return { hasReference: true, usable: false, brief: null };

  try {
    const brief = await createStructuredJson<WinningReferencePatternBrief>({
      schemaName: 'winning_reference_pattern_brief',
      schema: winningReferenceBriefSchema,
      system: [
        '너는 제안 전략 분석가다. 현재 프로젝트에 업로드된 과거 레퍼런스 제안서(같은/유사 프로젝트)의 재사용 가능한 "구조·논리"만 추출한다.',
        '추출 대상은 LOGIC/STRUCTURE다: 문제 재정의 방식, 전략→컨셉 전환 로직, 관객 질문과 답, 브랜드 톤의 작동 방식, 대표 경험/시그니처 장면 논리, 콘텐츠 아키텍처, 미디어/인터랙션 구성, 공간 여정, 운영/실행 증명, 증명 구조, 덱 섹션 순서 논리, 무엇이 설득력을 만들었는지.',
        '복사 금지: 과거 제안의 컨셉명, 슬로건, 페이지 제목, 슬라이드 원문 카피, 클라이언트/프로젝트 고유 명칭, 비주얼 문구를 그대로 옮기지 말라. 모든 필드는 "어떻게/왜"의 구조 설명이어야 하고 고유명사·카피 인용이 아니어야 한다.',
        'forbiddenCopyTerms에는 이 레퍼런스 제안서의 고유 컨셉명·슬로건·페이지 제목·코인된 명칭·클라이언트/프로젝트명을 모두 나열한다(다운스트림에서 복사 차단용 deny-list). 추출이 불가능하거나 전이 가능한 논리가 없으면 각 필드에 "없음"을 넣는다.',
        '현재 RFP와 무관한 다른 카테고리/유형의 논리는 추출하지 말라. 출력은 한국어.',
      ].join('\n'),
      user: `현재 RFP 맥락(이 논리가 적용될 대상):\n${args.currentRfpContext.slice(0, 4000)}\n\n레퍼런스 제안서 텍스트(구조/논리만 추출, 원문 복사 금지):\n${text}`,
      timeoutMs: 22_000,
      maxRetries: 1,
    });
    // "usable" requires >=2 of the 6 CORE concept-logic fields (deck/media/spatial/operation are weaker signals that
    // cannot alone make a brief usable). Below the bar → treat as no usable reference and fall back to current RFP only.
    const meaningfulCount = [brief.strategicReframingPattern, brief.conceptEmergencePattern, brief.brandTonePattern, brief.contentArchitecturePattern, brief.proofPattern, brief.whatMadeItPersuasive].filter(hasMeaning).length;
    if (meaningfulCount < 2) return { hasReference: true, usable: false, brief: null };
    return { hasReference: true, usable: true, brief: { ...brief, forbiddenCopyTerms: (brief.forbiddenCopyTerms ?? []).filter((term) => typeof term === 'string' && term.trim().length >= 2).slice(0, 40) } };
  } catch (error) {
    console.error(`[winningReferencePatternBrief] extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return { hasReference: true, usable: false, brief: null };
  }
}
