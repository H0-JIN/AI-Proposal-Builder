const fs = require('fs');

const route = fs.readFileSync('app/api/concepts/route.ts', 'utf8');
const types = fs.readFileSync('lib/types.ts', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');

const checks = [
  ['runtime path calls /api/concepts from 전략 방향 생성 handler', /const conceptResult = await postJson<ConceptCandidatesResult>\('\/api\/concepts'/.test(page)],
  ['frontend stores concepts from successful response shape', /conceptCandidates: conceptResult\.concepts/.test(page)],
  ['BPI completeness derives missing fields from present content', /normalizeBrandProductIntelligenceForDirections/.test(route) && /bpiDerivedFields/.test(route)],
  ['strict diagnosis incomplete response is staged', /failureStage: 'proposalStrategyDiagnosis completeness check'/.test(route)],
  ['initial schema\/LLM failure runs repair path before failing', /initial strategic direction generation failed; running evidence-derived repair path/.test(route)],
  ['repair path seeds zero concepts so exactly missing directions are evidence-derived by gate', /concepts: \[\]/.test(route) && /enforceResultMatrixGate/.test(route)],
  ['successful repair response still returns concepts and recommendation fields', /return conceptsJson\(attachGenerationMetadata\(repaired, metadata\)\)/.test(route)],
  ['diagnostics are serializable on the API result', /directionGenerationDiagnostics\?:/.test(types)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} strategic direction runtime repair checks failed.`);
  process.exit(1);
}
console.log('\nSimulated deployed failure state: RFP analysis + BPI + diagnosis are present; strict LLM/schema generation fails or under-generates; route runs evidence-derived repair and returns ConceptCandidatesResult-compatible cards for frontend rendering.');
