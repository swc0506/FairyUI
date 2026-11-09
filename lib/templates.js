// Canonical structures for FairyGUI extension components (Button/Label/ProgressBar/Slider)
// and a plain list-item template. Mirrors what the editor's "new button/progress bar…"
// wizards create: the extension element plus the name-convention children the runtime looks up.
import fs from 'node:fs';
import path from 'node:path';
import { addEntry, byName, resourceFile, xmlEscape } from './project.js';

function folderOf(options) {
  return String(options.folder || '').replace(/^\/+|\/+$/g, '');
}

function writeTemplate(pkg, name, xml, folder, exported = true) {
  const rel = folderOf({ folder });
  const entry = addEntry(pkg, { tag: 'component', name: `${name}.xml`, path: rel ? `/${rel}/` : '/', exported });
  const file = resourceFile(pkg, entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xml, 'utf8');
  return entry;
}

export const TEMPLATE_EXTENSIONS = {
  button: 'Button',
  label: 'Label',
  progressbar: 'ProgressBar',
  slider: 'Slider',
  combobox: 'ComboBox',
};

const DEFAULT_NAMES = {
  button: 'CommonBtn',
  label: 'CommonLabel',
  progressbar: 'CommonProgressBar',
  slider: 'CommonSlider',
  item: 'CommonItem',
  combobox: 'CommonComboBox',
  comboItem: 'CommonComboBoxItem',
  comboPopup: 'CommonComboBoxPopup',
  treeItem: 'CommonTreeItem',
  treeExpand: 'CommonTreeExpand',
  windowFrame: 'CommonWindowFrame',
  windowClose: 'CommonWindowClose',
};

const DEFAULT_SIZE = {
  button: [160, 56],
  label: [200, 32],
  progressbar: [200, 16],
  slider: [240, 24],
  item: [100, 100],
  combobox: [160, 32],
  comboItem: [100, 28],
  comboPopup: [160, 180],
  treeItem: [280, 36],
  treeExpand: [24, 24],
  windowFrame: [600, 400],
  windowClose: [32, 32],
};

function argb(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 6) return `#ff${hex.toLowerCase()}`;
  if (hex.length === 8) return `#${hex.toLowerCase()}`;
  return fallback;
}

