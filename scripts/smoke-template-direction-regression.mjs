import fs from 'node:fs';
import assert from 'node:assert/strict';

const concepts = fs.readFileSync('app/api/concepts/route.ts', 'utf8');
const naming = fs.readFileSync('app/api/concept-names/route.ts', 'utf8');

assert(!/AXIS_LABEL_TEMPLATES\s*=/.test(concepts), 'legacy axis label template map must not exist');
assert(!/representative_position:\s*\(c\)\s*=>\s*`\$\{c\}\s*대표성 각인`/.test(concepts), 'fallback must not produce subject + 대표성 각인');
assert(!/technology_reality_proof:\s*\(c\)\s*=>\s*`\$\{c\}\s*현재화`/.test(concepts), 'fallback must not produce subject + 현재화');
assert(!/system\/ecosystem_proof['"]?:\s*\(c\)\s*=>\s*`통합\s*\$\{c\}\s*생태계`/.test(concepts), 'fallback must not produce 통합 subject 생태계');
assert(/TEMPLATE_LIKE_DIRECTION_LABEL_PATTERNS/.test(concepts), 'hard template-like direction validation must be present');
assert(/assertNoTemplateDirectionSet\(concepts, 'post-repair'\)/.test(concepts), 'post-repair strategic direction set must be rejected, not rendered');
assert(/strategy_generation_failed_no_fallback_cards/.test(concepts), 'model errors must return structured failure instead of fallback cards');
assert(/strategy_generation_incomplete/.test(concepts), 'fewer than 3 strategic directions must fail instead of being padded by fallback cards');

for (const bad of ['Play 현재화', 'Expo 대표성 각인', '통합 Play 생태계', 'HTWO 현재화', 'Hyundai 대표성 각인', '통합 HTWO 생태계']) {
  assert(!concepts.includes(bad), `${bad} must not be hardcoded as an allowed output`);
}

assert(/\^현장\(\?:증명\|응답\|연결\)\$/.test(naming), 'concept-name validation must reject 현장증명/현장응답/현장연결');
assert(/partial_failure_retry_required/.test(naming), 'partial valid naming result must expose retry-required state');
assert(/canGenerateProposalStructure:\s*!partialFailure\s*&&\s*finalOptions\.length\s*===\s*3/.test(naming), 'proposal structure generation must be gated on exactly 3 names');

console.log('template direction and concept-name regression smoke checks passed');
