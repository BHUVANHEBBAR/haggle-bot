'use strict';
// All money inside the app is integer cents. Floats never touch a price decision.
const toCents = (n) => Math.round(Number(n) * 100);
const fmt = (cents) => (cents / 100).toFixed(2);
const usd = (cents) => `$${fmt(cents)}`;
module.exports = { toCents, fmt, usd };
