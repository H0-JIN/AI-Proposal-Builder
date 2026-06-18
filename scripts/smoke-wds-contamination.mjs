import { readFileSync } from 'node:fs';

const concepts = readFileSync('app/api/concepts/route.ts', 'utf8');
const page = readFileSync('app/page.tsx', 'utf8');
const bannedDefaultLabels = [
  '통합 아이덴티티',
  '통합+역할 차별화',
  '역할 차별화',
  '상징적 리더십',
  'unified identity',
  'unified + differentiated roles',
  'role differentiation',
  'symbolic leadership',
];

if (/const TYPE_SPECIFIC_FALLBACK_LABELS/.test(concepts) || /function fallbackLabelsForType/.test(concepts)) {
  throw new Error('Fixed RFP-type fallback direction label presets must not drive strategic directions');
}

const nonMultiRepairBlocks = concepts.match(/if \(params\.primaryType !== 'multi_entity_pavilion'[\s\S]*?blockedTerms =/g) ?? [];
for (const block of nonMultiRepairBlocks) {
  for (const term of bannedDefaultLabels) {
    if (block.toLowerCase().includes(term.toLowerCase())) {
      throw new Error(`Banned WDS label found in non-multi repair block: ${term}`);
    }
  }
}

if (!/matrixType !== 'entityDifferentiationMatrix' \|\| primaryRfpConceptType !== 'multi_entity_pavilion'/.test(page)) {
  throw new Error('Entity Differentiation Matrix UI is not gated by both matrixType and primaryRfpConceptType');
}

if (!/proposalPatternsUsedForDirections:\s*params\.primaryType === 'multi_entity_pavilion'/.test(concepts)) {
  throw new Error('proposalPatternsUsedForDirections is not disabled for non-multi-entity RFPs');
}

if (!/Strategic Direction Discovery Brief/.test(concepts) || !/possibleDirectionAxes/.test(concepts)) {
  throw new Error('Strategic Direction Discovery Brief and possibleDirectionAxes are required');
}

console.log('WDS contamination smoke checks passed');
