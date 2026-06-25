import { NextResponse } from 'next/server';
import { getDocumentRecordById, isSupabaseConfigured, updateDocumentMetadata } from '@/lib/ragStorage';
import { backfillProposalPatterns } from '@/lib/proposalPatternBackfill';
import { buildPatternOutcomeFields } from '@/lib/documentOutcomeMetadata';
import type { DbLibraryDocumentMetadata } from '@/lib/types';
import type { JsonValue } from '@/lib/dbTypes';

interface UpdateMetadataPayload {
  documentId?: string;
  patch?: DbLibraryDocumentMetadata;
  rerunPatterns?: boolean;
}

const OUTCOME_KEYS = ['outcome', 'outcomeLabel', 'outcomeReason', 'outcomeReasonType', 'failureAreas', 'winReasonTags', 'lossReasonTags'] as const;

function toJsonValue(value: unknown): JsonValue | null {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue | null;
}

function asObject(value: JsonValue | null | undefined): Record<string, JsonValue | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

// Edit an existing DB-library document's outcome/tagging metadata. Reads current metadata and DEEP-MERGES the patch so
// plumbing keys (documentRole/documentType/extractionStatus/originalDocumentId…) are never lost (RISK A). Never injects an
// outcome for a non-proposal role. Recomputes outcomeReasonType/failureAreas, then re-propagates to proposal_patterns.
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as UpdateMetadataPayload;
    const documentId = payload.documentId?.trim();
    if (!documentId) {
      return NextResponse.json({ ok: false, error: '문서 ID가 필요합니다.' }, { status: 400 });
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'Supabase 서버 환경 변수가 설정되지 않았습니다.' }, { status: 503 });
    }

    const record = await getDocumentRecordById(documentId);
    if (!record) {
      return NextResponse.json({ ok: false, error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const current = asObject(record.metadata);
    const patch = asObject(toJsonValue(payload.patch ?? {}));
    // A non-proposal document never carries an outcome — strip outcome-related keys from the patch for those roles.
    if (record.role !== 'proposal') {
      for (const key of OUTCOME_KEYS) delete patch[key];
    }

    const merged: Record<string, JsonValue | undefined> = { ...current, ...patch, updatedAt: new Date().toISOString() };
    if (!merged.createdAt) merged.createdAt = current.createdAt ?? merged.updatedAt;

    // Keep documents.metadata's derived outcome fields consistent with what the patterns will get (proposal role only).
    if (record.role === 'proposal') {
      const fields = buildPatternOutcomeFields(toJsonValue(merged));
      merged.outcomeReasonType = fields.outcome_reason_type;
      merged.failureAreas = toJsonValue(fields.failure_areas) ?? [];
    }

    const saved = await updateDocumentMetadata(documentId, toJsonValue(merged));
    if (!saved) {
      return NextResponse.json({ ok: false, error: '메타데이터 저장에 실패했습니다.' }, { status: 500 });
    }

    // Re-propagate the new outcome metadata onto already-extracted patterns (proposal role only).
    let patternResult: Awaited<ReturnType<typeof backfillProposalPatterns>> | null = null;
    if (payload.rerunPatterns && record.role === 'proposal') {
      patternResult = await backfillProposalPatterns({ documentId, force: true });
    }

    return NextResponse.json({ ok: true, documentId, role: record.role, metadata: merged, patternResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db-library/update-metadata] failed: ${message}`);
    return NextResponse.json({ ok: false, error: '메타데이터 저장에 실패했습니다.' }, { status: 500 });
  }
}
