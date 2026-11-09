// Generate and verify the C# view classes the FairyGUI publisher writes for a package:
// one `<Component>.cs` per exported component, using display-list indices for GetChildAt.
import fs from 'node:fs';
import path from 'node:path';
import { attrOf, childrenOf, firstChild, parseNumbers, parseXml } from './xml.js';
import { resourceFile } from './project.js';

export const RESERVED_CHILD_NAMES = new Set(['icon', 'title', 'bar', 'bar_v', 'grip', 'ani', 'arrow1', 'arrow2']);

const BASE_BY_EXTENTION = {
  Label: 'GLabel',
  Button: 'GButton',
  ProgressBar: 'GProgressBar',
  Slider: 'GSlider',
  ComboBox: 'GComboBox',
  ScrollBar: 'GScrollBar',
};

const TYPE_BY_TAG = {
  image: 'GImage',
  loader: 'GLoader',
  text: 'GTextField',
  richtext: 'GRichTextField',
  inputtext: 'GTextInput',
  graph: 'GGraph',
  list: 'GList',
  group: 'GGroup',
  component: 'GComponent',
};

export function componentBase(root) {
  return BASE_BY_EXTENTION[attrOf(root, 'extention') || ''] || 'GComponent';
}

export function isAnonymousName(name) {
  return /^n\d+$/.test(name || '');
}

/** Display-list children with their zero-based display index (groups included). */
export function displayNodes(root) {
  const list = firstChild(root, 'displayList');
  if (!list) return [];
  return list.children.map((node, index) => ({
    index,
    tag: node.tag,
    name: attrOf(node, 'name'),
    fileName: attrOf(node, 'fileName'),
    pkg: attrOf(node, 'pkg'),
    node,
  }));
}

export function controllersOf(root, packagesById) {
  return childrenOf(root, 'controller').map((controller) => {
    const pages = [];
    const raw = attrOf(controller, 'pages') || '';
    const parts = raw.split(',');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const id = Number(parts[i]);
      pages.push({ id: Number.isFinite(id) ? id : i / 2, name: parts[i + 1] ?? '' });
    }
    const selected = Number(attrOf(controller, 'selected'));
    return {
      name: attrOf(controller, 'name') || '',
      pages,
      selected: Number.isFinite(selected) ? selected : 0,
    };
  });
}

function baseName(fileName) {
  return String(fileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.xml$/i, '');
}

/** Field type of one display-list node, following the editor's published naming rules. */
export function fieldType(pkg, packagesById, node) {
  if (node.tag === 'component') {
    const cls = baseName(node.fileName) || 'GComponent';
    if (node.pkg) {
      const pkgName = packagesById.get(node.pkg) || node.pkg;
      return `${pkgName}.${cls}`;
    }
    return cls;
  }
  return TYPE_BY_TAG[node.tag] || 'GObject';
}

/** A generated field: non-reserved, non-anonymous display-list node. */
export function viewFields(pkg, packagesById, root) {
  const fields = [];
  for (const item of displayNodes(root)) {
    const name = item.name;
    if (!name || RESERVED_CHILD_NAMES.has(name) || isAnonymousName(name)) continue;
    fields.push({ name, type: fieldType(pkg, packagesById, item), index: item.index });
  }
  return fields;
}

export function viewSource({ packageName, componentName, url, root, packagesById }) {
  const base = componentBase(root);
  const controllers = childrenOf(root, 'controller')
    .map((controller) => attrOf(controller, 'name') || '')
    .filter(Boolean);
  const fields = viewFields({ name: packageName }, packagesById, root);
  const lines = [];
  lines.push('/** This is an automatically generated class by FairyGUI. Please do not modify it. **/');
  lines.push('');
  lines.push('using FairyGUI;');
  lines.push('using FairyGUI.Utils;');
  lines.push('');
  lines.push(`namespace ${packageName}`);
  lines.push('{');
  lines.push(`    public partial class ${componentName} : ${base}`);
  lines.push('    {');
  for (const controller of controllers) lines.push(`        public Controller ${controller};`);
  for (const field of fields) lines.push(`        public ${field.type} ${field.name};`);
  lines.push(`        public const string URL = "${url}";`);
  lines.push(`        public const string PATH = "${packageName}/${componentName}";`);
  lines.push('');
  lines.push(`        public static ${componentName} CreateInstance()`);
  lines.push('        {');
  lines.push(`            return (${componentName})UIPackage.CreateObject("${packageName}", "${componentName}");`);
  lines.push('        }');
  lines.push('');
  lines.push('        public override void ConstructFromXML(XML xml)');
  lines.push('        {');
  lines.push('            base.ConstructFromXML(xml);');
  lines.push('');
  controllers.forEach((name, index) => lines.push(`            ${name} = GetControllerAt(${index});`));
  fields.forEach((field) => lines.push(`            ${field.name} = (${field.type})GetChildAt(${field.index});`));
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  return { code: `${lines.join('\n')}\n`, base, controllers, fields };
}

