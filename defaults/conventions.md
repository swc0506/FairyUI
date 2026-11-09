# FairyGUI 使用规范（Ctt 客户端工程）

- 来源：`E:\ATT\开发流程.md` 第 3 节「UI 开发相关」（原工程 `D:\Work\DH\Publish2.0Android`，本机工程根目录 `E:\ATT\Ctt`）
- 用途：dsh-fairyui 的默认规范。工程内 `Client/Logic/UIProject/design/conventions.json` 存在时以工程规范为准；否则自动使用 `defaults/conventions.json`。
- 结构化字段无法表达的条款（后缀语义、目录布局、发布勾选项、代码生成流程）已写入规范 `notes`，由 `fairyui_guide` / `fairyui_inspect` 一并返回。

## 1. 组件命名：`<业务名>_<类型后缀>`

FGUI 组件的**文件名**决定生成的类名、UI 类型和层级，格式固定为 `<业务名>_<类型后缀>.xml`：业务名 + 一个下划线 + 类型后缀，**业务名内部不能再出现下划线**。

| 后缀 | UIType | UILayer | 生成类 / 文件 | 适用场景 |
| --- | --- | --- | --- | --- |
| `_Window` | `Window` | `Common` | `XxxWindow` / `XxxWindow.cs` | 全屏功能界面，堆叠显示，禁用下层界面 |
| `_MiniWindow` | `MiniWindow` | `Common` | `XxxWindow` / `XxxWindow.cs` | 非全屏弹窗、二级界面，不阻断下层操作 |
| `_Bg` | `BG` | `Bg` | `XxxWindow` / `XxxWindow.cs` | 主界面 / HUD 背景层，最底层 |
| `_Tip` | `Tip` | `Tip` | `XxxWindow` / `XxxWindow.cs` | 高层提示、飘字、Tips，不抢焦点 |
| `_MsgBox` | `MsgBox` | `MsgBox` | `XxxWindow` / `XxxWindow.cs` | 普通确认框 |
| `_SysBox` | `SysBox` | `SysBox` | `XxxWindow` / `XxxWindow.cs` | 系统级确认框，始终可交互 |
| `_ConstWindow` | `ConstWindow` | `MsgBox` | `XxxWindow` / `XxxWindow.cs` | 常驻窗口，位于普通窗口之上 |
| `_LoadingWindow` | `LoadingWindow` | `Common` | `XxxWindow` / `XxxWindow.cs` | 加载界面 |
| `_Guide` | `Guide` | `Guide` | `XxxWindow` / `XxxWindow.cs` | 新手引导层 |
| 无后缀 | — | — | `Xxx` / `XxxView.cs` + `Func/Xxx.cs` | 子组件、列表项、按钮模板等 |

**所有窗口类型的类名统一以 `Window` 结尾，后缀会被截掉**：

```
BagItemUse_MiniWindow.xml  →  class BagItemUseWindow
Main_Bg.xml                →  class MainWindow
CommonTips_Tip.xml         →  class CommonTipsWindow
```

命名硬规则：

1. **后缀大小写敏感**：`_MiniWIndow`、`_Miniwindow`、`_window` 都不会被识别，不会生成窗口代码。
2. **业务名在同一个包内必须唯一**：`Foo_Window` 和 `Foo_MiniWindow` 都会生成 `FooWindow`，文件互相覆盖。
3. **普通组件、列表项不要加 `_Item`、`_Com` 后缀**，直接写 `BagTableItem.xml`。带未识别后缀且有下划线的组件**不会生成任何代码**。
4. 文件名必须是合法 C# 标识符：英文开头，只含字母数字，不能有中文、空格、横线，不能数字开头。
5. 需要代码访问、被其他组件引用或被列表使用的组件，必须勾选**导出**（`exported="true"`），否则不生成类。
6. 组件内至少要有**一个改过名的子控件**，否则即使导出了也不会生成类。
7. 包名（目录名）直接作为命名空间与代码目录：`ET.Client.<Package>`、`UIModule/<Package>`，用 PascalCase，不要空格、横线（也避免下划线），确定后不要改。
8. 以 `DpRes` 开头的包按纯资源包使用，一般不在其中写 UI 代码。

## 2. 子控件命名

生成器规则：**C# 字段名 = `m_` + FGUI 控件的 `name`**。

- FGUI 里**不要自己写 `m_` 前缀**，否则生成 `m_m_xxx`（老界面已有此写法，新界面避免）。
- 需要代码访问的控件必须**改掉默认名**；FGUI 默认名（`n0`、`n13` 等，name 等于 id）会被忽略。
- `name` 必须是合法 C# 标识符，且在同一组件内唯一。
- 扩展组件保留名不要挪作他用，这些不会生成独立字段：
  - Button：`icon`、`title`
  - ComboBox / Label：`title`
  - ProgressBar：`bar`、`bar_v`、`ani`
  - Slider：`bar`、`bar_v`、`grip`、`ani`
  - ScrollBar：`arrow1`、`arrow2`、`grip`、`bar`

推荐前缀（新界面统一使用）：

