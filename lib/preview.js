// Preview support: turn an existing component XML into render-plan primitives (so
// cross-package instances appear in the preview) and apply controller gears
// (gearDisplay/gearColor/gearIcon/gearXY/gearSize) for the selected preview pages.
import fs from 'node:fs';
import path from 'node:path';
import { attrOf, childrenOf, firstChild, parseNumbers, parseXml } from './xml.js';
import { imageSize, resourceFile } from './project.js';

const UI_URL = /^ui:\/\/([0-9a-z]{8})([0-9a-z]+)$/i;

function entryIdOf(entry) {
  const hit = entry.attrs.find(([k]) => k === 'id');
  return hit ? hit[1] : undefined;
}

function entryById(pkg, id) {
  if (!pkg || !id) return undefined;
  return pkg.entries.find((entry) => entryIdOf(entry) === id);
}

function packageById(packages, id) {
  return (packages || []).find((pkg) => pkg.id && pkg.id.toLowerCase() === String(id || '').toLowerCase());
}

function naturalSize(pkg, entry) {
  try {
    return imageSize(resourceFile(pkg, entry));
  } catch {
    return undefined;
  }
}

function parsePageIds(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
}

function gearValues(gear) {
  const raw = attrOf(gear, 'values') || '';
  return raw === '' ? [] : raw.split('|');
}

/**
 * Evaluate the gears attached to one node for the given controller pages.
 * Returns { hidden, xy, size, color, icon }.
 */
export function evaluateGears(node, pageOf) {
  const state = { hidden: false };
  for (const gear of node.children || []) {
    if (!gear.tag.startsWith('gear')) continue;
    const controller = attrOf(gear, 'controller');
    if (!controller || !pageOf.has(controller)) continue;
    const selected = Number(pageOf.get(controller));
    const pages = parsePageIds(attrOf(gear, 'pages'));
    const index = pages.indexOf(selected);
    if (gear.tag === 'gearDisplay' || gear.tag === 'gearDisplay2') {
      if (pages.length > 0 && index < 0) state.hidden = true;
      continue;
    }
    if (index < 0) continue;
    const values = gearValues(gear);
    const value = values[index];
    if (value === undefined) continue;
    if (gear.tag === 'gearColor') {
      // "fill,stroke" (text uses the first colour as its text colour)
      state.color = value.split(',')[0] || undefined;
    } else if (gear.tag === 'gearIcon') {
      state.icon = value || undefined;
    } else if (gear.tag === 'gearXY') {
      const xy = parseNumbers(value);
      if (xy) state.xy = xy;
    } else if (gear.tag === 'gearSize') {
      const size = parseNumbers(value);
      if (size) state.size = size;
    }
  }
  return state;
}

function resolveUrl(packages, url) {
  const m = String(url || '').match(UI_URL);
  if (!m) return undefined;
  const pkg = packageById(packages, m[1]);
  if (!pkg) return undefined;
  const entry = entryById(pkg, m[2]);
  return entry ? { pkg, entry } : undefined;
}

function fitOf(node) {
  return attrOf(node, 'aspect') === 'true' ? 'contain' : 'stretch';
}

/**
 * Flatten a component (and nested component instances) into preview primitives,
 * offset by (ox, oy). Controller pages default to the component's `selected` page
 * and may be overridden by `overrides` ({controllerName: pageId}).
 */
