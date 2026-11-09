// dsh-fairyui: FairyGUI UI construction tools for DeepSeek Harness.
//
// The FairyGUI editor stores a project as plain XML (`<project>.fairy` plus
// `assets/<package>/package.xml` and one XML file per component). These tools read that
// format, build a component from a JSON layout spec, render a PNG preview with GDI+, and
// open the project in the editor for human review.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createPackage,
  designResolution,
  entryId,
  findPackage,
  imageSize,
  listPackages,
  resolveProject,
  resourceFile,
  savePackage,
  uiUrl,
} from './lib/project.js';
import {
  compileLayout,
  componentDisplayNames,
  componentInfo,
  existingExtention,
  previewDir,
  writeComponent,
  writePreviewPlan,
  writeRawComponent,
} from './lib/build.js';
import { buildTemplate, ensureComboBox, ensureTreeItem, ensureWindowFrame } from './lib/templates.js';
import { renderWith, runScript, scriptPath } from './lib/render.js';
import {
  applyNodePrefix,
  checkNodeNames,
  conventionsFile,
  conventionsInfo,
  defaultConventionsWarning,
  defaultsFile,
  lintPackages,
  loadConventions,
  matches,
  normalizeConventions,
  packageForComponent,
  RESERVED_NODE_NAMES,
  saveConventions,
} from './lib/conventions.js';
import { checkViews, componentDetail, resolveComponentEntry, syncViews, viewDir } from './lib/views.js';
import { parseNumbers, parseXml } from './lib/xml.js';

export const inject = ['tools'];

const DEFAULT_EDITOR = 'D:\\FairyGUI\\FairyGUI-Editor.exe';
const DEFAULT_WIDTH = 1136;
const DEFAULT_HEIGHT = 640;

