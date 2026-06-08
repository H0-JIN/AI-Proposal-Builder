import type { DocumentRole } from './dbTypes';
import type { DocumentType } from './rag';

export type UploadDocumentRole = Extract<DocumentRole, 'rfp' | 'proposal' | 'reference' | 'memo'>;

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