export function expandComponentPreview({
  pkg,
  entry,
  packages,
  overrides = {},
  warnings = [],
  depth = 0,
  seen = new Set(),
  ox = 0,
  oy = 0,
  maxDepth = 4,
}) {
  if (!entry || !pkg) return [];
  const key = `${pkg.id || pkg.name}:${entry.name}`;
  if (depth > maxDepth) {
    warnings.push(`preview: 组件嵌套超过 ${maxDepth} 层，已停止展开 ${pkg.name}/${entry.name}`);
    return [];
  }
  if (seen.has(key)) {
    warnings.push(`preview: 检测到组件循环引用 ${pkg.name}/${entry.name}，已停止展开`);
    return [];
  }
  let root;
  try {
    root = parseXml(fs.readFileSync(resourceFile(pkg, entry), 'utf8'));
  } catch (error) {
    warnings.push(`preview: 无法读取 ${pkg.name}/${entry.name} (${error.message})`);
    return [];
  }
  if (!root) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(key);

  const pageOf = new Map();
  for (const controller of childrenOf(root, 'controller')) {
    const name = attrOf(controller, 'name');
    if (!name) continue;
    const selected = Number(attrOf(controller, 'selected'));
    pageOf.set(name, Number.isFinite(selected) ? selected : 0);
  }
  for (const [name, page] of Object.entries(overrides)) {
    if (pageOf.has(name)) pageOf.set(name, Number(page));
  }

  const list = firstChild(root, 'displayList');
  if (!list) return [];
  const out = [];
  for (const node of list.children) {
    if (attrOf(node, 'visible') === 'false') continue;
    const state = evaluateGears(node, pageOf);
    if (state.hidden) continue;
    const xy = parseNumbers(attrOf(node, 'xy')) || [0, 0];
    let size = parseNumbers(attrOf(node, 'size')) || [0, 0];
    if (state.size) size = state.size;
    const x = ox + xy[0] + (state.xy ? state.xy[0] : 0);
    const y = oy + xy[1] + (state.xy ? state.xy[1] : 0);
    let w = size[0];
    let h = size[1];

    switch (node.tag) {
      case 'image': {
        const srcPkg = attrOf(node, 'pkg') ? packageById(packages, attrOf(node, 'pkg')) || pkg : pkg;
        const imageEntry = entryById(srcPkg, attrOf(node, 'src'));
        if (!imageEntry) {
          out.push({ kind: 'placeholder', x, y, w: Math.max(1, w), h: Math.max(1, h), label: 'missing image' });
          continue;
        }
        const natural = naturalSize(srcPkg, imageEntry);
        if (w <= 0 && natural) w = natural.width;
        if (h <= 0 && natural) h = natural.height;
        out.push({
          kind: 'image',
          x,
          y,
          w,
          h,
          file: resourceFile(srcPkg, imageEntry),
          fit: fitOf(node),
          alpha: Number(attrOf(node, 'alpha') ?? 1),
        });
        break;
      }
      case 'loader': {
        const url = state.icon || attrOf(node, 'url') || '';
        const resolved = resolveUrl(packages, url);
        if (resolved) {
          const natural = naturalSize(resolved.pkg, resolved.entry);
          if (w <= 0 && natural) w = natural.width;
          if (h <= 0 && natural) h = natural.height;
          out.push({
            kind: 'image',
            x,
            y,
            w,
            h,
            file: resourceFile(resolved.pkg, resolved.entry),
            fit: attrOf(node, 'aspect') === 'true' ? 'contain' : 'stretch',
            alpha: Number(attrOf(node, 'alpha') ?? 1),
          });
        } else {
          out.push({ kind: 'placeholder', x, y, w: Math.max(1, w), h: Math.max(1, h), label: `loader${url ? ` · ${url}` : ''}` });
        }
        break;
      }
      case 'text':
      case 'richtext':
      case 'inputtext': {
        const text = attrOf(node, 'text') ?? '';
        if (text === '' && node.tag !== 'inputtext') continue;
        const fontSize = Number(attrOf(node, 'fontSize') || 24);
        out.push({
          kind: 'text',
          x,
          y,
          w: Math.max(1, w),
          h: Math.max(1, h),
          text,
          fontSize,
          color: state.color || attrOf(node, 'color') || '#000000',
          align: attrOf(node, 'align') || 'left',
          valign: attrOf(node, 'vAlign') || 'top',
          bold: attrOf(node, 'bold') === 'true',
          italic: attrOf(node, 'italic') === 'true',
          strokeColor: attrOf(node, 'strokeColor'),
          strokeSize: Number(attrOf(node, 'strokeSize') || 0),
        });
        break;
      }
      case 'graph': {
        const ellipse = (attrOf(node, 'type') || 'rect') === 'eclipse';
        out.push({
          kind: 'rect',
          x,
          y,
          w: Math.max(1, w),
          h: Math.max(1, h),
          fill: state.color || attrOf(node, 'fillColor') || 'transparent',
          line: attrOf(node, 'lineColor'),
          lineWidth: Number(attrOf(node, 'lineSize') || 0),
          corner: Number(attrOf(node, 'corner') || 0),
          ellipse,
        });
        break;
      }
      case 'list': {
        out.push({
          kind: 'placeholder',
          x,
          y,
          w: Math.max(1, w),
          h: Math.max(1, h),
          label: `list · ${childrenOf(node, 'item').length} items`,
        });
        break;
      }
      case 'component': {
        const targetPkg = attrOf(node, 'pkg') ? packageById(packages, attrOf(node, 'pkg')) : pkg;
        const targetEntry = targetPkg && entryById(targetPkg, attrOf(node, 'src'));
        if (!targetPkg || !targetEntry) {
          out.push({ kind: 'placeholder', x, y, w: Math.max(1, w), h: Math.max(1, h), label: 'missing component' });
          break;
        }
        const nested = expandComponentPreview({
          pkg: targetPkg,
          entry: targetEntry,
          packages,
          overrides,
          warnings,
          depth: depth + 1,
          seen: nextSeen,
          ox: x,
          oy: y,
          maxDepth,
        });
        if (nested.length === 0) {
          out.push({ kind: 'placeholder', x, y, w: Math.max(1, w), h: Math.max(1, h), label: targetEntry.name.replace(/\.xml$/i, '') });
        } else {
          out.push(...nested);
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export const GEAR_TAG_BY_TYPE = {
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

function planPageMap(controllers, previewPages) {
  const pageOf = new Map();
  for (const controller of controllers || []) {
    if (!controller || typeof controller.name !== 'string') continue;
    pageOf.set(controller.name, Number.isInteger(controller.selected) ? controller.selected : 0);
  }
  for (const [name, page] of Object.entries(previewPages || {})) {
    if (page === undefined || page === null) continue;
    const value = Number(page);
    if (Number.isFinite(value)) pageOf.set(name, value);
  }
  return pageOf;
}

/** Apply the controller gears recorded on build-spec nodes to their preview primitives. */
export function applyPreviewGears(nodes, controllers, previewPages) {
  const pageOf = planPageMap(controllers, previewPages);
  if (pageOf.size === 0) return nodes;
  const out = [];
  for (const node of nodes) {
    if (!Array.isArray(node.gears) || node.gears.length === 0) {
      out.push(node);
      continue;
    }
    const state = evaluateGears(
      { children: node.gears.map((gear) => ({ tag: GEAR_TAG_BY_TYPE[gear.type] || `gear${gear.type}`, attrs: gearAttrs(gear) })) },
      pageOf,
    );
    if (state.hidden) continue;
    const item = { ...node };
    delete item.gears;
    if (state.xy) {
      item.x += state.xy[0];
      item.y += state.xy[1];
    }
    if (state.size) {
      item.w = state.size[0];
      item.h = state.size[1];
    }
    if (state.color) {
      if (item.kind === 'text') item.color = state.color;
      else if (item.kind === 'rect') item.fill = state.color;
    }
    out.push(item);
  }
  return out;
}

function gearAttrs(gear) {
  const attrs = { controller: gear.controller };
  if (Array.isArray(gear.pages)) attrs.pages = gear.pages.join(',');
  if (gear.values !== undefined) attrs.values = String(gear.values);
  if (gear.default !== undefined) attrs.default = String(gear.default);
  return attrs;
}
