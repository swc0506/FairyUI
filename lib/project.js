// FairyGUI project model: .fairy project file, package.xml resources, image sizes.
// The editor's on-disk format is plain XML; these helpers read and rewrite it without
// depending on the editor being open.
import fs from 'node:fs';
import path from 'node:path';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r\n|\r|\n/g, '&#xA;');
}

export function xmlUnescape(value) {
  return String(value)
    .replace(/&#xA;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function parseAttrs(text) {
  const attrs = [];
  const re = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) attrs.push([m[1], m[2]]);
  return attrs;
}

export function attr(entry, name) {
  const hit = entry.attrs.find(([k]) => k === name);
  return hit === undefined ? undefined : xmlUnescape(hit[1]);
}

/** Resolve either a `.fairy` file or its project directory. */
export function resolveProject(input) {
  if (!input || typeof input !== 'string') throw new Error('project path is required');
  const abs = path.resolve(input);
  const stat = fs.statSync(abs);
  let file = abs;
  if (stat.isDirectory()) {
    const fairies = fs.readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.fairy'));
    if (fairies.length === 0) throw new Error(`no .fairy project file found in "${abs}"`);
    if (fairies.length > 1) throw new Error(`more than one .fairy file in "${abs}": ${fairies.join(', ')}`);
    file = path.join(abs, fairies[0]);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/<projectDescription\b([^>]*)\/?>/);
  const attrs = m ? parseAttrs(m[1]) : [];
  const read = (k) => {
    const hit = attrs.find(([key]) => key === k);
    return hit ? hit[1] : undefined;
  };
  return {
    file,
    dir: path.dirname(file),
    name: path.basename(file, path.extname(file)),
    id: read('id'),
    type: read('type'),
    version: read('version'),
    assetsDir: path.join(path.dirname(file), 'assets'),
  };
}

function splitPackageXml(raw) {
  const open = raw.match(/<packageDescription\b([^>]*)>/);
  if (!open) throw new Error('package.xml has no <packageDescription> root');
  const resourcesOpen = raw.indexOf('<resources>');
  const resourcesClose = raw.indexOf('</resources>');
  if (resourcesOpen < 0 || resourcesClose < 0) throw new Error('package.xml has no <resources> block');
  return {
    header: raw.slice(0, resourcesOpen),
    rootAttrs: open[1],
    body: raw.slice(resourcesOpen + '<resources>'.length, resourcesClose),
    after: raw.slice(resourcesClose + '</resources>'.length),
  };
}

export function parsePackage(dir, raw) {
  const parts = splitPackageXml(raw);
  const entries = [];
  const re = /<([A-Za-z]+)\s+([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(parts.body)) !== null) {
    const attrs = parseAttrs(m[2]);
    const name = (attrs.find(([k]) => k === 'name') || [])[1];
    if (!name) continue;
    entries.push({ tag: m[1], attrs, name: xmlUnescape(name) });
  }
  const publish = (raw.match(/<publish\b[^>]*\bname="([^"]*)"/) || [])[1];
  return {
    dir,
    name: path.basename(dir),
    descPath: path.join(dir, 'package.xml'),
    raw,
    header: parts.header,
    rootAttrs: parts.rootAttrs,
    after: parts.after,
    entries,
    id: (parts.rootAttrs.match(/\bid="([^"]+)"/) || [])[1],
    publishName: publish ? xmlUnescape(publish) : undefined,
  };
}

