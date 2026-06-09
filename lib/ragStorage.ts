import 'server-only';

import { getSupabaseConfigState } from './supabase';
import type { ChunkImportance, ChunkRecord, DocumentRecord, DocumentRole, JsonValue, ProjectRecord, ProposalPatternInput, ProposalPatternRecord, SlideVisualPatternInput, SlideVisualPatternRecord } from './dbTypes';

export interface CreateProjectInput {
  name: string;
  clientName?: string | null;
  proposalType?: string | null;
  status?: string;
  metadata?: JsonValue | null;
}

export interface CreateDocumentInput {
  projectId: string;
  fileName: string;
  role: DocumentRole;
  mimeType?: string | null;
  sourceType?: string | null;
  metadata?: JsonValue | null;
}

export interface SaveChunkInput {
  chunkIndex: number;
  chunkText: string;
  category?: string | null;
  categories?: string[];
  tags?: string[];
  importance?: ChunkImportance;
  pageNumber?: number | null;
  slideNumber?: number | null;
  sectionTitle?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  tokenCount?: number | null;
  embedding?: number[] | null;
  metadata?: JsonValue | null;
}

export interface SaveChunksInput {
  projectId: string;
  documentId: string;
  chunks: SaveChunkInput[];
}

export interface SaveSlideVisualPatternsInput {
  patterns: SlideVisualPatternInput[];
}

export interface SaveProposalPatternsInput {
  patterns: ProposalPatternInput[];
}

export interface ProposalPatternBackfillDocument extends DocumentRecord {
  chunkCount: number;
  proposalPatternCount: number;
}

function logRagStorageError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
  console.error(`[ragStorage] ${operation} failed: ${message}`);
}

export function isSupabaseConfigured() {
  return getSupabaseConfigState().configured;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRecord | null> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from('projects')
      .insert({
        name: input.name,
        client_name: input.clientName ?? null,
        proposal_type: input.proposalType ?? null,
        status: input.status ?? 'active',
        metadata: input.metadata ?? null,
      })
      .select('*')
      .single();

    if (error) {
      logRagStorageError('createProject', error);
      return null;
    }

    return data;
  } catch (error) {
    logRagStorageError('createProject', error);
    return null;
  }
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentRecord | null> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from('documents')
      .insert({
        project_id: input.projectId,
        file_name: input.fileName,
        role: input.role,
        mime_type: input.mimeType ?? null,
        source_type: input.sourceType ?? null,
        metadata: input.metadata ?? null,
      })
      .select('*')
      .single();

    if (error) {
      logRagStorageError('createDocument', error);
      return null;
    }

    return data;
  } catch (error) {
    logRagStorageError('createDocument', error);
    return null;
  }
}

export async function saveChunks(input: SaveChunksInput): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client || input.chunks.length === 0) {
    return [];
  }

  try {
    const rows = input.chunks.map((chunk) => ({
      project_id: input.projectId,
      document_id: input.documentId,
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.chunkText,
      category: chunk.category ?? chunk.categories?.[0] ?? null,
      categories: chunk.categories ?? [],
      tags: chunk.tags ?? [],
      importance: chunk.importance ?? 'medium',
      page_number: chunk.pageNumber ?? null,
      slide_number: chunk.slideNumber ?? null,
      section_title: chunk.sectionTitle ?? null,
      source_type: chunk.sourceType ?? null,
      source_name: chunk.sourceName ?? null,
      token_count: chunk.tokenCount ?? null,
      embedding: chunk.embedding ?? null,
      metadata: chunk.metadata ?? null,
    }));

    const { data, error } = await client.from('chunks').insert(rows).select('*');

    if (error) {
      logRagStorageError('saveChunks', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('saveChunks', error);
    return [];
  }
}


export async function saveProposalPatterns(input: SaveProposalPatternsInput): Promise<ProposalPatternRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client || input.patterns.length === 0) {
    return [];
  }

  try {
    const rows = input.patterns.map((pattern) => ({
      project_id: pattern.project_id,
      document_id: pattern.document_id,
      chunk_id: pattern.chunk_id ?? null,
      pattern_type: pattern.pattern_type ?? null,
      pattern_name: pattern.pattern_name ?? null,
      slide_number: pattern.slide_number ?? null,
      slide_title: pattern.slide_title ?? null,
      slide_role: pattern.slide_role ?? null,
      section_order: pattern.section_order ?? null,
      summary: pattern.summary ?? null,
      reusable_principle: pattern.reusable_principle ?? null,
      why_it_matters: pattern.why_it_matters ?? null,
      relation_to_concept: pattern.relation_to_concept ?? null,
      relation_to_proposal_thesis: pattern.relation_to_proposal_thesis ?? null,
      before_slide_role: pattern.before_slide_role ?? null,
      after_slide_role: pattern.after_slide_role ?? null,
      narrative_stage: pattern.narrative_stage ?? null,
      outcome: pattern.outcome ?? null,
      outcome_reason: pattern.outcome_reason ?? null,
      outcome_reason_type: pattern.outcome_reason_type ?? null,
      source_text: pattern.source_text ?? null,
      source_type: pattern.source_type ?? 'text_extracted',
      confidence: pattern.confidence ?? 'medium',
      tags: pattern.tags ?? [],
      metadata: pattern.metadata ?? {},
    }));

    const { data, error } = await client.from('proposal_patterns').insert(rows).select('*');

    if (error) {
      logRagStorageError('saveProposalPatterns', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('saveProposalPatterns', error);
    return [];
  }
}


export async function getProposalPatternCountByDocument(documentId: string): Promise<number> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return 0;
  }

  try {
    const { count, error } = await client
      .from('proposal_patterns')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);

    if (error) {
      logRagStorageError('getProposalPatternCountByDocument', error);
      return 0;
    }

    return count ?? 0;
  } catch (error) {
    logRagStorageError('getProposalPatternCountByDocument', error);
    return 0;
  }
}

