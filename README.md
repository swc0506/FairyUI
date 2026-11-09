# dsh-fairyui

DSH Host 插件：让 Agent 看懂 UI 示意图里的组件类型，按工程规范生成 FairyGUI 界面元件、渲染预览，并在编辑器中复核。

FairyGUI 工程是纯 XML：`<工程>.fairy` + `assets/<包>/package.xml` + 每个元件一个 XML。插件直接读写这套格式，不要求编辑器常开。

## 工具

| 工具 | 用途 |
| --- | --- |
| `fairyui_inspect` | 读取工程：包、图片（id/名称/尺寸/九宫格）、元件（id/名称/尺寸/**扩展类型**/`ui://` 地址/控制器/齿轮）、设计分辨率、现有规范；`details:true` 展开控制器与齿轮 |
| `fairyui_asset_sheet` | 包内图片渲染成带标签的缩略图总览 PNG，便于按名称选素材 |
| `fairyui_mockup_grid` | 给示意图叠加带刻度的坐标网格，便于量出精确的 `x/y/w/h` |
| `fairyui_guide` | 返回组件识别对照表、节点类型参考、规范文件格式 |
| `fairyui_build` | 按 JSON 布局规格创建/替换元件，写 XML、出预览、返回 `ui://`；保留已有 `extention`，支持 `previewPages`、`indexChanged`、批量 `components` |
| `fairyui_sync_views` | 按 XML 显示列表重生成 C# 视图类（`GetChildAt` 索引与发布一致） |
| `fairyui_check_views` | 校验 XML ↔ 视图类：基类、字段集合、`GetChildAt`/`GetControllerAt` 索引、字段类型 |
| `fairyui_overlay` | 把组件框叠到示意图上，逐像素核对位置与尺寸 |
| `fairyui_template` | 创建扩展组件模板（Button/Label/ProgressBar/Slider/ComboBox/Tree/WindowFrame）或列表项模板 |
| `fairyui_conventions` | 读取/保存规范（默认 `defaults/conventions.json`，项目 `design/conventions.json` 可覆盖） |
| `fairyui_package_create` | 按规范新建空包（`assets/<包>/package.xml`） |
| `fairyui_lint` | 扫描现有包/组件/图片，报告命名违规；支持 `folder`/`components` 聚焦 |
| `fairyui_open` | 用 FairyGUI 编辑器打开工程 |

## 组件识别：示意图元素 → FairyGUI 节点

| 示意图元素 | node type | 关键参数 |
| --- | --- | --- |
| 图片、图标、头像、立绘、背景 | `image` | `asset`=包内文件名，`fit` |
| 纯色块、描边、圆角底板、分割线 | `graph` | `fill/line/lineWidth/corner/shape` |
| 标题、正文、价格、倒计时 | `text` | `text/fontSize/color/align/vAlign` |
| 输入框 | `inputtext` | `prompt/maxLength` |
| 富文本（多色、内嵌图、链接） | `richtext` | `text` 支持 `<font>`/`<img>`/`<a>`，`ubb=true` |
| 背包格、排行榜、任务列表、聊天 | `list` | `defaultItem`=Item 模板，`layout`，`items` |
| 按钮 | `button` | 自动匹配/创建 Button 模板，`title` 写文字 |
| 进度条 | `progressbar` | 自动匹配/创建 ProgressBar 模板，`value`/`max` |
| 滑动条 | `slider` | 自动匹配/创建 Slider 模板，`value`/`max` |
| 标签（文字+可选图标） | `label` | 自动匹配/创建 Label 模板，`title`/`icon` |
| 下拉框 | `combobox` | 自动创建 ComboBox + 选项按钮 + 弹出列表三件套，`items` 给选项 |
| 树 | `tree` | 自动创建 TreeItem + 展开按钮；`items` 带 `level` |
| 窗口 | `window` | 自动创建 Label 扩展的 WindowFrame（`initName="frame"`）+ 关闭按钮 |
| 复选框、页签 | `component` | 复用包内已有扩展组件（Button…） |
| 异步/外部资源 | `loader` | `url`=ui:// 或 http(s)，`fill` |
| 弹窗/面板 | 组件本身 + `graph` 背景 + 子节点 | 关闭按钮用 `button`，遮罩用 `graph` |

