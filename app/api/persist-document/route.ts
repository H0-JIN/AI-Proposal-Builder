import { NextResponse } from 'next/server';
import { persistUploadedDocumentToSupabase, type PersistUploadedDocumentInput } from '@/lib/documentPersistence';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as PersistUploadedDocumentInput;
    const result = await persistUploadedDocumentToSupabase(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[persist-document] DB save failed, uploaded file remains available: ${message}`);
    return NextResponse.json({ status: 'failed' });
  }
}
