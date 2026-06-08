import type { ChunkCategory, DocumentChunk, DocumentType } from './rag';

export type ProposalType = 'basic' | 'cheil' | 'innocean' | 'hyundai' | 'mice_event_operation' | 'conference_forum';

export type ProposalScopeType =
  | 'contentDevelopment'
  | 'boothExhibition'
  | 'experienceMarketing'
  | 'brandActivation'
  | 'operationOnly'
  | 'designBuild'
  | 'publicTender';

export interface ProjectInput {
  proposalType: ProposalType;
  projectName: string;
  clientName: string;
  briefText: string;
}

export type ExtractionStatus =
  | '텍스트 추출 중'
  | '텍스트 추출 완료'
  | '일부 텍스트만 추출'
  | '텍스트 추출 실패'
  | '텍스트 품질 낮음'
  | '이미지 중심 PDF 가능성 높음'
  | 'OCR 필요'
  | 'OCR 추출 완료'
  | 'OCR 일부 추출'
  | 'OCR 추출 실패'
  | '이미지 중심 PDF로 판단'
  | '빠른 Vision 분석 중'
  | '빠른 Vision 분석 완료'
  | '전체 Vision 분석 중'
  | '전체 Vision 분석 완료'
  | '하이브리드 PDF 분석 중'
  | '하이브리드 PDF 분석 완료'
  | 'Vision 분석 중'
  | 'Vision 분석 완료'
  | 'Vision 일부 완료'
  | 'Vision 분석 실패'
  | '추가 메모 입력 필요'
  | '이미지 중심 문서 / OCR 필요'
  | '추출 실패';

export interface VisionPageAnalysis {
  pageNumber: number;
  extractedText: string;
  visualSummary: string;
  detectedTables: string[];
  detectedDiagrams: string[];
  floorplanOrLayoutInfo: string;
  keyRequirements: string[];
  constraints: string[];
  scheduleInfo: string[];
  operationInfo: string[];
  designOrVisualReferences: string[];
  confidence: number;
  needsReview: boolean;
}

export type VisionStatus = 'unused' | 'queued' | 'quick_analyzing' | 'quick_completed' | 'analyzing' | 'completed' | 'partial' | 'failed';

export interface VisionFailedChunk {
  pageStart: number;
  pageEnd: number;
  errorMessage: string;
}

export interface VisionFailedPage {
  pageNumber: number;
  errorMessage: string;
}

export interface DocumentPageTextSource {
  pageNumber: number;
  text: string;
  sourceType: 'textExtraction' | 'visionAnalysis';
  visualSummary?: string;
}