识别本身由模型看图完成；插件负责给出这套分类、检查模板是否存在、并把结果落成合法 XML。

### FairyGUI 内置扩展组件

编辑器“扩展”有六种：**Button、Label、ProgressBar、Slider、ComboBox、ScrollBar**。它们不是独立控件，而是靠命名约定给组件加行为：

- 子元件：`title`、`icon`、`bar`/`bar_v`、`grip`、`ani`
- 控制器：`button`（up/down/over/selectedOver/disabled…）；进度/滑动条可选 `progress`
- ComboBox 另需 `dropdown` 弹出组件（内部 `list` + 项目模板）

插件行为：

- `button`/`label`/`progressbar`/`slider` 节点优先复用同扩展的现有组件；
- 没有模板时默认自动创建 `CommonBtn`/`CommonLabel`/`CommonProgressBar`/`CommonSlider`（`autoTemplate:false` 关闭），并写入 `templateFolder`（默认 `Widgets`）；
- 也可用 `fairyui_template` 显式创建并指定颜色、尺寸、标题；
- `combobox` 会创建 `CommonComboBox` + `CommonComboBoxItem` + `CommonComboBoxPopup` 三件套（弹出组件内是 `list`）；
- `tree` 会创建 `CommonTreeItem`（Button + expanded/leaf 控制器 + expandButton）和 `CommonTreeExpand`；
- `window` 会创建 Label 扩展的 `CommonWindowFrame`（`initName="frame"`、拖拽区、标题、关闭按钮）和 `CommonWindowClose`；
- ScrollBar 仍建议复用现有模板，插件不自动生成。

### 控制器 / 关联 / 组 / 滚动容器

```json
{
  "controllers": [{ "name": "tab", "pages": ["推荐", "新品"], "selected": 0 }],
  "scroll": { "overflow": "scroll", "scroll": "vertical", "scrollBar": "auto", "clipSoftness": "0,20" },
  "nodes": [
    { "type": "graph", "name": "bg", "rect": [0, 0, 800, 900], "relations": [{ "sidePair": "width-width,height-height" }] },
    { "type": "group", "name": "g1", "rect": [30, 90, 740, 220] },
    { "type": "graph", "name": "card", "rect": [30, 90, 230, 160], "group": "g1" },
    { "type": "graph", "name": "pageA", "rect": [30, 330, 740, 200], "gears": [{ "type": "display", "controller": "tab", "pages": ["0"] }] },
    { "type": "graph", "name": "pageB", "rect": [30, 330, 740, 200], "gears": [{ "type": "display", "controller": "tab", "pages": ["1"] }] },
    { "type": "button", "name": "tab1", "rect": [30, 560, 160, 56], "title": "推荐", "controller": "tab", "page": "0" }
  ]
}
```

- gear 类型：`display`/`display2`/`xy`/`size`/`look`/`color`/`fontSize`/`icon`/`ani`/`text`，`values` 用 FairyGUI 的 `|` 分隔格式；
- relation 的 `target` 省略表示相对组件自身，`sidePair` 如 `width-width,height-height`；
- 组节点用 `{type:"group"}`，成员节点写 `group:"组名"`；
- 根组件 `scroll` 即滚动容器（无需额外控件）。

## 布局规格

```json
{
  "project": "D:/Game/UI/MyProject.fairy",
  "package": "Main",
  "component": "UI_Shop_Panel",
  "width": 900,
  "height": 640,
  "nodes": [
    { "type": "graph", "name": "bg", "rect": [0, 0, 900, 640], "fill": "#2a2340", "corner": 20 },
    { "type": "text", "name": "title", "rect": [40, 30, 300, 44], "text": "商店", "fontSize": 32, "bold": true, "color": "#ffffff" },
    { "type": "button", "name": "closeBtn", "rect": [820, 24, 56, 48], "title": "X" },
    { "type": "list", "name": "goods", "rect": [40, 100, 520, 420], "defaultItem": "CommonItem",
      "layout": "flow_hz", "lineGap": 10, "columnGap": 10, "items": [{ "title": "物品1" }] },
    { "type": "richtext", "name": "desc", "rect": [590, 100, 270, 200], "fontSize": 22,
      "text": "<font color='#ffd260'>超值特惠</font>" },
    { "type": "inputtext", "name": "code", "rect": [590, 330, 270, 44], "prompt": "输入兑换码" },
    { "type": "loader", "name": "banner", "rect": [590, 400, 270, 120], "url": "ui://xxxx" }
  ]
}
```

