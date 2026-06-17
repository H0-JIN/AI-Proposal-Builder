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

const fallbackMatch = concepts.match(/const TYPE_SPECIFIC_FALLBACK_LABELS[\s\S]*?;\n\nfunction fallbackLabelsForType/);
if (!fallbackMatch) throw new Error('TYPE_SPECIFIC_FALLBACK_LABELS not found');
const fallbackBlock = fallbackMatch[0];
const nonMultiFallbackBlock = fallbackBlock.replace(/multi_entity_pavilion:\s*\[[^\]]*\],/, 'multi_entity_pavilion: [],');
for (const term of bannedDefaultLabels) {
  if (nonMultiFallbackBlock.toLowerCase().includes(term.toLowerCase())) {
    throw new Error(`Banned WDS label found in non-multi fallback labels: ${term}`);
  }
}

const universalFallbackPatterns = [
  /fallbackPresets\s*=\s*\[[\s\S]*?\];/,
  /fallbackLabelsForType\(type\).*?TYPE_SPECIFIC_FALLBACK_LABELS\.unknown/s,
];
for (const pattern of universalFallbackPatterns) {
  const match = concepts.match(pattern);
  if (!match) continue;
  for (const term of bannedDefaultLabels) {
    if (match[0].toLowerCase().includes(term.toLowerCase())) {
      throw new Error(`Banned WDS label found in universal fallback block: ${term}`);
    }
  }
}

if (!/matrixType !== 'entityDifferentiationMatrix' \|\| primaryRfpConceptType !== 'multi_entity_pavilion'/.test(page)) {
  throw new Error('Entity Differentiation Matrix UI is not gated by both matrixType and primaryRfpConceptType');
}

if (!/proposalPatternsUsedForDirections:\s*params\.primaryType === 'multi_entity_pavilion'/.test(concepts)) {
  throw new Error('proposalPatternsUsedForDirections is not disabled for non-multi-entity RFPs');
}

console.log('WDS contamination smoke checks passed');
