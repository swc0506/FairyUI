// Naming / packaging conventions stored next to the project (design/conventions.json)
// plus enforcement helpers used by the build, lint and package tools. A project without
// its own file falls back to the bundle's defaults/conventions.json (FairyGUI 使用规范).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODE_PREFIX_KEYS = ['graph', 'image', 'text', 'list', 'loader', 'richtext', 'inputtext', 'component', 'button'];

/** Extension reserved child names: never renamed or reported by the node-name rules. */
export const RESERVED_NODE_NAMES = new Set(['icon', 'title', 'bar', 'bar_v', 'grip', 'ani', 'arrow1', 'arrow2']);

const DEFAULT_CONVENTIONS_FILE = fileURLToPath(new URL('../defaults/conventions.json', import.meta.url));
const DEFAULT_SOURCE_FILE = fileURLToPath(new URL('../defaults/conventions.md', import.meta.url));

export function conventionsFile(project) {
  return path.join(project.dir, 'design', 'conventions.json');
}

export function sourceDocFile(project) {
  return path.join(project.dir, 'design', 'conventions.md');
}

export function defaultsFile() {
  return DEFAULT_CONVENTIONS_FILE;
}

export function defaultsSourceFile() {
  return fs.existsSync(DEFAULT_SOURCE_FILE) ? DEFAULT_SOURCE_FILE : null;
}

/** The bundle's built-in conventions (empty object when the defaults file is unreadable). Read on every call so edits apply without reloading the plugin. */
export function defaultConventions() {
  try {
    return normalizeConventions(JSON.parse(fs.readFileSync(DEFAULT_CONVENTIONS_FILE, 'utf8')));
  } catch {
    return {};
  }
}

