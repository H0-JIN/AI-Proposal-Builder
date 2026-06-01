export type ProposalType = 'basic' | 'cheil' | 'innocean' | 'hyundai';

export interface ProjectInput {
  proposalType: ProposalType;
  projectName: string;
  clientName: string;
  briefText: string;
}

export type ExtractionStatus =
  | '텍스트 추출 완료'
  | '일부 텍스트만 추출'
  | '이미지 중심 문서 / OCR 필요'
  | '추출 실패';

export interface UploadedDocument {
  fileName: string;
  fileType: string;
  extractionStatus: ExtractionStatus;
  extractedText: string;
  extractedCharCount: number;
  warningMessage?: string;
}

export interface SupplementalInfo {
  projectPurpose: string;
  spaceLocationScale: string;
  targetCustomer: string;
  experienceElements: string;
  brandMessage: string;
  schedule: string;
  budgetScope: string;
  designTone: string;
  exclusions: string;
}

export interface AnalysisResult {
  projectOverview: string;
  clientChallenge: string;
  requiredItems: string[];
  constraints: string[];
  targetInfo: string;
  spatialCondition: string;
  contentCondition: string;
  missingInfo: string[];
}

export interface SlideOutline {
  slideNumber: number;
  slideTitle: string;
  slidePurpose: string;
  keyMessage: string;
}

export interface SlideContent {
  slideNumber: number;
  title: string;
  subtitle: string;
  bodyBullets: string[];
  imagePlaceholder: string;
  diagramSuggestion: string;
}

export interface ProposalState {
  input: ProjectInput;
  supplementalInfo?: SupplementalInfo;
  uploadedDocuments?: UploadedDocument[];
  analysis?: AnalysisResult;
  outline?: SlideOutline[];
  slides?: SlideContent[];
}

export const proposalTypeLabels: Record<ProposalType, string> = {
  basic: '기본형',
  cheil: '제일기획형',
  innocean: '이노션형',
  hyundai: '현대차그룹형',
};
