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

export const outlineJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slides: {
      type: 'array',
      minItems: 12,
      maxItems: 16,
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
      minItems: 12,
      maxItems: 16,
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
          imagePlaceholder: { type: 'string' },
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
          'imagePlaceholder',
          'diagramSuggestion',
          'speakerNote',
          'confirmNeededNote',
        ],
      },
    },
  },
  required: ['slides'],
} as const;
