'use strict';
// Secret scan shared by the commit hooks. It reports file names and rule names only, never a secret value.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SHAPES = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{30,}/],
  ['groq-api-key', /gsk_[0-9A-Za-z]{20,}/],
  ['paypal-access-token', /A21[A-Za-z0-9._-]{40,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['paypal-client-id', /\bA[A-Za-z0-9_-]{70,90}\b/],
];
// lockfiles are full of long integrity hashes that look like client ids
const SKIP = /(^|\/)(package-lock\.json|node_modules|\.git)(\/|$)/;

// values of secret-looking variables in .env, so a pasted copy of one is caught (kept in memory, never printed)
function envSecretValues(root = ROOT) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, '.env'), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).map((l) => l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '').trim()])
    .filter(([k, v]) => v.length >= 8 && /KEY|SECRET|ID|TOKEN|PASSWORD/.test(k));
}

// -> [{ rule }] for one text; `secrets` is the envSecretValues() list
function scanText(text, secrets = []) {
  const hits = [];
  for (const [name, re] of SHAPES) if (re.test(text)) hits.push({ rule: name });
  for (const [k, v] of secrets) if (text.includes(v)) hits.push({ rule: `value of ${k} from .env` });
  return hits;
}

// -> [{ file, rule }]
function scanFiles(files, root = ROOT) {
  const secrets = envSecretValues(root);
  const out = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    if (SKIP.test(rel) || rel === '.env') continue;
    let buf; try { buf = fs.readFileSync(path.join(root, f)); } catch { continue; }
    if (buf.length > 6e6) continue;
    for (const h of scanText(buf.toString('latin1'), secrets)) out.push({ file: rel, rule: h.rule });
  }
  return out;
}

module.exports = { scanText, scanFiles, envSecretValues, SHAPES };
