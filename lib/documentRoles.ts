import type { DocumentRole } from './dbTypes';
import type { DocumentType } from './rag';

export type UploadDocumentRole = Extract<DocumentRole, 'rfp' | 'proposal' | 'reference' | 'memo'>;

export const canonicalDocumentRoles = ['rfp', 'proposal', 'reference', 'memo'] as const;

export type CanonicalDocumentRole = (typeof canonicalDocumentRoles)[number];


export function isCanonicalDocumentRole(value: unknown): value is CanonicalDocumentRole {
  return typeof value === 'string' && (canonicalDocumentRoles as readonly string[]).includes(value);
}

export function getDocumentRole(document: { role?: unknown; document_role?: unknown } | null | undefined): CanonicalDocumentRole | undefined {
  const role = typeof document?.role === 'string' ? document.role.trim() : undefined;
  if (isCanonicalDocumentRole(role)) return role;

  const legacyRole = typeof document?.document_role === 'string' ? document.document_role.trim() : undefined;
  if (isCanonicalDocumentRole(legacyRole)) return legacyRole;

  return undefined;
}

function normalizeRoleText(value: string) {
  return value.toLowerCase().replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function inferUploadedDocumentRole(fileName: string, extractedText = ''): UploadDocumentRole {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const name = normalizeRoleText(fileName);
  const textSample = normalizeRoleText(extractedText.slice(0, 4000));
  const haystack = `${name} ${textSample}`;

  if (/reference|레퍼런스|benchmark|벤치마크|case|사례/.test(haystack)) return 'reference';
  if (/제안서|proposal|deck/.test(haystack) || extension === 'ppt' || extension === 'pptx') return 'proposal';
  if (/rfp|제안요청서|request|brief/.test(haystack)) return 'rfp';
  return 'memo';
}

export function mapDocumentTypeToStorageRole(documentType?: DocumentType): UploadDocumentRole {
  if (documentType === 'rfp') return 'rfp';
  if (documentType === 'finalProposal') return 'proposal';
  if (documentType === 'reference' || documentType === 'portfolio') return 'reference';
  return 'memo';
}

export function mapStorageRoleToDocumentType(role: UploadDocumentRole): DocumentType | undefined {
  if (role === 'proposal') return 'finalProposal';
  if (role === 'reference') return 'reference';
  if (role === 'rfp') return 'rfp';
  return undefined;
}
