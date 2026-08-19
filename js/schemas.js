// ── schemas.js — XML feed parsing schemas ─────────────────────────────────────
// Each schema tells the parser how to interpret the XML structure.
// To support a new feed format, add a new entry here.
// The parser in worker.js is schema-agnostic; it only reads these properties.
//
// Properties:
//   itemTags       — ordered list of XML tags treated as a single product record
//   nestedSeparator — string used to join parent.child field names when flattening
//   maxDepth        — how many levels of nested elements to recurse into

const SCHEMAS = {
  google: {
    name: 'Google Shopping Feed',
    description: 'Standard Google Shopping XML feed (item / entry, namespaces g: c:)',
    itemTags: ['item', 'entry'],
    nestedSeparator: '.',
    maxDepth: 3,
  },

  // Template for future schemas:
  // custom: {
  //   name: 'Custom Feed',
  //   description: '...',
  //   itemTags: ['product'],
  //   nestedSeparator: '.',
  //   maxDepth: 2,
  // },
};