- `nodes` 顺序即 z-order（先写的在底层）；通用字段：`rotation`、`alpha`、`pivot`、`touchable`、`grayed`、`customData`（写入 FairyGUI“自定义数据”，如全屏背景的 `fill1`）。
- `folder`（工具参数）：元件写入包内哪个文件夹，如 `Panels`/`Widgets`；省略时用规范的 `componentFolder`（默认 `Panels`），再缺省为包根。实例引用的元件会写 `fileName`（`Widgets/CommonBtn.xml`），与编辑器格式一致。
- 文本/富文本/输入文本默认写 `autoClearText="true"`（发布时清除文本），列表/树默认写 `autoClearItems="true"`（发布时自动清空）；需要保留时传 `autoClearText:false` / `autoClearItems:false`。
- 图片九宫格：image 节点传 `scale9grid:"左,上,右,下"`（如 `"10,12,10,12"`），写回图片资源 `scale="9grid" scale9grid="..."`，拉伸时按九宫格绘制。
- 自动创建的模板写入规范的 `templateFolder`（默认 `Widgets`），新导入图片写入 `imageFolder`（默认 `Images`）。
- `list` 的 `layout` 可取 `row`/`flow_hz`/`flow_vt`/`pagination`，省略为单列；`defaultItem` 也接受 `ui://`。
- `button` 未指定 `asset` 时自动找包里第一个 Button 扩展组件；没有则报错并提示先在编辑器里建模板。
- 跨包引用元件：`asset` 写 `包名/元件名`（如 `Common1/CommonBtn`），实例自动带 `src`、`fileName` 和源包 `pkg`；`list` 的 `defaultItem`、`tree` 模板同样支持。不写包名时只在目标包内查找。
- `extention`：给组件根节点写扩展类型（`Label`/`Button`/`ProgressBar`/`Slider`/`ComboBox`/`ScrollBar`/`none`）。**省略时保留磁盘上已有的 `extention`**，新建组件为无扩展；传 `none` 移除。spec 里出现保留名（`icon`/`title`/`bar` 等）但组件没有扩展类型时会给出 warning。
- `previewPages`：`{控制器名: 页id}`，预览按指定页应用 `gearDisplay`/`gearColor`/`gearIcon`/`gearXY`/`gearSize`，多态组件能看到非默认态。
- 覆盖已有组件时返回 `indexChanged:[{name, from, to}]`（匿名 `n1`/`n2` 不计入），并 warning 提示重跑 `fairyui_sync_views`。
- 批量：`components:[名称 | {component, nodes, width, height, folder, extention, controllers, scroll, exported}]`，每项独立返回，单项失败不中断其它。
- `infos`：`loader has no url`、`text is empty` 属于运行时赋值，不再算 warning，统一放进 `infos`；传 `expectEmpty:["节点名"]` 可完全静默。
- `richtext` 的预览只显示纯文本（标记会被剥离），最终渲染以编辑器为准。

## 视图类：生成与校验

`fairyui_sync_views` 按组件 XML 的显示列表重生成 C# 视图类，规则与 FairyGUI 发布器一致：

1. 基类：`Label→GLabel`、`Button→GButton`、`ProgressBar→GProgressBar`、`Slider→GSlider`、`ComboBox→GComboBox`、无→`GComponent`；
2. 保留名 `icon`/`title`/`bar`/`bar_v`/`grip`/`ani`/`arrow1`/`arrow2` 不生成字段；
3. 匿名名（`^n\d+$`，如 `n1`、`n15`）不生成字段但**占显示索引**；
4. 组件实例：本包用 `fileName` 的类名；跨包（`pkg` 属性是包 id）先查各包 `package.xml` 换成包名，输出 `Common1.CommonBtn`；
5. `URL = ui://<包id><元件id>`，`PATH = "<包名>/<元件名>"`；
6. 控制器按出现顺序 `GetControllerAt(i)`；
7. 文件为 `utf-8-sig` + `CRLF`，输出到 `<工程>/../Code/Game/Scripts/UI/View/<包名>/`（`codeRoot` 可覆盖）。

