// Layout spec -> FairyGUI component XML + render plan for the PNG preview.
// Covers the display-list primitives and the extension components the demo project uses,
// plus controllers/gears, relations, groups and scroll-pane root attributes.
import fs from 'node:fs';
import path from 'node:path';
import {
  addEntry,
  attr,
  byName,
  entryPath,
  imageSize,
  newId,
  resourceFile,
  uiUrl,
  xmlEscape,
} from './project.js';
import { ensureTemplate, ensureTreeItem, ensureWindowFrame } from './templates.js';

const NODE_TYPES = new Set([
  'graph',
  'rect',
  'image',
  'text',
  'inputtext',
  'richtext',
  'list',
  'loader',
  'button',
  'label',
  'progressbar',
  'slider',
  'combobox',
  'tree',
  'window',
  'component',
  'group',
]);

const ALIGN = new Set(['left', 'center', 'right']);
const VALIGN = new Set(['top', 'middle', 'bottom']);

const GEAR_TAGS = {
  display: 'gearDisplay',
  display2: 'gearDisplay2',
  xy: 'gearXY',
  size: 'gearSize',
  look: 'gearLook',
  color: 'gearColor',
  fontSize: 'gearFontSize',
  icon: 'gearIcon',
  ani: 'gearAni',
  text: 'gearText',
};

function fail(message) {
  throw new Error(message);
}

function rectOf(node, index) {
  const r = node.rect;
  if (!Array.isArray(r) || r.length !== 4 || r.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    fail(`nodes[${index}] (${node.name || '?'}): rect must be [x, y, width, height] numbers`);
  }
  if (r[2] < 0 || r[3] < 0) fail(`nodes[${index}] (${node.name || '?'}): width/height must be >= 0`);
  return { x: r[0], y: r[1], w: r[2], h: r[3] };
}

function color(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  let s = String(value).trim();
  if (s === 'none' || s === 'transparent') return 'transparent';
  if (!s.startsWith('#')) s = `#${s}`;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
    fail(`invalid color "${value}" (use #rgb, #rrggbb or #aarrggbb)`);
  }
  return s;
}

function normalizeHex8(value) {
  const s = color(value, undefined);
  if (!s || s === 'transparent') return undefined;
  let hex = s.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 6) return `#ff${hex.toLowerCase()}`;
  return `#${hex.toLowerCase()}`;
}

