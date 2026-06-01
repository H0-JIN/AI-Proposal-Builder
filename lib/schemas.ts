const stringArray = { type: 'array', items: { type: 'string' } } as const;

const analysisSectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rfpFact: stringArray,
    aiProposal: stringArray,
    confirmNeeded: stringArray,
  },
  required: ['rfpFact', 'aiProposal', 'confirmNeeded'],
} as const;

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectOverview: { type: 'string' },
    clientChallenge: { type: 'string' },
    requiredItems: stringArray,
    constraints: stringArray,
    targetInfo: { type: 'string' },
    spatialCondition: { type: 'string' },
    contentCondition: { type: 'string' },
    operationCondition: { type: 'string' },
    kpiScheduleConstraints: stringArray,
    missingInfo: stringArray,
    rfpRequirements: analysisSectionSchema,
    clientTask: analysisSectionSchema,
    targetSpaceContentOperation: analysisSectionSchema,
    kpiTimelineConstraints: analysisSectionSchema,
  },
  required: [
    'projectOverview',
    'clientChallenge',
    'requiredItems',
    'constraints',
    'targetInfo',
    'spatialCondition',
    'contentCondition',
    'operationCondition',
    'kpiScheduleConstraints',
    'missingInfo',
    'rfpRequirements',
    'clientTask',
    'targetSpaceContentOperation',
    'kpiTimelineConstraints',
  ],
} as const;


export const conceptCandidatesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    concepts: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          conceptId: { type: 'string' },
          conceptNameKR: { type: 'string' },
          conceptNameEN: { type: 'string' },
          oneLineDefinition: { type: 'string' },
          coreMessage: { type: 'string' },
          experienceLogic: { type: 'string' },
          targetRelevance: { type: 'string' },
          keyExperienceAssetDirection: { type: 'string' },
          whyThisWorks: { type: 'string' },
        },
        required: [
          'conceptId',
          'conceptNameKR',
          'conceptNameEN',
          'oneLineDefinition',
          'coreMessage',
          'experienceLogic',
          'targetRelevance',
          'keyExperienceAssetDirection',
          'whyThisWorks',
        ],
      },
    },
  },
  required: ['concepts'],
} as const;

export const outlineJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slides: {
      type: 'array',
      minItems: 20,
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slideNumber: { type: 'number' },
          slideType: { type: 'string' },
          slideTitle: { type: 'string' },
          slidePurpose: { type: 'string' },
          keyMessage: { type: 'string' },
          confirmNeededNote: { type: 'string' },
        },
        required: ['slideNumber', 'slideType', 'slideTitle', 'slidePurpose', 'keyMessage', 'confirmNeededNote'],
      },
    },
  },
  required: ['slides'],
} as const;

export const slideContentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slides: {
      type: 'array',
      minItems: 20,
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slideNumber: { type: 'number' },
          slideType: { type: 'string' },
          slideTitle: { type: 'string' },
          slidePurpose: { type: 'string' },
          keyMessage: { type: 'string' },
          mainCopy: { type: 'string' },
          bodyBullets: { type: 'array', minItems: 3, maxItems: 7, items: { type: 'string' } },
          visualDirection: { type: 'string' },
          visitorAction: { type: 'string' },
          contentMechanism: { type: 'string' },
          spatialPlacement: { type: 'string' },
          mediaOrObject: { type: 'string' },
          outputOrReward: { type: 'string' },
          imagePlaceholder: { type: 'string' },
          visualPrompt: { type: 'string' },
          diagramSuggestion: { type: 'string' },
          speakerNote: { type: 'string' },
          confirmNeededNote: { type: 'string' },
        },
        required: [
          'slideNumber',
          'slideType',
          'slideTitle',
          'slidePurpose',
          'keyMessage',
          'mainCopy',
          'bodyBullets',
          'visualDirection',
          'visitorAction',
          'contentMechanism',
          'spatialPlacement',
          'mediaOrObject',
          'outputOrReward',
          'imagePlaceholder',
          'visualPrompt',
          'diagramSuggestion',
          'speakerNote',
          'confirmNeededNote',
        ],
      },
    },
  },
  required: ['slides'],
} as const;