function componentXml({ width, height, extension, body, extensionTag }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="${width},${height}"${extension ? ` extention="${extension}"` : ''}>
  <displayList>
${body}
  </displayList>
${extensionTag ? `  ${extensionTag}\n` : ''}</component>
`;
}

/** Build the XML for one template; returns { name, xml, width, height }. */
export function buildTemplate({
  extension,
  width,
  height,
  title = '按钮',
  bg = '#f0a020',
  text = '#ffffff',
  fontSize = 24,
  corner = 12,
  bar = '#ffd166',
  track = '#333344',
  grip = '#ffffff',
} = {}) {
  const kind = extension === 'item' ? 'item' : extension;
  if (!DEFAULT_NAMES[kind]) throw new Error(`unsupported template extension "${extension}"`);
  const [dw, dh] = DEFAULT_SIZE[kind];
  const w = Math.max(1, Math.round(Number(width) || dw));
  const h = Math.max(1, Math.round(Number(height) || dh));
  const fill = argb(bg, '#fff0a020');
  const textColor = argb(text, '#ffffffff');

  if (kind === 'button') {
    const body = [
      `    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="${fill}" corner="${Number(corner) || 0}"/>`,
      `    <text id="n1" name="title" xy="0,0" size="${w},${h}" fontSize="${fontSize}" color="${textColor}" align="center" vAlign="middle" autoSize="none" singleLine="true" text="${xmlEscape(title)}"/>`,
    ].join('\n');
    return { name: DEFAULT_NAMES.button, width: w, height: h, xml: componentXml({ width: w, height: h, extension: 'Button', body, extensionTag: '<Button/>' }) };
  }

  if (kind === 'label') {
    const body = `    <text id="n0" name="title" xy="0,0" size="${w},${h}" fontSize="${fontSize}" color="${textColor}" vAlign="middle" autoSize="none" singleLine="true" text="${xmlEscape(title)}"/>`;
    return { name: DEFAULT_NAMES.label, width: w, height: h, xml: componentXml({ width: w, height: h, extension: 'Label', body, extensionTag: '<Label/>' }) };
  }

  if (kind === 'progressbar') {
    const pad = 2;
    const body = [
      `    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="${argb(track, '#ff333344')}" corner="${Math.floor(h / 2)}"/>`,
      `    <graph id="n1" name="bar" xy="${pad},${pad}" size="${Math.max(1, w - pad * 2)},${Math.max(1, h - pad * 2)}" type="rect" fillColor="${argb(bar, '#ffffd166')}" corner="${Math.floor((h - pad * 2) / 2)}"/>`,
    ].join('\n');
    return { name: DEFAULT_NAMES.progressbar, width: w, height: h, xml: componentXml({ width: w, height: h, extension: 'ProgressBar', body, extensionTag: '<ProgressBar/>' }) };
  }

  if (kind === 'slider') {
    const gripH = Math.max(12, h);
    const barH = Math.max(4, Math.floor(h / 3));
    const barY = Math.floor((h - barH) / 2);
    const body = [
      `    <graph id="n0" name="bg" xy="0,${barY}" size="${w},${barH}" type="rect" fillColor="${argb(track, '#ff333344')}" corner="${Math.floor(barH / 2)}"/>`,
      `    <graph id="n1" name="bar" xy="0,${barY}" size="${Math.floor(w / 2)},${barH}" type="rect" fillColor="${argb(bar, '#ffffd166')}" corner="${Math.floor(barH / 2)}"/>`,
      `    <graph id="n2" name="grip" xy="${w - gripH},0" size="${gripH},${gripH}" type="eclipse" fillColor="${argb(grip, '#ffffffff')}"/>`,
    ].join('\n');
    return { name: DEFAULT_NAMES.slider, width: w, height: h, xml: componentXml({ width: w, height: h, extension: 'Slider', body, extensionTag: '<Slider/>' }) };
  }

  // plain list-item template (graph background + title text)
  const body = [
    `    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="${argb(track, '#ff333344')}" corner="${Number(corner) || 0}"/>`,
    `    <text id="n1" name="title" xy="0,0" size="${w},${h}" fontSize="${fontSize}" color="${textColor}" align="center" vAlign="middle" autoSize="none" singleLine="true" text="${xmlEscape(title === '按钮' ? '物品' : title)}"/>`,
  ].join('\n');
  return { name: DEFAULT_NAMES.item, width: w, height: h, xml: componentXml({ width: w, height: h, extension: undefined, body }) };
}

function comboItemXml(w, h) {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="${w},${h}" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="#ff3399ff">
      <gearDisplay controller="button" pages="1,2,3"/>
      <relation target="" sidePair="width-width,height-height"/>
    </graph>
    <text id="n1" name="title" xy="4,0" size="${Math.max(1, w - 8)},${h}" fontSize="16" color="#ffffff" vAlign="middle" autoSize="none" singleLine="true" text="选项">
      <relation target="" sidePair="width-width,height-height"/>
    </text>
  </displayList>
  <Button mode="Radio"/>
</component>
`;
}

function comboPopupXml(w, h, itemUrl) {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="${w},${h}">
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="#ff222233" corner="6"/>
    <list id="n1" name="list" xy="2,2" size="${Math.max(1, w - 4)},${Math.max(1, h - 4)}" overflow="scroll" scrollBarFlags="4" margin="0,0,0,0" defaultItem="${itemUrl}"/>
  </displayList>
</component>
`;
}

function comboXml(w, h, popupUrl, visibleItemCount) {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="${w},${h}" extention="ComboBox">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="#ff3a3a4a" corner="6">
      <gearDisplay controller="button" pages="0,1,2,3"/>
      <relation target="" sidePair="width-width,height-height"/>
    </graph>
    <text id="n1" name="title" xy="8,0" size="${Math.max(1, w - 34)},${h}" fontSize="16" color="#ffffff" vAlign="middle" autoSize="none" singleLine="true" text="请选择"/>
    <graph id="n2" name="arrow" xy="${Math.max(1, w - 20)},${Math.max(1, Math.floor(h / 2) - 4)}" size="10,8" type="rect" fillColor="#ffcccccc"/>
  </displayList>
  <ComboBox dropdown="${popupUrl}" visibleItemCount="${visibleItemCount || 5}"/>
</component>
`;
}