export function listPackages(project) {
  if (!fs.existsSync(project.assetsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(project.assetsDir)) {
    const dir = path.join(project.assetsDir, name);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const desc = path.join(dir, 'package.xml');
    if (!fs.existsSync(desc)) continue;
    out.push(parsePackage(dir, fs.readFileSync(desc, 'utf8')));
  }
  return out;
}

export function findPackage(packages, ref) {
  if (!ref) {
    if (packages.length === 1) return packages[0];
    throw new Error(`package is required; available: ${packages.map((p) => p.name).join(', ')}`);
  }
  const wanted = String(ref).toLowerCase();
  const hit = packages.find(
    (p) =>
      p.name.toLowerCase() === wanted ||
      (p.id && p.id.toLowerCase() === wanted) ||
      (p.publishName && p.publishName.toLowerCase() === wanted),
  );
  if (!hit) throw new Error(`package "${ref}" not found; available: ${packages.map((p) => p.name).join(', ')}`);
  return hit;
}

export function entryId(entry) {
  const hit = entry.attrs.find(([k]) => k === 'id');
  return hit ? hit[1] : undefined;
}

export function entryPath(entry) {
  return attr(entry, 'path') || '/';
}

/** Absolute on-disk path of a resource entry (image, font, sound...). */
export function resourceFile(pkg, entry) {
  const rel = entryPath(entry).replace(/^\/+|\/+$/g, '');
  return path.join(pkg.dir, rel, entry.name);
}

export function newId(pkg, reserved = new Set()) {
  const used = new Set(pkg.entries.map((e) => entryId(e)));
  for (let i = 0; i < 5000; i += 1) {
    let id = '';
    for (let k = 0; k < 5; k += 1) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!used.has(id) && !reserved.has(id)) return id;
  }
  throw new Error('could not allocate a free resource id');
}

function randomPackageId() {
  let id = '';
  for (let i = 0; i < 8; i += 1) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return id;
}

/** Create an empty FairyGUI package (assets/<name>/package.xml). */
export function createPackage(project, name, publishName) {
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/.test(name)) {
    throw new Error(`package name "${name}" may only contain letters, digits, _ and - (and CJK)`);
  }
  const dir = path.join(project.assetsDir, name);
  const file = path.join(dir, 'package.xml');
  if (fs.existsSync(file)) throw new Error(`package "${name}" already exists at ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  const id = randomPackageId();
  const publish = publishName ? `\n  <publish name="${xmlEscape(publishName)}"/>` : '';
  const content = `<?xml version="1.0" encoding="utf-8"?>
<packageDescription id="${id}">
  <resources>
  </resources>${publish}
</packageDescription>
`;
  fs.writeFileSync(file, content, 'utf8');
  return { dir, file, id, name };
}

export function serializeEntry(entry) {
  const attrs = entry.attrs.map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<${entry.tag} ${attrs}/>`;
}

export function savePackage(pkg) {
  const body = pkg.entries.map((e) => `    ${serializeEntry(e)}`).join('\n');
  const content = `${pkg.header}<resources>\n${body}\n  </resources>${pkg.after}`;
  fs.writeFileSync(pkg.descPath, content, 'utf8');
  pkg.raw = content;
}

export function addEntry(pkg, { tag, name, path: folder = '/', exported = false }) {
  const entry = {
    tag,
    name,
    attrs: [
      ['id', newId(pkg)],
      ['name', xmlEscape(name)],
      ['path', folder],
      ...(exported ? [['exported', 'true']] : []),
    ],
  };
  pkg.entries.push(entry);
  return entry;
}

export function byName(pkg, name, tags) {
  const wanted = String(name).toLowerCase();
  return pkg.entries.find((e) => {
    if (tags && !tags.includes(e.tag)) return false;
    const full = e.name.toLowerCase();
    const bare = full.replace(/\.xml$/i, '');
    return full === wanted || bare === wanted || (entryId(e) || '').toLowerCase() === wanted;
  });
}

export function imageSize(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return undefined;
  }
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpeg' };
      }
      i += 2 + len;
    }
    return undefined;
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h, format: 'webp' };
    }
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' };
    }
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
    }
  }
  if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') {
    return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)), format: 'bmp' };
  }
  return undefined;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** FairyGUI URL: ui://<packageId><itemId>. */
export function uiUrl(pkg, entry) {
  return `ui://${pkg.id}${entryId(entry)}`;
}

export function designResolution(project) {
  const s = readJson(path.join(project.dir, 'settings', 'Adaptation.json'), undefined);
  return s ? { width: s.designResolutionX, height: s.designResolutionY, scaleMode: s.scaleMode } : undefined;
}