`fairyui_check_views` 反向比对 XML 与 `.cs`：基类、字段集合（多/少都报）、`GetChildAt` 索引、字段类型、`GetControllerAt` 索引；省略 `components` 时检查整包。两个工具都支持 `components` 数组，批量时逐组件返回结果。

## 命名与包管理规范

插件自带默认规范 `defaults/conventions.json`，内容取自 `E:\ATT\开发流程.md` 第 3 节「UI 开发相关」（Ctt 客户端工程的 FairyGUI 规范，原文已整理到 `defaults/conventions.md`）。项目内 `<工程>/design/conventions.json` 存在时以项目规范为准，否则自动套用默认规范；用户上传的原文另存为 `design/conventions.md`。

默认规范（摘要）：

```json
{
  "componentNamePattern": "^[A-Z][A-Za-z0-9]*(_(Window|MiniWindow|Bg|Tip|MsgBox|SysBox|ConstWindow|LoadingWindow|Guide))?$",
  "packageNamePattern": "^[A-Z][A-Za-z0-9]*$",
  "imageNamePattern": "^[A-Za-z0-9_().-]+$",
  "nodeNamePattern": "^(lb|btn|list|img|icon|bg|ld|input|gra|graph|sp|spine|com|item|sld|pro|bar|group|G)_[A-Za-z0-9_]+$",
  "requireExported": true,
  "autoPrefixNodeNames": false,
  "notes": "<业务名>_<类型后缀> 后缀表、m_ 前缀规则、子控件前缀、扩展保留名、包/目录约定、发布勾选项……"
}
```

- 结构化字段：`componentNamePattern`、`packageNamePattern`、`imageNamePattern`、`nodeNamePattern`、`defaultPackage`、`packageRules`（按组件名选包）、`componentFolder`/`templateFolder`/`imageFolder`（写入目录，本规范不设置 = 写包根）、`nodeNamePrefixes` + `autoPrefixNodeNames`（按类型加前缀）、`requireExported`、`notes`。
- 无法结构化的条款（`_Window`/`_MiniWindow`/… 九种后缀的类名与 UIType、`m_` + name 的字段规则、子控件前缀表、扩展保留名、Controller 页名、包内目录布局、`fill`/`Common`/`Dynamic` 图集、发布勾选项、代码生成流程）写在 `notes`，同时进入 `fairyui_guide`。
- 查看：`fairyui_conventions`（action=`show`，返回 `source: project | custom | bundled-default`）。
- 覆盖：`fairyui_conventions`（action=`save`，`rules` 只需写要覆盖的字段，`sourceText` 存原文）。
- 规范来源**永远显式**：`fairyui_build` / `fairyui_lint` 返回 `conventions:{source, path}`；用内置默认规范时 `source = "bundled-default"`，且 `warnings[0]` 固定为「⚠️ 正在使用内置默认规范（未找到 <工程>/design/conventions.json）…」——此时命名检查结果不可信，不再静默回退。
- `conventionsPath`（build/lint）：指向任意路径的 `conventions.json` 正本，优先级 入参 > 工程 `design/` > 内置。
- 生效：`fairyui_build` 校验组件名/节点名、按 `packageRules`/`defaultPackage` 选包、按 `folder`/`componentFolder` 落盘、按前缀重命名节点、决定 `exported`；`ignoreConventions: true` 可单次绕过。扩展保留名（`icon`/`title`/`bar`…）不会被前缀重命名，也不报节点命名违规。
- 检查：`fairyui_lint` 按生效规范报告包/组件/图片命名违规；`folder` 只看某个子目录，`components` 只校验指定元件；只有在规范配置了 `componentFolder`/`templateFolder` 时才额外报告「元件留在包根」的目录违规。
- 新建包：`fairyui_package_create`，包名同样受 `packageNamePattern` 约束，并预建规范里配置的 `Images`/`Widgets`/`Panels` 目录（本规范未配置，因此不建子目录）。

## 典型流程

