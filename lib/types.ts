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

export interface AnalysisSection {
  rfpFact: string[];
  aiProposal: string[];
  confirmNeeded: string[];
}

export interface AnalysisResult {
  projectOverview: string;
  clientChallenge: string;
  requiredItems: string[];
  constraints: string[];
  targetInfo: string;
  spatialCondition: string;
  contentCondition: string;
  operationCondition: string;
  kpiScheduleConstraints: string[];
  missingInfo: string[];
  rfpRequirements: AnalysisSection;
  clientTask: AnalysisSection;
  targetSpaceContentOperation: AnalysisSection;
  kpiTimelineConstraints: AnalysisSection;
}

export interface ConceptCandidate {
  conceptId: string;
  conceptNameKR: string;
  conceptNameEN: string;
  oneLineDefinition: string;
  coreMessage: string;
  experienceLogic: string;
  targetRelevance: string;
  keyExperienceAssetDirection: string;
  whyThisWorks: string;
}

export interface SlideOutline {
  slideNumber: number;
  slideType: string;
  slideTitle: string;
  slidePurpose: string;
  keyMessage: string;
  confirmNeededNote: string;
}

export interface ProductExperienceDetail {
  productCode: string;
  productNameOrRole: string;
  coreValue: string;
  experienceTitle: string;
  oneLineExperience: string;
  visitorMission: string;
  visitorAction: string;
  contentMechanism: string;
  mediaOrObject: string;
  spatialPlacement: string;
  outputOrReward: string;
  snsSharePoint: string;
  visualDirection: string;
  imagePlaceholder: string;
  diagramSuggestion: string;
}

export interface KeyExperienceAsset {
  assetName: string;
  assetType: string;
  roleInProposal: string;
  visitorAction: string;
  experienceMechanism: string;
  spatialPlacement: string;
  mediaOrObject: string;
  outputOrReward: string;
  whyItMatters: string;
  visualDirection: string;
}

export interface ExperienceScenarioStep {
  step: 'Entry' | 'Select' | 'Experience' | 'Generate' | 'Share' | 'Exit';
  visitorAction: string;
  systemResponse: string;
  mediaOrObject: string;
  output: string;
  designNote: string;
}

export interface SlideContent {
  slideNumber: number;
  slideType: string;
  slideTitle: string;
  slidePurpose: string;
  keyMessage: string;
  mainCopy: string;
  bodyBullets: string[];
  visualDirection: string;
  visitorAction: string;
  contentMechanism: string;
  spatialPlacement: string;
  mediaOrObject: string;
  outputOrReward: string;
  imagePlaceholder: string;
  visualPrompt: string;
  diagramSuggestion: string;
  productExperienceDetails: ProductExperienceDetail[];
  keyExperienceAssets: KeyExperienceAsset[];
  experienceScenarioSteps: ExperienceScenarioStep[];
  speakerNote: string;
  confirmNeededNote: string;
}

export interface ProposalState {
  input: ProjectInput;
  supplementalInfo?: SupplementalInfo;
  uploadedDocuments?: UploadedDocument[];
  analysis?: AnalysisResult;
  conceptCandidates?: ConceptCandidate[];
  selectedConcept?: ConceptCandidate;
  outline?: SlideOutline[];
  slides?: SlideContent[];
}

export const proposalTypeLabels: Record<ProposalType, string> = {
  basic: '기본형',
  cheil: '제일기획형',
  innocean: '이노션형',
  hyundai: '현대차그룹형',
};
