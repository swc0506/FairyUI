// Vision helpers: crop/zoom a mockup, annotate regions, sample a palette, and diff
// a generated preview against the mockup. All rendering is the bundled GDI+ script.
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from './project.js';
import { renderWith, scriptPath } from './render.js';

function requireImage(file, label = 'image') {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  const size = imageSize(file);
  if (!size) throw new Error(`cannot read image size (PNG/JPEG/WebP): ${file}`);
  return size;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clampRect(rect, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.round(Number(rect[0]) || 0)));
  const y = Math.max(0, Math.min(height - 1, Math.round(Number(rect[1]) || 0)));
  const w = Math.max(1, Math.min(width - x, Math.round(Number(rect[2]) || 0)));
  const h = Math.max(1, Math.min(height - y, Math.round(Number(rect[3]) || 0)));
  return { x, y, w, h };
}

export async function cropImage({ image, rect, cols = 3, rows = 3, scale = 1, outDir, prefix }) {
  const size = requireImage(image);
  const zoom = Math.max(1, Math.min(4, Number(scale) || 1));
  const base = path.basename(image, path.extname(image));
  const dir = outDir || path.join(path.dirname(image), `${base}_crops`);
  ensureDir(dir);
  const items = [];
  if (Array.isArray(rect) && rect.length === 4) {
    const r = clampRect(rect, size.width, size.height);
    const out = path.join(dir, `${prefix || base}_crop.png`);
    items.push({ ...r, scale: zoom, out });
  } else {
    const c = Math.max(1, Math.min(12, Math.round(Number(cols) || 3)));
    const rr = Math.max(1, Math.min(12, Math.round(Number(rows) || 3)));
    for (let row = 0; row < rr; row += 1) {
      for (let col = 0; col < c; col += 1) {
        const x = Math.floor((size.width * col) / c);
        const y = Math.floor((size.height * row) / rr);
        const x2 = Math.floor((size.width * (col + 1)) / c);
        const y2 = Math.floor((size.height * (row + 1)) / rr);
        const out = path.join(dir, `${prefix || base}_r${row + 1}c${col + 1}.png`);
        items.push({ x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y), scale: zoom, out });
      }
    }
  }
  const planPath = path.join(dir, 'crop.plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ mode: 'crop', image, items }, null, 2), 'utf8');
  await renderWith(scriptPath('vision.ps1'), planPath, items[0].out);
  return {
    ok: true,
    image,
    width: size.width,
    height: size.height,
    mode: items.length === 1 ? 'rect' : 'grid',
    scale: zoom,
    dir,
    files: items.map((item) => ({ path: item.out, rect: [item.x, item.y, item.w, item.h] })),
  };
}

export async function annotateImage({ image, regions, out, scale = 1 }) {
  const size = requireImage(image);
  const list = Array.isArray(regions) ? regions : [];
  if (list.length === 0) throw new Error('regions must be a non-empty array of { rect:[x,y,w,h], label? }');
  const normalized = list.map((region, index) => {
    const raw = Array.isArray(region?.rect) ? region.rect : region?.rect;
    if (!Array.isArray(raw) || raw.length !== 4) {
      throw new Error(`regions[${index}].rect must be [x, y, width, height]`);
    }
    const r = clampRect(raw, size.width, size.height);
    return {
      ...r,
      label: region.label !== undefined ? String(region.label) : region.name !== undefined ? String(region.name) : undefined,
      color: region.color ? String(region.color) : undefined,
    };
  });
  const base = path.basename(image, path.extname(image));
  const target = out || path.join(path.dirname(image), `${base}_annotated.png`);
  const planPath = path.join(path.dirname(target), `${base}_annotate.plan.json`);
  fs.writeFileSync(
    planPath,
    JSON.stringify({ mode: 'annotate', image, regions: normalized, scale: Math.max(1, Math.min(2, Number(scale) || 1)) }, null, 2),
    'utf8',
  );
  await renderWith(scriptPath('vision.ps1'), planPath, target);
  return { ok: true, image, path: target, regions: normalized, width: size.width, height: size.height };
}

export async function paletteImage({ image, rect, top = 8, step = 4 }) {
  const size = requireImage(image);
  const base = path.basename(image, path.extname(image));
  const out = path.join(path.dirname(image), `${base}_palette.json`);
  const plan = { mode: 'palette', image, top: Math.max(1, Math.min(32, Number(top) || 8)), step: Math.max(1, Math.min(16, Number(step) || 4)) };
  if (Array.isArray(rect) && rect.length === 4) plan.rect = clampRect(rect, size.width, size.height);
  const planPath = path.join(path.dirname(out), `${base}_palette.plan.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
  await renderWith(scriptPath('vision.ps1'), planPath, out);
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  return { ok: true, image, path: out, ...result };
}

export async function diffImages({ image, preview, out, threshold = 24 }) {
  const a = requireImage(image, 'image');
  const b = requireImage(preview, 'preview');
  const base = path.basename(image, path.extname(image));
  const heatmap = out || path.join(path.dirname(image), `${base}_diff.png`);
  const metrics = `${heatmap.replace(/\.png$/i, '')}.json`;
  const plan = {
    mode: 'diff',
    a: image,
    b: preview,
    heatmap,
    metrics,
    threshold: Math.max(0, Math.min(255, Math.round(Number(threshold) || 24))),
  };
  const planPath = path.join(path.dirname(heatmap), `${base}_diff.plan.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
  await renderWith(scriptPath('vision.ps1'), planPath, heatmap, { timeoutMs: 180000 });
  const result = JSON.parse(fs.readFileSync(metrics, 'utf8'));
  return {
    ok: true,
    image,
    preview,
    imageSize: [a.width, a.height],
    previewSize: [b.width, b.height],
    resized: a.width !== b.width || a.height !== b.height,
    heatmap,
    metricsPath: metrics,
    ...result,
  };
}
