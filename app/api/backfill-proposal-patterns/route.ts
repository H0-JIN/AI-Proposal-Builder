import { NextResponse } from 'next/server';
import { backfillProposalPatterns, type BackfillProposalPatternsInput } from '@/lib/proposalPatternBackfill';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BackfillProposalPatternsInput;
    const result = await backfillProposalPatterns(payload);
    return NextResponse.json(result, { status: result.status === 'failed' ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backfill-proposal-patterns] failed: ${message}`);
    return NextResponse.json({ status: 'failed', error: '패턴 추출 실패' }, { status: 500 });
  }
}