export function viewDir(project, packageName, codeRoot) {
  const root = codeRoot ? path.resolve(codeRoot) : path.join(project.dir, '..', 'Code', 'Game', 'Scripts', 'UI', 'View');
  return path.join(root, packageName);
}

export function writeViewFile(file, code) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = `${String(code).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')}`;
  fs.writeFileSync(file, `\uFEFF${normalized}`, 'utf8');
}

/** Resolve "Panels/Feed/DigFeedPanel.xml", "Panels/Feed/DigFeedPanel" or "DigFeedPanel" to a component entry. */
export function resolveComponentEntry(pkg, ref) {
  const raw = String(ref || '').trim().replace(/\\/g, '/');
  if (!raw) throw new Error('component is required');
  const components = pkg.entries.filter((entry) => entry.tag === 'component');
  const target = raw.replace(/^\/+/, '');
  const wanted = target.toLowerCase();
  const withXml = wanted.endsWith('.xml') ? wanted : `${wanted}.xml`;
  const bare = wanted.replace(/\.xml$/, '');
  const hit = components.find((entry) => {
    const entryPath = (entry.attrs.find(([k]) => k === 'path') || [])[1] || '/';
    const rel = `${entryPath.replace(/^\/+|\/+$/g, '')}${entryPath === '/' ? '' : '/'}${entry.name}`.replace(/^\/+/, '').toLowerCase();
    return rel === wanted || rel === withXml || entry.name.toLowerCase() === withXml || entry.name.toLowerCase().replace(/\.xml$/, '') === bare;
  });
  if (!hit) {
    throw new Error(
      `component "${ref}" not found in package "${pkg.name}"; ` +
        `available (first 30): ${components.slice(0, 30).map((e) => e.name.replace(/\.xml$/i, '')).join(', ')}`,
    );
  }
  return hit;
}

export function packageNameMap(packages) {
  const map = new Map();
  for (const pkg of packages) if (pkg.id) map.set(pkg.id, pkg.name);
  return map;
}

function readComponentRoot(pkg, entry) {
  const file = resourceFile(pkg, entry);
  return { file, raw: fs.readFileSync(file, 'utf8'), root: parseXml(fs.readFileSync(file, 'utf8')) };
}

/** Regenerate the C# view classes for the requested components. */
export function syncViews({ project, pkg, packages, components, codeRoot }) {
  const byId = packageNameMap(packages);
  const outDir = viewDir(project, pkg.name, codeRoot);
  const written = [];
  const failures = [];
  for (const ref of components) {
    try {
      const entry = resolveComponentEntry(pkg, ref);
      const componentName = entry.name.replace(/\.xml$/i, '');
      const { file, root } = readComponentRoot(pkg, entry);
      if (!root) throw new Error(`${file} is empty`);
      const url = `ui://${pkg.id}${entry.attrs.find(([k]) => k === 'id')?.[1] || ''}`;
      const generated = viewSource({ packageName: pkg.name, componentName, url, root, packagesById: byId });
      const dst = path.join(outDir, `${componentName}.cs`);
      writeViewFile(dst, generated.code);
      written.push({
        file: dst,
        source: file,
        class: componentName,
        base: generated.base,
        url,
        controllers: generated.controllers.map((name, index) => ({ name, index })),
        fields: generated.fields,
      });
    } catch (error) {
      failures.push({ component: String(ref), error: error.message });
    }
  }
  return { outDir, written, failures };
}

function parseViewFile(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const head = source.match(/class\s+(\w+)\s*:\s*([\w.]+)/);
  if (!head) throw new Error(`cannot find the class declaration in ${file}`);
  const fields = [];
  const fieldRe = /public\s+(?!const\b)([\w.<>]+)\s+(\w+)\s*;/g;
  let m;
  while ((m = fieldRe.exec(source)) !== null) fields.push({ type: m[1], name: m[2] });
  const indexEntries = [];
  const indexRe = /(\w+)\s*=\s*\(([\w.]+)\)\s*GetChildAt\((\d+)\)\s*;/g;
  while ((m = indexRe.exec(source)) !== null) indexEntries.push({ name: m[1], type: m[2], index: Number(m[3]) });
  const controllerEntries = [];
  const controllerRe = /(\w+)\s*=\s*GetControllerAt\((\d+)\)\s*;/g;
  while ((m = controllerRe.exec(source)) !== null) controllerEntries.push({ name: m[1], index: Number(m[2]) });
  const url = (source.match(/const\s+string\s+URL\s*=\s*"([^"]*)"/) || [])[1];
  const pathConst = (source.match(/const\s+string\s+PATH\s*=\s*"([^"]*)"/) || [])[1];
  return {
    className: head[1],
    base: head[2],
    fields: fields.filter((field) => field.type !== 'Controller'),
    controllers: fields.filter((field) => field.type === 'Controller').map((field) => field.name),
    indexEntries,
    controllerEntries,
    url,
    pathConst,
  };
}