const GUIDE_MARKDOWN = `# FairyGUI 组件识别与拼装参考

## 1. 示意图元素 → FairyGUI 节点

| 示意图上的元素 | node type | 关键参数 |
| --- | --- | --- |
| 图片、图标、头像、立绘、背景图 | image | asset=包内文件名；fit=stretch/contain |
| 纯色块、描边、圆角底板、分割线 | graph | fill/line/lineWidth/corner/shape |
| 标题、正文、价格、倒计时文字 | text | text/fontSize/color/align/vAlign |
| 输入框（昵称、兑换码、搜索） | inputtext | prompt/maxLength；自动 autoSize=none |
| 富文本（混色、内嵌图标、超链接） | richtext | text 可含 <img src='ui://...'/>、<a href='...'>；ubb=true |
| 背包格、排行榜、任务列表、聊天滚动区 | list | defaultItem=Item 模板组件；layout=row/flow_hz/flow_vt；items 可给示例数据 |
| 按钮 | button | 自动匹配/创建 Button 模板；title=按钮文字；可用 asset 指定模板 |
| 进度条 | progressbar | 自动匹配/创建 ProgressBar 模板；value/max 设置进度 |
| 滑动条 | slider | 自动匹配/创建 Slider 模板；value/max |
| 标签（文字+可选图标） | label | 自动匹配/创建 Label 模板；title/icon |
| 下拉框 | combobox | 自动创建 ComboBox + 选项按钮 + 弹出列表三件套；items 给选项 |
| 树 | tree | 自动创建 TreeItem + 展开按钮；列表自动 treeView |
| 窗口 | window | 自动创建 Label 扩展的 WindowFrame（initName=frame）+ 关闭按钮 |
| 复选框、页签 | component | 复用包内已有扩展组件（Button…），title 等写入扩展属性 |
| 需要异步/外部加载的图、模型、视频 | loader | url=ui:// 或 http(s)；fill=scale/scaleFree/scaleNoBorder/none |
| 弹窗、面板 | 组件本身 + graph 背景 + 子节点 | 弹窗的关闭按钮用 button；遮罩用 graph |

### 1.1 FairyGUI 扩展组件（内置类型）

编辑器属性面板的“扩展”有六种：**Button、Label、ProgressBar、Slider、ComboBox、ScrollBar**。它们不是独立控件，而是靠命名约定给普通组件加行为：

- 子元件名：\`title\`（文本/富文本/标签/按钮）、\`icon\`（装载器/标签/按钮）、\`bar\`/\`bar_v\`（进度条伸缩条）、\`grip\`（滑动条拖动把）、\`ani\`（帧动画）。
- 控制器名：\`button\`（页面 up/down/over/selectedOver/disabled/selectedDisabled），进度/滑动条可选 \`progress\` 控制器。
- ComboBox 还需要一个 \`dropdown\` 弹出组件（内部 \`list\` + 项目模板）。

插件对 \`button\`/\`label\`/\`progressbar\`/\`slider\` 节点：优先复用包内同扩展的组件；没有时默认自动创建 \`CommonBtn\`/\`CommonLabel\`/\`CommonProgressBar\`/\`CommonSlider\` 模板（\`autoTemplate:false\` 可关闭），也可以用 \`fairyui_template\` 显式创建/改颜色尺寸。\`combobox\` 会自动创建三件套（\`CommonComboBox\` + Item + Popup，Popup 内是 \`list\`）；\`tree\` 会自动创建 \`CommonTreeItem\` + \`CommonTreeExpand\`；\`window\` 会自动创建 Label 扩展的 \`CommonWindowFrame\`（\`initName="frame"\`）+ 关闭按钮。ScrollBar 建议复用现有模板（或编辑器向导），插件不自动生成。模板写入 \`templateFolder\`（本规范不设置，默认写包根）。

先调用 fairyui_inspect，确认包里已有的组件及其 extension（Button/Label/ProgressBar/Slider/ComboBox…）和 ui:// 地址；没有的模板先用 fairyui_build 建一个（如 \`CommonItem\`），再在 list/component 里引用。

## 2. 节点通用字段

所有节点：\`type\`、\`name\`、\`rect:[x,y,w,h]\`；可选 \`rotation\`、\`alpha\`、\`pivot\`、\`touchable\`、\`grayed\`、\`customData\`（写入自定义数据，如全屏背景的 \`fill1\`）。
数组顺序即 z-order（先写的在底层）。

- 文本/富文本/输入文本默认写 \`autoClearText="true"\`（发布时清除文本）；需要保留时传 \`autoClearText:false\`。
- 图片九宫格：image 节点传 \`scale9grid:"左,上,右,下"\`（如 \`"10,12,10,12"\`），会写回图片资源 \`scale="9grid" scale9grid="..."\`；拉伸时按九宫格处理。
- 列表/树默认写 \`autoClearItems="true"\`（发布时自动清空）；需要保留示例数据时传 \`autoClearItems:false\`。
- 组件实例会写 \`fileName\`（如 \`CommonButton.xml\` 或 \`Component/ItemGood.xml\`），与编辑器格式一致。

### 2.1 控制器 / 关联 / 组 / 滚动容器

- **控制器**：\`controllers:[{name:"tab", pages:["推荐","新品"], selected:0}]\`，页面写到 \`<controller pages="0,推荐,1,新品">\`。
- **齿轮（gear）**：节点 \`gears:[{type:"display", controller:"tab", pages:["1"]}]\`，或 \`{type:"xy", values:"65,271|252,190", tween:true}\`、\`{type:"size", values:"196,174,1,1", default:"100,100,1,1"}\`、\`{type:"color", values:"#66ff99"}\`。
- **关联**：节点 \`relations:[{sidePair:"width-width,height-height"}]\`（省略 target 表示相对组件自身），或 \`{target:"n1", sidePair:"left-left"}\`。
- **组**：\`{type:"group", name:"g1", rect:[...]}\`，成员节点写 \`group:"g1"\`。
- **滚动容器**：\`fairyui_build\` 的 \`scroll:{overflow:"scroll", scroll:"vertical", scrollBar:"auto", margin:"0,0,0,0", clipSoftness:"0,20"}\`。
- **按钮实例**：\`title\`、\`icon\`、\`mode\`（Common/Check/Radio）、\`checked\`、\`selectedTitle\`、\`titleColor\`、\`titleFontSize\`、\`controller\`+\`page\`（联动控制器）。
- **跨包元件**：\`asset:"Common1/CommonBtn"\`（包名/元件名）；实例自动写 \`src\`、\`fileName\` 和源包 \`pkg\`。\`list\` 的 \`defaultItem\`、\`tree\` 的模板同样接受该写法。

## 3. 规范：Ctt 客户端 FairyGUI 规范（工程内 design/conventions.json 可覆盖）

插件默认规范 \`defaults/conventions.json\` 取自 \`E:\\ATT\\开发流程.md\` 第 3 节「UI 开发相关」（原文见 \`defaults/conventions.md\`）。工程内 \`design/conventions.json\` 存在时以工程规范为准，否则自动套用默认规范。

| 规则 | 默认值 |
| --- | --- |
| componentNamePattern | \`^[A-Z][A-Za-z0-9]*(_(Window\\|MiniWindow\\|Bg\\|Tip\\|MsgBox\\|SysBox\\|ConstWindow\\|LoadingWindow\\|Guide))?$\`（业务名可选一个合法类型后缀） |
| packageNamePattern | \`^[A-Z][A-Za-z0-9]*$\`（包名 PascalCase，不用中文/空格/横线） |
| imageNamePattern | \`^[A-Za-z0-9_().-]+$\`（图片名用英文/拼音） |
| nodeNamePattern | \`^(lb\\|btn\\|list\\|img\\|icon\\|bg\\|ld\\|input\\|gra\\|graph\\|sp\\|spine\\|com\\|item\\|sld\\|pro\\|bar\\|group\\|G)_[A-Za-z0-9_]+$\`（类型前缀 + 下划线 + 业务名） |
| requireExported | true（构建的组件默认导出；纯视觉子件可传 exported:false） |

工具无法直接表达的条款（必须遵守）：

- 组件文件名 = \`<业务名>_<类型后缀>\`：\`_Window\`（全屏）/ \`_MiniWindow\`（弹窗）/ \`_Bg\` / \`_Tip\` / \`_MsgBox\` / \`_SysBox\` / \`_ConstWindow\` / \`_LoadingWindow\` / \`_Guide\`；**后缀大小写敏感**，业务名内部不能再出现下划线。无后缀 = 子组件 / 列表项 / 按钮模板（生成 \`Xxx\` + \`XxxView.cs\`）。窗口类统一以 \`Window\` 结尾：\`BagItemUse_MiniWindow\` → \`BagItemUseWindow\`。
- 业务名在同一包内必须唯一（\`Foo_Window\` 与 \`Foo_MiniWindow\` 都生成 \`FooWindow\`，互相覆盖）；普通组件、列表项不要加 \`_Item\`、\`_Com\` 后缀；带未识别后缀且有下划线的组件不会生成任何代码。
- 需要代码访问、被其他组件引用或被列表使用的组件必须导出，且组件内至少有一个改过名的子控件，否则不生成类。
- 子控件 C# 字段 = \`m_\` + name：不要在 FGUI 里自己写 \`m_\`（否则 \`m_m_xxx\`）；FGUI 默认名 \`n0\`/\`n13\` 不生成字段。新界面统一前缀 \`lb_\`（文本/富文本）\`btn_\` \`list_\` \`img_\` \`icon_\` \`bg_\` \`ld_\` \`input_\` \`gra_\`/\`graph_\` \`sp_\`/\`spine_\` \`com_\`/\`item_\` \`sld_\`/\`pro_\`/\`bar_\` \`group_\`/\`G_\`；老界面的 \`lab_\`/\`txt_\`/\`text_\` 保留不动。
- 扩展保留名不要挪用：\`title\`、\`icon\`、\`bar\`、\`bar_v\`、\`grip\`、\`ani\`、\`arrow1\`、\`arrow2\`；Controller 名与页名、Transition 名与标签名必须是合法 C# 标识符（页名生成 \`public const int <页名>\`）。
- 包名 = 命名空间 \`ET.Client.<Package>\` 与代码目录 \`UIModule/<Package>\`；包内目录沿用工程既有布局（包根或 \`Component\`/\`Btn\`/\`Tips\` 等功能目录），**不用 Panels/Widgets/Images 三分结构**；\`DpRes\` 开头的包为纯资源包。
- 文本/富文本/输入文本勾选「发布时清除文本」（多语言走配置表）；虚拟列表勾选「发布时自动清空」。
- 大背景在“自定义数据”写 \`fill\`/\`fill0\`（只处理刘海屏位置）、\`fill1\`（等比缩放）、\`fill2\`（直接拉伸）；公共图集放 \`Common\`、\`Common1\`…（数字越小跨包引用越多）；超过 512x512 的大图不打图集，放 \`Assets/Res/UIImages\` 用 Loader；小图标按模块建 \`Dynamic\`+模块名 图集（如 \`DynamicItem\`）。
- 代码生成：FGUI 发布到 \`Assets/Bundles/UIRes/UIPackage\` → Unity 菜单 \`FGUI → FGUI Tool\`（先 LoadUIResource，再 SpawnAllUIPageCode）→ 逻辑只写 \`*WindowLogic.cs\` 与 \`Func/*.cs\`；\`UIModule/Auto\` 每次整体重建，勿手改。

- 查看当前生效规则：\`fairyui_conventions\`（action=show，返回 source: project | custom | bundled-default）。
- 覆盖项目规范：\`fairyui_conventions\`（action=save，rules 只需写要覆盖的字段，sourceText 存原文）。
- \`fairyui_build\` 校验组件名与节点名、按 \`packageRules\`/\`defaultPackage\` 选包（\`autoPrefixNodeNames=true\` 时给节点名加前缀）；\`fairyui_package_create\` 校验包名；\`fairyui_lint\` 扫描包/组件/图片命名违规。

## 4. 推荐工作流

1. \`fairyui_mockup_grid\` 给示意图加坐标网格，read_image 读取后量出每个元素的 rect。
2. \`fairyui_inspect\` 看包、组件模板、扩展类型、设计分辨率、现有规范。
3. 按上表把元素映射为 node；按钮/进度条/下拉框优先复用包内模板。
4. \`fairyui_build\` 生成并出预览；read_image 对比示意图，修正 rect/字号/颜色后再 build。
5. \`fairyui_open\` 在编辑器中复核；需要发布时在编辑器内发布。
6. 覆盖已有组件后若返回 \`indexChanged\`，立即跑 \`fairyui_sync_views\` 重生成视图类，再 \`fairyui_check_views\` 确认一致。
7. 想逐像素核对时用 \`fairyui_overlay\` 把组件框叠到示意图上。

## 5. 视图类：生成与校验

- \`fairyui_sync_views\`：按 XML 显示列表重生成 \`<工程>/../Code/Game/Scripts/UI/View/<包名>/<组件>.cs\`（utf-8-sig + CRLF）。保留名 \`icon/title/bar/bar_v/grip/ani/arrow1/arrow2\` 与匿名名 \`n1/n2\` 不生成字段但占索引；跨包实例输出 \`包名.类名\`；扩展类型映射 Label→GLabel、Button→GButton、ProgressBar→GProgressBar、Slider→GSlider、ComboBox→GComboBox。
- \`fairyui_check_views\`：逐组件比对基类、字段集合、\`GetChildAt\` 索引、字段类型、\`GetControllerAt\` 索引，返回每条问题。
- 两个工具都支持 \`components\` 数组与 \`codeRoot\` 覆盖输出目录；批量时单个失败不影响其它。
- 预览控制器页：\`fairyui_build\` 传 \`previewPages:{stateCtrl:1}\`；跨包组件实例会在预览中合成展开（图片/文本/图形），无法解析时退回占位框。
`;

function asText(value, summary) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return [{ type: 'text', text: summary ? `${summary}\n\n${body}` : body }];
}

/** The tool pipeline requires lossless JSON: drop undefined, normalize non-finite numbers. */
function toJson(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const clean = toJson(item);
      return clean === undefined ? null : clean;
    });
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const clean = toJson(item);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return value;
}

function resolveUserPath(args, exec, ctx, key = 'project') {
  const raw = args[key];
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`${key} is required`);
  return resolveMaybeRelative(raw, exec, ctx);
}

function resolveMaybeRelative(raw, exec, ctx) {
  const value = String(raw).trim().replace(/^"(.*)"$/, '$1');
  if (path.isAbsolute(value)) return value;
  const wd = ctx.get('workingDirectory');
  if (wd && exec.agent) {
    try {
      return path.resolve(wd.get(exec.agent.session), value);
    } catch {
      // fall through to process cwd
    }
  }
  return path.resolve(value);
}

function normalizeFolder(value) {
  return typeof value === 'string' ? value.trim().replace(/^\/+|\/+$/g, '') : '';
}