| 前缀 | FGUI 控件 | 生成的 C# 类型 | 示例 |
| --- | --- | --- | --- |
| `lb_` | 文本 / 富文本 | `GTextField` / `GRichTextField` | `lb_title`、`lb_none` |
| `btn_` | 按钮或按钮组件 | `GButton` | `btn_sort`、`btn_close` |
| `list_` | 列表 | `GList` | `list_goods`、`list_tab` |
| `img_` | 图片 | `GImage` | `img_bg`、`img_icon` |
| `icon_` | 图标 Loader | `GLoader` | `icon_quality` |
| `bg_` | 背景图 / Loader | `GImage` / `GLoader` | `bg_item` |
| `ld_` | 通用 Loader | `GLoader` | `ld_choose` |
| `input_` | 输入框 | `GTextInput` | `input_msg` |
| `gra_` / `graph_` | 图形、遮罩、点击区 | `GGraph` | `gra_click`、`mask` |
| `sp_` / `spine_` | Spine / 3D Loader | `GLoader3D` | `spine_card` |
| `com_` / `item_` | 自定义子组件 | 对应生成类 / `GComponent` | `com_head`、`item_cost` |
| `sld_` / `pro_` / `bar_` | 滑动条 / 进度条 / 滚动条 | `GSlider` / `GProgressBar` / `GScrollBar` | `sld_volume` |
| `group_` / `G_` | 高级组（advanced group） | `GGroup` | `group_collect` |

老界面里的 `lab_`、`txt_`、`text_` 等前缀保留不动，新界面统一用 `lb_`。

## 3. 按钮、列表、控制器

- **按钮**：生成器自动绑定 `m_btn_xxx.onClick` 并生成 `OnClick<控件名>`，逻辑写 `WindowLogic` / `Func`，不要在 `BindEvent` 里重复绑定。
- **列表**：按 `list_<业务名>` 命名，生成 `<业务名>RenderListItem` 渲染函数与 `OnClick<业务名>RenderListItem`；同一窗口内业务名不能重复。列表项模板用无下划线命名（如 `BagTableItem`），渲染函数自动 `cast` 并调用 `Init(this)`。
- **Controller / Transition**：命名用 PascalCase，字段为 `m_<name>`；Controller 的页名会生成为 `public const int <页名>`，Transition 标签会生成 `TransitionHook__<标签>`，都必须是合法 C# 标识符。

## 4. 包与目录

- 包名（`assets/<Package>`）：PascalCase，`ET.Client.<Package>` / `UIModule/<Package>`，不要空格横线，确定后不随意改。
- 包内目录：新包统一 `Panels/`（窗口）、`Widgets/`（控件）、`Images/`（图片），参考图放 `示意图/`；老包（`Base`/`Login`/`NewCommon` 等）沿用 `Button`、`Progress`、`Text`、`Btn`、`Component`、`Tips` 等既有布局。生成代码只用文件名（`resName`），组件放在哪个子目录不影响 `[UIRes]`，但同一个包里不要两处混放；`fairyui_build` 不传 `folder` 即写包根。
- `DpRes` 开头的包为纯资源包，一般不写 UI 代码。

## 5. 发布与运行时

- 文本 / 富文本 / 输入文本勾选「发布时清除文本」（`autoClearText`）：多语言统一走配置表，不用内部 xml。
- 虚拟列表勾选「发布时自动清空」（`autoClearItems`），避免初始化时生成默认脏数据。
- 铺满屏幕的大背景在「自定义数据」写 `fill` 关键字：`fill`/`fill0` 只处理刘海屏位置，`fill1` 等比缩放，`fill2` 直接拉伸。
- 公共图集放 `Common`、`Common1`、`Common2`…（数字越小跨包引用越多）；超过 512x512 的大图不打图集，放 `Assets/Res/UIImages`，用 Loader 填路径；小图标按模块建 `Dynamic`+模块名 图集（如 `DynamicItem`），Loader url 写 `ui://DynamicItem/10350` 形式。
- 所有资源（组件、图片等）名称不得使用中文，只能用英文或拼音。

## 6. 代码生成流程

1. FGUI 编辑器里按上面的规则建包与组件（出码不要求先发布）。
2. Unity 菜单 **FGUI → FGUI Tool**：先 **LoadUIResource**，再点目标包按钮或 **SpawnAllUIPageCode**。生成器直接读 `Client/Logic/UIProject/assets` 下的源 XML，不依赖发布产物。
3. 发布（FGUI 编辑器 Publish）输出到 `Client/Unity/Assets/Bundles/UIRes/UIPackage`：`<包名>_fui.bytes` + 图集，只决定运行时能否加载；漏发布 → 打开窗口时 `uiSkin == null`。
4. 业务逻辑只写 `*WindowLogic.cs`（含 `*WindowLogic_List.cs` 标记区间）与 `Func/*.cs`；`UIModule/Auto` 每次生成整体删除重建，不要在里面写业务。
5. 生成结果不对时依次检查：是否导出 / 后缀大小写 / 是否有改过名的子控件 / 文件名非法字符或多余下划线；字段为 null 检查控件是否改名；`uiSkin == null` 检查是否已发布与 `[UIRes]` 的包名、资源名。
