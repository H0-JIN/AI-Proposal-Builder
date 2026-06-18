import type { DocumentRole } from './dbTypes';
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
  | '추출 실패'
  | '원본 저장 / 텍스트 추출 실패';

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
  pageNumber?: number;
  slideNumber?: number;
  sectionTitle?: string;
  text: string;
  sourceType: 'textExtraction' | 'visionAnalysis';
  visualSummary?: string;
}

export type ProposalOutcome = 'won' | 'lost' | 'unknown';
export type OutcomeReasonType = 'external' | 'quality' | 'mixed' | 'unknown';
export type FailureArea = 'concept' | 'strategy' | 'structure' | 'content' | 'design' | 'execution' | 'operation' | 'differentiation' | 'budget_external' | 'schedule_external' | 'procurement_external' | 'unknown';

export interface DbLibraryDocumentMetadata {
  outcome?: ProposalOutcome;
  outcomeReason?: string;
  outcomeReasonType?: OutcomeReasonType;
  failureAreas?: FailureArea[];
  originalFileName?: string;
  uploadedVia?: 'db_library_upload';
}

export interface UploadedDocument {
  id: string;
  fileName: string;
  fileType: string;
  documentType?: DocumentType;
  documentRole?: Extract<DocumentRole, 'rfp' | 'proposal' | 'reference' | 'memo'>;
  dbSaveStatus?: 'idle' | 'disabled' | 'saving' | 'saved' | 'failed' | 'partial';
  dbProjectId?: string;
  dbDocumentId?: string;
  dbChunkCount?: number;
  proposalPatternStatus?: 'extracting' | 'extracted' | 'skipped' | 'failed';
  proposalPatternCount?: number;
  dbLibraryMetadata?: DbLibraryDocumentMetadata;
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

export interface EntityDifferentiationItem {
  entityName: string;
  entityType: string;
  sourceEvidence: string;
  roleInProject: string;
  keyOffering: string;
  audienceTakeaway: string;
  distinctMessage: string;
  proofPoint: string;
  spatialOrContentRole: string;
  experienceMechanism: string;
  visualOrToneCue: string;
  relationshipToOtherEntities: string;
  riskIfUndifferentiated: string;
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
  unifyingFrame?: string;
  differentiationPrinciple?: string;
  entityDifferentiationMatrix?: EntityDifferentiationItem[];
  riskOfOverIntegration?: string;
  howToAvoidSimilarity?: string;
  currentRfpSpecificity?: string;
}

export type SlidePurpose = 'Problem' | 'Insight' | 'Strategy' | 'Concept' | 'Experience' | 'Content' | 'Proof' | 'Impact';

export interface SlideNarrativeMetadata {
  slidePurpose: string;
  slideRole?: string;
  relationToThesis?: string;
  whyThisSlideExists?: string;
  sourceEvidence?: string[];
  referenceAllowed?: boolean;
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
  primaryRfpConceptType?: RfpConceptType;
  matrixType?: MatrixType;
  selectedDirectionLensSet?: string[];
  classificationConfidence?: 'high' | 'medium' | 'low';
  classificationReason?: string;
  multiEntityEvidenceCount?: number;
  singleBrandVisitorRoomEvidenceCount?: number;
  missingInfo: string[];
  rfpRequirements: AnalysisSection;
  clientTask: AnalysisSection;
  targetSpaceContentOperation: AnalysisSection;
  kpiTimelineConstraints: AnalysisSection;
}

export interface HiddenNeedsLayer {
  surfaceRequest: string;
  hiddenNeed: string;
  clientAnxiety: string;
  decisionTrigger: string;
  evaluationRisk: string;
  realWinningCondition: string;
}

export interface StrategicApproachLayer {
  strategicTension: string;
  winningApproach: string;
  differentiationLogic: string;
  audiencePerceptionShift: string;
  proofLogic: string;
}

export interface KeywordExecutionGuide {
  keyword: string;
  spatialUXImplication: string;
  designImplication: string;
  contentImplication: string;
  contentOrMediaImplication?: string;
  operationImplication?: string;
}

export interface AntiPatternValidation {
  riskToAvoid: string;
  howThisConceptAvoidsIt: string;
  validationCheck: string;
  validationCriteria: string[];
  passed: boolean;
  validationSummary: string;
}

export interface ConceptMetaphorSource {
  metaphorSeed: string;
  symbolicImage: string;
  proposalWorld: string;
  whyThisCanBecomeAConceptTitle: string;
  sourceTypes: string[];
  rfpEvidence: string[];
}

export interface ConceptMechanism {
  experienceMechanism: string;
  spatialMechanism: string;
  contentMechanism: string;
  interactionMechanism: string;
  recognitionLogic: string;
  visitorOrAudienceTransformation: string;
  proofMechanism: string;
  whyThisCanBecomeAConcept: string;
}

export interface RfpDiagnosis {
  decisionMakerConcern: string;
  coreWinningCondition: string;
  hiddenNeed: string;
  evaluatorDecisionRisk: string;
  clientUniquePosition: string;
  strategicTension: string;
  proofBurden: string;
  genericProposalFailureReason: string;
  requiredProofElements: string[];
  rfpEvidenceAnchors: string[];
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

export interface ConceptRationale {
  problemInsight: string;
  clientNeed: string;
  audienceBarrier: string;
  strategicShift: string;
  whyThisConcept: string;
}

export interface ConceptEvaluationScores {
  rfpFitScore: number;
  targetFitScore: number;
  differentiationScore: number;
  spatialFeasibilityScore: number;
  viralPotentialScore: number;
  operationFeasibilityScore: number;
}

export interface EntityDifferentiationUse {
  unifyingFrame: string;
  distinctEntityRoles: string;
  visitorRecognitionLogic: string;
  proofByEntity: string;
  riskCheck: string;
}

export type ConceptNameScopeClassification = 'proposal_level' | 'section_level' | 'content_module_level' | 'product_specific_level' | 'generic_label';
export type ConceptNameEvidenceLevel = 'proposalLevel' | 'entityLevel' | 'contentDetail' | 'referenceOnly';

export type NameValidationStatus = 'passed' | 'repaired' | 'warning';

export interface ConceptNameValidationDebug {
  nameValidationStatus: NameValidationStatus;
  originalName: string;
  repairedName: string;
  reason: string;
}

export interface ConceptScopeValidation {
  coversWholeProposal: boolean;
  coversMainEntitiesOrScope: boolean;
  expandableToSpace: boolean;
  expandableToContent: boolean;
  expandableToMediaOrInteraction: boolean;
  expandableToOperationOrProof: boolean;
  notProductSpecificOnly: boolean;
  notSectionTitleOnly: boolean;
}


export interface WinningThesis {
  contextShift: string;
  previousBaseline: string;
  newReality: string;
  clientUniquePosition: string;
  audiencePerceptionGap: string;
  winningClaim: string;
  whyNow: string;
  whyThisClient: string;
  whatMustBeProven: string;
}

export interface ConceptLeap {
  fromStatement: string;
  toStatement: string;
  conceptLeap: string;
  corePromise: string;
  emotionalTakeaway: string;
  evaluatorTakeaway: string;
}

export interface SignatureProofIdea {
  signatureScene: string;
  signatureContent: string;
  signatureSpatialMove: string;
  signatureMediaOrInteraction: string;
  whyThisProvesTheConcept: string;
  whyThisIsNotGeneric: string;
}

export type EntityBalanceStatus = 'balanced' | 'over-focused' | 'unknown';

export type ConceptNameLanguageMode = 'Korean' | 'English' | 'bilingual';

export interface ConceptNameOption {
  id?: string;
  conceptName: string;
  languageMode: ConceptNameLanguageMode;
  koreanSubtitle?: string;
  oneLineSlogan: string;
  shortMeaning: string;
  whyItFitsRfp: string;
  whyItFits?: string;
  strategicClaim?: string;
  expandableTo?: { space: string; content: string; media: string; operation: string };
  validation?: {
    coverReady: boolean;
    connectedToCoreWinningCondition: boolean;
    connectedToSelectedDirection?: boolean;
    currentRfpSpecific?: boolean;
    noPromptExampleCopy?: boolean;
    noCrossRfpContamination?: boolean;
    notGenericEnglishCombination: boolean;
    notInternalStrategyLabel: boolean;
    notSlideTitle: boolean;
    notTooLong: boolean;
    expandableToProposalSystem: boolean;
    specificToCurrentRfp: boolean;
  };
  coverReadinessScore?: number;
  specificityScore?: number;
  coverTitleScore: number;
  memorabilityScore: number;
  rfpSpecificityScore: number;
  expandabilityScore: number;
  risk: string;
  namingStyle?: 'Direct claim' | 'Short bilingual title' | 'Brand/category-specific phrase' | 'Spatial/experience frame' | 'Symbolic but grounded' | 'Strong one-line statement' | 'Direct strategic' | 'Brand / sensory' | 'Spatial / system' | 'Symbolic' | 'Global English / bilingual';
  mainRisk?: string;
}


export interface ConceptNameOptionsResult {
  selectedDirectionId: string;
  options: ConceptNameOption[];
  recommendedOptionIndex: number;
  generationNote: string;
}

export type MatrixType =
  | 'entityDifferentiationMatrix'
  | 'brandExperienceMatrix'
  | 'productExperienceMatrix'
  | 'operationTrustMatrix'
  | 'none';

export interface BrandExperienceMatrixItem {
  brandMeaning: string;
  visitorQuestion: string;
  experienceStage: string;
  processOrProofPoint: string;
  spatialMoment: string;
  sensoryOrEmotionalCue: string;
  memoryAfterVisit: string;
}

export type RfpConceptType =
  | 'multi_entity_pavilion'
  | 'single_brand_experience'
  | 'visitor_center_or_tour'
  | 'product_experience_space'
  | 'pop_up_or_campaign'
  | 'exhibition_booth'
  | 'content_media_experience'
  | 'operation_heavy_event'
  | 'public_sector_exhibition'
  | 'technology_showcase'
  | 'unknown';

export interface StrategicDirectionQualityValidation {
  isStrategicBet: boolean;
  isOnlyBasicRequirement: boolean;
  addressesCoreWinningCondition: boolean;
  addressesStrategicTension: boolean;
  addressesProofBurden: boolean;
  hasDistinctPointOfView: boolean;
  couldFitAnyRfp: boolean;
  validationReason: string;
}

export interface ConceptCandidate {
  conceptId: string;
  rfpConceptType: RfpConceptType;
  secondaryRfpConceptTypes?: RfpConceptType[];
  strategicDirectionType: string;
  strategicDirectionLabel: string;
  strategicDirectionQualityValidation?: StrategicDirectionQualityValidation;
  directionLabel?: string;
  oneLineSummary?: string;
  directionAxis?: string;
  whyThisDirectionExists?: string;
  whatThisDirectionEmphasizes: string;
  oneLineStrategicBet?: string;
  whenToChooseThisDirection: string;
  directionSource?: { rfpEvidence: string; proposalPatternLearning: string; lostPatternAvoidance: string };
  failurePatternAvoided?: string;
  winningPatternUsed?: string;
  directionDebug?: { source: string; failurePatternAvoided: string; winningPatternUsed: string; confidence: string };
  proposalCoreConceptName: string;
  repairedProposalCoreConceptName?: string;
  nameValidationStatus?: NameValidationStatus;
  nameValidation?: ConceptNameValidationDebug;
  proposalCoreConceptSlogan: string;
  proposalCoreConceptDefinition: string;
  winningThesisUse: WinningThesis;
  conceptLeap: ConceptLeap;
  signatureProofIdea: SignatureProofIdea;
  whyThisIsCoreConcept: string;
  experiencePrinciple: string;
  visitorJourney: string;
  contentMediaImplication: string;
  conceptName: string;
  conceptSlogan: string;
  conceptTagline: string;
  conceptDefinition: string;
  hiddenNeedResolved: string;
  strategicApproach: string;
  whyThisConcept: string;
  conceptMechanism: ConceptMechanism;
  conceptMetaphorSource: ConceptMetaphorSource;
  rfpGrounding: string[];
  whyThisNameFitsRfp: string;
  whyThisIsNotJustPoetic: string;
  whyThisCanOrganizeProposal: string;
  whyThisNameWorks: string;
  conceptKeywords: [string, string, string];
  keywordExecutionGuide: KeywordExecutionGuide[];
  experienceNarrativeFlow: string[];
  antiPatternValidation: AntiPatternValidation;
  mainStrength: string;
  mainRisk: string;
  requiredProofElementsAddressed?: string[];
  executionKeywords?: string[];
  entityDifferentiationUse: EntityDifferentiationUse;
  conceptRationale?: ConceptRationale;
  conceptTitle: string;
  subtitle: string;
  conceptNameKR: string;
  conceptNameEN: string;
  conceptNameEnglish?: string;
  conceptNameKoreanSubtitle?: string;
  conceptSloganKorean?: string;
  conceptSloganEnglish?: string;
  conceptScopeValidation?: ConceptScopeValidation;
  conceptNameScopeClassification?: ConceptNameScopeClassification;
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
  namingGuardWarning?: string;
  coveredEntities?: string[];
  missingEntities?: string[];
  dominantEntity?: string;
  entityBalanceStatus?: EntityBalanceStatus;
  dominantEntityInName?: string;
  productSpecificNameDetected?: boolean;
  coversWholeRfp?: boolean;
  conceptNameEvidenceLevel?: ConceptNameEvidenceLevel;
  repairedName?: boolean;
  finalConceptName?: string;
  finalConceptSlogan?: string;
  finalConceptNameOption?: ConceptNameOption;
  selectedDirection?: ConceptCandidate;
}



export interface ConceptRecommendation {
  recommendedConceptId: string;
  recommendedDirectionLabel?: string;
  recommendationReason: string;
  otherDirectionsUsefulness?: string;
  tradeOffSummary?: string;
  whyNotOthers: string;
}

export interface ConceptNamingGuardNotice {
  message: string;
  repairedConceptIds: string[];
  warningConceptIds: string[];
  violations: string[];
}

export interface ConceptCandidatesResult {
  conceptPromptVersion?: string;
  regenerationId?: string;
  generationAttempt?: number;
  generatedAt?: string;
  hiddenNeeds: HiddenNeedsLayer;
  strategicApproach: StrategicApproachLayer;
  matrixType?: MatrixType;
  brandExperienceMatrix?: BrandExperienceMatrixItem[];
  selectedDirectionLensSet?: string[];
  activeMatrixSummary?: string;
  rawPrimaryRfpConceptType?: RfpConceptType;
  rawMatrixType?: MatrixType;
  activeMatrixType?: MatrixType;
  hasEntityDifferentiationMatrix?: boolean;
  entityMatrixActive?: boolean;
  brandMatrixActive?: boolean;
  sanitizerApplied?: boolean;
  sanitizerReason?: string;
  proposalPatternsUsedForDirections?: boolean;
  currentRfpOnlyMode?: boolean;
  contaminationCheckPassed?: boolean;
  blockedTerms?: string[];
  primaryRfpConceptType?: RfpConceptType;
  classificationConfidence?: 'high' | 'medium' | 'low';
  classificationReason?: string;
  multiEntityEvidenceCount?: number;
  singleBrandVisitorRoomEvidenceCount?: number;
  entityDifferentiationMatrix: EntityDifferentiationItem[];
  rfpDiagnosis?: RfpDiagnosis;
  conceptDevelopmentLogic: ConceptDevelopmentLogic;
  concepts: ConceptCandidate[];
  recommendation: ConceptRecommendation;
  directionValidation?: {
    allDirectionsAreStrategicBets?: boolean;
    noBasicRequirementDirections?: boolean;
    allDirectionsAddressCoreWinningCondition?: boolean;
    allDirectionsAddressProofBurden?: boolean;
    noCouldFitAnyRfpDirections?: boolean;
    weakDirectionLabels?: string[];
    directionsAreRfpSpecific?: boolean;
    noFixedPresetLabels?: boolean;
    directionAxesAreDistinct?: boolean;
    currentRfpEvidenceDominates?: boolean;
    proposalPatternsOnlyModify?: boolean;
    noCrossRfpContamination?: boolean;
    noInvalidMultiEntityLanguage?: boolean;
    noHardcodedPresetLabels: boolean;
    eachDirectionHasPatternReason: boolean;
    eachDirectionHasRfpEvidence: boolean;
    directionsAreDistinct: boolean;
    lostPatternUsedAsAvoidanceOnly: boolean;
    wonPatternUsedAsPositiveReference: boolean;
  };
  namingGuardNotice?: ConceptNamingGuardNotice;
  evidenceBalance?: {
    status: EntityBalanceStatus;
    dominantEntity?: string;
    coveredEntities: string[];
  };
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
  sourceEvidence: string;
  referenceAllowed: boolean;
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
  dbUploadedDocuments?: UploadedDocument[];
  analysis?: AnalysisResult;
  rfpDiagnosis?: RfpDiagnosis;
  conceptDevelopmentLogic?: ConceptDevelopmentLogic;
  conceptCandidates?: ConceptCandidate[];
  conceptRecommendation?: ConceptRecommendation;
  conceptGenerationResult?: ConceptCandidatesResult;
  proposalNarrative?: ProposalNarrative;
  selectedStrategicDirection?: ConceptCandidate;
  selectedConcept?: ConceptCandidate;
  conceptNameOptions?: ConceptNameOption[];
  selectedFinalConceptNameOption?: ConceptNameOption;
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