export interface UploadedDocument {
  id: string;
  fileName: string;
  fileType: string;
  documentType?: DocumentType;
  extractionStatus: ExtractionStatus;
  extractedText: string;
  documentAnalysisText?: string;
  extractedCharCount: number;
  visionStatus?: VisionStatus;
  visionUsed?: boolean;
  visionPageCount?: number;
  visionTotalPageCount?: number;
  totalPageCount?: number;
  visionAnalysis?: VisionPageAnalysis[];
  pageTextSources?: DocumentPageTextSource[];
  textExtractionPageNumbers?: number[];
  visionPageNumbers?: number[];
  failedChunks?: VisionFailedChunk[];
  failedPages?: VisionFailedPage[];
  needsReview?: boolean;
  ocrUsed?: boolean;
  ocrAvailable?: boolean;
  warningMessage?: string;
  errorMessage?: string;
  chunks?: DocumentChunk[];
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

export interface TaskSection {
  taskId: string;
  taskTitle: string;
  phase: string;
  requiredDeliverables: string[];
  target: string[];
  keyRequirements: string[];
  referenceMentions: string[];
  existingAssets: string[];
  constraints: string[];
  kpi: string[];
  schedule: string[];
  confirmNeeded: string[];
}

export type RequirementSourceCategory = 'requiredDeliverables' | 'scopeOfWork' | 'evaluationCriteria' | 'constraints';

export type RequirementCoverageStatus = 'covered' | 'partially_covered' | 'missing';

export interface RfpRequirementCoverage {
  requirement: string;
  sourceCategory: RequirementSourceCategory;
  mappedSlideTitle: string;
  coverageStatus: RequirementCoverageStatus;
  note: string;
}


export interface ProductFeature {
  product: string;
  keyFeature: string;
  valueProposition: string;
}

export interface NumericInformation {
  pastPerformance: string[];
  lessonLearned: string[];
  currentIssue: string[];
  targetKPI: string[];
  referenceMetric: string[];
  proposedMeasurement: string[];
}

export interface ProposalNarrativeFlowStage {
  stage: string;
  purpose: string;
}

export interface ProposalNarrative {
  marketContext: string;
  coreProblem: string;
  strategicOpportunity: string;
  proposalThesis: string;
  whyNow: string;
  whyUs: string;
  whyThisConcept: string;
  narrativeFlow: ProposalNarrativeFlowStage[];
}

export type SlidePurpose = 'Problem' | 'Insight' | 'Strategy' | 'Concept' | 'Experience' | 'Content' | 'Proof' | 'Impact';

export interface SlideNarrativeMetadata {
  slidePurpose: string;
  slideRole?: string;
  relationToThesis?: string;
  whyThisSlideExists?: string;
}

export interface AnalysisResult {
  projectOverview: string;
  clientChallenge: string;
  taskSections: TaskSection[];
  inferredProposalType: ProposalType;
  proposalTypeReasoning: string;
  proposalScopeTypes: ProposalScopeType[];
  proposalStructureGuard: string;
  requiredDeliverables: string[];
  scopeOfWork: string[];
  evaluationCriteria: string[];
  requiredItems: string[];
  requiredScope: string[];
  referenceOnly: string[];
  existingAssets: string[];
  productInfo: string[];
  productFeatures: ProductFeature[];
  kpiObjectives: string[];
  numericInfo: NumericInformation;
  constraints: string[];
  schedule: string[];
  doNotTreatAsScope: string[];
  confirmNeeded: string[];
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

export interface ConceptDevelopmentLogic {
  winningStrategyBrief?: string;
  proposalThesis?: string;
  experienceLogic?: string;
  clientIntent: string;
  audienceTakeaway: string;
  strategicTension: string;
  conceptSeed: string;
  coreChallenge: string;
  targetInsight: string;
  brandOrProductValue: string;
  experienceOpportunity: string;
  strategicApproach: string;
  conceptNecessity: string;
  selectedConceptReason: string;
  spatialOpportunity?: string;
  conceptDevelopmentCriteria?: string[];
}

export interface ConceptEvaluationScores {
  rfpFitScore: number;
  targetFitScore: number;
  differentiationScore: number;
  spatialFeasibilityScore: number;
  viralPotentialScore: number;
  operationFeasibilityScore: number;
}

export interface ConceptCandidate {
  conceptId: string;
  conceptName: string;
  conceptTagline: string;
  conceptDefinition: string;
  conceptTitle: string;
  subtitle: string;
  conceptNameKR: string;
  conceptNameEN: string;
  oneLineDefinition: string;
  coreMessage: string;
  thesisProof: string;
  experienceStructure: string;
  expectedAssets: string[];
  strengths: string[];
  risks: string[];
  evaluationSummary: string;
  experienceLogic: string;
  keyExperienceAssetDirection: string;
  targetRelevance: string;
  spatialApplication: string;
  mediaInteractionPotential: string;
  viralPotential: string;
  executionFeasibility: string;
  whyThisWorks: string;
  riskOrCaution: string;
  evaluationScores: ConceptEvaluationScores;
}

export interface ConceptRecommendation {
  recommendedConceptId: string;
  recommendationReason: string;
  whyNotOthers: string;
}

export interface ConceptCandidatesResult {
  conceptDevelopmentLogic: ConceptDevelopmentLogic;
  concepts: ConceptCandidate[];
  recommendation: ConceptRecommendation;
}

export interface SlideOutline extends SlideNarrativeMetadata {
  slideNumber: number;
  slideType: string;
  slideTitle: string;
  keyMessage: string;
  mainCopy: string;
  confirmNeededNote: string;
}

export interface ProductExperienceDetail {
  productCode: string;
  productRole: string;
  coreValue: string;
  experienceTitle: string;
  oneLineExperience: string;
  visitorMission: string;
  visitorAction: string;
  systemResponse: string;
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

export interface ReferenceInsight {
  referenceName: string;
  referenceType: string;
  whatToLearn: string;
  howToApply: string;
  caution: string;
}

export interface ExperienceScenarioStep {
  step: 'Entry' | 'Select' | 'Experience' | 'Generate' | 'Share' | 'Exit';
  visitorAction: string;
  systemResponse: string;
  mediaOrObject: string;
  output: string;
  designNote: string;
}

export interface SlideContent extends SlideNarrativeMetadata {
  slideNumber: number;
  slideType: string;
  slideTitle: string;
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
  referenceInsights: ReferenceInsight[];
  speakerNote: string;
  confirmNeededNote: string;
  retrievalMetadata?: {
    slideNumber: number;
    slideTitle: string;
    retrievalQuery: string;
    matchedCategories: ChunkCategory[];
    evidenceCount: number;
  };
}

export interface ProposalState {
  input: ProjectInput;
  supplementalInfo?: SupplementalInfo;
  uploadedDocuments?: UploadedDocument[];
  analysis?: AnalysisResult;
  conceptDevelopmentLogic?: ConceptDevelopmentLogic;
  conceptCandidates?: ConceptCandidate[];
  conceptRecommendation?: ConceptRecommendation;
  conceptGenerationResult?: ConceptCandidatesResult;
  proposalNarrative?: ProposalNarrative;
  selectedConcept?: ConceptCandidate;
  outline?: SlideOutline[];
  slides?: SlideContent[];
  retrievalEvidence?: RetrievalEvidenceItem[];
  analysisBasis?: {
    type: 'full' | 'partial';
    label: string;
    completedPageCount?: number;
    totalPageCount?: number;
  };
}

export interface RetrievalEvidenceItem {
  sourceDocument: string;
  pageNumber?: number;
  category: string;
  categories?: string[];
  importance?: 'high' | 'medium' | 'low';
  bulletSummary: string[];
  shortExcerpt: string;
}

export const proposalTypeLabels: Record<ProposalType, string> = {
  basic: '기본형',
  cheil: '제일기획형',
  innocean: '이노션형',
  hyundai: '현대차그룹형',
  mice_event_operation: 'MICE 행사 운영형',
  conference_forum: '컨퍼런스 / 포럼형',
};
