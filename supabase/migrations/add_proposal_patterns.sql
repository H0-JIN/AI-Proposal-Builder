-- Add reusable proposal structure/message pattern storage for future RAG learning.
-- This stores text-derived proposal organization patterns only; generation does not read it yet.

create table if not exists public.proposal_patterns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  chunk_id uuid references public.chunks(id) on delete set null,
  pattern_type text,
  pattern_name text,
  slide_number int,
  slide_title text,
  slide_role text,
  section_order int,
  summary text,
  reusable_principle text,
  why_it_matters text,
  relation_to_concept text,
  relation_to_proposal_thesis text,
  before_slide_role text,
  after_slide_role text,
  narrative_stage text,
  outcome text,
  outcome_reason text,
  source_text text,
  source_type text default 'text_extracted',
  confidence text default 'medium',
  tags text[],
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table if exists public.proposal_patterns
  add column if not exists outcome text,
  add column if not exists outcome_reason text;

create index if not exists proposal_patterns_project_id_idx on public.proposal_patterns(project_id);
create index if not exists proposal_patterns_document_id_idx on public.proposal_patterns(document_id);
create index if not exists proposal_patterns_chunk_id_idx on public.proposal_patterns(chunk_id);
create index if not exists proposal_patterns_slide_role_idx on public.proposal_patterns(slide_role);
create index if not exists proposal_patterns_narrative_stage_idx on public.proposal_patterns(narrative_stage);
create index if not exists proposal_patterns_tags_gin_idx on public.proposal_patterns using gin(tags);
