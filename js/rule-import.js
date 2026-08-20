// ── rule-import.js — import "exclude_items" rules from the other system ───────
// Standalone (no Vue). Consumed by app.js (openRuleImport / applyRuleImport).
//
// Source rule shape (external system):
//   { conditions: { condition:'AND'|'OR', rules:[ group | leaf ] },
//     operations: [ { source, operator, arguments } ] }
//   group = { condition:'AND'|'OR', rules:[...] }
//   leaf  = { source:<field>, operator:<op>, value:{ type, value } }
//
// Only rules whose operations include `exclude_items` are imported — their
// conditions become the filter tree (so the filter SHOWS what the other system
// excludes). Output is a Feed Manager filter tree: {type:'AND'|'OR', children}
// / {type:'condition', field, operator, value, multiline}. Nodes carry no _id —
// the app assigns them via _ensureNodeIds, same as loadSavedFilter.

// Explicit map for operators where the name alone isn't enough — most importantly
// contains_any, which must set multiline:true (its value is a newline list).
const RULE_OP_MAP = {
  contains_any:          { op: 'contains', multiline: true },
  contains:              { op: 'contains' },
  not_contains:          { op: 'not_contains' },
  equal:                 { op: 'equals' },
  equals:                { op: 'equals' },
  string_equal:          { op: 'equals' },
  not_equal:             { op: 'not_equals' },
  string_not_equal:      { op: 'not_equals' },
  starts_with:           { op: 'starts_with' },
  begins_with:           { op: 'starts_with' },
  ends_with:             { op: 'ends_with' },
  less_than:             { op: 'lt' },
  less_than_or_equal:    { op: 'lte' },
  greater_than:          { op: 'gt' },
  greater_than_or_equal: { op: 'gte' },
  is_empty:              { op: 'is_empty' },
  is_not_empty:          { op: 'is_not_empty' },
  regex:                 { op: 'regex' },
};

// Heuristic fallback for unseen but "logically named" operators. Anything it
// returns is flagged as guessed so the UI can surface it for review.
function _guessOperator(s) {
  const has = (...ks) => ks.some(k => s.includes(k));
  const neg = has('not', 'neq', 'isnt', 'differ', 'exclude');

  if (has('regex', 'regexp', 'matches', 'pattern')) return { op: 'regex' };
  if (has('empty', 'blank'))         return { op: neg ? 'is_not_empty' : 'is_empty' };
  if (has('start', 'begin', 'prefix')) return { op: 'starts_with' };
  if (has('end', 'suffix'))          return { op: 'ends_with' };
  if (has('contain', 'include', 'has')) {
    if (has('any', 'one_of', 'oneof', 'in_list', 'list', '_in')) return { op: 'contains', multiline: true };
    return { op: neg ? 'not_contains' : 'contains' };
  }
  if (has('greater', 'more', 'above', 'gt')) return { op: has('equal', 'eq') ? 'gte' : 'gt' };
  if (has('less', 'smaller', 'below', 'lt'))  return { op: has('equal', 'eq') ? 'lte' : 'lt' };
  if (has('equal', 'eq', 'same', 'is'))       return { op: neg ? 'not_equals' : 'equals' };
  return null;
}

function _resolveOperator(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (RULE_OP_MAP[key]) return { ...RULE_OP_MAP[key], guessed: false };
  const g = _guessOperator(key);
  return g ? { ...g, guessed: true } : null;
}

// Pull the plain string value out of a leaf. value is usually {type, value};
// arrays are treated as a newline list (→ multiline).
function _extractLeafValue(leaf) {
  let v = leaf.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) v = v.value;
  if (Array.isArray(v)) return { value: v.map(x => String(x)).join('\n'), wasArray: true };
  if (v === undefined || v === null) return { value: '', wasArray: false };
  return { value: String(v), wasArray: false };
}

// Match a source field name against the project's XML fields.
//   exact  → use as-is
//   soft   → case-insensitive + ignoring a namespace prefix (title ↔ g:title),
//            only when it resolves to a single field (flagged guessed)
//   none   → empty field, caller keeps the original name as a hint
function _matchField(source, fields) {
  const src = String(source);
  if (fields.includes(src)) return { field: src, guessed: false };
  const norm = s => String(s).toLowerCase().replace(/^[a-z_]+:/, '');
  const target = norm(src);
  const hits = fields.filter(f => norm(f) === target);
  if (hits.length === 1) return { field: hits[0], guessed: true };
  return { field: '', guessed: false };
}