1. `fairyui_mockup_grid` 给示意图加网格 → `read_image` 读取并量坐标。
2. `fairyui_guide`/`fairyui_inspect` 确认组件类型映射、模板与现有规范。
3. 用户上传规范文档时，解析为 rules 并 `fairyui_conventions` 保存。
4. `fairyui_build` 生成并出预览；`read_image` 对比示意图，修正后再次 build。
5. 覆盖已有组件出现 `indexChanged` 时，用 `fairyui_sync_views` 重生成视图类，再用 `fairyui_check_views` 确认一致。
6. `fairyui_overlay` 把组件框叠到示意图上，逐像素核对。
7. `fairyui_lint` 自查命名；`fairyui_open` 在编辑器复核/发布。

## 安装（换电脑 / 分发）

插件是**纯 ESM + PowerShell 脚本，没有 npm 依赖**，拷贝目录即可。

### 环境要求

- Windows（预览/资源总览/网格用 PowerShell + GDI+；FairyGUI 编辑器本身也是 Windows 程序）
- 已安装 DSH，并能访问 `plugin_manager`
- 已安装 FairyGUI 编辑器（默认找 `D:\FairyGUI\FairyGUI-Editor.exe`）

### 步骤

1. 把整个 `dsh-fairyui` 目录拷到目标电脑（保持 `index.js`、`lib/`、`defaults/`、`locale/`、`icon.svg`、`package.json`、`cordis.patch.yml` 的相对结构；`lib/*.ps1` 不能少）。
2. 在目标机器的 DSH 中安装本地 bundle。

   **方式 A（推荐）：让 Agent 装。** 打开 DSH 新建会话，把下面这段直接发给它：

   > 帮我安装本地插件 bundle：`D:\path\to\dsh-fairyui`。用 `plugin_manager` 的 `install_bundle`，target 用这个绝对路径；装完确认插件行已启用（entryId 形如 `include:dsh-fairyui`），再调用 `fairyui_guide` 验证 `fairyui_*` 工具可用。这个安装需要 Full access 权限。

   如果当前会话权限不足，先把 DSH 的权限/会话切到 Full access（插件安装属于需要授权的高权限操作），否则调用会被拒绝。

   **方式 B：命令行。**

   ```
   dsh plugin --profile <profile> add link:D:\path\to\dsh-fairyui
   ```

   `plugin_manager` 的等价写法：

   ```
   plugin_manager install_bundle target=D:\path\to\dsh-fairyui
   ```

3. 确认插件行已启用（entryId 形如 `include:dsh-fairyui`）；被禁用时：

   ```
   plugin_manager set_plugin target=include:dsh-fairyui enabled=true
   ```

4. 若编辑器不在默认路径，在 profile 的 `cordis.patch.yml` 里覆盖配置：

   ```yaml
   - id: dsh-fairyui
     config:
       editorPath: "C:\\Apps\\FairyGUI\\FairyGUI-Editor.exe"
   ```

   保存后重载插件（disable → enable）或重启 DSH。

5. 验证：调用 `fairyui_guide`（应返回组件对照表），再对任意 `.fairy` 工程调用 `fairyui_inspect`。

   也可以直接发给 Agent：

   > 用 `fairyui_guide` 确认插件已加载，再对 `D:\path\to\Project.fairy` 调用 `fairyui_inspect`，把包、图片和元件列出来。

### 升级 / 卸载

- 升级：替换目录里的 `index.js`/`lib` 后，把插件 disable → enable 让新模块生效（本地 link 安装不需要重新 pnpm）。
- 卸载：`plugin_manager remove_bundle target=dsh-fairyui`，或只禁用插件行。
- 规范与生成物都在 **FairyGUI 工程内**（`design/conventions.json`、`.dsh-fairyui/`），不依赖安装机器，随工程一起拷走即可。

## 限制

- 预览是 GDI+ 近似渲染：列表/树仍画占位框，按钮/组件实例会递归展开成图片/文本/图形（跨包同样展开，解析不了时退回占位框），富文本只显示纯文本，九宫格图片按整图拉伸；最终效果以编辑器/运行库为准。
- 自动创建的扩展模板是最小结构（单态按钮、纯图形进度条/滑动条），不含多态 `gear`、控制器联动、动效；需要精细交互时在编辑器里完善。
- 自动生成的 ComboBox 弹出列表、窗口与树都是基础样式，实际项目可替换为美术模板；ScrollBar 不自动生成。
- 需要 Windows（PowerShell + GDI+，FairyGUI 编辑器本身也是 Windows 程序）。
- 发布（`.fui` 与图集）仍由 FairyGUI 编辑器完成。
