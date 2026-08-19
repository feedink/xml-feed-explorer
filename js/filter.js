// ── filter.js — filter tree evaluation ───────────────────────────────────────
// filterGroup = { type: 'AND'|'OR', children: [filterGroup | condition] }
// condition   = { type: 'condition', field, operator, value }
//
// Multi-value fields (arrays): string operators check if ANY value matches,
// except not_contains / not_equals which require ALL values to not match.

function _extractNumber(s) {
  const m = String(s).replace(/\s/g, '').match(/-?\d[\d.,]*/);
  if (!m) return null;
  let raw = m[0];
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    // Both separators: last one is decimal (1.234,56 → European; 1,234.56 → US)
    if (lastComma > lastDot) { raw = raw.replace(/\./g, '').replace(',', '.'); }
    else { raw = raw.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    // Only commas: single = decimal (1234,56), multiple = thousands (1,234,567)
    if ((raw.match(/,/g) || []).length === 1) { raw = raw.replace(',', '.'); }
    else { raw = raw.replace(/,/g, ''); }
  } else if ((raw.match(/\./g) || []).length > 1) {
    // Multiple dots only: thousands separators (1.234.567)
    raw = raw.replace(/\./g, '');
  }
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

function _testCondition(item, { field, operator, value }) {
  let raw = item[field];
  if (raw === undefined || raw === null) raw = '';
  const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];

  if (operator === 'is_empty')     return values.every(v => v.trim() === '');
  if (operator === 'is_not_empty') return values.some(v => v.trim() !== '');

  if (operator === 'regex') {
    try { const re = new RegExp(value, 'i'); return values.some(v => re.test(v)); }
    catch { return false; }
  }

  const numOps = ['gt', 'gte', 'lt', 'lte', 'eq_num', 'neq_num'];
  if (numOps.includes(operator)) {
    const thr = _extractNumber(value);
    if (thr === null) return false;
    return values.some(v => {
      const n = _extractNumber(v);
      if (n === null) return false;
      switch (operator) {
        case 'gt':     return n > thr;
        case 'gte':    return n >= thr;
        case 'lt':     return n < thr;
        case 'lte':    return n <= thr;
        case 'eq_num': return n === thr;
        case 'neq_num':return n !== thr;
      }
    });
  }

  const lv = value.toLowerCase();
  if (operator === 'not_contains') return values.every(v => !v.toLowerCase().includes(lv));
  if (operator === 'not_equals')   return values.every(v => v.toLowerCase() !== lv);

  return values.some(v => {
    const s = v.toLowerCase();
    switch (operator) {
      case 'contains':    return s.includes(lv);
      case 'equals':      return s === lv;
      case 'starts_with': return s.startsWith(lv);
      case 'ends_with':   return s.endsWith(lv);
    }
    return false;
  });
}

function evaluateFilter(item, node) {
  if (!node || !node.type) return true;
  if (node.type === 'condition') return _testCondition(item, node);
  const kids = node.children || [];
  if (!kids.length) return true;
  const results = kids.map(child => evaluateFilter(item, child));
  return node.type === 'AND' ? results.every(Boolean) : results.some(Boolean);
}
