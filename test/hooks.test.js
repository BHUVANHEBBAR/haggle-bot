'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isCommit, attributionProblems } = require('../scripts/hooks/precommit');
const { decide, isEnvFile } = require('../scripts/hooks/guard');
const { scanText, scanFiles } = require('../scripts/hooks/secret-scan');

// fake secrets are assembled at run time so this file never contains a secret-shaped string itself
const fakeGoogleKey = 'AI' + 'za' + 'x'.repeat(35);
const fakeGroqKey = 'gs' + 'k_' + 'y'.repeat(30);

test('git commit is recognised in the usual spellings, and other git commands are not', () => {
  for (const c of ['git commit -m "x"', 'git add -A && git commit -m x', 'git -C . commit --amend', 'git commit -q -m "$(cat <<EOF\nmsg\nEOF\n)"']) assert.ok(isCommit(c), c);
  for (const c of ['git status', 'git log --oneline', 'git diff --cached', 'echo commit']) assert.ok(!isCommit(c), c);
});

test('a Claude co-author or "Generated with Claude Code" line is flagged, normal messages are not', () => {
  assert.equal(attributionProblems('fix bug\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>').length >= 1, true);
  assert.equal(attributionProblems('x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)').length, 1);
  assert.deepEqual(attributionProblems('Separate buyer and seller sign-in'), []);
  assert.deepEqual(attributionProblems('Co-authored-by: A Human <a@example.com>'), []);
});

test('secret shapes are detected without returning the value', () => {
  const hits = scanText(`const k = "${fakeGoogleKey}"; const g = "${fakeGroqKey}"`);
  assert.deepEqual(hits.map((h) => h.rule).sort(), ['google-api-key', 'groq-api-key']);
  assert.ok(!JSON.stringify(hits).includes(fakeGoogleKey));
  assert.deepEqual(scanText('const sandboxOnly = true; // no keys here'), []);
});

test('a value copied from .env is detected by name; lockfiles and .env itself are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
  fs.writeFileSync(path.join(dir, '.env'), 'PAYPAL_CLIENT_SECRET=' + 'z'.repeat(24) + '\nPORT=3000\n');
  fs.writeFileSync(path.join(dir, 'leak.js'), 'module.exports = "' + 'z'.repeat(24) + '";');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '"integrity": "A' + 'b'.repeat(80) + '"');
  fs.writeFileSync(path.join(dir, 'fine.js'), 'module.exports = 1;');
  const hits = scanFiles(['leak.js', 'package-lock.json', 'fine.js', '.env'], dir);
  assert.deepEqual(hits, [{ file: 'leak.js', rule: 'value of PAYPAL_CLIENT_SECRET from .env' }]);
});

test('guard: .env cannot be edited, .env.example can', () => {
  assert.equal(decide({ tool_name: 'Edit', tool_input: { file_path: 'D:/x/.env' } }).decision, 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: '.env.local' } }).decision, 'deny');
  assert.equal(decide({ tool_name: 'Edit', tool_input: { file_path: '.env.example' } }).decision, 'allow');
  assert.equal(isEnvFile('src/environment.js'), false);
});

test('guard: printing secrets is denied, harmless commands are allowed', () => {
  for (const c of ['cat .env', 'type .env', 'grep KEY .env', 'printenv', 'echo $PAYPAL_CLIENT_SECRET', 'Get-Content .env']) assert.equal(decide({ tool_name: 'Bash', tool_input: { command: c } }).decision, 'deny', c);
  for (const c of ['cat .env.example', 'npm test', 'ls -la', 'git status', 'node scripts/hooks/secret-scan.js']) assert.equal(decide({ tool_name: 'Bash', tool_input: { command: c } }).decision, 'allow', c);
});

test('guard: force-push is denied, a plain push asks, other git is allowed', () => {
  for (const c of ['git push --force origin main', 'git push -f', 'git push --force-with-lease origin main', 'git push origin +main']) assert.equal(decide({ tool_name: 'Bash', tool_input: { command: c } }).decision, 'deny', c);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git push' } }).decision, 'ask');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } }).decision, 'ask');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }).decision, 'allow');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git log --oneline -5' } }).decision, 'allow');
});