function nodeName(node, index, used) {
  const base = String(node.name || `${node.type || 'node'}${index}`).trim();
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/.test(base)) {
    fail(`nodes[${index}]: name "${base}" may only contain letters, digits, _ and - (and CJK)`);
  }
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}${n++}`;
  used.add(name);
  return name;
}

function componentExtention(pkg, entry) {
  const file = resourceFile(pkg, entry);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return (raw.match(/<component\b[^>]*\bextention="([^"]+)"/) || [])[1];
  } catch {
    return undefined;
  }
}

function naturalSize(pkg, entry) {
  try {
    return imageSize(resourceFile(pkg, entry));
  } catch {
    return undefined;
  }
}

/** Import an image file into the package's images folder and register it. */
function importImage(pkg, source, preferredName, folder = 'Images') {
  const fileName = preferredName || path.basename(source);
  const absSource = path.resolve(source);
  const absPkg = path.resolve(pkg.dir);
  let dest;
  let relDir = String(folder || 'Images').replace(/^\/+|\/+$/g, '');
  if (absSource.toLowerCase().startsWith(`${absPkg.toLowerCase()}${path.sep}`)) {
    // Already inside the package (e.g. Images/Button/x.png): keep its folder.
    dest = absSource;
    relDir = path.relative(absPkg, path.dirname(absSource)).split(path.sep).join('/');
  } else {
    const destDir = path.join(pkg.dir, relDir);
    fs.mkdirSync(destDir, { recursive: true });
    dest = path.join(destDir, fileName);
    if (absSource !== path.resolve(dest)) fs.copyFileSync(source, dest);
  }
  const entry = {
    tag: 'image',
    name: fileName,
    attrs: [
      ['id', newId(pkg)],
      ['name', xmlEscape(fileName)],
      ['path', `/${relDir}/`],
    ],
  };
  pkg.entries.push(entry);
  return entry;
}

function setEntryAttr(entry, name, value) {
  const hit = entry.attrs.find(([k]) => k === name);
  if (hit) hit[1] = String(value);
  else entry.attrs.push([name, String(value)]);
}

/** Normalize a nine-slice spec: [l,t,r,b] or "l,t,r,b" -> "l,t,r,b"; true means "keep existing". */
function normalizeScale9(value) {
  if (value === true) return true;
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  const parts = String(raw).split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return undefined;
  const nums = parts.map(Number);
  if (!nums.every((n) => Number.isFinite(n) && n >= 0)) return undefined;
  return nums.map((n) => Math.round(n)).join(',');
}

/** Apply a nine-slice grid to the image resource that backs an image node. */
function applyScale9(entry, node, index, warnings) {
  const value = node.scale9grid;
  if (value === undefined || value === null || value === false || value === '') return;
  const slice = normalizeScale9(value);
  if (slice === true) {
    if (entry.attrs.some(([k]) => k === 'scale9grid')) {
      setEntryAttr(entry, 'scale', '9grid');
    } else {
      warnings.push(
        `nodes[${index}] (${node.name || '?'}): scale9grid:true but image "${entry.name}" has no nine-slice grid yet; pass "left,top,right,bottom"`,
      );
    }
    return;
  }
  if (!slice) {
    warnings.push(
      `nodes[${index}] (${node.name || '?'}): scale9grid must be "left,top,right,bottom" (got ${JSON.stringify(value)})`,
    );
    return;
  }
  setEntryAttr(entry, 'scale', '9grid');
  setEntryAttr(entry, 'scale9grid', slice);
}

function resolveImage(pkg, node, index, importRoot, imported, warnings, imageFolder) {
  if (node.asset) {
    const hit = byName(pkg, node.asset, ['image']);
    if (hit) return hit;
  }
  const candidateNames = [];
  if (node.asset) candidateNames.push(path.basename(String(node.asset)));
  if (node.file) candidateNames.push(path.basename(String(node.file)));
  const roots = [pkg.dir, ...(importRoot ? [importRoot] : [])];
  const subdirs = ['Images', 'images', 'image', ''];
  for (const name of candidateNames) {
    if (node.asset && path.isAbsolute(String(node.asset)) && fs.existsSync(String(node.asset))) {
      return importImage(pkg, String(node.asset), undefined, imageFolder);
    }
    if (node.file && fs.existsSync(String(node.file))) return importImage(pkg, String(node.file), undefined, imageFolder);
    for (const root of roots) {
      for (const sub of subdirs) {
        const file = path.join(root, sub, name);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          const entry = importImage(pkg, file, undefined, imageFolder);
          imported.push({ name, file, id: entry.attrs[0][1] });
          return entry;
        }
      }
    }
  }
  warnings.push(`nodes[${index}] (${node.name || '?'}): image asset "${node.asset || node.file || '?'}" not found; replaced with a gray placeholder`);
  return undefined;
}

function findPackageByName(packages, ref) {
  const wanted = String(ref || '').toLowerCase();
  if (!wanted) return undefined;
  return (packages || []).find(
    (p) => p.name.toLowerCase() === wanted || (p.id && p.id.toLowerCase() === wanted),
  );
}

function splitComponentRef(raw) {
  const value = String(raw || '').trim();
  const slash = value.indexOf('/');
  if (slash > 0) return { pkgRef: value.slice(0, slash), name: value.slice(slash + 1) };
  return { pkgRef: null, name: value };
}

/** Resolve "Pkg/Widgets/Comp" (cross-package) or "Comp" (same package) to { pkg, entry }. */
function resolveComponent(pkg, node, index, packages) {
  const raw = node.asset === undefined || node.asset === null ? '' : String(node.asset);
  if (raw.startsWith('ui://')) {
    for (const candidate of [pkg, ...(packages || []).filter((p) => p !== pkg)]) {
      const entry = candidate.entries.find((e) => e.tag === 'component' && uiUrl(candidate, e) === raw);
      if (entry) return { pkg: candidate, entry };
    }
    fail(`nodes[${index}] (${node.name || '?'}): component url "${raw}" not found in this project`);
  }
  const { pkgRef, name } = splitComponentRef(raw);
  const targetPkg = pkgRef ? findPackageByName(packages, pkgRef) : pkg;
  if (pkgRef && !targetPkg) {
    fail(
      `nodes[${index}] (${node.name || '?'}): package "${pkgRef}" not found; available: ` +
        `${(packages || []).map((p) => p.name).join(', ')}`,
    );
  }
  const hit = byName(targetPkg, name, ['component']) || byName(targetPkg, `${name}.xml`, ['component']);
  if (!hit) {
    const available = targetPkg.entries
      .filter((e) => e.tag === 'component')
      .map((e) => e.name.replace(/\.xml$/i, ''))
      .slice(0, 40)
      .join(', ');
    fail(`nodes[${index}] (${node.name || '?'}): component "${raw}" not found in package "${targetPkg.name}"; available: ${available}`);
  }
  return { pkg: targetPkg, entry: hit };
}

/** Resolve a list/tree item template ("Pkg/Comp", "Comp" or ui://) to its ui:// URL. */
function resolveComponentUrl(pkg, ref, packages) {
  const raw = String(ref || '').trim();
  if (raw.startsWith('ui://')) return raw;
  if (!raw) return undefined;
  const { pkgRef, name } = splitComponentRef(raw);
  const targetPkg = pkgRef ? findPackageByName(packages, pkgRef) : pkg;
  if (!targetPkg) return undefined;
  const hit = byName(targetPkg, name, ['component']) || byName(targetPkg, `${name}.xml`, ['component']);
  return hit ? uiUrl(targetPkg, hit) : undefined;
}

function attrsToString(attrs) {
  return attrs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
}

function controllersXml(controllers) {
  if (!Array.isArray(controllers)) return '';
  const seen = new Set();
  return controllers
    .map((c, index) => {
      if (!c || typeof c.name !== 'string' || c.name.trim() === '') fail(`controllers[${index}].name is required`);
      if (seen.has(c.name)) fail(`duplicate controller "${c.name}"`);
      seen.add(c.name);
      const pages = Array.isArray(c.pages) ? c.pages : [];
      if (pages.length === 0) fail(`controller "${c.name}" needs at least one page`);
      const pageText = pages.map((page, i) => `${i},${page === undefined || page === null ? '' : page}`).join(',');
      const selected = Number.isInteger(c.selected) ? c.selected : 0;
      if (selected < 0 || selected >= pages.length) fail(`controller "${c.name}" selected page ${selected} is out of range`);
      return `  <controller name="${xmlEscape(c.name)}" pages="${pageText}" selected="${selected}"/>`;
    })
    .join('\n');
}

function buildDecorations(node, index, ctx) {
  const out = [];
  for (const gear of node.gears || []) {
    const tag = GEAR_TAGS[gear.type];
    if (!tag) fail(`nodes[${index}] (${node.name || '?'}): gear type "${gear.type}" must be one of ${Object.keys(GEAR_TAGS).join(', ')}`);
    if (!ctx.controllerNames.has(gear.controller)) {
      fail(
        `nodes[${index}] (${node.name || '?'}): gear references unknown controller "${gear.controller}"; ` +
          `declare it in the component "controllers" list`,
      );
    }
    const gearAttrs = [['controller', gear.controller]];
    if (gear.pages !== undefined) {
      gearAttrs.push(['pages', Array.isArray(gear.pages) ? gear.pages.join(',') : String(gear.pages)]);
    }
    if (gear.condition !== undefined) gearAttrs.push(['condition', String(gear.condition)]);
    if (gear.values !== undefined) gearAttrs.push(['values', String(gear.values)]);
    if (gear.default !== undefined) gearAttrs.push(['default', String(gear.default)]);
    if (gear.tween) gearAttrs.push(['tween', 'true']);
    out.push(`<${tag} ${attrsToString(gearAttrs)}/>`);
  }
  for (const relation of node.relations || []) {
    if (!relation || typeof relation.sidePair !== 'string' || relation.sidePair === '') {
      fail(`nodes[${index}] (${node.name || '?'}): relation needs sidePair, e.g. "width-width,height-height"`);
    }
    let target = '';
    if (relation.target !== undefined && relation.target !== null && relation.target !== '') {
      target = ctx.idByName.get(String(relation.target));
      if (!target) {
        fail(`nodes[${index}] (${node.name || '?'}): relation target "${relation.target}" is not a node in this component`);
      }
    }
    out.push(`<relation target="${target}" sidePair="${relation.sidePair}"/>`);
  }
  return out;
}

function pushNode(xml, tag, attrs, children) {
  const head = `    <${tag} ${attrsToString(attrs)}`;
  if (!children || children.length === 0) {
    xml.push(`${head}/>`);
    return;
  }
  const body = children.map((child) => `      ${child}`).join('\n');
  xml.push(`${head}>\n${body}\n    </${tag}>`);
}

/**
 * Turn the model-authored spec into XML nodes plus render-plan nodes.
 * Throws on structural errors; non-fatal problems go to warnings.
 */
export function compileLayout({
  pkg,
  nodes,
  width,
  height,
  importRoot,
  autoTemplate = true,
  controllers = [],
  allowOverflow = false,
  templateFolder = '',
  imageFolder = '',
  packages = [],
}) {
  if (!Array.isArray(nodes) || nodes.length === 0) fail('nodes must be a non-empty array');
  if (nodes.length > 800) fail('too many nodes (max 800)');
  const usedNames = new Set();
  const xml = [];
  const plan = [];
  const imported = [];
  const createdTemplates = [];
  const warnings = [];
  const seenNames = new Set();
  // FairyGUI's editor emits <group> after the members that reference it; keep that order.
  const groupXml = [];

  const idByName = new Map();
  const groupIds = new Map();
  nodes.forEach((node, index) => {
    if (node && typeof node.name === 'string' && node.name !== '') idByName.set(node.name, `n${index}`);
    if (node && node.type === 'group') groupIds.set(node.name, `n${index}`);
  });
  const ctx = { idByName, controllerNames: new Set((controllers || []).map((c) => c && c.name).filter(Boolean)) };

  nodes.forEach((rawNode, index) => {
    if (!rawNode || typeof rawNode !== 'object') fail(`nodes[${index}] must be an object`);
    let node = rawNode;
    let type = node.type === 'rect' ? 'graph' : node.type;
    let resolvedComponent;
    if (!NODE_TYPES.has(node.type || '')) {
      fail(`nodes[${index}]: type must be one of ${[...NODE_TYPES].join(', ')}`);
    }
    if (type === 'button' || type === 'label' || type === 'progressbar' || type === 'slider' || type === 'combobox') {
      const wantedExt = { button: 'Button', label: 'Label', progressbar: 'ProgressBar', slider: 'Slider', combobox: 'ComboBox' }[type];
      const options = pkg.entries
        .filter((e) => e.tag === 'component')
        .map((e) => ({ entry: e, ext: componentExtention(pkg, e) }));
      const describe = () =>
        options
          .filter((o) => o.ext)
          .map((o) => `${o.entry.name.replace(/\.xml$/i, '')}(${o.ext})`)
          .join(', ') || '(no extension components)';
      let picked;
      if (node.asset) {
        const resolved = resolveComponent(pkg, node, index, packages);
        const ext = componentExtention(resolved.pkg, resolved.entry);
        if (!ext || ext.toLowerCase() !== wantedExt.toLowerCase()) {
          fail(
            `nodes[${index}] (${node.name || '?'}): "${node.asset}" has extension ${ext || 'none'}, not ${wantedExt}` +
              (resolved.pkg === pkg ? `; available: ${describe()}` : ` (package "${resolved.pkg.name}")`),
          );
        }
        picked = { pkg: resolved.pkg, entry: resolved.entry, ext };
      } else {
        picked = options.find((o) => o.ext && o.ext.toLowerCase() === wantedExt.toLowerCase());
        if (picked) picked = { ...picked, pkg };
        if (!picked) {
          if (autoTemplate === false) {
            fail(
              `nodes[${index}] uses type "${type}" but package "${pkg.name}" has no ${wantedExt} component; ` +
                `create one in the editor or call fairyui_template. Available: ${describe()}`,
            );
          }
          const size = Array.isArray(node.rect) && node.rect.length === 4 ? node.rect : [0, 0, 160, 56];
          const created = ensureTemplate(pkg, type, {
            width: Math.max(1, Math.round(size[2])),
            height: Math.max(1, Math.round(size[3])),
            title: node.title,
            bg: node.fill,
            text: node.color,
            fontSize: node.fontSize,
            visibleItemCount: node.visibleItemCount,
            folder: templateFolder,
          });
          createdTemplates.push(created.name);
          picked = { pkg, entry: created.entry, ext: wantedExt };
        }
      }
      resolvedComponent = picked;
      node = { ...node, type: 'component', asset: picked.entry.name.replace(/\.xml$/i, '') };
      type = 'component';
    }

    if (type === 'window') {
      let entry;
      let entryPkg = pkg;
      if (node.asset) {
        const resolved = resolveComponent(pkg, node, index, packages);
        entry = resolved.entry;
        entryPkg = resolved.pkg;
        const ext = componentExtention(entryPkg, entry);
        if (ext !== 'Label') {
          fail(`nodes[${index}] (${node.name || '?'}): window frame "${node.asset}" must use the Label extension (got ${ext || 'none'})`);
        }
      } else {
        const size = Array.isArray(node.rect) && node.rect.length === 4 ? node.rect : [0, 0, 600, 400];
        const created = ensureWindowFrame(pkg, {
          width: Math.max(160, Math.round(size[2])),
          height: Math.max(120, Math.round(size[3])),
          title: node.title,
          folder: templateFolder,
        });
        if (created.created) createdTemplates.push(created.name, created.closeName);
        entry = created.entry;
      }
      resolvedComponent = { pkg: entryPkg, entry };
      node = { ...node, type: 'component', asset: entry.name.replace(/\.xml$/i, '') };
      type = 'component';
    }

    if (seenNames.has(node.name)) warnings.push(`duplicate node name "${node.name}"`);
    seenNames.add(node.name);
    const name = nodeName(node, index, usedNames);
    const r = rectOf(node, index);
    if (r.x + r.w > width + 0.5 || r.y + r.h > height + 0.5 || r.x < -0.5 || r.y < -0.5) {
      if (!allowOverflow && node.allowOverflow !== true) {
        warnings.push(`nodes[${index}] (${name}) is outside the ${width}x${height} component`);
      }
    }
    const common = [
      ['id', `n${index}`],
      ['name', xmlEscape(name)],
      ['xy', `${r.x},${r.y}`],
    ];
    if (node.pivot) common.push(['pivot', node.pivot]);
    if (node.rotation) common.push(['rotation', String(node.rotation)]);
    if (node.alpha !== undefined) common.push(['alpha', String(node.alpha)]);
    if (node.touchable === false) common.push(['touchable', 'false']);
    if (node.grayed === true) common.push(['grayed', 'true']);
    if (node.customData !== undefined && node.customData !== null && node.customData !== '') {
      common.push(['customData', xmlEscape(String(node.customData))]);
    }
    if (node.group) {
      const gid = groupIds.get(node.group);
      if (!gid) {
        fail(`nodes[${index}] (${name}): group "${node.group}" is not a group node in this component`);
      }
      common.push(['group', gid]);
    }
    const decorations = buildDecorations(node, index, ctx);

    if (type === 'group') {
      const attrs = [...common, ['size', `${r.w},${r.h}`], ['advanced', 'true']];
      pushNode(groupXml, 'group', attrs, decorations);
      return;
    }

    if (type === 'graph') {
      const shape = node.shape === 'circle' || node.shape === 'ellipse' ? 'eclipse' : 'rect';
      const fill = normalizeHex8(node.fill);
      const line = normalizeHex8(node.line);
      const lineSize = Number(node.lineWidth || (line ? 1 : 0));
      const attrs = [
        ...common,
        ['size', `${r.w},${r.h}`],
        ['type', shape],
        ...(lineSize > 0 ? [['lineSize', String(lineSize)]] : []),
        ...(line ? [['lineColor', line]] : []),
        ...(fill ? [['fillColor', fill]] : []),
        ...(node.corner ? [['corner', String(node.corner)]] : []),
      ];
      pushNode(xml, 'graph', attrs, decorations);
      plan.push({
        kind: 'rect',
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        fill: fill || 'transparent',
        line,
        lineWidth: lineSize,
        corner: Number(node.corner || 0),
        ellipse: shape === 'eclipse',
      });
      return;
    }

    if (type === 'image') {
      const entry = resolveImage(pkg, node, index, importRoot, imported, warnings, imageFolder);
      if (entry) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
          warnings.push(`nodes[${index}] (${name}): "${entry.name}" is not a raster image`);
        }
        applyScale9(entry, node, index, warnings);
        const attrs = [
          ...common,
          ['src', entry.attrs[0][1]],
          ['size', `${r.w},${r.h}`],
          ...(node.fit === 'contain' ? [['aspect', 'true']] : []),
        ];
        pushNode(xml, 'image', attrs, decorations);
        plan.push({
          kind: 'image',
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          file: resourceFile(pkg, entry),
          fit: node.fit === 'contain' ? 'contain' : 'stretch',
          alpha: Number(node.alpha ?? 1),
        });
      } else {
        const attrs = [...common, ['size', `${r.w},${r.h}`], ['type', 'rect'], ['fillColor', '#ff555555']];
        pushNode(xml, 'graph', attrs, decorations);
        plan.push({ kind: 'placeholder', x: r.x, y: r.y, w: r.w, h: r.h, label: 'missing image' });
      }
      return;
    }

    if (type === 'text' || type === 'inputtext') {
      const isInput = type === 'inputtext';
      const text = node.text === undefined ? '' : String(node.text);
      if (!isInput && text.trim() === '') warnings.push(`nodes[${index}] (${name}): text is empty`);
      const fs_ = Number(node.fontSize || 24);
      const attrs = [
        ...common,
        ['size', `${r.w},${r.h}`],
        ['fontSize', String(fs_)],
        ...(node.color ? [['color', color(node.color, '#000000')]] : []),
        ...(node.align ? [['align', ALIGN.has(node.align) ? node.align : 'left']] : []),
        ...(node.vAlign ? [['vAlign', VALIGN.has(node.vAlign) ? node.vAlign : 'top']] : []),
        ...(isInput
          ? [['autoSize', 'none']]
          : node.autoSize
            ? [['autoSize', node.autoSize]]
            : node.vAlign
              ? [['autoSize', 'none']]
              : []),
        ...(isInput ? [['input', 'true']] : []),
        ...(isInput && node.prompt ? [['prompt', xmlEscape(node.prompt)]] : []),
        ...(isInput || node.singleLine ? [['singleLine', 'true']] : []),
        ...(node.maxLength ? [['maxLength', String(node.maxLength)]] : []),
        ...(node.bold ? [['bold', 'true']] : []),
        ...(node.italic ? [['italic', 'true']] : []),
        ...(node.strokeColor ? [['strokeColor', color(node.strokeColor, '#000000')]] : []),
        ...(node.strokeSize ? [['strokeSize', String(node.strokeSize)]] : []),
        ...(node.leading ? [['leading', String(node.leading)]] : []),
        ...(node.autoClearText === false ? [] : [['autoClearText', 'true']]),
        ['text', xmlEscape(text)],
      ];
      pushNode(xml, 'text', attrs, decorations);
      if (isInput) {
        plan.push({ kind: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: 'transparent', line: '#ff888888', lineWidth: 1, corner: 0 });
        if (node.prompt) {
          plan.push({
            kind: 'text',
            x: r.x + 6,
            y: r.y,
            w: Math.max(0, r.w - 12),
            h: r.h,
            text: String(node.prompt),
            fontSize: fs_,
            color: '#ff888888',
            align: node.align || 'left',
            valign: node.vAlign || 'middle',
            bold: false,
            italic: false,
          });
        }
      } else {
        plan.push({
          kind: 'text',
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          text,
          fontSize: fs_,
          color: color(node.color, '#000000'),
          align: node.align || 'left',
          valign: node.vAlign || 'top',
          bold: !!node.bold,
          italic: !!node.italic,
          strokeColor: node.strokeColor ? color(node.strokeColor, '#000000') : undefined,
          strokeSize: Number(node.strokeSize || 0),
          leading: Number(node.leading || 0),
          singleLine: !!node.singleLine,
        });
      }
      return;
    }

    if (type === 'richtext') {
      const text = node.text === undefined ? '' : String(node.text);
      const fs_ = Number(node.fontSize || 24);
      const attrs = [
        ...common,
        ['size', `${r.w},${r.h}`],
        ['fontSize', String(fs_)],
        ...(node.color ? [['color', color(node.color, '#000000')]] : []),
        ...(node.align ? [['align', ALIGN.has(node.align) ? node.align : 'left']] : []),
        ...(node.vAlign ? [['vAlign', VALIGN.has(node.vAlign) ? node.vAlign : 'top']] : []),
        ...(node.autoSize ? [['autoSize', node.autoSize]] : node.vAlign ? [['autoSize', 'none']] : []),
        ['ubb', node.ubb === false ? 'false' : 'true'],
        ...(node.autoClearText === false ? [] : [['autoClearText', 'true']]),
        ['text', xmlEscape(text)],
      ];
      pushNode(xml, 'richtext', attrs, decorations);
      const plain = text
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;|&gt;|&quot;|&apos;/g, '')
        .trim();
      plan.push({
        kind: 'text',
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        text: plain || '(rich text)',
        fontSize: fs_,
        color: color(node.color, '#000000'),
        align: node.align || 'left',
        valign: node.vAlign || 'top',
        bold: !!node.bold,
        italic: !!node.italic,
      });
      if (/<[^>]*>/.test(text)) warnings.push(`nodes[${index}] (${name}): rich text markup is simplified in the preview`);
      return;
    }

    if (type === 'loader') {
      let url = '';
      if (node.url) {
        url = String(node.url);
      } else if (node.asset) {
        const imageEntry = byName(pkg, node.asset, ['image']);
        if (imageEntry) url = uiUrl(pkg, imageEntry);
        else warnings.push(`nodes[${index}] (${name}): loader image "${node.asset}" not found`);
      }
      const fill = ['scale', 'scaleFree', 'scaleNoBorder', 'none'].includes(node.fill) ? node.fill : 'scale';
      const attrs = [
        ...common,
        ['size', `${r.w},${r.h}`],
        ...(url ? [['url', xmlEscape(url)]] : []),
        ['fill', fill],
        ...(node.align ? [['align', node.align]] : []),
        ...(node.vAlign ? [['vAlign', node.vAlign]] : []),
      ];
      pushNode(xml, 'loader', attrs, decorations);
      plan.push({ kind: 'placeholder', x: r.x, y: r.y, w: r.w, h: r.h, label: `loader${url ? ` · ${url}` : ''}` });
      if (!url) warnings.push(`nodes[${index}] (${name}): loader has no url; use url or asset`);
      return;
    }

    if (type === 'tree') {
      let itemUrl;
      const wantedItem = node.defaultItem || node.asset;
      if (wantedItem) {
        itemUrl = resolveComponentUrl(pkg, wantedItem, packages);
        if (!itemUrl) fail(`nodes[${index}] (${name}): tree item template "${wantedItem}" not found`);
      } else {
        const created = ensureTreeItem(pkg, { width: 280, height: 36, folder: templateFolder });
        if (created.created) createdTemplates.push(created.name, created.expandName);
        itemUrl = uiUrl(pkg, created.entry);
      }
      const items = Array.isArray(node.items) ? node.items : [];
      const attrs = [
        ...common,
        ['size', `${r.w},${r.h}`],
        ['overflow', node.overflow || 'scroll'],
        ['treeView', 'true'],
        ['indent', String(node.indent ?? 15)],
        ['clickToExpand', '1'],
        ...(node.scrollBarFlags !== undefined ? [['scrollBarFlags', String(node.scrollBarFlags)]] : []),
        ['defaultItem', itemUrl],
        ...(node.autoClearItems === false ? [] : [['autoClearItems', 'true']]),
      ];
      const children = [...decorations];
      for (const item of items) {
        const parts = [];
        if (item.title !== undefined) parts.push(`title="${xmlEscape(item.title)}"`);
        if (item.level !== undefined) parts.push(`level="${Number(item.level)}"`);
        if (item.icon) {
          if (String(item.icon).startsWith('ui://')) parts.push(`icon="${item.icon}"`);
          else {
            const iconEntry = byName(pkg, item.icon, ['image']);
            if (iconEntry) parts.push(`icon="${uiUrl(pkg, iconEntry)}"`);
          }
        }
        children.push(`<item ${parts.join(' ')}/>`);
      }
      pushNode(xml, 'list', attrs, children);
      plan.push({
        kind: 'placeholder',
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        label: `tree · ${items.length} items`,
      });
      return;
    }

    if (type === 'list') {
      const layout = ['row', 'flow_hz', 'flow_vt', 'pagination'].includes(node.layout) ? node.layout : undefined;
      const overflow = ['visible', 'hidden', 'scroll'].includes(node.overflow) ? node.overflow : 'scroll';
      let defaultItem = '';
      if (node.defaultItem) {
        defaultItem = resolveComponentUrl(pkg, node.defaultItem, packages) || '';
        if (!defaultItem) warnings.push(`nodes[${index}] (${name}): list item template "${node.defaultItem}" not found`);
      } else if (node.asset) {
        defaultItem = resolveComponentUrl(pkg, node.asset, packages) || '';
        if (!defaultItem) warnings.push(`nodes[${index}] (${name}): list item template "${node.asset}" not found`);
      } else if (autoTemplate !== false) {
        const created = ensureTemplate(pkg, 'item', { width: 100, height: 100, folder: templateFolder });
        createdTemplates.push(created.name);
        defaultItem = uiUrl(pkg, created.entry);
      } else {
        warnings.push(`nodes[${index}] (${name}): list has no defaultItem template`);
      }
      const items = Array.isArray(node.items) ? node.items : [];
      const attrs = [
        ...common,
        ['size', `${r.w},${r.h}`],
        ...(layout ? [['layout', layout]] : []),
        ['overflow', overflow],
        ...(node.scroll ? [['scroll', node.scroll]] : []),
        ...(node.margin ? [['margin', node.margin]] : []),
        ...(node.lineGap !== undefined ? [['lineGap', String(node.lineGap)]] : []),
        ...(node.columnGap !== undefined ? [['colGap', String(node.columnGap)]] : []),
        ...(node.clipSoftness ? [['clipSoftness', node.clipSoftness]] : []),
        ...(node.selectionMode ? [['selectionMode', node.selectionMode]] : []),
        ...(node.selectionController ? [['selectionController', node.selectionController]] : []),
        ...(node.pageController ? [['pageController', node.pageController]] : []),
        ...(node.scrollBarFlags !== undefined ? [['scrollBarFlags', String(node.scrollBarFlags)]] : []),
        ...(defaultItem ? [['defaultItem', defaultItem]] : []),
        ...(node.autoClearItems === false ? [] : [['autoClearItems', 'true']]),
      ];
      const children = [...decorations];
      for (const item of items) {
        const parts = [];
        if (item.title !== undefined) parts.push(`title="${xmlEscape(item.title)}"`);
        if (item.icon) {
          if (String(item.icon).startsWith('ui://')) parts.push(`icon="${item.icon}"`);
          else {
            const iconEntry = byName(pkg, item.icon, ['image']);
            if (iconEntry) parts.push(`icon="${uiUrl(pkg, iconEntry)}"`);
          }
        }
        children.push(`<item ${parts.join(' ')}/>`);
      }
      pushNode(xml, 'list', attrs, children);
      plan.push({
        kind: 'placeholder',
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        label: `list · ${layout || 'single column'} · ${items.length} items`,
      });
      return;
    }

    // component instance (including button/label/progressbar/slider shorthands)
    const resolved = resolvedComponent || resolveComponent(pkg, node, index, packages);
    const entry = resolved.entry;
    const entryPkg = resolved.pkg;
    const ext = componentExtention(entryPkg, entry);
    const fileFolder = entryPath(entry).replace(/^\/+|\/+$/g, '');
    const attrs = [
      ...common,
      ['src', entry.attrs[0][1]],
      ['fileName', fileFolder ? `${fileFolder}/${entry.name}` : entry.name],
      ...(entryPkg && entryPkg.id && entryPkg.id !== pkg.id ? [['pkg', entryPkg.id]] : []),
      ['size', `${r.w},${r.h}`],
    ];
    const props = { ...(node.props || {}) };
    const propKeys = [
      'title',
      'selectedTitle',
      'titleColor',
      'titleFontSize',
      'icon',
      'selectedIcon',
      'sound',
      'soundVolume',
      'mode',
      'checked',
      'controller',
      'page',
      'value',
      'max',
      'visibleItemCount',
    ];
    for (const key of propKeys) {
      if (node[key] !== undefined) props[key] = String(node[key]);
    }
    for (const key of ['icon', 'selectedIcon']) {
      const value = props[key];
      if (value && !String(value).startsWith('ui://')) {
        const iconEntry = byName(pkg, value, ['image']);
        if (iconEntry) props[key] = uiUrl(pkg, iconEntry);
        else warnings.push(`nodes[${index}] (${name}): icon asset "${value}" not found`);
      }
    }
    const propEntries = Object.entries(props).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (propEntries.length > 0 && !ext) {
      warnings.push(`nodes[${index}] (${name}): "${entry.name}" has no extension; title/props were skipped`);
    }
    let children = [];
    const comboItems = ext === 'ComboBox' && Array.isArray(node.items)
      ? node.items.filter((item) => item && item.title !== undefined)
      : [];
    if (ext === 'ComboBox') {
      const attrsText = propEntries.map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(' ');
      if (comboItems.length > 0) {
        const itemsText = comboItems.map((item) => `<item title="${xmlEscape(item.title)}"/>`).join('');
        children.push(`<ComboBox${attrsText ? ` ${attrsText}` : ''}>${itemsText}</ComboBox>`);
      } else if (attrsText) {
        children.push(`<ComboBox ${attrsText}/>`);
      }
    } else if (ext && propEntries.length > 0) {
      children.push(`<${ext} ${propEntries.map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(' ')}/>`);
    }
    children = children.concat(decorations);
    pushNode(xml, 'component', attrs, children);
    plan.push({
      kind: 'placeholder',
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      label: `${entry.name}${props.title ? ` · ${props.title}` : ''}`,
    });
  });

  if (groupXml.length > 0) xml.push(...groupXml);

  return { xml, plan, imported, createdTemplates, warnings };
}

export function componentXml({ width, height, xml, controllers = [], scroll = {} }) {
  const rootAttrs = [['size', `${width},${height}`]];
  if (scroll && typeof scroll === 'object') {
    for (const key of ['overflow', 'scroll', 'scrollBar', 'margin', 'clipSoftness']) {
      if (scroll[key] !== undefined) rootAttrs.push([key, String(scroll[key])]);
    }
  }
  const controllerBlock = controllersXml(controllers);
  return `<?xml version="1.0" encoding="utf-8"?>
