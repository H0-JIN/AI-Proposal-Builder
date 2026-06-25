import type { DocumentRole } from './dbTypes';
import type { ChunkCategory, DocumentChunk, DocumentType } from './rag';

export type ProposalType = 'basic' | 'cheil' | 'innocean' | 'hyundai' | 'basic_proposal' | 'brand_experience' | 'experience_marketing' | 'corporate_technology_showcase' | 'exhibition_booth_content' | 'multi_entity_pavilion' | 'visitor_center_tour' | 'popup_retail_experience' | 'mice_event_operation' | 'conference_forum';

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

// Which dimensions of a reference proposal the user allows to be reused. Mirrors proposal_patterns.can_use_for_*. A
// dimension can only RESTRICT (turn off) what failure-area analysis already permits — it never re-enables a failed one.
export interface ReferenceUsePolicy {
  canUseForStrategy?: boolean;
  canUseForConcept?: boolean;
  canUseForStructure?: boolean;
  canUseForContent?: boolean;
  canUseForDesign?: boolean;
  canUseForExecution?: boolean;
  canUseForOperation?: boolean;
}

// Document-level outcome/tagging metadata for a Supabase reference-library upload. Stored in documents.metadata (jsonb,
// no schema change). ALL fields optional — partial tagging is valid. `outcome` is NEVER defaulted to 'won'; an untagged
// proposal stays neutral. `outcomeReason` is the win/loss reason memo (the key the outcome classifiers already read).
export interface DbLibraryDocumentMetadata {
  outcome?: ProposalOutcome;
  outcomeLabel?: string;
  outcomeReason?: string;
  outcomeReasonType?: OutcomeReasonType;
  failureAreas?: FailureArea[];
  proposalType?: string;
  projectCategory?: string;
  clientName?: string;
  industry?: string;
  projectName?: string;
  proposalYear?: string;
  confidence?: 'user_confirmed' | 'inferred' | 'unknown';
  winReasonTags?: string[];
  lossReasonTags?: string[];
  contentTypeTags?: string[];
  technologyTags?: string[];
  experienceFormatTags?: string[];
  referenceUsePolicy?: ReferenceUsePolicy;
  createdAt?: string;
  updatedAt?: string;
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
  // Deterministic proposal-deck structure metadata (server-attached; not model-generated). Drives section ordering and
  // the slideType-branched PPTX layout so the export reads as a proposal deck, not an analysis-card report.
  slideSection?: DeckSection;
  layoutRatio?: DeckLayoutRatio;
  heroElement?: DeckHeroElement;
  visualWeight?: DeckVisualWeight;
  textDensity?: DeckTextDensity;
  pageSubtitle?: string;
  keyCopy?: string;
}

export type DeckSection = 'cover' | 'toc' | 'overview' | 'approach' | 'concept' | 'conceptStrategy' | 'content' | 'contentDetail' | 'operation' | 'closing';
export type DeckLayoutRatio = 'full-bleed-visual' | 'visual-left-text-right' | 'text-left-visual-right' | 'text-full' | 'split-50-50' | 'hero-statement';
export type DeckHeroElement = 'none' | 'big-number' | 'big-keyword' | 'full-image' | 'quote' | 'diagram';
export type DeckVisualWeight = 'text-led' | 'balanced' | 'visual-led';
export type DeckTextDensity = 'low' | 'medium' | 'high';

// Generation-time distilled concept-LOGIC structure of the current project's own uploaded reference proposal. LOGIC ONLY
// — never old copy. forbiddenCopyTerms are the reference's own concept names/slogans/page titles, captured expressly to
// BLOCK them downstream (deny-list). Computed fresh at generation (no DB write); attached to the comparison advisory.
export interface WinningReferencePatternBrief {
  strategicReframingPattern: string;
  conceptEmergencePattern: string;
  audienceQuestionPattern: string;
  brandTonePattern: string;
  signatureExperiencePattern: string;
  contentArchitecturePattern: string;
  mediaAndInteractionPattern: string;
  spatialJourneyPattern: string;
  operationProofPattern: string;
  proofPattern: string;
  deckStructurePattern: string;
  whatMadeItPersuasive: string;
  reusableLogicOnly: string;
  forbiddenCopyTerms: string[];
}

// UI-safe summary of how past won/lost proposal pattern learning informed the generated proposal structure. Carries
// NO raw old-proposal copy — only counts/flags + a scrubbed one-liner for the collapsed "수주 패턴 참고" chip.
export interface PatternLearningSummary {
  used: boolean;
  confidence: 'high' | 'medium' | 'low';
  winningPatternCount: number;
  riskCount: number;
  contentPatternUsed: boolean;
  proofPatternUsed: boolean;
  recommendedPatternRole: string | null;
  referenceBriefSummary?: string | null;
  referenceBriefIsNeutral?: boolean;
  referenceConfidenceReason?: string | null;
  referenceInfluenceLevel?: 'structural' | 'neutral-hint';
}

