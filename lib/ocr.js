// OCR helper: Windows.Media.Ocr (zero install on Windows 10/11). With scale > 1 the image is
// split into overlapping tiles and each tile is upscaled before recognition (full-image 2x OCR
// drifts on large bitmaps). Boxes are mapped back to source pixels, merged and de-duplicated.
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from './project.js';
import { renderWith, runScript, scriptPath } from './render.js';

const MAX_TILE_SCALED = 800;

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union <= 0 ? 0 : inter / union;
}

function normalizeText(text) {
  return String(text).replace(/\s+/g, '');
}

async function runOcrFile(imagePath, lang, outPath) {
  const planPath = `${outPath}.plan.json`;
  fs.writeFileSync(planPath, JSON.stringify({ image: imagePath, lang: lang ? String(lang) : undefined }, null, 2), 'utf8');
  await runScript(scriptPath('ocr.ps1'), ['-Plan', planPath, '-Out', outPath], { timeoutMs: 120000 });
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

export async function ocrImage({ image, lang, out, scale = 2 }) {
  if (!fs.existsSync(image)) throw new Error(`image not found: ${image}`);
  const abs = path.resolve(image);
  const size = imageSize(abs);
  if (!size) throw new Error(`cannot read image size (PNG/JPEG/WebP): ${abs}`);
  const base = path.basename(abs, path.extname(abs));
  const target = out || path.join(path.dirname(abs), `${base}_ocr.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  let factor = Math.max(1, Math.min(4, Number(scale) || 1));
  factor = Math.min(factor, 4096 / size.width, 4096 / size.height);
  factor = Math.max(1, Math.round(factor * 100) / 100);

  const workDir = path.join(path.dirname(abs), '.dsh-fairyui', `ocr-${base}-${Date.now()}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const lines = [];
  let language;
  let tileCount = 1;
  try {
    if (factor <= 1.01) {
      const result = await runOcrFile(abs, lang, path.join(workDir, 'ocr_0.json'));
      language = result.lang;
      for (const line of result.lines || []) {
        lines.push({ text: line.text, rect: line.rect, fontSize: line.fontSize, words: line.words });
      }
    } else {
      let tileSize = Math.max(160, Math.floor(MAX_TILE_SCALED / factor));
      const cols = Math.max(1, Math.ceil(size.width / tileSize));
      const rows = Math.max(1, Math.ceil(size.height / tileSize));
      const overlap = Math.min(24, Math.floor(tileSize / 8));
      const tiles = [];
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x0 = Math.max(0, col * tileSize - (col > 0 ? overlap : 0));
          const y0 = Math.max(0, row * tileSize - (row > 0 ? overlap : 0));
          const x1 = Math.min(size.width, (col + 1) * tileSize);
          const y1 = Math.min(size.height, (row + 1) * tileSize);
          if (x1 - x0 < 8 || y1 - y0 < 8) continue;
          tiles.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, out: path.join(workDir, `tile_r${row + 1}c${col + 1}.png`) });
        }
      }
      if (tiles.length === 0) throw new Error('image is too small for OCR');
      tileCount = tiles.length;
      const cropPlan = path.join(workDir, 'tiles.plan.json');
      fs.writeFileSync(
        cropPlan,
        JSON.stringify({ mode: 'crop', image: abs, items: tiles.map((tile) => ({ ...tile, scale: factor })) }, null, 2),
        'utf8',
      );
      await renderWith(scriptPath('vision.ps1'), cropPlan, tiles[0].out, { timeoutMs: 180000 });

      for (let index = 0; index < tiles.length; index += 1) {
        const tile = tiles[index];
        const result = await runOcrFile(tile.out, lang, path.join(workDir, `ocr_${index}.json`));
        language = language || result.lang;
        for (const line of result.lines || []) {
          if (!Array.isArray(line.rect) || line.rect.length !== 4) continue;
          lines.push({
            text: line.text,
            rect: [
              Math.round(tile.x + line.rect[0] / factor),
              Math.round(tile.y + line.rect[1] / factor),
              Math.round(line.rect[2] / factor),
              Math.round(line.rect[3] / factor),
            ],
            fontSize: typeof line.fontSize === 'number' ? Math.round(line.fontSize / factor) : line.fontSize,
            words: line.words,
          });
        }
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const merged = [];
  for (const line of lines.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])) {
    const duplicate = merged.some(
      (existing) => normalizeText(existing.text) === normalizeText(line.text) && iou(existing.rect, line.rect) > 0.5,
    );
    if (!duplicate) merged.push(line);
  }

  const payload = {
    ok: true,
    image,
    path: target,
    width: size.width,
    height: size.height,
    scale: factor,
    tiles: tileCount,
    lang: language,
    count: merged.length,
    text: merged.map((line) => line.text).join('\n'),
    lines: merged,
  };
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}
