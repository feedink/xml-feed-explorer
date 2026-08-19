// ── worker.js — streaming XML parser with optional filter ─────────────────────
// Receives via postMessage:
//   { file, schema, config,
//     filter: filterTree|null,   — null = no filter
//     limit:  number|null,       — stop after N matched items (preview)
//     discoverOnly: boolean }    — scan all, report fields+count, no batches
//
// Sends:
//   { type: 'progress', bytes, total, count }   — count = items scanned so far
//   { type: 'batch',    items: [...] }           — not sent in discoverOnly mode
//   { type: 'done',     count, scanned, skipped, fields: [...] }
//   { type: 'warn',     message }
//   { type: 'error',    message }

const MAX_ITEM_BYTES = 50 * 1024 * 1024;
const NO_TAG_WARN_AT = 20 * 1024 * 1024;

let cfg          = null;
let schema       = null;
let filterTree   = null;
let itemLimit    = null;
let resultLimit  = null;
let discoverOnly = false;
let stopped      = false;

self.onmessage = async ({ data }) => {
  try {
    if (data.detectTags) { await _detectTags(data.file); return; }
    cfg          = data.config;
    schema       = data.schema;
    filterTree   = data.filter       || null;
    itemLimit    = data.limit        || null;
    resultLimit  = data.resultLimit  || null;
    discoverOnly = !!data.discoverOnly;
    await _streamFile(data.file);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};

// ── tag auto-detection ────────────────────────────────────────────────────────

const PRODUCT_KW  = ['product', 'item', 'entry', 'offer', 'sku', 'article', 'record', 'row', 'variant', 'prod'];
const IGNORE_TAGS = new Set(['?xml', 'xml', '!--']);

async function _detectTags(file) {
  const SCAN = Math.min(file.size, 10 * 1024 * 1024);
  const text  = new TextDecoder('utf-8', { fatal: false }).decode(await file.slice(0, SCAN).arrayBuffer());
  const counts = {}, first = {};
  const re = /<([a-zA-Z][a-zA-Z0-9_:-]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[1]; if (IGNORE_TAGS.has(t)) continue;
    counts[t] = (counts[t] || 0) + 1;
    if (first[t] === undefined) first[t] = m.index;
  }
  const candidates = Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .map(([tag, count]) => ({ tag, count, isProduct: PRODUCT_KW.some(kw => tag.toLowerCase().includes(kw)) }))
    .sort((a, b) => {
      if (a.isProduct !== b.isProduct) return a.isProduct ? -1 : 1;
      if (a.count !== b.count) return a.count - b.count;
      return (first[a.tag] || 0) - (first[b.tag] || 0);
    });
  self.postMessage({ type: 'done', candidates });
}

// ── filter evaluation (mirrors filter.js — keep in sync) ─────────────────────

function _extractNumber(s) {
  const m = String(s).replace(/\s/g, '').match(/-?\d[\d.,]*/);
  if (!m) return null;
  let raw = m[0];
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) { raw = raw.replace(/\./g, '').replace(',', '.'); }
    else { raw = raw.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    if ((raw.match(/,/g) || []).length === 1) { raw = raw.replace(',', '.'); }
    else { raw = raw.replace(/,/g, ''); }
  } else if ((raw.match(/\./g) || []).length > 1) {
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
        case 'gt':      return n > thr;
        case 'gte':     return n >= thr;
        case 'lt':      return n < thr;
        case 'lte':     return n <= thr;
        case 'eq_num':  return n === thr;
        case 'neq_num': return n !== thr;
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

// ── streaming ─────────────────────────────────────────────────────────────────

async function _streamFile(file) {
  const decoder    = new TextDecoder('utf-8', { fatal: false });
  let buffer       = '';
  let itemTag      = null;
  let scannedCount = 0;
  let matchedCount = 0;
  let skipCount    = 0;
  let batch        = [];
  let noTagWarned  = false;
  const allFields  = new Set();
  let offset       = 0;
  stopped          = false;

  const flush = (final) => {
    if (!itemTag) return;
    const open  = '<' + itemTag;
    const close = '</' + itemTag + '>';

    while (true) {
      if (buffer.length > MAX_ITEM_BYTES) {
        const nextOpen = buffer.indexOf(open, open.length);
        if (nextOpen !== -1) {
          skipCount++;
          self.postMessage({ type: 'warn', message: `Pominięto rekord — rozmiar bufora przekroczył ${MAX_ITEM_BYTES / 1048576} MB (niezamknięty tag lub uszkodzony XML)` });
          buffer = buffer.slice(nextOpen);
        } else { buffer = ''; break; }
      }

      const start = buffer.indexOf(open);
      if (start === -1) { if (!final) buffer = buffer.slice(-close.length); break; }
      const openEnd = buffer.indexOf('>', start);
      if (openEnd === -1) { buffer = buffer.slice(start); break; }
      const end = buffer.indexOf(close, openEnd);
      if (end === -1) { if (!final) { buffer = buffer.slice(start); break; } skipCount++; break; }

      const xml = buffer.slice(start, end + close.length);
      buffer = buffer.slice(end + close.length);

      try {
        const item = _parseItem(xml, itemTag);
        Object.keys(item).forEach(k => allFields.add(k));
        scannedCount++;

        if (!discoverOnly) {
          if (!filterTree || evaluateFilter(item, filterTree)) {
            matchedCount++;
            if (!resultLimit || matchedCount <= resultLimit) {
              batch.push(item);
              if (batch.length >= cfg.batchSize) {
                self.postMessage({ type: 'batch', items: batch });
                batch = [];
              }
            }
            if (itemLimit && matchedCount >= itemLimit) { stopped = true; return; }
          }
        } else if (itemLimit && scannedCount <= itemLimit) {
          // discoverOnly + preview: collect first itemLimit items and send eagerly
          batch.push(item);
          if (batch.length >= itemLimit) { self.postMessage({ type: 'batch', items: batch }); batch = []; }
        }
      } catch (_) { skipCount++; }
    }
  };

  while (offset < file.size) {
    const slice  = file.slice(offset, offset + cfg.chunkSize);
    const ab     = await slice.arrayBuffer();
    const isLast = offset + ab.byteLength >= file.size;
    buffer      += decoder.decode(ab, { stream: !isLast });
    offset      += ab.byteLength;

    if (!itemTag) {
      for (const tag of schema.itemTags) {
        if (buffer.includes('<' + tag + '>') || buffer.includes('<' + tag + ' ')) {
          itemTag = tag; break;
        }
      }
      if (!itemTag && !noTagWarned && offset >= NO_TAG_WARN_AT) {
        noTagWarned = true;
        self.postMessage({ type: 'warn', message: `Przetworzono ${NO_TAG_WARN_AT / 1048576} MB bez znalezienia tagów: ${schema.itemTags.join(', ')}. Sprawdź schemat parsowania.` });
      }
    }

    flush(false);
    // When filtering, eagerly send partial batch so UI shows results as they arrive
    if (filterTree && batch.length) { self.postMessage({ type: 'batch', items: batch }); batch = []; }
    self.postMessage({ type: 'progress', bytes: offset, total: file.size, count: scannedCount });
    if (stopped) break;
  }

  if (!stopped) flush(true);
  if (batch.length) self.postMessage({ type: 'batch', items: batch });
  self.postMessage({
    type:    'done',
    count:   discoverOnly ? scannedCount : matchedCount,
    scanned: scannedCount,
    skipped: skipCount,
    fields:  [...allFields].sort(),
  });
}

// ── item parser ───────────────────────────────────────────────────────────────

function _parseItem(xml, outerTag) {
  const cdata = [];
  const safe  = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => {
    cdata.push(c);
    return '\x00C' + (cdata.length - 1) + '\x00';
  });
  const innerStart = safe.indexOf('>') + 1;
  const innerEnd   = safe.lastIndexOf('</' + outerTag + '>');
  return _parseChildren(safe.slice(innerStart, innerEnd), '', cdata, schema.maxDepth);
}

function _findClose(xml, afterOpen, tagName) {
  const open  = '<' + tagName;
  const close = '</' + tagName + '>';
  let depth = 1, i = afterOpen;
  while (i < xml.length && depth > 0) {
    const nc = xml.indexOf(close, i);
    const no = xml.indexOf(open,  i);
    if (nc === -1) return xml.length;
    if (no !== -1 && no < nc) {
      const ch = xml[no + open.length];
      if (ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '/') {
        depth++; i = no + open.length;
      } else { i = no + 1; }
    } else { depth--; if (depth === 0) return nc; i = nc + close.length; }
  }
  return xml.length;
}

function _parseChildren(xml, prefix, cdata, depthLeft) {
  const result = {}; let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i); if (lt === -1) break;
    if (xml[lt + 1] === '/') break;
    if (xml.slice(lt, lt + 4) === '<!--') { const end = xml.indexOf('-->', lt); i = end === -1 ? xml.length : end + 3; continue; }
    let j = lt + 1;
    while (j < xml.length && xml[j] !== '>' && xml[j] !== ' ' && xml[j] !== '\t' &&
           xml[j] !== '\n' && xml[j] !== '\r' && xml[j] !== '/') j++;
    const tagName = xml.slice(lt + 1, j); if (!tagName) { i = lt + 1; continue; }
    let selfClose = false;
    while (j < xml.length && xml[j] !== '>') { if (xml[j] === '/') selfClose = true; j++; } j++;
    const fieldKey = prefix ? prefix + schema.nestedSeparator + tagName : tagName;
    if (selfClose) { _setField(result, fieldKey, ''); i = j; continue; }
    const closeIdx = _findClose(xml, j, tagName);
    const content  = xml.slice(j, closeIdx);
    i = closeIdx + ('</' + tagName + '>').length;
    const hasChildren = depthLeft > 0 && /<[a-zA-Z]/.test(content.replace(/\x00C\d+\x00/g, ''));
    if (hasChildren) {
      const nested = _parseChildren(content, fieldKey, cdata, depthLeft - 1);
      for (const [k, v] of Object.entries(nested)) _setField(result, k, v);
    } else {
      _setField(result, fieldKey, _text(content, cdata));
    }
  }
  return result;
}

function _text(s, cdata) {
  return s
    .replace(/\x00C(\d+)\x00/g, (_, i) => cdata[+i])
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

function _setField(obj, key, value) {
  if (obj[key] === undefined)       obj[key] = value;
  else if (Array.isArray(obj[key])) obj[key].push(value);
  else                              obj[key] = [obj[key], value];
}
