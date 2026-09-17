#!/usr/bin/env node
/**
 * Usage:
 *   node split-diff.mjs --repo <path> --base <branch> --target <branch> --pr <number> [--output <dir>]
 *
 * Options:
 *   --repo     Path to local git repo
 *   --base     Base branch (e.g. uat, main)
 *   --target   PR source branch (e.g. uatfix/JEC-2240)
 *   --pr       PR number (used in session folder name)
 *   --output   Root output folder (default: ./_prr-output/reviews)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// --- Parse args ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const repo      = get('--repo');
const base      = get('--base');
const target    = get('--target');
const pr        = get('--pr');
const output    = get('--output') ?? './github-pr-master-output';
const baseSha   = get('--base-sha');
const targetSha = get('--target-sha');

if (!repo || !base || !target) {
  console.error('Usage: node split-diff.mjs --repo <path> --base <branch> --target <branch> --pr <number> [--output <dir>] [--base-sha <sha>] [--target-sha <sha>]');
  process.exit(1);
}

// --- Session folder ---
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const prefix = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const slug = [pr ? `pr${pr}` : null, target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/, '').slice(0, 40)]
  .filter(Boolean).join('-');
const sessionDir = path.resolve(output, `${prefix}-${slug}`);
const diffsDir   = path.join(sessionDir, 'diffs');
fs.mkdirSync(diffsDir, { recursive: true });

console.log(`Session: ${sessionDir}`);

// --- Fetch + save full diff ---
console.log('Fetching origin...');
execSync(`git -C "${repo}" fetch origin --prune --no-recurse-submodules`, { stdio: 'inherit' });

const BIG_BUFFER = 512 * 1024 * 1024; // 512 MB — large enough for repo-wide diffs
const baseRef   = baseSha   ?? `origin/${base}`;
const targetRef = targetSha ?? `origin/${target}`;
const diffCmd = `git -C "${repo}" diff ${baseRef}...${targetRef}`;
const raw = execSync(diffCmd, { maxBuffer: BIG_BUFFER }).toString();
fs.writeFileSync(path.join(sessionDir, 'full.diff'), raw, 'utf8');

const statCmd = `git -C "${repo}" diff --stat ${baseRef}...${targetRef}`;
const stat = execSync(statCmd, { maxBuffer: BIG_BUFFER }).toString();
console.log('\nDiff stat:\n' + stat);

// --- Parse diff ---
const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));
const files = [];
let current = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (line.startsWith('diff --git ')) {
    if (current) files.push(current);
    const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    current = { path: match?.[2] ?? line, status: 'modified', added: 0, removed: 0, hunks: [] };
    continue;
  }

  if (!current) continue;

  if (line.startsWith('new file mode'))      { current.status = 'added';   continue; }
  if (line.startsWith('deleted file mode'))  { current.status = 'deleted'; continue; }
  if (line.startsWith('rename to '))         { current.status = 'renamed'; current.path = line.replace('rename to ', ''); continue; }

  if (line.startsWith('@@ ')) {
    const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    const startLine = m ? parseInt(m[1]) : 0;
    const hunkLines = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('@@') && !lines[j].startsWith('diff --git ')) {
      const l = lines[j];
      hunkLines.push(l);
      if (l.startsWith('+') && !l.startsWith('+++')) current.added++;
      if (l.startsWith('-') && !l.startsWith('---')) current.removed++;
      j++;
    }
    current.hunks.push({ startLine, lines: hunkLines });
    i = j - 1;
  }
}
if (current) files.push(current);

// --- Write per-file .md ---
let count = 0;
for (const file of files) {
  const outPath = path.join(diffsDir, file.path + '.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let md = `# ${file.path}\n**Status:** ${file.status} | **+${file.added} / -${file.removed} lines**\n---\n\n`;

  for (const hunk of file.hunks) {
    const hasChanges = hunk.lines.some(l => l.startsWith('+') || l.startsWith('-'));
    if (!hasChanges) continue;

    const newLines = hunk.lines.filter(l => !l.startsWith('-'));
    const endLine  = hunk.startLine + newLines.length - 1;
    md += endLine > hunk.startLine
      ? `**Lines ${hunk.startLine}–${endLine}**\n`
      : `**Line ${hunk.startLine}**\n`;

    md += '```diff\n';
    for (const l of hunk.lines) {
      if (l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')) md += l + '\n';
    }
    md += '```\n\n';
  }

  fs.writeFileSync(outPath, md, 'utf8');
  count++;
}

console.log(`\nCreated ${count} diff files → ${diffsDir}`);