/** "components": [...] plus the single "component": "..." shorthand. */
function componentRefs(args) {
  const refs = [];
  if (Array.isArray(args.components)) {
    for (const value of args.components) {
      if (typeof value === 'string' && value.trim() !== '') refs.push(value.trim());
    }
  }
  if (typeof args.component === 'string' && args.component.trim() !== '') refs.push(args.component.trim());
  return refs;
}

function openProject(args, exec, ctx) {
  const input = resolveUserPath(args, exec, ctx);
  const project = resolveProject(input);
  return { project, packages: listPackages(project) };
}

function imageEntryInfo(pkg, entry) {
  const size = imageSize(resourceFile(pkg, entry));
  const scale9 = entry.attrs.find(([k]) => k === 'scale9grid');
  return {
    id: entryId(entry),
    name: entry.name,
    width: size?.width,
    height: size?.height,
    ...(scale9 ? { scale9grid: scale9[1] } : {}),
  };
}

function componentEntryInfo(pkg, entry, details = false) {
  let info = {};
  try {
    info = componentInfo(pkg, entry);
  } catch {
    info = {};
  }
  let extra = {};
  if (details) {
    try {
      const detail = componentDetail(pkg, entry);
      extra = {
        controllers: detail.controllers,
        gears: detail.gears,
      };
    } catch {
      extra = {};
    }
  }
  return {
    id: entryId(entry),
    name: entry.name.replace(/\.xml$/i, ''),
    url: uiUrl(pkg, entry),
    path: (entry.attrs.find(([k]) => k === 'path') || [])[1] || '/',
    size: info.size,
    extention: info.extention,
    nodes: info.nodeCount,
    ...extra,
    exported: entry.attrs.some(([k, v]) => k === 'exported' && v === 'true'),
  };
}

function packageSummary(pkg, { imageLimit = 120, includeImages = true, details = false } = {}) {
  const images = pkg.entries.filter((e) => e.tag === 'image');
  const components = pkg.entries.filter((e) => e.tag === 'component');
  const fonts = pkg.entries.filter((e) => e.tag === 'font');
  const others = pkg.entries.filter((e) => !['image', 'component', 'font'].includes(e.tag));
  const shown = includeImages ? images.slice(0, imageLimit) : [];
  return {
    id: pkg.id,
    name: pkg.name,
    publishName: pkg.publishName,
    dir: pkg.dir,
    urlTemplate: `ui://${pkg.id}<itemId>`,
    counts: {
      images: images.length,
      components: components.length,
      fonts: fonts.length,
      other: others.length,
    },
    components: components.map((e) => componentEntryInfo(pkg, e, details)),
    ...(includeImages ? { images: shown.map((e) => imageEntryInfo(pkg, e)) } : {}),
    ...(includeImages && images.length > shown.length ? { imagesTruncated: true } : {}),
  };
}

function buildPreviewPlan({ width, height, plan, background, scale }) {
  return { width, height, scale, background, nodes: plan };
}

function editorPath(config) {
  const value = config && typeof config.editorPath === 'string' && config.editorPath.trim() !== ''
    ? config.editorPath.trim()
    : DEFAULT_EDITOR;
  return value.replace(/^"(.*)"$/, '$1');
}

// ---------------------------------------------------------------------------
// Model-facing parameter schemas (plain JSON Schema: the tool registry forwards
// `parameters` verbatim to the model provider, so it must carry type: "object").
// ---------------------------------------------------------------------------

const projectParam = {
  type: 'string',
  description: 'Absolute path to the .fairy file or to the project directory.',
};

const nodeSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    type: {
      type: 'string',
      enum: ['graph', 'rect', 'image', 'text', 'inputtext', 'richtext', 'list', 'loader', 'button', 'label', 'progressbar', 'slider', 'combobox', 'tree', 'window', 'component', 'group'],
      description: 'Node kind.',
    },
    name: { type: 'string', description: 'Unique node name (letters, digits, _, -, CJK).' },
    rect: {
      type: 'array',
      description: '[x, y, width, height] inside the component.',
      items: { type: 'number' },
    },
    asset: { type: 'string', description: 'Image name/id (image), component/template name (component/button), item template (list) or image (loader).' },
    text: { type: 'string', description: 'Text content (text, richtext, inputtext default value).' },
    fontSize: { type: 'number' },
    color: { type: 'string', description: '#rrggbb or #aarrggbb.' },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    vAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
    fill: { type: 'string', description: 'Graph fill color (graph) or loader scale mode (loader: scale/scaleFree/scaleNoBorder/none).' },
    line: { type: 'string', description: 'Graph border color.' },
    lineWidth: { type: 'number' },
    corner: { type: 'number', description: 'Rounded corner radius.' },
    shape: { type: 'string', enum: ['rect', 'ellipse', 'circle'] },
    fit: { type: 'string', enum: ['stretch', 'contain'] },
    scale9grid: {
      type: 'string',
      description:
        'Nine-slice grid for an image node: "left,top,right,bottom" (e.g. "10,12,10,12"). Writes scale="9grid" scale9grid="..." on the image resource in package.xml.',
    },
    title: { type: 'string', description: 'Component/button instance title.' },
    icon: { type: 'string', description: 'Component/button instance icon asset name or ui:// URL.' },
    value: { type: 'number', description: 'ProgressBar/Slider current value.' },
    max: { type: 'number', description: 'ProgressBar/Slider maximum value.' },
    props: { type: 'object', additionalProperties: true, description: 'Extra extension properties.' },
    group: { type: 'string', description: 'Member of a group node (group node name).' },
    gears: {
      type: 'array',
      description: 'Controller-driven state changes.',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          type: {
            type: 'string',
            enum: ['display', 'display2', 'xy', 'size', 'look', 'color', 'fontSize', 'icon', 'ani', 'text'],
          },
          controller: { type: 'string' },
          pages: { type: 'array', items: { type: 'string' }, description: 'Controller page indices, e.g. ["0","1"] or ["1"].' },
          values: { type: 'string', description: 'FairyGUI gear values, e.g. "65,271|252,190".' },
          default: { type: 'string' },
          condition: { type: 'number', description: 'gearDisplay2 condition (0 = and, 1 = or).' },
          tween: { type: 'boolean' },
        },
      },
    },
    relations: {
      type: 'array',
      description: 'Layout relations; target omitted means the component itself.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', description: 'Target node name; omit for the parent component.' },
          sidePair: { type: 'string', description: 'e.g. "width-width,height-height" or "right-right".' },
        },
        required: ['sidePair'],
      },
    },
    mode: { type: 'string', enum: ['Common', 'Check', 'Radio'], description: 'Button mode.' },
    checked: { type: 'boolean', description: 'Button selected state.' },
    selectedTitle: { type: 'string' },
    titleColor: { type: 'string' },
    titleFontSize: { type: 'number' },
    selectedIcon: { type: 'string' },
    sound: { type: 'string' },
    controller: { type: 'string', description: 'Button controller name (state switch).' },
    page: { type: 'string', description: 'Button controller page id.' },
    visibleItemCount: { type: 'number', description: 'ComboBox visible item count.' },
    selectionController: { type: 'string', description: 'List selection controller.' },
    pageController: { type: 'string', description: 'List pagination controller.' },
    scrollBarFlags: { type: 'number', description: 'List scroll bar flags (bitmask).' },
    indent: { type: 'number', description: 'Tree indent per level in pixels (default 15).' },
    rotation: { type: 'number' },
    alpha: { type: 'number' },
    visible: { type: 'boolean', description: 'Node visibility (writes visible="false" when false).' },
    pivot: { type: 'string', description: 'Pivot, e.g. "0.5,0.5".' },
    allowOverflow: { type: 'boolean', description: 'Suppress the out-of-bounds warning.' },
    prompt: { type: 'string', description: 'Placeholder text (inputtext).' },
    maxLength: { type: 'number', description: 'Max characters (inputtext).' },
    ubb: { type: 'boolean', description: 'Enable UBB/HTML markup (richtext, default true).' },
    url: { type: 'string', description: 'Loader URL: ui:// URL, http(s) URL or image asset name.' },
    defaultItem: { type: 'string', description: 'List item template component name or ui:// URL.' },
    items: {
      type: 'array',
      description: 'List items (title/icon).',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          title: { type: 'string' },
          icon: { type: 'string' },
        },
      },
    },
    layout: {
      type: 'string',
      enum: ['column', 'row', 'flow_hz', 'flow_vt', 'pagination'],
      description: 'List layout; omit for a single column.',
    },
    overflow: { type: 'string', enum: ['visible', 'hidden', 'scroll'] },
    scroll: { type: 'string', enum: ['vertical', 'horizontal', 'both'] },
    lineGap: { type: 'number' },
    columnGap: { type: 'number' },
    clipSoftness: { type: 'string', description: 'e.g. "0,20".' },
    selectionMode: { type: 'string', enum: ['single', 'multiple', 'none'] },
    margin: { type: 'string', description: 'e.g. "0,0,0,0".' },
  },
  required: ['type', 'rect'],
};

