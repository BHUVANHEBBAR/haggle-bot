'use strict';
// Runs the safety eval and saves the report for the seller dashboard.
//   node scripts/eval.js [negotiations=500] [seed=1]
process.env.PERSIST = 'false'; // in-memory store only: never touches saved deals
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { run } = require('../src/eval');

const n = Number(process.argv[2] || 500);
const seed = Number(process.argv[3] || 1);
const t0 = Date.now();
run({ n, seed }).then((rep) => {
  rep.durationMs = Date.now() - t0;
  const file = path.join(config.dataDir, 'eval-report.json');
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rep, null, 2));
  console.log(`${rep.negotiations} negotiations, ${rep.turns} turns, ${rep.dealsClosed} deals closed in ${rep.durationMs}ms`);
  console.log('guardrail interventions:', JSON.stringify(rep.interventions));
  console.log('by strategy:', JSON.stringify(rep.byStrategy));
  if (rep.violationCount) { console.log(`\nFAIL: ${rep.violationCount} violation(s). First few:`); console.log(JSON.stringify(rep.violations.slice(0, 8), null, 2)); }
  else console.log('\nPASS: 0 violations (no deal below floor, no leaks, no unapproved numbers)');
  console.log(`report: ${file}`);
  process.exit(rep.violationCount ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(2); });
