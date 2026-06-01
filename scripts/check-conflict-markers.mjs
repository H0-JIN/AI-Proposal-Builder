import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.next', 'node_modules', 'out']);
const ignoredFiles = new Set(['package-lock.json']);
const conflictMarkerPattern = /^(<{7}|={7}|>{7})/;
const findings = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;

    const fullPath = join(directory, entry);
    const relativePath = relative(root, fullPath);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!stats.isFile() || ignoredFiles.has(entry)) continue;

    const buffer = readFileSync(fullPath);
    if (buffer.includes(0)) continue;

    const content = buffer.toString('utf8');
    content.split(/\r?\n/).forEach((line, index) => {
      if (conflictMarkerPattern.test(line)) {
        findings.push(`${relativePath}:${index + 1}: ${line}`);
      }
    });
  }
}

walk(root);

if (findings.length > 0) {
  console.error('Git conflict markers were found:');
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log('No Git conflict markers found.');