// Deck-level design guide (deterministic, themed by proposal type). Applied to the PPTX (fonts, colors, before/after-
// concept band styling). Pretendard is the default body font.
export interface DesignGuide {
  visualTone: string;
  fontPrimary: string;
  fontSecondary: string;
  colorMain: string;
  colorSub: string;
  colorAccent: string;
  imageStyle: string;
  iconStyle: string;
  beforeConceptStyle: string;
  afterConceptStyle: string;
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

export interface BrandProductIntelligence {
  clientOrBrandRole: string;
  productOrServiceMeaning: string;
  categoryContext: string;
  audiencePerceptionGap: string;
  brandSpecificVocabulary: string[];
  wordsToAvoid: string[];
  toneGuidance: string;
  strategyImplication: string;
  namingImplication: string;
}

export interface RfpDiagnosis {
  decisionMakerConcern: string;
  coreProposalThesis?: string;
  coreWinningCondition: string;
  hiddenRequirement?: string;
  hiddenNeed: string;
  evaluatorDecisionRisk: string;
  clientUniquePosition: string;
  strategicIssue?: string;
  strategicTension: string;
  persuasionTask?: string;
  proofBurden: string;
  genericProposalRisk?: string;
  genericProposalFailureReason: string;
  requiredPersuasionElements?: string[];
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
  // Client-side provenance stamps so the final naming section renders ONLY candidates that belong to the currently
  // selected project + strategic direction, and so a late/stale async response can never surface under another direction.
  projectKey?: string;
  directionKey?: string;
  generationBatchId?: string;
  // Globally-unique per-candidate key = projectKey::directionKey::generationBatchId::indexInBatch. The server `id`
  // restarts at name-1/2/3 every batch and therefore COLLIDES across "추가 컨셉 보기" batches; selection/highlight must
  // key off candidateKey so exactly one card is selected.
  candidateKey?: string;
  // Internal Korean concept seed: the strong Korean title built from the frame BEFORE the (often English) conceptName is
  // transcreated from it. Not shown in the main UI; available for collapsed dev/debug only.
  koreanConceptSeed?: string;
  conceptName: string;
  languageMode: ConceptNameLanguageMode;
  koreanSubtitle?: string;
  oneLineSlogan: string;
  shortMeaning: string;
  whyItFitsRfp: string;
  whyItFits?: string;
  whyItFitsSelectedDirection?: string;
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
    noRepeatedMainHook?: boolean;
    noInternalProofLanguageInMainCopy?: boolean;
    currentRfpVocabularyUsed?: boolean;
    notGeneric?: boolean;
    notCrossRfpContaminated?: boolean;
    namesAreSpecificToSelectedDirection?: boolean;
    namesDoNotFitOtherDirections?: boolean;
    noDuplicateConceptLogic?: boolean;
    noNearDuplicateNames?: boolean;
    noGenericEnglishCombination?: boolean;
    connectedToDiagnosis?: boolean;
    connectedToBrandProductIntelligence?: boolean;
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
  isStrategicChoice?: boolean;
  notRfpFactSummary?: boolean;
  notScheduleVenueScaleFact?: boolean;
  notRequirementList?: boolean;
  directionAxisIsValid?: boolean;
  hasRepresentativePersuasionScene?: boolean;
  hasDistinctWinningLogic?: boolean;
  canGenerateUniqueConceptNames?: boolean;
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



export interface ConceptDirectionScore {
  conceptId: string;
  directionLabel?: string;
  total: number;
  rfpFitScore: number;
  differentiationScore: number;
  targetFitScore: number;
  spatialFeasibilityScore: number;
  viralPotentialScore: number;
  operationFeasibilityScore: number;
}

export interface ConceptRecommendation {
  recommendedConceptId: string;
  recommendedDirectionLabel?: string;
  recommendationReason: string;
  otherDirectionsUsefulness?: string;
  tradeOffSummary?: string;
  whyNotOthers: string;
  // §3: the recommended direction is the highest-scoring one (argmax over evaluationScores), not index 0.
  recommendationScore?: number;
  scoreBreakdown?: ConceptDirectionScore[];
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
  brandProductIntelligence?: BrandProductIntelligence;
  conceptDevelopmentLogic: ConceptDevelopmentLogic;
  concepts: ConceptCandidate[];
  recommendation: ConceptRecommendation;
  directionGenerationDiagnostics?: {
    failureStage?: string;
    initialError?: string;
    initialDirectionCount?: number;
    finalDirectionCount?: number;
    repairPathRan?: boolean;
    bpiDerivedFields?: string[];
    rejectionReasons?: string[];
  };
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
  brandProductIntelligence?: BrandProductIntelligence;
  conceptDevelopmentLogic?: ConceptDevelopmentLogic;
  conceptCandidates?: ConceptCandidate[];
  conceptRecommendation?: ConceptRecommendation;
  conceptGenerationResult?: ConceptCandidatesResult;
  proposalNarrative?: ProposalNarrative;
  selectedStrategicDirection?: ConceptCandidate;
  // Index (0/1/2) of the selected strategic direction within conceptCandidates. Used to scope per-direction concept
  // name candidates so two directions never share a cache bucket even if their content-derived key collides.
  selectedDirectionIndex?: number;
  selectedConcept?: ConceptCandidate;
  conceptNameOptions?: ConceptNameOption[];
  conceptNameOptionsByDirection?: Record<string, ConceptNameOption[]>;
  selectedFinalConceptNameOption?: ConceptNameOption;
  // The exact selected candidate's candidateKey. A card is highlighted ONLY when its candidateKey equals this — so
  // exactly one card is ever selected (no id-collision multi-highlight across appended batches).
  selectedFinalConceptCandidateKey?: string;
  outline?: SlideOutline[];
  slides?: SlideContent[];
  designGuide?: DesignGuide;
  patternLearningSummary?: PatternLearningSummary;
  // Winning/losing pattern learning applied during final concept naming (phase 3-2). Shown in the naming section's
  // collapsed "수주 패턴 참고" chip. Project-scoped (cleared on a new RFP/project).
  conceptPatternLearningSummary?: PatternLearningSummary;
  // Cached generation-time reference-proposal concept-logic brief (extracted once, reused by naming + outline). null =
  // attempted, no usable brief; undefined = not yet attempted. Project-scoped (cleared on a new RFP/project).
  winningReferenceBrief?: WinningReferencePatternBrief | null;
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
  basic: '기본 제안형',
  cheil: '브랜드 경험형',
  innocean: '경험 마케팅형',
  hyundai: '기술/제품 쇼케이스형',
  basic_proposal: '기본 제안형',
  brand_experience: '브랜드 경험형',
  experience_marketing: '경험 마케팅형',
  corporate_technology_showcase: '기술/제품 쇼케이스형',
  exhibition_booth_content: '전시 부스/콘텐츠형',
  multi_entity_pavilion: '다중 기업/공동관형',
  visitor_center_tour: '견학/홍보관형',
  popup_retail_experience: '팝업/리테일 경험형',
  mice_event_operation: 'MICE 운영형',
  conference_forum: '컨퍼런스/포럼형',
};

export const proposalTypeDescriptions: Record<ProposalType, string> = {
  basic: '프로젝트 이해, 핵심 과제, 제안 전략, 컨셉, 공간/콘텐츠 구성, 실행 계획, 기대 효과가 이어지는 기본형 구조.',
  cheil: '브랜드 과제, 관람객 인식, 경험 전략, 공간·콘텐츠 아이디어, 기억/확산 포인트, 실행 계획을 강조하는 브랜드 경험형 구조.',
  innocean: '타깃 행동, 체험 동선, 브랜드 접점, 참여/공유 구조, 운영 실행성을 강조하는 경험 마케팅형 구조.',
  hyundai: '기업 비전, 기술/제품 가치, 신뢰 가능한 설득 장면, 공간/미디어 전달 방식, 실행 가능성을 강조하는 기술·제품 쇼케이스형 구조.',
  basic_proposal: '프로젝트 이해, 핵심 과제, 제안 전략, 컨셉, 공간/콘텐츠 구성, 실행 계획, 기대 효과가 이어지는 기본형 구조.',
  brand_experience: '브랜드 과제, 관람객 인식, 경험 전략, 공간·콘텐츠 아이디어, 기억/확산 포인트, 실행 계획을 강조하는 브랜드 경험형 구조.',
  experience_marketing: '타깃 행동, 체험 동선, 브랜드 접점, 참여/공유 구조, 운영 실행성을 강조하는 경험 마케팅형 구조.',
  corporate_technology_showcase: '기업 비전, 기술/제품 가치, 신뢰 가능한 설득 장면, 공간/미디어 전달 방식, 실행 가능성을 강조하는 기술·제품 쇼케이스형 구조.',
  exhibition_booth_content: '전시 목적, 메시지 구조, 부스/공간 구성, 핵심 콘텐츠, 관람 동선, 운영 대응을 강조하는 전시 부스/콘텐츠형 구조.',
  multi_entity_pavilion: '여러 기업·기관·브랜드의 공통 메시지와 개별 역할을 함께 설계하는 공동관/다중 주체형 구조.',
  visitor_center_tour: '브랜드 또는 생산/서비스 과정을 관람객이 이해하고 신뢰하도록 동선, 교육, 체험, 기억 요소를 설계하는 견학/홍보관형 구조.',
  popup_retail_experience: '짧은 기간 안에 방문, 체험, 촬영, 공유, 구매 또는 브랜드 호감을 유도하는 팝업/리테일 경험형 구조.',
  mice_event_operation: '행사 목적, 프로그램, 등록/입장, 운영 동선, 인력, 시스템, 리스크, 일정, 예산 대응을 강조하는 MICE 운영형 구조.',
  conference_forum: '아젠다, 세션 구성, 연사/발표 시스템, 등록/네트워킹, 파트너 부스, 의전, 운영 안정성을 강조하는 컨퍼런스/포럼형 구조.',
};

export function normalizeProposalType(type?: ProposalType): ProposalType {
  if (type === 'basic') return 'basic_proposal';
  if (type === 'cheil') return 'brand_experience';
  if (type === 'innocean') return 'experience_marketing';
  if (type === 'hyundai') return 'corporate_technology_showcase';
  return type ?? 'basic_proposal';
}