export async function deleteProposalPatternsByDocument(documentId: string): Promise<boolean> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return false;
  }

  try {
    const { error } = await client
      .from('proposal_patterns')
      .delete()
      .eq('document_id', documentId);

    if (error) {
      logRagStorageError('deleteProposalPatternsByDocument', error);
      return false;
    }

    return true;
  } catch (error) {
    logRagStorageError('deleteProposalPatternsByDocument', error);
    return false;
  }
}

export async function getDocumentChunks(documentId: string): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('chunks')
      .select('*')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      logRagStorageError('getDocumentChunks', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getDocumentChunks', error);
    return [];
  }
}

export async function getProposalDocumentsForPatternBackfill(options: { documentId?: string; projectId?: string } = {}): Promise<ProposalPatternBackfillDocument[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    let query = client
      .from('documents')
      .select('*, chunks(id), proposal_patterns(id)')
      .eq('role', 'proposal')
      .order('created_at', { ascending: true });

    if (options.documentId) {
      query = query.eq('id', options.documentId);
    }

    if (options.projectId) {
      query = query.eq('project_id', options.projectId);
    }

    const { data, error } = await query;

    if (error) {
      logRagStorageError('getProposalDocumentsForPatternBackfill', error);
      return [];
    }

    return (data ?? [])
      .map((document) => {
        const withRelations = document as DocumentRecord & { chunks?: Array<{ id: string }>; proposal_patterns?: Array<{ id: string }> };
        const { chunks: _chunks, proposal_patterns: _patterns, ...record } = withRelations;
        return {
          ...record,
          chunkCount: _chunks?.length ?? 0,
          proposalPatternCount: _patterns?.length ?? 0,
        } as ProposalPatternBackfillDocument;
      })
      .filter((document) => document.chunkCount > 0);
  } catch (error) {
    logRagStorageError('getProposalDocumentsForPatternBackfill', error);
    return [];
  }
}

export async function getProposalPatternsByDocument(documentId: string): Promise<ProposalPatternRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('proposal_patterns')
      .select('*')
      .eq('document_id', documentId)
      .order('section_order', { ascending: true, nullsFirst: false })
      .order('slide_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      logRagStorageError('getProposalPatternsByDocument', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getProposalPatternsByDocument', error);
    return [];
  }
}

export async function getProposalPatternsByProject(projectId: string): Promise<ProposalPatternRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('proposal_patterns')
      .select('*')
      .eq('project_id', projectId)
      .order('document_id', { ascending: true, nullsFirst: false })
      .order('section_order', { ascending: true, nullsFirst: false })
      .order('slide_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      logRagStorageError('getProposalPatternsByProject', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getProposalPatternsByProject', error);
    return [];
  }
}

export async function saveSlideVisualPatterns(input: SaveSlideVisualPatternsInput): Promise<SlideVisualPatternRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client || input.patterns.length === 0) {
    return [];
  }

  try {
    const rows = input.patterns.map((pattern) => ({
      project_id: pattern.project_id,
      document_id: pattern.document_id,
      chunk_id: pattern.chunk_id ?? null,
      slide_number: pattern.slide_number ?? null,
      slide_title: pattern.slide_title ?? null,
      slide_role: pattern.slide_role ?? null,
      layout_type: pattern.layout_type ?? null,
      visual_text_ratio: pattern.visual_text_ratio ?? null,
      hero_element: pattern.hero_element ?? null,
      visual_direction: pattern.visual_direction ?? null,
      diagram_type: pattern.diagram_type ?? null,
      tone_and_manner: pattern.tone_and_manner ?? null,
      image_prompt: pattern.image_prompt ?? null,
      source_type: pattern.source_type ?? 'text_extracted',
      confidence: pattern.confidence ?? 'medium',
      metadata: pattern.metadata ?? {},
    }));

    const { data, error } = await client.from('slide_visual_patterns').insert(rows).select('*');

    if (error) {
      logRagStorageError('saveSlideVisualPatterns', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('saveSlideVisualPatterns', error);
    return [];
  }
}

export async function getSlideVisualPatternsByDocument(documentId: string): Promise<SlideVisualPatternRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('slide_visual_patterns')
      .select('*')
      .eq('document_id', documentId)
      .order('slide_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      logRagStorageError('getSlideVisualPatternsByDocument', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getSlideVisualPatternsByDocument', error);
    return [];
  }
}

export async function getSlideVisualPatternsByProject(projectId: string): Promise<SlideVisualPatternRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('slide_visual_patterns')
      .select('*')
      .eq('project_id', projectId)
      .order('document_id', { ascending: true, nullsFirst: false })
      .order('slide_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      logRagStorageError('getSlideVisualPatternsByProject', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getSlideVisualPatternsByProject', error);
    return [];
  }
}

export async function getProjectChunks(projectId: string): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('chunks')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('chunk_index', { ascending: true });

    if (error) {
      logRagStorageError('getProjectChunks', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getProjectChunks', error);
    return [];
  }
}

export async function searchChunksByCategory(projectId: string, categories: string[]): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client || categories.length === 0) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('chunks')
      .select('*')
      .eq('project_id', projectId)
      .or(`category.in.(${categories.map(escapeSupabaseListValue).join(',')}),categories.ov.{${categories.map(escapePostgresArrayValue).join(',')}}`)
      .order('created_at', { ascending: true })
      .order('chunk_index', { ascending: true });

    if (error) {
      logRagStorageError('searchChunksByCategory', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('searchChunksByCategory', error);
    return [];
  }
}

function escapeSupabaseListValue(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function escapePostgresArrayValue(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
