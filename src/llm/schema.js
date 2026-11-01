'use strict';
// Our agents describe the JSON they expect once, in Gemini's responseSchema dialect (upper-case types).
// Groq's strict structured outputs want plain JSON Schema: lower-case types, every property required,
// additionalProperties:false. This converts one into the other so the schemas are defined in one place.
function toJsonSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = { type: String(s.type || 'object').toLowerCase() };
  if (out.type === 'object') {
    const props = {};
    for (const [k, v] of Object.entries(s.properties || {})) props[k] = toJsonSchema(v);
    out.properties = props;
    out.required = Object.keys(props); // strict mode: every property must be listed
    out.additionalProperties = false;
  } else if (out.type === 'array') {
    out.items = toJsonSchema(s.items);
  }
  if (s.enum) out.enum = s.enum;
  return out;
}

module.exports = { toJsonSchema };