const layoutParam = {
  type: 'array',
  description: 'Display-list nodes, ordered bottom to top.',
  items: nodeSchema,
};

export function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {};

  ctx.tools.register({
    name: 'fairyui_inspect',
    description:
      'Inspect a FairyGUI project on disk: packages, images (id/name/pixel size/9-slice), components (id/name/size/extension) and the design resolution. Call this first when the user wants to build or modify a FairyGUI UI, so you know which assets you may use. Returns JSON.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: {
          type: 'string',
          description: 'Only inspect this package (folder name, package id or publish name).',
        },
        imageLimit: {
          type: 'number',
          description: 'Maximum images listed per package (default 120, max 500).',
        },
        details: {
          type: 'boolean',
          description: 'Also list each component controllers (name/pages/selected) and node gears (type/controller/target).',
        },
      },
      required: ['project'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, 'FairyGUI project inspected.'),
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const wanted = args.package ? [findPackage(packages, args.package)] : packages;
      const limit = Math.max(1, Math.min(500, Math.floor(Number(args.imageLimit) || 120)));
      const design = designResolution(project);
      const conventions = conventionsInfo(project);
      return toJson({
        ok: true,
        project: {
          name: project.name,
          file: project.file,
          type: project.type,
          version: project.version,
          design: design || null,
        },
        packages: wanted.map((pkg) => packageSummary(pkg, { imageLimit: limit, details: args.details === true })),
        conventions: conventions.rules
          ? {
              source: conventions.source,
              file: conventions.file,
              sourceDoc: conventions.sourceDoc,
              ...(conventions.projectFile ? { projectFile: conventions.projectFile } : {}),
              rules: conventions.rules,
            }
          : null,
        hint:
          'Use fairyui_asset_sheet to see the images as a labeled contact sheet; reference images by name (or id) in fairyui_build. Use fairyui_mockup_grid to measure coordinates on a mockup.',
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_asset_sheet',
    description:
      "Render a labeled contact sheet (PNG) of a package's images so you can look at the available UI assets and pick them by name for a mockup. Each cell shows the image, its id, name and pixel size. Returns the sheet path; open it with read_image.",
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: {
          type: 'string',
          description: 'Package name/id to show; defaults to the only package.',
        },
        out: {
          type: 'string',
          description: 'Output PNG path (default: <project>/.dsh-fairyui/sheet-<package>.png).',
        },
        query: {
          type: 'string',
          description: 'Only include images whose name contains this text (case-insensitive).',
        },
        max: {
          type: 'number',
          description: 'Maximum number of images (default 60, max 200).',
        },
        cell: {
          type: 'number',
          description: 'Cell size in pixels (default 150).',
        },
        includeComponents: {
          type: 'boolean',
          description: 'Also list components as placeholder cells (default false).',
        },
      },
      required: ['project'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, value.sheet ? `Asset sheet: ${value.sheet}` : 'Asset sheet'),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const pkg = findPackage(packages, args.package);
      const max = Math.max(1, Math.min(200, Math.floor(Number(args.max) || 60)));
      const cell = Math.max(80, Math.min(260, Math.floor(Number(args.cell) || 150)));
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const images = pkg.entries
        .filter((e) => e.tag === 'image')
        .filter((e) => (query ? e.name.toLowerCase().includes(query) : true))
        .sort((a, b) => a.name.localeCompare(b.name));
      const selected = images.slice(0, max);
      const items = selected.map((entry) => {
        const info = imageEntryInfo(pkg, entry);
        return {
          kind: 'image',
          file: resourceFile(pkg, entry),
          label: info.name,
          sub: `${info.id} · ${info.width ?? '?'}x${info.height ?? '?'}`,
          width: info.width,
          height: info.height,
        };
      });
      if (args.includeComponents === true) {
        for (const entry of pkg.entries.filter((e) => e.tag === 'component')) {
          const info = componentEntryInfo(pkg, entry);
          items.push({
            kind: 'component',
            label: info.name,
            sub: `${info.size?.join('x') || '?'}${info.extention ? ` · ${info.extention}` : ''}`,
          });
        }
      }
      if (items.length === 0) throw new Error(`no images${query ? ` matching "${query}"` : ''} in package "${pkg.name}"`);
      const out = typeof args.out === 'string' && args.out.trim() !== ''
        ? resolveMaybeRelative(args.out, exec, ctx)
        : path.join(project.dir, '.dsh-fairyui', `sheet-${pkg.name}.png`);
      const columns = Math.max(1, Math.min(8, Math.floor(1200 / cell)));
      const planPath = path.join(previewDir(project), `sheet-${pkg.name}.plan.json`);
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(
        planPath,
        JSON.stringify(
          {
            title: `${project.name} / ${pkg.name} (${items.length}${images.length > selected.length ? ` of ${images.length}` : ''})`,
            cell,
            columns,
            items,
          },
          null,
          2,
        ),
        'utf8',
      );
      await renderWith(scriptPath('sheet.ps1'), planPath, out);
      return toJson({
        ok: true,
        package: pkg.name,
        sheet: out,
        cell,
        columns,
        total: images.length,
        shown: selected.length,
        truncated: images.length > selected.length,
        items: selected.map((entry) => {
          const info = imageEntryInfo(pkg, entry);
          return { id: info.id, name: info.name, width: info.width, height: info.height };
        }),
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_build',
    description:
      'Create or replace a component in a FairyGUI package from a layout spec, write the project XML, and render a PNG preview. ' +
      'Node objects (array order = z-order, first is bottom): ' +
      "{type:'graph', name, rect:[x,y,w,h], shape:'rect'|'ellipse', fill:'#aarrggbb', line, lineWidth, corner} | " +
      "{type:'image', name, rect, asset:'file name or id', fit:'stretch'|'contain'} | " +
      "{type:'text', name, rect, text, fontSize, color, align, vAlign, bold, italic, strokeColor, strokeSize, leading, singleLine} | " +
      "{type:'inputtext', name, rect, prompt, maxLength, fontSize} | " +
      "{type:'richtext', name, rect, text, fontSize, color, ubb} | " +
      "{type:'list', name, rect, defaultItem:'item template', layout:'row'|'flow_hz'|'flow_vt'|'pagination', items:[{title,icon}], lineGap, columnGap, overflow} | " +
      "{type:'loader', name, rect, url:'ui://... or http(s)', fill:'scale'|'scaleFree'|'scaleNoBorder'|'none'} | " +
      "{type:'button', name, rect, asset:'Button template name (optional: auto-created)', title, icon} | " +
      "{type:'label', name, rect, asset, title, icon} | " +
      "{type:'progressbar', name, rect, asset, value, max} | " +
      "{type:'slider', name, rect, asset, value, max} | " +
      "{type:'combobox', name, rect, asset, visibleItemCount, items:[{title}]} | " +
      "{type:'tree', name, rect, defaultItem, indent, items:[{title,icon,level}]} | " +
      "{type:'window', name, rect, asset, title} | " +
      "{type:'component', name, rect, asset:'component name', title, icon, props}. " +
      'Component options: controllers:[{name,pages,selected}] plus node gears (display/xy/size/look/color/fontSize/icon) and relations (sidePair) for state and layout; node group="groupName" with a {type:"group"} node; scroll:{overflow,scroll,scrollBar,margin,clipSoftness} makes the component a scroll pane. ' +
      'Images already in the package are referenced by name; images available under importRoot are imported automatically. ' +
      'Components resolve inside the target package, or across packages with asset "Common1/CommonBtn" (the instance gets the src/fileName plus pkg of the source package); list defaultItem/tree templates accept the same form. ' +
      'When design/conventions.json or the bundled defaults apply, the component name, folder, package choice, node name pattern and export flag follow them; the component is written into the conventions componentFolder when one is configured (otherwise the package root), templates into templateFolder and imported images into imageFolder (both likewise default to the package root). ' +
      'Text nodes get autoClearText="true" and lists autoClearItems="true" by default (pass false to keep text/items on publish); node customData is written as the FairyGUI 自定义数据. ' +
      'When the component already exists its extention is preserved; pass extention to change it ("none" removes it). previewPages:{controllerName:pageId} renders another controller state (gearDisplay/gearColor/gearIcon/gearXY/gearSize). Overwriting an existing component returns indexChanged and warns when GetChildAt indices moved. Batch mode: components:[name|{component,nodes,…}]. ' +
      'Returns the component file, its ui:// URL and the preview path (open the preview with read_image).',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: {
          type: 'string',
          description: 'Package name/id; defaults to the only package.',
        },
        component: {
          type: 'string',
          description: 'Component name (file is <package>/<folder>/<component>.xml). Existing components are replaced.',
        },
        folder: {
          type: 'string',
          description:
            'Resource folder inside the package, e.g. "Component" or "Tips". Defaults to the conventions componentFolder, else the package root.',
        },
        width: {
          type: 'number',
          description: 'Component width (default: project design width or 1136).',
        },
        height: {
          type: 'number',
          description: 'Component height (default: project design height or 640).',
        },
        nodes: layoutParam,
        controllers: {
          type: 'array',
          description: 'Component controllers: [{name, pages:["up","down"], selected:0}]. Nodes reference them in gears and button props.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              pages: { type: 'array', items: { type: 'string' } },
              selected: { type: 'number' },
            },
            required: ['name', 'pages'],
          },
        },
        scroll: {
          type: 'object',
          additionalProperties: false,
          description: 'Root scroll-pane attributes (any component can scroll).',
          properties: {
            overflow: { type: 'string', enum: ['visible', 'hidden', 'scroll'] },
            scroll: { type: 'string', enum: ['vertical', 'horizontal', 'both'] },
            scrollBar: { type: 'string', enum: ['visible', 'hidden', 'auto'] },
            margin: { type: 'string' },
            clipSoftness: { type: 'string' },
          },
        },
        importRoot: {
          type: 'string',
          description:
            'Directory to search for images that are not in the package yet (also searches <project>/assets/<package>/images).',
        },
        extention: {
          type: 'string',
          enum: ['Label', 'Button', 'ProgressBar', 'Slider', 'ComboBox', 'ScrollBar', 'none'],
          description:
            'Extension type written on the component root. Omit to keep the extention already on disk (new components get none); "none" removes it.',
        },
        previewPages: {
          type: 'object',
          additionalProperties: true,
          description: 'Preview controller pages: {controllerName: pageId}; applies gearDisplay/gearColor/gearIcon/gearXY/gearSize.',
        },
        conventionsPath: {
          type: 'string',
          description: 'Conventions file to use instead of <project>/design/conventions.json (custom source).',
        },
        expectEmpty: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Node names whose empty text or missing loader url is expected (assigned at runtime); suppresses the info entry.',
        },
        components: {
          type: 'array',
          description:
            'Batch mode: build several components in one call. Items are names (reusing the top-level nodes) or {component, nodes?, width?, height?, folder?, extention?, controllers?, scroll?, exported?}. Each result is independent; one failure does not stop the others.',
          items: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
        },
        background: {
          type: 'string',
          description: 'Preview background color (default #ffffffff).',
        },
        scale: {
          type: 'number',
          description: 'Preview scale, 1-3 (default 1).',
        },
        exported: {
          type: 'boolean',
          description: 'Mark the component as exported (default: project convention, else true).',
        },
        ignoreConventions: {
          type: 'boolean',
          description: 'Bypass design/conventions.json for this build (name/package/prefix checks).',
        },
        autoTemplate: {
          type: 'boolean',
          description: 'Create a default Button/Item template when the package has none (default true).',
        },
      },
      required: ['project', 'component', 'nodes'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        asText(value, value.ok ? `Built ${value.component.name} · ${value.component.url}` : 'Build finished'),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const batch = Array.isArray(args.components) ? args.components : null;
      if (!batch) return toJson(await buildOne(args, exec));
      const results = [];
      for (const item of batch) {
        const spec = typeof item === 'string' ? { component: item } : { ...(item || {}) };
        try {
          results.push(await buildOne({ ...args, ...spec, components: undefined }, exec));
        } catch (error) {
          results.push({ ok: false, component: spec.component, error: error.message });
        }
      }
      return toJson({
        ok: results.every((result) => result.ok),
        count: results.length,
        failed: results.filter((result) => !result.ok).map((result) => result.component),
        results,
      });
    },
  });

  async function buildOne(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const name = String(args.component || '').trim();
      if (!name) throw new Error('component is required');
      const conventions = args.ignoreConventions === true ? null : conventionsInfo(project, args.conventionsPath);
      const rules = conventions?.rules || null;
      if (rules?.componentNamePattern && !matches(rules.componentNamePattern, name)) {
        throw new Error(
          `component name "${name}" violates the project convention ${rules.componentNamePattern} ` +
            `(see ${conventions?.path || conventionsFile(project)}); rename it or pass ignoreConventions: true`,
        );
      }
      const packageRef = args.package || (rules ? packageForComponent(project, packages, name, undefined, rules) : undefined);
      const pkg = findPackage(packages, packageRef);
      const design = designResolution(project);
      const width = Math.max(1, Math.round(Number(args.width) || design?.width || DEFAULT_WIDTH));
      const height = Math.max(1, Math.round(Number(args.height) || design?.height || DEFAULT_HEIGHT));
      const importRoot = args.importRoot ? resolveMaybeRelative(args.importRoot, exec, ctx) : undefined;
      let nodes = args.nodes;
      if (rules?.autoPrefixNodeNames && rules.nodeNamePrefixes) {
        const rename = new Map();
        nodes = nodes.map((node) => {
          const renamed = applyNodePrefix(rules, node);
          if (renamed.name !== node.name && typeof node.name === 'string') rename.set(node.name, renamed.name);
          return renamed;
        });
        // Keep relation/group references valid when node names were prefixed.
        nodes = nodes.map((node) => ({
          ...node,
          ...(node.group && rename.has(node.group) ? { group: rename.get(node.group) } : {}),
          ...(Array.isArray(node.relations)
            ? {
                relations: node.relations.map((relation) =>
                  relation && relation.target && rename.has(relation.target)
                    ? { ...relation, target: rename.get(relation.target) }
                    : relation,
                ),
              }
            : {}),
        }));
      }
      const nameViolations = rules ? checkNodeNames(rules, nodes) : [];
      const folder = normalizeFolder(args.folder !== undefined ? args.folder : rules?.componentFolder);
      const templateFolder = normalizeFolder(rules?.templateFolder);
      const imageFolder = normalizeFolder(rules?.imageFolder);
      const compiled = compileLayout({
        pkg,
        packages,
        nodes,
        width,
        height,
        importRoot,
        autoTemplate: args.autoTemplate !== false,
        controllers: Array.isArray(args.controllers) ? args.controllers : [],
        allowOverflow: !!(args.scroll && args.scroll.overflow === 'scroll'),
        templateFolder,
        imageFolder,
        previewPages: args.previewPages && typeof args.previewPages === 'object' ? args.previewPages : {},
        expectEmpty: Array.isArray(args.expectEmpty) ? args.expectEmpty : [],
      });
      const exported = args.exported !== undefined ? args.exported : rules?.requireExported !== false;
      const written = writeComponent({
        project,
        pkg,
        name,
        width,
        height,
        displayXml: compiled.xml,
        exported,
        controllers: Array.isArray(args.controllers) ? args.controllers : [],
        scroll: args.scroll && typeof args.scroll === 'object' ? args.scroll : {},
        folder,
        extention: args.extention,
      });
      const { entry, file } = written;
      savePackage(pkg);

      const warnings = [];
      if (conventions?.source === 'bundled-default') {
        warnings.push(defaultConventionsWarning(conventions.projectFile || conventionsFile(project)));
      }
      warnings.push(...compiled.warnings);
      if (!written.extention) {
        const reserved = nodes
          .filter((node) => node && typeof node.name === 'string' && RESERVED_NODE_NAMES.has(node.name))
          .map((node) => node.name);
        if (reserved.length > 0) {
          warnings.push(
            `组件没有扩展类型（extention），保留名 ${[...new Set(reserved)].join(', ')} 不生效；` +
              '需要 Label/Button 行为时传 extention',
          );
        }
      }
      const nextNames = componentDisplayNames(file);
      const previous = new Map((written.previous || []).map((item) => [item.name, item.index]));
      const indexChanged = nextNames
        .filter((item) => !/^n\d+$/.test(item.name) && previous.has(item.name) && previous.get(item.name) !== item.index)
        .map((item) => ({ name: item.name, from: previous.get(item.name), to: item.index }));
      if (indexChanged.length > 0) warnings.push('节点索引已变化，请重新生成视图类（fairyui_sync_views）');
      for (const violation of nameViolations.slice(0, 10)) warnings.push(violation.message);
      for (const templateName of compiled.createdTemplates) {
        if (rules?.componentNamePattern && !matches(rules.componentNamePattern, templateName)) {
          warnings.push(`auto-created template "${templateName}" does not match ${rules.componentNamePattern}`);
        }
      }
      if (rules?.imageNamePattern) {
        for (const item of compiled.imported) {
          if (!matches(rules.imageNamePattern, item.name)) {
            warnings.push(`imported image "${item.name}" does not match ${rules.imageNamePattern}`);
          }
        }
      }
      const preview = { path: null, width, height };
      const scale = Math.max(1, Math.min(3, Number(args.scale) || 1));
      try {
        const planPath = writePreviewPlan(
          project,
          name,
          buildPreviewPlan({
            width,
            height,
            plan: compiled.plan,
            background: args.background || '#ffffffff',
            scale,
          }),
        );
        const out = path.join(previewDir(project), `${name}.png`);
        await renderWith(scriptPath('render.ps1'), planPath, out);
        preview.path = out;
        preview.scale = scale;
      } catch (error) {
        warnings.push(`preview failed: ${error.message}`);
      }

      const xml = fs.readFileSync(file, 'utf8');
      if (/&(?!(amp|lt|gt|quot|#xA|#\d+);)/.test(xml)) warnings.push('generated XML contains an unescaped "&"');

      const specPath = path.join(project.dir, '.dsh-fairyui', `${name}.spec.json`);
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      fs.writeFileSync(
        specPath,
        JSON.stringify(
          {
            project: project.file,
            package: pkg.name,
            component: name,
            width,
            height,
            extention: written.extention || null,
            controllers: args.controllers || [],
            scroll: args.scroll || {},
            previewPages: args.previewPages || {},
            conventionsPath: args.conventionsPath || null,
            nodes: args.nodes,
            importRoot,
          },
          null,
          2,
        ),
        'utf8',
      );

      return toJson({
        ok: true,
        component: {
          name,
          id: entryId(entry),
          url: uiUrl(pkg, entry),
          file,
          folder: folder ? `/${folder}/` : '/',
          size: [width, height],
          extention: written.extention || null,
        },
        package: { name: pkg.name, id: pkg.id, dir: pkg.dir },
        preview,
        conventions: conventions ? { source: conventions.source, path: conventions.path } : null,
        indexChanged,
        imported: compiled.imported,
        createdTemplates: compiled.createdTemplates,
        warnings,
        infos: compiled.infos,
        spec: specPath,
        next: [
          'Open preview with read_image and compare it with the mockup; adjust the spec and call fairyui_build again if needed.',
          'If indexChanged is non-empty, run fairyui_sync_views for this component before building the game code.',
          'Call fairyui_open to inspect the component in the FairyGUI editor.',
        ],
      });
  }

  ctx.tools.register({
    name: 'fairyui_open',
    description:
      'Open a FairyGUI project in the FairyGUI editor so a human can inspect or publish it. Launches the configured editor executable with the .fairy path.',
    parameters: {
      type: 'object',
      properties: { project: projectParam },
      required: ['project'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, value.ok ? `Opened ${value.project.name} in FairyGUI` : 'Open failed'),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { project } = openProject(args, exec, ctx);
      const exe = editorPath(cfg);
      if (!fs.existsSync(exe)) {
        throw new Error(`FairyGUI editor not found at "${exe}"; set config.editorPath in the plugin config`);
      }
      const child = spawn(exe, [project.file], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return toJson({
        ok: true,
        editor: exe,
        project: { name: project.name, file: project.file },
        pid: child.pid,
        note: 'The editor reads the project from disk; components written by fairyui_build appear in the library after the project is (re)opened or refreshed.',
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_guide',
    description:
      'Return the FairyGUI component taxonomy and node-type reference: how to express lists, buttons, rich text, loaders, inputs, progress bars, sliders and combo boxes, plus the conventions file format. Call before analyzing a mockup or when a visual element must be mapped to a FairyGUI construct.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, 'FairyGUI component guide'),
    },
    isConcurrencySafe: () => true,
    execute() {
      return toJson({ ok: true, markdown: GUIDE_MARKDOWN });
    },
  });

  ctx.tools.register({
    name: 'fairyui_mockup_grid',
    description:
      'Overlay a labeled coordinate grid on a UI mockup PNG/JPEG so you can read exact x/y/w/h for the layout spec. Returns the grid image path; open it with read_image, measure, then call fairyui_build.',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Absolute path to the mockup image.' },
        out: { type: 'string', description: 'Output path (default: <image>-grid.png next to the source).' },
        step: { type: 'number', description: 'Grid spacing in source pixels (default 50, min 10).' },
        labelEvery: { type: 'number', description: 'Label interval in source pixels (default 100).' },
        scale: { type: 'number', description: 'Output scale, 1-2 (default 1).' },
      },
      required: ['image'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, `Grid overlay: ${value.grid}`),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const image = resolveUserPath(args, exec, ctx, 'image');
      if (!fs.existsSync(image)) throw new Error(`mockup not found: ${image}`);
      const size = imageSize(image);
      if (!size) throw new Error(`cannot read image size: ${image}`);
      const step = Math.max(10, Math.min(500, Math.round(Number(args.step) || 50)));
      const labelEvery = Math.max(step, Math.min(1000, Math.round(Number(args.labelEvery) || 100)));
      const scale = Math.max(1, Math.min(2, Number(args.scale) || 1));
      const ext = path.extname(image);
      const out = args.out
        ? resolveMaybeRelative(args.out, exec, ctx)
        : path.join(path.dirname(image), `${path.basename(image, ext)}-grid${ext || '.png'}`);
      await runScript(scriptPath('grid.ps1'), [
        '-Image',
        image,
        '-Out',
        out,
        '-Step',
        String(step),
        '-LabelEvery',
        String(labelEvery),
        '-Scale',
        String(scale),
      ]);
      return toJson({
        ok: true,
        image,
        grid: out,
        width: size.width,
        height: size.height,
        step,
        labelEvery,
        scale,
        next: 'Open the grid with read_image; coordinates are in source pixels (multiply by 1/scale only if you changed scale).',
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_conventions',
    description:
      'Read or save the UI conventions. The bundle ships a default spec (defaults/conventions.json, the Ctt client FairyGUI rules from 开发流程.md §3); a project design/conventions.json overrides it. Save accepts rules parsed from a user-provided text or document; the optional sourceText is stored as design/conventions.md. fairyui_build and fairyui_lint enforce these rules.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        action: { type: 'string', enum: ['show', 'save'], description: 'show (default) or save.' },
        rules: {
          type: 'object',
          additionalProperties: true,
          description:
            'Conventions: {componentNamePattern, packageNamePattern, imageNamePattern, nodeNamePattern, nodeNamePrefixes:{graph,image,text,list,loader,richtext,inputtext,component,button}, defaultPackage, packageRules:[{pattern,package}], componentFolder, templateFolder, imageFolder, requireExported, autoPrefixNodeNames, notes}.',
        },
        sourceText: {
          type: 'string',
          description: 'Original user document text (saved to design/conventions.md) when action=save.',
        },
      },
      required: ['project'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        asText(value, value.rules ? `Conventions: ${value.path}` : `No conventions: ${value.path}`),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { project } = openProject(args, exec, ctx);
      const action = args.action === 'save' ? 'save' : 'show';
      if (action === 'save') {
        if (!args.rules || typeof args.rules !== 'object') throw new Error('rules is required for action=save');
        const rules = normalizeConventions(args.rules);
        const { file, source } = saveConventions(project, rules, args.sourceText);
        return toJson({ ok: true, path: file, source: source || null, rules });
      }
      const info = conventionsInfo(project);
      return toJson({
        ok: true,
        source: info.source,
        path: info.file,
        sourceDoc: info.sourceDoc,
        ...(info.projectFile ? { projectFile: info.projectFile } : {}),
        defaultsFile: defaultsFile(),
        rules: info.rules || null,
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_package_create',
    description:
      'Create an empty FairyGUI package (assets/<name>/package.xml) so UIs can be grouped per module/package according to the project conventions. Returns the package id and ui:// prefix.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        name: { type: 'string', description: 'Package folder/name, e.g. "Main" or "Items".' },
        publishName: { type: 'string', description: 'Optional publish name written as <publish name="..."/>.' },
        ignoreConventions: { type: 'boolean', description: 'Skip packageNamePattern validation.' },
      },
      required: ['project', 'name'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, value.ok ? `Created package ${value.name}` : 'Package create failed'),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { project } = openProject(args, exec, ctx);
      const name = String(args.name || '').trim();
      const rules = args.ignoreConventions === true ? null : loadConventions(project);
      if (rules?.packageNamePattern && !matches(rules.packageNamePattern, name)) {
        throw new Error(
          `package name "${name}" violates the project convention ${rules.packageNamePattern}; ` +
            'choose another name or pass ignoreConventions: true',
        );
      }
      const created = createPackage(project, name, args.publishName ? String(args.publishName) : undefined);
      const folders = [rules?.imageFolder, rules?.templateFolder, rules?.componentFolder]
        .map((folder) => (typeof folder === 'string' ? folder.trim().replace(/^\/+|\/+$/g, '') : ''))
        .filter((folder, index, all) => folder !== '' && all.indexOf(folder) === index);
      for (const folder of folders) fs.mkdirSync(path.join(created.dir, folder), { recursive: true });
      return toJson({
        ok: true,
        name: created.name,
        id: created.id,
        dir: created.dir,
        file: created.file,
        folders,
        urlTemplate: `ui://${created.id}<itemId>`,
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_template',
    description:
      'Create a FairyGUI extension component template (Button/Label/ProgressBar/Slider/ComboBox) or a tree/window/plain list-item template, with the name-convention children the runtime looks up (title, icon, bar, grip) and the extension element (<Button/>, <ProgressBar/>…). ComboBox creates the linked item + dropdown components; tree creates the item + expand button; window creates a Label-extension frame (initName="frame") + close button. Use it when the package has no suitable template yet; fairyui_build can also auto-create these templates.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: { type: 'string', description: 'Package name/id; defaults to the only package or the convention default.' },
        name: { type: 'string', description: 'Component name (default CommonBtn / CommonLabel / CommonProgressBar / CommonSlider / CommonItem).' },
        folder: {
          type: 'string',
          description: 'Resource folder inside the package, e.g. "Component". Defaults to the conventions templateFolder, else the package root.',
        },
        extension: {
          type: 'string',
          enum: ['button', 'label', 'progressbar', 'slider', 'combobox', 'tree', 'window', 'item'],
          description: 'Template kind.',
        },
        width: { type: 'number' },
        height: { type: 'number' },
        title: { type: 'string', description: 'Default title text.' },
        bg: { type: 'string', description: 'Background/accent color (#rrggbb).' },
        text: { type: 'string', description: 'Title color.' },
        bar: { type: 'string', description: 'Progress/slider bar color.' },
        track: { type: 'string', description: 'Progress/slider track color.' },
        grip: { type: 'string', description: 'Slider grip color.' },
        fontSize: { type: 'number' },
        corner: { type: 'number', description: 'Corner radius (button/item).' },
        exported: { type: 'boolean', description: 'Export the component (default true).' },
        ignoreConventions: { type: 'boolean', description: 'Skip the componentNamePattern check.' },
      },
      required: ['project', 'extension'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, value.ok ? `Template ${value.name} · ${value.url}` : 'Template failed'),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const kind = String(args.extension || '').toLowerCase();
      if (!['button', 'label', 'progressbar', 'slider', 'combobox', 'tree', 'window', 'item'].includes(kind)) {
        throw new Error(`extension must be button, label, progressbar, slider, combobox, tree, window or item (got "${args.extension}")`);
      }
      const template = kind === 'combobox'
        ? { name: 'CommonComboBox', width: Number(args.width) || 160, height: Number(args.height) || 32 }
        : kind === 'tree'
          ? { name: 'CommonTreeItem', width: Number(args.width) || 280, height: Number(args.height) || 36 }
          : kind === 'window'
            ? { name: 'CommonWindowFrame', width: Number(args.width) || 600, height: Number(args.height) || 400 }
            : buildTemplate({
            extension: kind,
            width: args.width,
            height: args.height,
            title: args.title,
            bg: args.bg,
            text: args.text,
            bar: args.bar,
            track: args.track,
            grip: args.grip,
            fontSize: args.fontSize,
            corner: args.corner,
          });
      const name = String(args.name || template.name).trim();
      const rules = args.ignoreConventions === true ? null : loadConventions(project);
      if (rules?.componentNamePattern && !matches(rules.componentNamePattern, name)) {
        throw new Error(
          `component name "${name}" violates the project convention ${rules.componentNamePattern}; ` +
            'pick a conforming name or pass ignoreConventions: true',
        );
      }
      const packageRef = args.package || (rules ? packageForComponent(project, packages, name) : undefined);
      const pkg = findPackage(packages, packageRef);
      const templateFolder = normalizeFolder(args.folder !== undefined ? args.folder : rules?.templateFolder);
      if (kind === 'combobox') {
        const created = ensureComboBox(pkg, {
          name,
          width: args.width,
          height: args.height,
          visibleItemCount: args.visibleItemCount,
          folder: templateFolder,
        });
        savePackage(pkg);
        return toJson({
          ok: true,
          name: created.name,
          extension: kind,
          id: entryId(created.entry),
          url: uiUrl(pkg, created.entry),
          size: [Number(args.width) || 160, Number(args.height) || 32],
          itemTemplate: created.itemName,
          popupTemplate: created.popupName,
          replaced: !created.created,
          package: { name: pkg.name, id: pkg.id },
        });
      }
      if (kind === 'tree') {
        const created = ensureTreeItem(pkg, { name, width: args.width, height: args.height, folder: templateFolder });
        savePackage(pkg);
        return toJson({
          ok: true,
          name: created.name,
          extension: kind,
          id: entryId(created.entry),
          url: uiUrl(pkg, created.entry),
          size: [Number(args.width) || 280, Number(args.height) || 36],
          expandTemplate: created.expandName,
          replaced: !created.created,
          package: { name: pkg.name, id: pkg.id },
        });
      }
      if (kind === 'window') {
        const created = ensureWindowFrame(pkg, {
          name,
          width: args.width,
          height: args.height,
          title: args.title,
          folder: templateFolder,
        });
        savePackage(pkg);
        return toJson({
          ok: true,
          name: created.name,
          extension: kind,
          id: entryId(created.entry),
          url: uiUrl(pkg, created.entry),
          size: created.size,
          closeTemplate: created.closeName,
          replaced: !created.created,
          package: { name: pkg.name, id: pkg.id },
        });
      }
      const existed = !!pkg.entries.find((e) => e.tag === 'component' && e.name.toLowerCase() === `${name}.xml`.toLowerCase());
      const { entry, file } = writeRawComponent({
        pkg,
        name,
        xml: template.xml,
        exported: args.exported !== false,
        folder: templateFolder,
      });
      savePackage(pkg);
      return toJson({
        ok: true,
        name,
        extension: kind,
        id: entryId(entry),
        url: uiUrl(pkg, entry),
        file,
        size: [template.width, template.height],
        replaced: existed,
        package: { name: pkg.name, id: pkg.id },
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_lint',
    description:
      'Check the project against the effective conventions (project design/conventions.json, else the bundled default spec): package names, component names, image names and node names. Returns one violation entry per offending resource. Call after generating UI or when the user asks whether naming rules are respected.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: { type: 'string', description: 'Only lint this package (default: all packages).' },
        folder: {
          type: 'string',
          description: 'Only lint components/images in this package sub-folder, e.g. "Panels/Feed".',
        },
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only lint these component names (batch); each component is reported independently.',
        },
        conventionsPath: {
          type: 'string',
          description: 'Conventions file to use instead of <project>/design/conventions.json (custom source).',
        },
      },
      required: ['project'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        asText(value, value.count === 0 ? 'No convention violations' : `${value.count} convention violation(s)`),
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const info = conventionsInfo(project, args.conventionsPath);
      if (!info.rules) {
        throw new Error(`no conventions found at ${conventionsFile(project)} or ${defaultsFile()}; save them with fairyui_conventions first`);
      }
      const wanted = args.package ? [findPackage(packages, args.package)] : packages;
      const folder = typeof args.folder === 'string' ? args.folder : '';
      const componentNames = Array.isArray(args.components) ? args.components : undefined;
      const violations = lintPackages(project, wanted, info.rules, { folder, components: componentNames });
      const warnings = [];
      if (info.source === 'bundled-default') {
        warnings.push(defaultConventionsWarning(info.projectFile || conventionsFile(project)));
      }
      const perComponent = componentNames
        ? componentNames.map((component) => {
            const name = String(component).replace(/\.xml$/i, '').toLowerCase();
            const own = violations.filter((violation) => String(violation.name || '').toLowerCase() === name);
            return { component, ok: own.length === 0, violations: own };
          })
        : undefined;
      return toJson({
        ok: true,
        source: info.source,
        path: info.path || info.file,
        conventions: { source: info.source, path: info.path || info.file },
        folder: folder || null,
        count: violations.length,
        warnings,
        ...(perComponent ? { items: perComponent } : {}),
        violations,
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_sync_views',
    description:
      'Regenerate the C# view classes (GComponent/GLabel/GButton…) from component XML, using display-list indices exactly like the FairyGUI publisher: reserved child names and anonymous n1/n2 names get no field but still occupy the index. Writes <project>/../Code/Game/Scripts/UI/View/<package>/<Component>.cs (utf-8-sig, CRLF) and returns the generated fields/controllers. Use it after fairyui_build reports indexChanged.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: { type: 'string', description: 'Package name/id that owns the components (required).' },
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component XML paths relative to the package, e.g. "Panels/Feed/DigFeedPanel.xml" (name alone also works).',
        },
        component: { type: 'string', description: 'Single component (shorthand for components:[...]).' },
        codeRoot: {
          type: 'string',
          description: 'Override the UI/View output root (default <project>/../Code/Game/Scripts/UI/View).',
        },
      },
      required: ['project', 'package'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        asText(value, value.ok ? `Generated ${value.written.length} view class(es)` : `Generated ${value.written.length}, failed ${value.failures.length}`),
    },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const pkg = findPackage(packages, args.package);
      const refs = componentRefs(args);
      if (refs.length === 0) throw new Error('components is required (e.g. ["Panels/Feed/DigFeedPanel.xml"])');
      const codeRoot = typeof args.codeRoot === 'string' && args.codeRoot.trim() !== ''
        ? resolveMaybeRelative(args.codeRoot, exec, ctx)
        : undefined;
      const result = syncViews({ project, pkg, packages, components: refs, codeRoot });
      return toJson({
        ok: result.failures.length === 0,
        package: pkg.name,
        outDir: result.outDir,
        count: result.written.length,
        written: result.written,
        failures: result.failures,
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_check_views',
    description:
      'Check that each component XML still matches its generated C# view class: base class (extention), field set (custom non-reserved children), GetChildAt indices (anonymous nodes counted), field types and GetControllerAt indices. Returns ok plus per-component problems.',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        package: { type: 'string', description: 'Package name/id that owns the components (required).' },
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component XML paths relative to the package; omit to check every component in the package.',
        },
        component: { type: 'string', description: 'Single component (shorthand for components:[...]).' },
        codeRoot: {
          type: 'string',
          description: 'Override the UI/View root (default <project>/../Code/Game/Scripts/UI/View).',
        },
      },
      required: ['project', 'package'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        asText(value, value.ok ? 'All view classes are consistent' : `${value.items.filter((item) => !item.ok).length} component(s) inconsistent`),
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const { project, packages } = openProject(args, exec, ctx);
      const pkg = findPackage(packages, args.package);
      let refs = componentRefs(args);
      if (refs.length === 0) {
        refs = pkg.entries
          .filter((entry) => entry.tag === 'component')
          .map((entry) => {
            const folder = (entry.attrs.find(([k]) => k === 'path') || [])[1] || '/';
            return `${folder.replace(/^\/+|\/+$/g, '')}${folder === '/' ? '' : '/'}${entry.name}`;
          });
      }
      const root = typeof args.codeRoot === 'string' && args.codeRoot.trim() !== ''
        ? resolveMaybeRelative(args.codeRoot, exec, ctx)
        : undefined;
      const result = checkViews({ project, pkg, packages, components: refs, codeRoot: root });
      return toJson({
        ok: result.ok,
        package: pkg.name,
        dir: result.dir,
        total: result.items.length,
        failed: result.items.filter((item) => !item.ok).length,
        items: result.items,
      });
    },
  });

  ctx.tools.register({
    name: 'fairyui_overlay',
    description:
      'Draw a component XML display list (colored node boxes) over a mockup image so box positions and element sizes can be compared pixel by pixel. Colours: component red, image cyan, loader yellow, text green, list magenta, graph gray. Returns the PNG path and the design/on-mockup rectangles.',
    parameters: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: 'Absolute component XML path, or a package-relative path/name when project+package are given.',
        },
        mockup: { type: 'string', description: 'Absolute path to the mockup image.' },
        project: projectParam,
        package: { type: 'string', description: 'Package name/id (only needed with a relative component).' },
        out: { type: 'string', description: 'Output PNG path (default <mockup dir>/<component>-overlay.png).' },
        offset: {
          type: 'array',
          items: { type: 'number' },
          description: 'Component origin on the mockup, [x, y] (default [0, 0]).',
        },
        zoom: { type: 'number', description: 'Output zoom (default 1, 1-4).' },
        crop: {
          type: 'array',
          items: { type: 'number' },
          description: 'Crop after drawing, [x0, y0, x1, y1] in mockup pixels.',
        },
      },
      required: ['component', 'mockup'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => asText(value, `Overlay: ${value.path}`),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const mockup = resolveUserPath(args, exec, ctx, 'mockup');
      if (!fs.existsSync(mockup)) throw new Error(`mockup not found: ${mockup}`);
      const raw = String(args.component || '').trim();
      if (!raw) throw new Error('component is required');
      let compFile = raw;
      if (!path.isAbsolute(raw) || !fs.existsSync(raw)) {
        if (!args.project) throw new Error('pass an absolute component XML path, or project + package with a component name');
        const opened = openProject({ project: args.project }, exec, ctx);
        const pkg = findPackage(opened.packages, args.package);
        const entry = resolveComponentEntry(pkg, raw);
        compFile = resourceFile(pkg, entry);
      }
      const root = parseXml(fs.readFileSync(compFile, 'utf8'));
      if (!root) throw new Error(`cannot parse component XML: ${compFile}`);
      const size = parseNumbers(root.attrs.size) || [0, 0];
      const offset = Array.isArray(args.offset) && args.offset.length === 2
        ? args.offset.map((value) => Number(value) || 0)
        : [0, 0];
      const zoom = Math.max(1, Math.min(4, Number(args.zoom) || 1));
      const crop = Array.isArray(args.crop) && args.crop.length === 4
        ? args.crop.map((value) => Math.round(Number(value) || 0))
        : undefined;
      const colors = {
        component: '#ff0000',
        image: '#00ffff',
        loader: '#ffff00',
        text: '#00ff00',
        richtext: '#00c800',
        inputtext: '#00c800',
        list: '#ff00ff',
        graph: '#a0a0a0',
        group: '#c8c8c8',
      };
      const list = root.children.find((child) => child.tag === 'displayList');
      const nodes = (list ? list.children : [])
        .filter((node) => node.attrs.xy !== undefined)
        .map((node) => {
          const xy = parseNumbers(node.attrs.xy) || [0, 0];
          const wh = parseNumbers(node.attrs.size) || [0, 0];
          return {
            name: node.attrs.name || '',
            type: node.tag,
            design: [xy[0], xy[1], wh[0], wh[1]],
            mockup: [xy[0] + offset[0], xy[1] + offset[1], wh[0], wh[1]],
          };
        });
      const ext = path.extname(mockup);
      const out = typeof args.out === 'string' && args.out.trim() !== ''
        ? resolveMaybeRelative(args.out, exec, ctx)
        : path.join(path.dirname(mockup), `${path.basename(compFile, '.xml')}-overlay.png`);
      const planPath = `${out}.plan.json`;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(
        planPath,
        JSON.stringify(
          {
            mockup,
            out,
            width: size[0],
            height: size[1],
            offset,
            zoom,
            crop,
            nodes: nodes.map((node) => ({
              x: node.design[0],
              y: node.design[1],
              w: node.design[2],
              h: node.design[3],
              color: colors[node.type] || '#ffffff',
            })),
          },
          null,
          2,
        ),
        'utf8',
      );
      await renderWith(scriptPath('overlay.ps1'), planPath, out);
      return toJson({
        ok: true,
        component: compFile,
        mockup,
        path: out,
        zoom,
        crop: crop || null,
        offset,
        nodes: nodes.map((node) => ({ name: node.name, type: node.type, design: node.design, mockup: node.mockup })),
      });
    },
  });
}
