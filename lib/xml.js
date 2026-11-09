// Minimal, dependency-free XML reader for the subset FairyGUI writes: elements,
// attributes (single or double quoted), self-closing tags, comments, CDATA and the
// XML declaration. Text content is kept on the node but not unescaped beyond the
// five predefined entities; components only need structure and attributes.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function xmlUnescape(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body] ?? all;
  });
}

export function parseAttrs(raw) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = xmlUnescape(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

function findTagEnd(text, from) {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

/** Parse an XML document and return the root element (or null for an empty document). */
export function parseXml(text) {
  const source = String(text || '');
  const root = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1].text += source.slice(i);
      break;
    }
    if (lt > i) stack[stack.length - 1].text += source.slice(i, lt);
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += source.slice(lt + 9, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    const gt = findTagEnd(source, lt + 1);
    if (gt < 0) break;
    const raw = source.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].tag === name) {
          stack.length = k;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = body.match(/^([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) {
      i = gt + 1;
      continue;
    }
    const tag = nameMatch[1];
    const node = {
      tag,
      attrs: parseAttrs(body.slice(nameMatch[0].length)),
      children: [],
      text: '',
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root.children[0] || null;
}

export function attrOf(node, name) {
  return node && node.attrs ? node.attrs[name] : undefined;
}

export function childrenOf(node, tag) {
  return node && Array.isArray(node.children) ? node.children.filter((child) => child.tag === tag) : [];
}

export function firstChild(node, tag) {
  return childrenOf(node, tag)[0];
}

/** "12,34" -> [12, 34]; undefined when the value is missing or non-numeric. */
export function parseNumbers(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parts = value.split(',').map((part) => Number(part.trim()));
  return parts.some((n) => !Number.isFinite(n)) ? undefined : parts;
}
