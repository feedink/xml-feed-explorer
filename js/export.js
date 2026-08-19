// ── export.js ─────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _xmlVal(tag, v) {
  const s = String(v ?? '');
  const body = (s.includes('<') || s.includes('&') || s.includes('>'))
    ? '<![CDATA[' + s.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>' : _esc(s);
  return '<' + tag + '>' + body + '</' + tag + '>';
}

// Recursively converts a flat item object back to XML lines,
// reconstructing nested tags from dot-separated keys.
// Arrays on nested children = multiple occurrences of the parent tag.
function _itemToXmlLines(item, sep, indent) {
  const lines = [];
  const seen  = new Set();
  for (const key of Object.keys(item)) {
    if (key.startsWith('_')) continue;
    const dotIdx = key.indexOf(sep);
    if (dotIdx === -1) {
      // Flat field — repeat tag for each array element
      const val = item[key];
      if (Array.isArray(val)) {
        for (const v of val) lines.push(indent + _xmlVal(key, v));
      } else {
        lines.push(indent + _xmlVal(key, val));
      }
    } else {
      const parent = key.slice(0, dotIdx);
      if (seen.has(parent)) continue;
      seen.add(parent);
      // Collect all children of this parent
      const prefix   = parent + sep;
      const children = Object.entries(item)
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => [k.slice(prefix.length), v]);
      // Number of repetitions = max array length among children
      const reps = Math.max(...children.map(([, v]) => Array.isArray(v) ? v.length : 1));
      for (let i = 0; i < reps; i++) {
        lines.push(indent + '<' + parent + '>');
        const childObj = {};
        for (const [subkey, val] of children) {
          childObj[subkey] = Array.isArray(val) ? (val[i] ?? '') : val;
        }
        lines.push(..._itemToXmlLines(childObj, sep, indent + '  '));
        lines.push(indent + '</' + parent + '>');
      }
    }
  }
  return lines;
}

function exportXml(items, itemTag, sep) {
  sep = sep || '.';
  const tag   = itemTag || 'item';
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<feed>'];
  for (const item of items) {
    lines.push('  <' + tag + '>');
    lines.push(..._itemToXmlLines(item, sep, '    '));
    lines.push('  </' + tag + '>');
  }
  lines.push('</feed>');
  _download(new Blob([lines.join('\n')], { type: 'application/xml' }), 'export_' + Date.now() + '.xml');
}

function exportXlsx(items, fields) {
  const cols = fields.filter(f => !f.startsWith('_'));
  const rows = items.map(item =>
    cols.map(f => {
      const v = item[f];
      return Array.isArray(v) ? v.join(' | ') : (v ?? '');
    })
  );
  const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Feed');
  XLSX.writeFile(wb, 'export_' + Date.now() + '.xlsx');
}

function _download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