/** Compare each component XML with the generated C# class on disk. */
export function checkViews({ project, pkg, packages, components, codeRoot }) {
  const byId = packageNameMap(packages);
  const dir = viewDir(project, pkg.name, codeRoot);
  const items = [];
  for (const ref of components) {
    const problems = [];
    try {
      const entry = resolveComponentEntry(pkg, ref);
      const componentName = entry.name.replace(/\.xml$/i, '');
      const srcFile = resourceFile(pkg, entry);
      const root = parseXml(fs.readFileSync(srcFile, 'utf8'));
      if (!root) throw new Error('component XML is empty');
      const csFile = path.join(dir, `${componentName}.cs`);
      if (!fs.existsSync(csFile)) {
        items.push({ component: componentName, ok: false, problems: [`缺少视图类文件 ${csFile}`] });
        continue;
      }
      const view = parseViewFile(csFile);
      const expectedBase = componentBase(root);
      if (view.base !== expectedBase) {
        const ext = attrOf(root, 'extention') || '(none)';
        problems.push(`基类不一致: cs=${view.base} xml extention=${ext} 期望 ${expectedBase}`);
      }
      const controllers = childrenOf(root, 'controller').map((c) => attrOf(c, 'name')).filter(Boolean);
      const gotControllers = new Map(view.controllerEntries.map((item) => [item.name, item.index]));
      controllers.forEach((name, index) => {
        if (!gotControllers.has(name)) problems.push(`缺控制器字段 ${name} (index ${index})`);
        else if (gotControllers.get(name) !== index) problems.push(`控制器 ${name} 索引不一致: cs=${gotControllers.get(name)} xml=${index}`);
      });
      for (const name of gotControllers.keys()) {
        if (!controllers.includes(name)) problems.push(`多余控制器字段 ${name}`);
      }
      const expectedFields = viewFields(pkg, byId, root);
      const gotFields = new Map(view.indexEntries.map((item) => [item.name, item]));
      for (const field of expectedFields) {
        const got = gotFields.get(field.name);
        if (!got) {
          problems.push(`缺字段 ${field.name} (index ${field.index})`);
          continue;
        }
        if (got.index !== field.index) problems.push(`${field.name} 索引不一致: cs=${got.index} xml=${field.index}`);
        if (got.type !== field.type) problems.push(`${field.name} 类型不一致: cs=${got.type} xml=${field.type}`);
      }
      const expectedNames = new Set(expectedFields.map((field) => field.name));
      for (const name of gotFields.keys()) {
        if (!expectedNames.has(name)) problems.push(`多余字段 ${name}`);
      }
      items.push({
        component: componentName,
        ok: problems.length === 0,
        fieldCount: { cs: view.indexEntries.length, xml: expectedFields.length },
        problems,
      });
    } catch (error) {
      items.push({ component: String(ref), ok: false, problems: [error.message] });
    }
  }
  return { dir, ok: items.every((item) => item.ok), items };
}

/** Component detail used by fairyui_inspect details=true: controllers and gears per node. */
export function componentDetail(pkg, entry) {
  const file = resourceFile(pkg, entry);
  const root = parseXml(fs.readFileSync(file, 'utf8'));
  if (!root) return { controllers: [], gears: [] };
  const byId = new Map();
  const controllers = controllersOf(root, byId);
  const gears = [];
  for (const item of displayNodes(root)) {
    for (const gear of item.node.children) {
      if (!gear.tag.startsWith('gear')) continue;
      const pages = attrOf(gear, 'pages');
      gears.push({
        type: gear.tag,
        controller: attrOf(gear, 'controller') || '',
        target: item.name || '',
        ...(pages ? { pages: pages.split(',').map((part) => Number(part)) } : {}),
      });
    }
  }
  const size = parseNumbers(attrOf(root, 'size')) || [];
  return { size, controllers, gears };
}
