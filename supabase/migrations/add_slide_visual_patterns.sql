-- Add slide-level visual/layout pattern storage for future proposal generation guidance.

create table if not exists public.slide_visual_patterns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  chunk_id uuid references public.chunks(id) on delete set null,
  slide_number int,
  slide_title text,
  slide_role text,
  layout_type text,
  visual_text_ratio text,
  hero_element text,
  visual_direction text,
  diagram_type text,
  tone_and_manner text,
  image_prompt text,
  source_type text default 'text_extracted',
  confidence text default 'medium',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists slide_visual_patterns_project_id_idx on public.slide_visual_patterns(project_id);
create index if not exists slide_visual_patterns_document_id_idx on public.slide_visual_patterns(document_id);
create index if not exists slide_visual_patterns_chunk_id_idx on public.slide_visual_patterns(chunk_id);
