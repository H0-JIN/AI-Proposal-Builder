export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectOverview: { type: 'string' },
    clientChallenge: { type: 'string' },
    requiredItems: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    targetInfo: { type: 'string' },
    spatialCondition: { type: 'string' },
    contentCondition: { type: 'string' },
    missingInfo: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'projectOverview',
    'clientChallenge',
    'requiredItems',
    'constraints',
    'targetInfo',
    'spatialCondition',
    'contentCondition',
    'missingInfo',
  ],
} as const;

export const outlineJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slides: {
      type: 'array',
      minItems: 8,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slideNumber: { type: 'number' },
          slideTitle: { type: 'string' },
          slidePurpose: { type: 'string' },
          keyMessage: { type: 'string' },
        },
        required: ['slideNumber', 'slideTitle', 'slidePurpose', 'keyMessage'],
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
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slideNumber: { type: 'number' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          bodyBullets: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
          imagePlaceholder: { type: 'string' },
          diagramSuggestion: { type: 'string' },
        },
        required: ['slideNumber', 'title', 'subtitle', 'bodyBullets', 'imagePlaceholder', 'diagramSuggestion'],
      },
    },
  },
  required: ['slides'],
} as const;