function ensureRawComponent(pkg, name, xml, folder = '') {
  const existing = byName(pkg, `${name}.xml`, ['component']);
  if (existing) return { entry: existing, name, created: false };
  const entry = writeTemplate(pkg, name, xml, folder);
  return { entry, name, created: true };
}

/** Create the three linked components a ComboBox needs: item, popup, combobox. */
export function ensureComboBox(pkg, options = {}) {
  const w = Math.max(60, Math.round(Number(options.width) || DEFAULT_SIZE.combobox[0]));
  const h = Math.max(24, Math.round(Number(options.height) || DEFAULT_SIZE.combobox[1]));
  const visible = Math.max(1, Math.round(Number(options.visibleItemCount) || 5));
  const folder = folderOf(options);
  const item = ensureRawComponent(pkg, options.itemName || DEFAULT_NAMES.comboItem, comboItemXml(w, 28), folder);
  const itemUrl = `ui://${pkg.id}${item.entry.attrs[0][1]}`;
  const popup = ensureRawComponent(
    pkg,
    options.popupName || DEFAULT_NAMES.comboPopup,
    comboPopupXml(w, Math.max(60, h + 28 * Math.min(visible, 5)), itemUrl),
    folder,
  );
  const popupUrl = `ui://${pkg.id}${popup.entry.attrs[0][1]}`;
  const combo = ensureRawComponent(pkg, options.name || DEFAULT_NAMES.combobox, comboXml(w, h, popupUrl, visible), folder);
  return {
    entry: combo.entry,
    name: combo.name,
    created: combo.created,
    itemName: item.name,
    popupName: popup.name,
  };
}

function closeButtonXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="32,32" extention="Button">
  <displayList>
    <graph id="n0" name="bg" xy="1,1" size="30,30" type="eclipse" fillColor="#ffb23a48"/>
    <text id="n1" name="title" xy="0,0" size="32,32" fontSize="20" color="#ffffff" align="center" vAlign="middle" autoSize="none" singleLine="true" text="×"/>
  </displayList>
  <Button/>
</component>
`;
}

function windowFrameXml(w, h, closeId, title) {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="${w},${h}" extention="Label" initName="frame">
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="${w},${h}" type="rect" fillColor="#ff2b2b3c" corner="14" lineSize="2" lineColor="#ff5a4a7a">
      <relation target="" sidePair="width-width,height-height"/>
    </graph>
    <graph id="n1" name="dragArea" xy="12,4" size="${Math.max(1, w - 96)},44" type="rect" fillColor="#00000000">
      <relation target="" sidePair="width-width"/>
    </graph>
    <text id="n2" name="title" xy="24,10" size="${Math.max(1, w - 104)},32" fontSize="22" color="#ffffff" vAlign="middle" autoSize="none" singleLine="true" text="${xmlEscape(title)}">
      <relation target="" sidePair="width-width"/>
    </text>
    <component id="n3" name="closeButton" src="${closeId}" xy="${Math.max(1, w - 46)},10" size="32,32">
      <relation target="" sidePair="right-right"/>
    </component>
  </displayList>
</component>
`;
}

/** Create the window frame (Label extension, initName="frame") plus its close button. */
export function ensureWindowFrame(pkg, options = {}) {
  const w = Math.max(160, Math.round(Number(options.width) || DEFAULT_SIZE.windowFrame[0]));
  const h = Math.max(120, Math.round(Number(options.height) || DEFAULT_SIZE.windowFrame[1]));
  const folder = folderOf(options);
  const close = ensureRawComponent(pkg, options.closeName || DEFAULT_NAMES.windowClose, closeButtonXml(), folder);
  const closeId = close.entry.attrs[0][1];
  const name = options.name || DEFAULT_NAMES.windowFrame;
  const frame = ensureRawComponent(pkg, name, windowFrameXml(w, h, closeId, options.title || '窗口标题'), folder);
  return { entry: frame.entry, name: frame.name, created: frame.created, closeName: close.name, size: [w, h] };
}

function treeExpandXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="24,24" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <text id="n0" name="collapse" xy="0,0" size="24,24" fontSize="14" color="#cccccc" align="center" vAlign="middle" autoSize="none" singleLine="true" text="▶">
      <gearDisplay controller="button" pages="0,2,3"/>
    </text>
    <text id="n1" name="expand" xy="0,0" size="24,24" fontSize="14" color="#ffd166" align="center" vAlign="middle" autoSize="none" singleLine="true" text="▼">
      <gearDisplay controller="button" pages="1"/>
    </text>
  </displayList>
  <Button mode="Check"/>
</component>
`;
}

function treeItemXml(w, h, expandId) {
  return `<?xml version="1.0" encoding="utf-8"?>
<component size="${w},${h}" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <controller name="expanded" pages="0,,1," selected="1"/>
  <controller name="leaf" pages="0,,1," selected="0"/>
  <displayList>
    <graph id="n0" name="indent" xy="0,0" size="16,${h}" type="rect" fillColor="#00000000"/>
    <loader id="n1" name="icon" xy="20,4" size="${h - 8},${h - 8}" fill="scale" align="center" vAlign="middle"/>
    <text id="n2" name="title" xy="52,0" size="${Math.max(1, w - 58)},${h}" fontSize="20" color="#ffffff" vAlign="middle" autoSize="none" singleLine="true" text="节点">
      <relation target="" sidePair="width-width"/>
    </text>
    <component id="n3" name="expandButton" src="${expandId}" xy="4,6" size="24,24">
      <gearDisplay controller="leaf" pages="0"/>
      <Button checked="true" controller="expanded" page="1"/>
    </component>
  </displayList>
  <Button mode="Radio"/>
</component>
`;
}

/** Create the tree item (Button with expanded/leaf controllers) plus its expand button. */
export function ensureTreeItem(pkg, options = {}) {
  const w = Math.max(120, Math.round(Number(options.width) || DEFAULT_SIZE.treeItem[0]));
  const h = Math.max(24, Math.round(Number(options.height) || DEFAULT_SIZE.treeItem[1]));
  const folder = folderOf(options);
  const expand = ensureRawComponent(pkg, options.expandName || DEFAULT_NAMES.treeExpand, treeExpandXml(), folder);
  const expandId = expand.entry.attrs[0][1];
  const item = ensureRawComponent(pkg, options.name || DEFAULT_NAMES.treeItem, treeItemXml(w, h, expandId), folder);
  return { entry: item.entry, name: item.name, created: item.created, expandName: expand.name };
}

/**
 * Find or create an extension template inside a package.
 * Returns { entry, name, created }.
 */
export function ensureTemplate(pkg, kind, options = {}) {
  if (kind === 'combobox') return ensureComboBox(pkg, options);
  if (kind === 'tree') return ensureTreeItem(pkg, options);
  if (kind === 'window') return ensureWindowFrame(pkg, options);
  const template = buildTemplate({ ...options, extension: kind });
  const preferred = options.name || template.name;
  const existing = byName(pkg, `${preferred}.xml`, ['component']) || byName(pkg, preferred, ['component']);
  if (existing) {
    const expected = TEMPLATE_EXTENSIONS[kind];
    if (expected) {
      let actual;
      try {
        const raw = fs.readFileSync(resourceFile(pkg, existing), 'utf8');
        actual = (raw.match(/<component\b[^>]*\bextention="([^"]+)"/) || [])[1];
      } catch {
        actual = undefined;
      }
      if (!actual || actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
          `component "${existing.name.replace(/\.xml$/i, '')}" already exists but its extension is ${actual || 'none'}, not ${expected}; ` +
            'rename it, pass an explicit asset for this node, or create a template with a different name',
        );
      }
    }
    return { entry: existing, name: existing.name.replace(/\.xml$/i, ''), created: false };
  }
  const entry = writeTemplate(pkg, preferred, template.xml, options.folder);
  return { entry, name: preferred, created: true };
}
