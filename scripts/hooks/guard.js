'use strict';
// Claude Code PreToolUse guard for the project's standing rules:
//   never edit .env; never print secrets; no force-push; a plain `git push` needs the owner's say-so (asks).
const fs = require('fs');
const path = require('path');

const isEnvFile = (p) => /^\.env(\.[^/\\]+)?$/.test(path.basename(String(p || ''))) && path.basename(String(p)) !== '.env.example';

const PRINT_ENV_FILE = /\b(cat|type|less|more|head|tail|grep|egrep|rg|sed|awk|Get-Content|gc|cp|mv|source|\.)\s+[^|;&\n]*\.env(?!\.example)(?![\w.-])/i;
const PRINT_ENV_VARS = /\b(printenv|Get-ChildItem\s+env:|dir\s+env:)\b|\becho\s+[^|;&\n]*\$\{?(PAYPAL_\w+|GROQ_\w+|GEMINI_\w+|SELLER_KEY|SESSION_SECRET|LLM_API_KEY)|\bprocess\.env\.(PAYPAL_CLIENT_SECRET|GROQ_API_KEY|GEMINI_API_KEY)\b[^;\n]*console\.log/i;
const FORCE_PUSH = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*push\b[^;&|\n]*(\s--force\b|\s--force-with-lease\b|\s-f\b|\s\+\S+)/;
const PUSH = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*push\b/;

// -> { decision: 'allow'|'deny'|'ask', reason }
function decide(input) {
  const tool = input.tool_name, ti = input.tool_input || {};
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool) && isEnvFile(ti.file_path || ti.notebook_path)) {
    return { decision: 'deny', reason: 'Editing .env is not allowed in this project: tell the owner the exact line to change instead.' };
  }
  if (tool === 'Bash') {
    const c = String(ti.command || '');
    if (PRINT_ENV_FILE.test(c) || PRINT_ENV_VARS.test(c)) return { decision: 'deny', reason: 'This would print or copy secrets from .env or the environment, which this project forbids. Use a script that reports names and lengths only.' };
    if (FORCE_PUSH.test(c)) return { decision: 'deny', reason: 'Force-push is blocked. If history really must be rewritten, the owner runs it themselves.' };
    if (PUSH.test(c)) return { decision: 'ask', reason: 'Pushing publishes to the public repository; the owner approves every push.' };
  }
  return { decision: 'allow', reason: '' };
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const d = decide(input);
  if (d.decision === 'allow') return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: d.reason } }));
}

if (require.main === module) main();
module.exports = { decide, isEnvFile };