function readConventionsAt(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return normalizeConventions(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Read the effective conventions, without ever silently pretending the project rules apply:
 * explicit conventionsPath > <project>/design/conventions.json > bundled defaults.
 */
export function conventionsInfo(project, conventionsPath) {
  if (typeof conventionsPath === 'string' && conventionsPath.trim() !== '') {
    const file = path.resolve(conventionsPath.trim().replace(/^"(.*)"$/, '$1'));
    const rules = readConventionsAt(file);
    if (!rules) throw new Error(`no readable conventions.json at "${file}"`);
    return { rules, source: 'custom', file, path: file, sourceDoc: null };
  }
  const own = readConventionsAt(conventionsFile(project));
  if (own) {
    return {
      rules: own,
      source: 'project',
      file: conventionsFile(project),
      path: conventionsFile(project),
      sourceDoc: fs.existsSync(sourceDocFile(project)) ? sourceDocFile(project) : null,
    };
  }
  const defaults = defaultConventions();
  if (Object.keys(defaults).length === 0) {
    return { rules: null, source: null, file: null, path: null, sourceDoc: null, projectFile: conventionsFile(project) };
  }
  return {
    rules: defaults,
    source: 'bundled-default',
    file: DEFAULT_CONVENTIONS_FILE,
    path: DEFAULT_CONVENTIONS_FILE,
    sourceDoc: defaultsSourceFile(),
    projectFile: conventionsFile(project),
  };
}

/** The fixed first warning when the bundled defaults (not the project file) are in effect. */
export function defaultConventionsWarning(projectFile) {
  return `⚠️ 正在使用内置默认规范（未找到 ${projectFile}），节点命名/包名检查结果不可信`;
}

/** Read the effective rules only (build/lint/template checks). */
export function loadConventions(project, conventionsPath) {
  return conventionsInfo(project, conventionsPath).rules || null;
}

export function normalizeConventions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of [
    'componentNamePattern',
    'packageNamePattern',
    'imageNamePattern',
    'nodeNamePattern',
    'defaultPackage',
    'componentFolder',
    'templateFolder',
    'imageFolder',
  ]) {
    if (typeof raw[key] === 'string' && raw[key].trim() !== '') out[key] = raw[key].trim();
  }
  if (raw.nodeNamePrefixes && typeof raw.nodeNamePrefixes === 'object') {
    const prefixes = {};
    for (const key of NODE_PREFIX_KEYS) {
      if (typeof raw.nodeNamePrefixes[key] === 'string' && raw.nodeNamePrefixes[key] !== '') {
        prefixes[key] = raw.nodeNamePrefixes[key];
      }
    }
    if (Object.keys(prefixes).length > 0) out.nodeNamePrefixes = prefixes;
  }
  if (Array.isArray(raw.packageRules)) {
    const rules = raw.packageRules
      .filter((r) => r && typeof r.pattern === 'string' && typeof r.package === 'string')
      .map((r) => ({ pattern: r.pattern, package: r.package }));
    if (rules.length > 0) out.packageRules = rules;
  }
  for (const key of ['requireExported', 'autoPrefixNodeNames']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (typeof raw.notes === 'string' && raw.notes.trim() !== '') out.notes = raw.notes;
  return out;
}

export function validatePatterns(rules) {
  for (const key of ['componentNamePattern', 'packageNamePattern', 'imageNamePattern', 'nodeNamePattern']) {
    if (!rules[key]) continue;
    try {
      new RegExp(rules[key]);
    } catch (error) {
      throw new Error(`invalid ${key} "${rules[key]}": ${error.message}`);
    }
  }
  for (const rule of rules.packageRules || []) {
    try {
      new RegExp(rule.pattern);
    } catch (error) {
      throw new Error(`invalid packageRules pattern "${rule.pattern}": ${error.message}`);
    }
  }
}

export function saveConventions(project, rules, sourceText) {
  validatePatterns(rules);
  const dir = path.join(project.dir, 'design');
  fs.mkdirSync(dir, { recursive: true });
  const file = conventionsFile(project);
  fs.writeFileSync(file, JSON.stringify(rules, null, 2), 'utf8');
  let source;
  if (typeof sourceText === 'string' && sourceText.trim() !== '') {
    source = sourceDocFile(project);
    fs.writeFileSync(source, sourceText, 'utf8');
  }
  return { file, source };
}

export function matches(pattern, value) {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

/** Pick the package for a component: explicit > packageRules match > defaultPackage. */
export function packageForComponent(project, packages, componentName, explicit, rules) {
  if (explicit) return explicit;
  const effective = rules !== undefined ? rules : loadConventions(project);
  if (!effective) return undefined;
  for (const rule of effective.packageRules || []) {
    if (matches(rule.pattern, componentName)) return rule.package;
  }
  return effective.defaultPackage;
}

/** Prefix a node name per conventions; reserved extension names (icon/title/bar…) are kept as-is. */
export function applyNodePrefix(rules, node) {
  if (!rules?.nodeNamePrefixes) return node;
  if (typeof node.name === 'string' && RESERVED_NODE_NAMES.has(node.name)) return node;
  const type = node.type === 'rect' ? 'graph' : node.type;
  const prefix = rules.nodeNamePrefixes[type];
  if (!prefix || typeof node.name !== 'string') return node;
  if (node.name.startsWith(prefix)) return node;
  return { ...node, name: `${prefix}${node.name}` };
}

export function checkNodeNames(rules, nodes) {
  const violations = [];
  nodes.forEach((node) => {
    if (typeof node.name !== 'string') return;
    if (RESERVED_NODE_NAMES.has(node.name)) return;
    if (rules?.nodeNamePattern && !matches(rules.nodeNamePattern, node.name)) {
      violations.push({ kind: 'node', name: node.name, message: `node "${node.name}" does not match ${rules.nodeNamePattern}` });
    }
    const type = node.type === 'rect' ? 'graph' : node.type;
    const prefix = rules?.nodeNamePrefixes?.[type];
    if (prefix && !node.name.startsWith(prefix)) {
      violations.push({ kind: 'node', type, name: node.name, message: `node "${node.name}" should start with "${prefix}"` });
    }
  });
  return violations;
}

/** Scan packages for naming violations, optionally limited to one folder / component list. */
export function lintPackages(project, packages, rules, options = {}) {
  const violations = [];
  if (!rules) return violations;
  const folder = typeof options.folder === 'string' ? options.folder.trim().replace(/^\/+|\/+$/g, '') : '';
  const wanted = Array.isArray(options.components) && options.components.length > 0
    ? new Set(options.components.map((name) => String(name).replace(/\.xml$/i, '').toLowerCase()))
    : null;
  for (const pkg of packages) {
    if (!matches(rules.packageNamePattern, pkg.name)) {
      violations.push({ kind: 'package', name: pkg.name, message: `package "${pkg.name}" does not match ${rules.packageNamePattern}` });
    }
    for (const entry of pkg.entries) {
      const entryPath = (entry.attrs.find(([k]) => k === 'path') || [])[1] || '/';
      const normalizedPath = entryPath.replace(/^\/+|\/+$/g, '');
      if (entry.tag === 'component') {
        const name = entry.name.replace(/\.xml$/i, '');
        if (folder && !(normalizedPath === folder || normalizedPath.startsWith(`${folder}/`))) continue;
        if (wanted && !wanted.has(name.toLowerCase()) && !wanted.has(`${normalizedPath}/${name}`.toLowerCase())) continue;
        if (!matches(rules.componentNamePattern, name)) {
          violations.push({ kind: 'component', package: pkg.name, name, message: `component "${name}" does not match ${rules.componentNamePattern}` });
        }
        const folderRules = [rules.componentFolder, rules.templateFolder].filter(Boolean);
        if (entryPath === '/' && folderRules.length > 0) {
          violations.push({
            kind: 'folder',
            package: pkg.name,
            name,
            message: `component "${name}" sits at the package root; move it into ${rules.componentFolder || 'Panels'}/ or ${rules.templateFolder || 'Widgets'}/`,
          });
        }
      }
      if (entry.tag === 'image' && rules.imageNamePattern && !matches(rules.imageNamePattern, entry.name)) {
        if (folder && !(normalizedPath === folder || normalizedPath.startsWith(`${folder}/`))) continue;
        violations.push({ kind: 'image', package: pkg.name, name: entry.name, message: `image "${entry.name}" does not match ${rules.imageNamePattern}` });
      }
    }
  }
  return violations;
}
