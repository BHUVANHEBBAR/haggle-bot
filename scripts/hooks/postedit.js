'use strict';
// Claude Code PostToolUse hook: right after an edit, check the file still compiles and tell Claude if not (exit 2).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const file = String(input.tool_input?.file_path || input.tool_response?.filePath || '');
  if (!file) return;
  const rel = path.relative(ROOT, path.resolve(file)).replace(/\\/g, '/');
  if (rel.startsWith('..')) return;

  let r;
  if (/^web\/src\/.+\.(ts|tsx)$/.test(rel)) {
    r = spawnSync('npx tsc --noEmit -p .', { cwd: path.join(ROOT, 'web'), encoding: 'utf8', shell: true, timeout: 120000 });
  } else if (/^(src|scripts|test)\/.+\.js$/.test(rel)) {
    r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8', timeout: 30000 });
  } else return;

  if (r.status !== 0) {
    const out = (String(r.stdout || '') + String(r.stderr || '')).split('\n').filter(Boolean).slice(0, 15).join('\n');
    console.error(`Check failed after editing ${rel}:\n${out}`);
    process.exit(2);
  }
}

if (require.main === module) main();
