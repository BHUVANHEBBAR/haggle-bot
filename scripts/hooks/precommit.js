'use strict';
// Pre-commit gate, used two ways:
//   Claude Code PreToolUse hook on `git commit` (JSON on stdin; exit 2 blocks the commit and shows the reason to Claude)
//   git hooks in .githooks/ (`--git` for pre-commit, `--msg <file>` for commit-msg)
// Rules: no Claude co-author line (project rule), no secrets in changed files, tests pass, types check, built app not stale.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scanFiles } = require('./secret-scan');

const ROOT = path.join(__dirname, '..', '..');
const TRAILERS = [
  [/Co-Authored-By:\s*Claude/i, 'a "Co-Authored-By: Claude" trailer'],
  [/Generated with \[?Claude Code/i, 'a "Generated with Claude Code" line'],
  [/noreply@anthropic\.com/i, 'the Claude noreply address'],
];

const isCommit = (cmd) => /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*commit\b/.test(cmd) && !/\bgit\s+commit-tree\b/.test(cmd);

function attributionProblems(text) {
  if (process.env.ALLOW_COAUTHOR === '1') return [];
  return TRAILERS.filter(([re]) => re.test(text)).map(([, what]) => `commit message contains ${what} (this repo's commits are authored by the owner only; remove it)`);
}

// one command string through the shell: npm and npx are .cmd files on Windows (args here are fixed literals, never user input)
const run = (cmd, args, cwd = ROOT) => spawnSync([cmd, ...args].join(' '), { cwd, encoding: 'utf8', shell: true, timeout: 300000 });

// files this commit could include: staged now, plus modified or new files a `git add` in the same command would stage
function changedFiles() {
  const out = run('git', ['status', '--porcelain', '-z', '--untracked-files=all']).stdout || '';
  return out.split('\0').filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.includes(' -> '));
}

function newestMtime(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

function checks({ skipSlow = false } = {}) {
  const problems = [];
  const hits = scanFiles(changedFiles());
  for (const h of hits) problems.push(`secret check: ${h.file} matches rule "${h.rule}" (value not shown)`);
  if (skipSlow) return problems;

  const t = run('npm', ['test', '--silent']);
  if (t.status !== 0) problems.push('npm test failed:\n' + String(t.stdout || '').split('\n').filter((l) => /^(not ok|# fail|ℹ fail)|✖/.test(l)).slice(0, 12).join('\n'));

  const web = path.join(ROOT, 'web');
  if (fs.existsSync(path.join(web, 'node_modules'))) {
    const c = run('npx', ['tsc', '--noEmit', '-p', '.'], web);
    if (c.status !== 0) problems.push('tsc --noEmit failed in web/:\n' + String(c.stdout || '').split('\n').slice(0, 12).join('\n'));
    const built = path.join(ROOT, 'public', 'app', 'index.html');
    if (fs.existsSync(built) && newestMtime(path.join(web, 'src')) > fs.statSync(built).mtimeMs + 1000) {
      problems.push('public/app/ is older than web/src: run "npm run build" in web/ so the committed app matches the source');
    }
  }
  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--msg') { // git commit-msg hook
    const probs = attributionProblems(fs.readFileSync(argv[1], 'utf8'));
    if (probs.length) { console.error('Commit blocked:\n - ' + probs.join('\n - ')); process.exit(1); }
    return;
  }
  if (argv[0] === '--git') { // git pre-commit hook: staged files only
    const staged = (run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']).stdout || '').split('\n').filter(Boolean);
    const probs = scanFiles(staged).map((h) => `secret check: ${h.file} matches rule "${h.rule}" (value not shown)`);
    const rest = checks({ skipSlow: false }).filter((p) => !p.startsWith('secret check'));
    probs.push(...rest);
    if (probs.length) { console.error('Commit blocked:\n - ' + probs.join('\n - ')); process.exit(1); }
    return;
  }
  // Claude Code hook
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* not JSON: nothing to judge */ }
  const cmd = String(input.tool_input?.command || '');
  if (!isCommit(cmd)) return;
  const attr = attributionProblems(cmd);
  const probs = attr.length ? attr : checks(); // a wrong trailer fails fast, before the slow checks
  if (probs.length) {
    console.error('Commit blocked by the project pre-commit hook:\n - ' + probs.join('\n - ') + '\nFix these and commit again.');
    process.exit(2);
  }
}

if (require.main === module) main();
module.exports = { isCommit, attributionProblems };
