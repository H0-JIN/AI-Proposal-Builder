-- Add lost-proposal failure area and partial pattern usability fields.

alter table if exists public.proposal_patterns
  add column if not exists failure_areas text[],
  add column if not exists can_use_for_structure boolean default true,
  add column if not exists can_use_for_concept boolean default true,
  add column if not exists can_use_for_strategy boolean default true,
  add column if not exists can_use_for_content boolean default true,
  add column if not exists can_use_for_design boolean default true,
  add column if not exists can_use_for_execution boolean default true,
  add column if not exists can_use_for_operation boolean default true;

create index if not exists proposal_patterns_failure_areas_gin_idx on public.proposal_patterns using gin(failure_areas);
