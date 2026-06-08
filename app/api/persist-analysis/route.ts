import { NextResponse } from 'next/server';
import { persistAnalysisToSupabase, type PersistAnalysisInput } from '@/lib/analysisPersistence';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as PersistAnalysisInput;
    const result = await persistAnalysisToSupabase(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[persist-analysis] DB save failed, analysis remains available: ${message}`);
    return NextResponse.json({ status: 'failed' });
  }
}