function _convertConditions(node, ctx) {
  if (!node || typeof node !== 'object') return null;

  // Group node
  if (Array.isArray(node.rules)) {
    const type = String(node.condition || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
    const children = [];
    for (const child of node.rules) {
      const c = _convertConditions(child, ctx);
      if (c) children.push(c);
    }
    return children.length ? { type, children } : null;
  }

  // Leaf condition
  if (node.source && node.operator) {
    const resolved = _resolveOperator(node.operator);
    if (!resolved) {
      ctx.errors.push(`Nieznany operator: "${node.operator}" (pole "${node.source}")`);
      return null;
    }
    const noValue = resolved.op === 'is_empty' || resolved.op === 'is_not_empty';
    const { value, wasArray } = _extractLeafValue(node);
    const match = _matchField(node.source, ctx.fields);
    const cond = { type: 'condition', field: match.field, operator: resolved.op, value: noValue ? '' : value };
    if (!noValue && (resolved.multiline || wasArray)) cond.multiline = true;
    // Keep the source name as a hint whenever the field wasn't an exact match,
    // so the UI can prompt the user to pick / verify the right XML field.
    if (!match.field) { cond._sourceHint = String(node.source); ctx.unmapped.push(String(node.source)); }
    else if (match.guessed) { cond._sourceHint = String(node.source); ctx.softMapped.push(`${node.source} → ${match.field}`); }
    if (resolved.guessed) {
      ctx.warnings.push(`Operator "${node.operator}" → "${resolved.op}" (dopasowany automatycznie — sprawdź)`);
    }
    return cond;
  }

  // Leaf without an operator (e.g. source:'all' placeholder) — ignore
  return null;
}

// Collapse groups that hold a single child — an AND/OR of one element is just
// that element. Multi-child groups are kept intact. Applied bottom-up, this
// turns AND[ OR[a], OR[b] ] into AND[ a, b ].
function _flatten(node) {
  if (!node || node.type === 'condition') return node;
  const children = (node.children || []).map(_flatten).filter(Boolean);
  if (children.length === 1) return children[0];
  return { type: node.type, children };
}

function _isExcludeRule(rule) {
  const ops = rule && rule.operations;
  return Array.isArray(ops) && ops.some(o => o && o.operator === 'exclude_items');
}

// Accepts: a single object, a JSON array, or newline-separated objects (NDJSON —
// the format pasted from the other system, one rule per physical line).
function _parseRules(text) {
  const trimmed = text.trim();
  if (!trimmed) return { rules: [], parseErrors: [] };
  try {
    const parsed = JSON.parse(trimmed);
    return { rules: Array.isArray(parsed) ? parsed : [parsed], parseErrors: [] };
  } catch (_) { /* fall through to line-by-line */ }

  const rules = [], parseErrors = [];
  trimmed.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try { rules.push(JSON.parse(t)); }
    catch (_) { parseErrors.push(`Linia ${i + 1}: nieprawidłowy JSON`); }
  });
  return { rules, parseErrors };
}

function convertExcludeRules(text, availableFields) {
  const { rules, parseErrors } = _parseRules(text);
  const ctx = { warnings: [], errors: [...parseErrors],
                fields: Array.isArray(availableFields) ? availableFields : [],
                unmapped: [], softMapped: [] };
  const ruleTrees = [];
  const skippedReasons = [];
  let imported = 0, skipped = 0;

  rules.forEach((rule, i) => {
    if (!_isExcludeRule(rule)) {
      skipped++;
      const op = rule && rule.operations && rule.operations[0] && rule.operations[0].operator || 'brak';
      skippedReasons.push(`Reguła ${i + 1}: pominięta (operacja "${op}", nie exclude_items)`);
      return;
    }
    const tree = _flatten(_convertConditions(rule.conditions, ctx));
    if (tree) { ruleTrees.push(tree); imported++; }
    else { skipped++; skippedReasons.push(`Reguła ${i + 1}: brak warunków do zaimportowania`); }
  });

  // Multiple exclude rules → OR (item excluded if ANY rule matches → filter shows the union).
  // ruleTrees is also returned raw so the app can append rules onto an existing filter.
  let tree = null;
  if (ruleTrees.length === 1) tree = ruleTrees[0];
  else if (ruleTrees.length > 1) tree = { type: 'OR', children: ruleTrees };

  return {
    tree,
    ruleTrees,
    ruleCount: rules.length,
    imported,
    skipped,
    skippedReasons,
    warnings: [...new Set(ctx.warnings)],
    errors: ctx.errors,
    unmapped: [...new Set(ctx.unmapped)],
    softMapped: [...new Set(ctx.softMapped)],
    ok: !!tree && ctx.errors.length === 0,
  };
}
