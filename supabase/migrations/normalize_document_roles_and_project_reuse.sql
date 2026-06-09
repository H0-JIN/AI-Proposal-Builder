-- Normalize legacy document_role values to the canonical documents.role field.
-- documents.role is canonical; documents.document_role remains a legacy compatibility mirror.

alter table if exists public.documents
  add column if not exists document_role text;

update public.documents
set document_role = role
where role is not null
  and (document_role is null or document_role <> role);

notify pgrst, 'reload schema';
