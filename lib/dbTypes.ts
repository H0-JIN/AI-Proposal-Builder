export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };

export type DocumentRole =
  | 'rfp'
  | 'clientBrief'
  | 'reference'
  | 'portfolio'
  | 'proposal'
  | 'template'
  | 'budgetSample'
  | 'scheduleSample'
  | 'organizationSample'
  | 'other'
  | 'memo';

export type ChunkImportance = 'high' | 'medium' | 'low';

export interface ProjectRecord {
  [key: string]: unknown;
  id: string;
  name: string;
  client_name: string | null;
  proposal_type: string | null;
  status: string;
  metadata: JsonValue | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  [key: string]: unknown;
  id: string;
  project_id: string;
  file_name: string;
  role: DocumentRole;
  mime_type: string | null;
  source_type: string | null;
  metadata: JsonValue | null;
  status: string | null;
  file_size: number | null;
  created_at: string;
}

export interface ChunkRecord {
  [key: string]: unknown;
  id: string;
  project_id: string;
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  category: string | null;
  categories: string[];
  tags: string[];
  importance: ChunkImportance;
  page_number: number | null;
  slide_number: number | null;
  section_title: string | null;
  source_type: string | null;
  source_name: string | null;
  token_count: number | null;
  embedding: number[] | null;
  metadata: JsonValue | null;
  created_at: string;
}

export interface SlideVisualPatternRecord {
  [key: string]: unknown;
  id: string;
  project_id: string | null;
  document_id: string | null;
  chunk_id: string | null;
  slide_number: number | null;
  slide_title: string | null;
  slide_role: string | null;
  layout_type: string | null;
  visual_text_ratio: string | null;
  hero_element: string | null;
  visual_direction: string | null;
  diagram_type: string | null;
  tone_and_manner: string | null;
  image_prompt: string | null;
  source_type: string | null;
  confidence: string | null;
  metadata: JsonValue | null;
  created_at: string;
}

export type SlideVisualPatternInput = Partial<Pick<SlideVisualPatternRecord, 'id' | 'chunk_id' | 'slide_number' | 'slide_title' | 'slide_role' | 'layout_type' | 'visual_text_ratio' | 'hero_element' | 'visual_direction' | 'diagram_type' | 'tone_and_manner' | 'image_prompt' | 'source_type' | 'confidence' | 'metadata' | 'created_at'>> &
  Pick<SlideVisualPatternRecord, 'project_id' | 'document_id'>;

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: ProjectRecord;
        Insert: Partial<Pick<ProjectRecord, 'id' | 'client_name' | 'proposal_type' | 'status' | 'metadata' | 'created_at' | 'updated_at'>> &
          Pick<ProjectRecord, 'name'>;
        Update: Partial<Omit<ProjectRecord, 'id' | 'created_at'>>;
        Relationships: [];
      };
      documents: {
        Row: DocumentRecord;
        Insert: Partial<Pick<DocumentRecord, 'id' | 'mime_type' | 'source_type' | 'metadata' | 'status' | 'file_size' | 'created_at'>> &
          Pick<DocumentRecord, 'project_id' | 'file_name' | 'role'>;
        Update: Partial<Omit<DocumentRecord, 'id' | 'project_id' | 'created_at'>>;
        Relationships: [
          {
            foreignKeyName: 'documents_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      chunks: {
        Row: ChunkRecord;
        Insert: Partial<Pick<ChunkRecord, 'id' | 'category' | 'categories' | 'tags' | 'importance' | 'page_number' | 'slide_number' | 'section_title' | 'source_type' | 'source_name' | 'token_count' | 'embedding' | 'metadata' | 'created_at'>> &
          Pick<ChunkRecord, 'project_id' | 'document_id' | 'chunk_index' | 'chunk_text'>;
        Update: Partial<Omit<ChunkRecord, 'id' | 'project_id' | 'document_id' | 'created_at'>>;
        Relationships: [
          {
            foreignKeyName: 'chunks_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chunks_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
        ];
      };
      slide_visual_patterns: {
        Row: SlideVisualPatternRecord;
        Insert: SlideVisualPatternInput;
        Update: Partial<Omit<SlideVisualPatternRecord, 'id' | 'created_at'>>;
        Relationships: [
          {
            foreignKeyName: 'slide_visual_patterns_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'slide_visual_patterns_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'slide_visual_patterns_chunk_id_fkey';
            columns: ['chunk_id'];
            isOneToOne: false;
            referencedRelation: 'chunks';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