<component ${attrsToString(rootAttrs)}>
${controllerBlock ? `${controllerBlock}\n` : ''}  <displayList>
${xml.join('\n')}
  </displayList>
</component>
`;
}

/** Register (or reuse) a component entry and write its XML file. */
export function writeComponent({ project, pkg, name, width, height, displayXml, exported, controllers, scroll, folder = '' }) {
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/.test(name)) {
    fail(`component name "${name}" may only contain letters, digits, _ and - (and CJK)`);
  }
  let entry = byName(pkg, `${name}.xml`, ['component']);
  if (!entry) {
    const rel = String(folder || '').replace(/^\/+|\/+$/g, '');
    entry = addEntry(pkg, { tag: 'component', name: `${name}.xml`, path: rel ? `/${rel}/` : '/', exported: exported !== false });
  } else if (exported === true) {
    const hit = entry.attrs.find(([k]) => k === 'exported');
    if (hit) hit[1] = 'true';
    else entry.attrs.push(['exported', 'true']);
  }
  const file = resourceFile(pkg, entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, componentXml({ width, height, xml: displayXml, controllers, scroll }), 'utf8');
  return { entry, file };
}

/** Write a complete component XML (used for extension templates). */
export function writeRawComponent({ pkg, name, xml, exported = true, folder = '' }) {
  let entry = byName(pkg, `${name}.xml`, ['component']);
  if (!entry) {
    const rel = String(folder || '').replace(/^\/+|\/+$/g, '');
    entry = addEntry(pkg, { tag: 'component', name: `${name}.xml`, path: rel ? `/${rel}/` : '/', exported });
  } else if (exported) {
    const hit = entry.attrs.find(([k]) => k === 'exported');
    if (hit) hit[1] = 'true';
    else entry.attrs.push(['exported', 'true']);
  }
  const file = resourceFile(pkg, entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xml, 'utf8');
  return { entry, file };
}

export function componentInfo(pkg, entry) {
  const file = resourceFile(pkg, entry);
  const raw = fs.readFileSync(file, 'utf8');
  const size = (raw.match(/<component\b[^>]*\bsize="([^"]+)"/) || [])[1] || '';
  const [w, h] = size.split(',').map((n) => Number(n));
  const ext = (raw.match(/<component\b[^>]*\bextention="([^"]+)"/) || [])[1];
  const nodeCount = (raw.match(/<(image|text|graph|component|list|loader|group|richtext)\b/g) || []).length;
  return { size: [w, h], extention: ext, nodeCount };
}

export function previewDir(project) {
  return path.join(project.dir, '.dsh-fairyui', 'preview');
}

export function writePreviewPlan(project, name, plan) {
  const dir = previewDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.plan.json`);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), 'utf8');
  return file;
}

export function naturalImageSize(pkg, entry) {
  return naturalSize(pkg, entry);
}

export function extOf(pkg, entry) {
  return componentExtention(pkg, entry);
}

export function attrOf(entry, name2) {
  return attr(entry, name2);
}
