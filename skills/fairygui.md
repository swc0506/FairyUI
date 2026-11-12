# FairyGUI 制作手册

面向「用 XML / fairyui_* 工具制作和修改 FairyGUI 界面」的工作手册。内容整理自 FairyGUI 官方编辑器文档（39 页）与 FairyGUI-unity 官方示例工程（30 个示例、SDK 源码、UIProject XML）。

## 0. 第一原则

1. **名字就是契约**：子元件名（`title`/`icon`/`frame`/`closeButton`…）、控制器名（`button`/`c1`/`expanded`）、过渡名（`t0`）、资源 URL 都会被运行时代码字符串引用；改名等于改代码。
2. **布局用宽高，效果用 Scale**：九宫格与关联只在改宽高时生效；Scale 是整体缩放，九宫格失效、组件内关联不生效。
3. **匿名名占显示索引**：`n0`/`n17` 这类默认名不生成 C# 字段，但占用 `GetChildAt(i)` 索引；在中间插入匿名底板会让后面所有字段位移（必须重生成视图类）。
4. 不确定就先 `fairyui_inspect`（`details:true` 看控制器/齿轮），再动手。

## 1. 工程与文件模型

```
<工程>.fairy                      # 项目标识（文件名=项目名）
assets/<包名>/package.xml         # 包资源清单
assets/<包名>/<子目录>/<组件>.xml # 每个组件一个 XML
assets_<分支>/...                 # 分支内容（只放与主干有差异的资源）
settings/                         # 适配、发布等配置
.objs/                            # 编辑器内部数据，不要进版本库
```

- `package.xml`：`<packageDescription id="8位包id">`；`<resources>` 里每条资源有 `id`（约 5 位）、`name`（组件带 `.xml`、图片带扩展名）、`path`、`exported`、图片可带 `scale="9grid" scale9grid="l,t,r,b"`；`<publish name="包名">` + `<atlas name index>`。`path="/components/"` 对应磁盘 `assets/<包>/components/`。
- 运行时 URL 两种形态：`ui://<包名>/<资源名>`（代码侧，包名= publish name）与 `ui://<8位包id><5位资源id>`（编辑器内部/发布数据，`src`/`defaultItem` 也用 id 形式）。
- **导出 `exported="true"` 的条件**：跨包引用、代码动态创建、生成视图类；**同包内 `src`/`defaultItem` 引用不要求导出**，列表项组件也常不导出。窗口框架组件不必导出，但**窗口内容组件必须导出**（`Main` 一般导出）。
- 包依赖不自动加载：A 包引用 B 包的导出组件时，运行时必须先 `UIPackage.AddPackage` 载入 B。
- 发布产物：`<包名>_fui.bytes`（Unity 固定扩展名 bytes）+ `<包名>_atlas0.png`…；用 `UIPackage.AddPackage("UI/包名")` 加载。
- 分支：`assets_<分支>` + `package_branch.xml`；运行时 `UIPackage.branch = "en"` 必须在 `AddPackage` 之后、创建任何 UI 之前。
- TTF 字体无论是否导出都不会随包发布，需手动放到引擎并注册（Unity `FontManager.RegisterFont`）。

## 2. 显示列表与命名

### 组件 XML 骨架（顺序固定）

`<component size="W,H" [extention="…"][initName]/>` → `<controller>`* → `<displayList>` → 扩展尾元素（`<Button/>`、`<ProgressBar/>`、`<ComboBox dropdown="ui://…"/>` 等）→ `<transition>`*。

- **没有** `<inputtext>`、`<tree>`、`<window>`、`<button>` 这类标签：输入文本是 `<text input="true">`，树是 `<list treeView="true">`，窗口靠 `extention` + 节点命名，按钮靠 `extention="Button"` + 尾元素。
- 组件内每个节点都要有唯一 `id`；`name` 与 `id` 相同（`name="n0"`、`name="n17"`）即**匿名件**：不生成代码字段，但占显示索引。
- 裁剪/滚动/遮罩/命中写在组件**根属性**：`overflow`、`scroll`、`scrollBar`、`scrollBarFlags`、`margin`、`mask`+`reversedMask`、`hitTest`、`opaque`、`bgColor`；不要造子节点。

节点通用属性：`id`、`name`、`xy`、`size`、`pivot`（0~1）、`rotation`、`alpha`、`visible`、`touchable`、`grayed`、`customData`、`group`。数组顺序即 z-order（先写的在底层）；`<group>` 写在成员之后。

- **匿名名**：`n` + 数字（`n0`、`n17`）→ 不生成字段但占索引；显示列表里被 gearDisplay 隐藏的元件也不会移除，`GetChild` 永远拿得到——所以索引稳定。
- **保留名**（扩展组件子元件，不能改名、不能加前缀）：`icon`、`title`、`bar`、`bar_v`、`grip`、`ani`、`arrow1`、`arrow2`。
- **组件实例**：`<component src="元件id" fileName="Widgets/X.xml" pkg="源包id" size xy/>`；`pkg` 存的是**包 id**（工具里写 `包名/元件名` 会自动换算）。
- **关系**：`<relation target="目标名或空" sidePair="left-left,width-width"/>`，`target=""` 表示相对父容器。
- **组**：普通组只在编辑期有效、发布后不存在；高级组（`advanced="true"`）发布后保留为 `GGroup`，支持显示/位置/大小控制与布局（无/水平/垂直）。组不是容器，遍历成员要比较 `group` 属性；无布局的高级组运行时不自动改大小，需要时 `EnsureBoundsCorrect()`。

## 3. 控件速查

### image 图片
- 资源：像素尺寸（SVG 需手填）、九宫格（四角不变形/四边单向/中间双向）、平铺、纹理集、重复边缘像素、裁剪边缘空白、@2x/3x/4x。
- 实例：颜色、亮度、翻转、填充方法。
- XML：`<image src size xy aspect="true" flip="hz"/>`；**九宫格只写在 package.xml 的图片资源行**（`scale="9grid" scale9grid="l,t,r,b"`，四元组取自原图像素），节点上写 `scale9grid` 无效——生成器要改九宫格必须改资源行。
- 坑：图片不可点击；九宫格只在改宽高时生效。

### graph 图形
- 类型：矩形/圆形/正多边形/多边形/`无`（纯占位，不挡点击）。
- XML：`<graph type="rect|eclipse" size xy lineSize lineColor fillColor corner/>`；圆角可 1 个或 4 个逗号分隔。
- 坑：空白图形不挡点击，全透明（alpha=0）图形挡；多边形顶点必须顺时针。

### movieclip / skeleton / loader3d
- 动画=序列帧 `.jta`；不可点击；**不支持纹理分页**（开自动分页可能发布报错，需单独纹理集）。
- 骨骼：Spine 3.8+ / 龙骨；着色器与「贴图是否已预乘」必须成对匹配；Unity 需 `FAIRYGUI_SPINE` / `FAIRYGUI_DRAGONBONES` 与 Always Included Shaders。
- 这三种本插件不提供节点类型：需要时在编辑器里放置，或用 `loader` 承载。

### loader 装载器
- 用途：动态换图/动画/组件、可点击、可外部加载。
- XML：`<loader url="ui://包名/资源名" fill="scale|scaleFree|scaleNoBorder|none" aspect="true" align vAlign/>`；URL 可勾「发布时自动清空」留给代码。
- `GLoader.url` 只看前缀：`ui://` = 包内资源；其它 = `Resources.Load`（外部路径）。写成外部路径的图标空白但不报错。
- 坑：装载器没有剪裁，超出要放进「溢出隐藏」组件；动态创建必须先 SetSize；自动大小时填充处理失效。

### text 文本
- XML：`<text fontSize color align vAlign autoSize singleLine autoClearText text/>`；输入文本是 `<text input="true" prompt maxLength singleLine>`。
- autoSize：自动宽高/自动高度/自动收缩/显示省略号/无；工具栏：UBB、文本模板 `{key=value}`、粗体/斜体/下划线、**仅编辑器预览 = autoClearText**。
- 模板优先于 UBB；模板变量运行时 `SetVar(...).FlushVars()`。
- 坑：位图字体要动态改字号/颜色，必须在字体资源勾「允许动态改变字号/颜色」；文本不可交互；字距 H5 不支持。

### richtext 富文本
- 可交互、可点击链接、可图文混排、支持 HTML；autoSize 无「显示省略号」。
- HTML：`<a href='x'>`、`<img src='ui://...'/>`（必须自闭合）、`<input type='button|text'/>`、`<select>`；链接点击事件冒泡。
- XML：`<richtext ubb="true|false" .../>`；坑：`<img>` 写成 `>` 不生效。

### inputtext 输入文本
- 最大长度（0 不限）、密码、输入限制（Unity 用正则如 `[0-9]`）、键盘类型、提示文字（可带 UBB 颜色）。
- 坑：手机键盘完成键不可控，onSubmit 仅 PC。

### font 字体
- 系统字体 / TTF / 位图字体（图片字符集）；Unity 另有 TextMeshPro(SDFAA)。
- 坑：位图字体两个「允许动态改变字号/颜色」；BMFont 只支持 fnt；TMP 采样字号必须与编辑器一致。

## 4. 扩展组件（六种内置类型）

| 扩展 | 基类 | 子元件约定 | 规则 |
| --- | --- | --- | --- |
| Label 标签 | GLabel | `title`（文本/富文本/标签/按钮）、`icon`（装载器/标签/按钮） | 只为实例化提供标题/图标入口；缺子元件静默无效 |
| Button 按钮 | GButton | `title`、`icon`；控制器必须叫 `button` | 页面 `up/down/over/selectedOver/disabled/selectedDisabled`；模式 普通/单选/复选；`连接`（控制器+页面）实现单选组/Tab |
| ComboBox 下拉框 | GComboBox | 显示区按钮 + `dropdown` 弹出组件（背景 + **必须命名 `list`** 的列表） | `visibleItemCount` 控制弹出高度；`选择控制` 双向同步；列表项可勾「发布时清空」 |
| ProgressBar 进度条 | GProgressBar | `bar`（横向）/`bar_v`（纵向）/`title`/`ani` | bar 的宽/高必须设成满值尺寸；反向时右/底边固定 |
| Slider 滑动条 | GSlider | `bar`/`bar_v`/`title`/`grip` | grip 必须与 bar 建关联并摆在满值位置（正向 `left-left`，反向 `top-top`） |
| ScrollBar 滚动条 | GScrollBar | `arrow1`/`arrow2`/`grip`/`bar`（空白图形占位） | 由滚动容器自动创建，**不要拖到舞台上用** |

- 扩展全靠名称约定：缺 `title`/`icon`/`button` 控制器时能力静默失效，不报错。
- 按钮按下缩放会自动把轴心设为 (0.5,0.5)；按下变暗会覆盖内部图片颜色。
- 扩展类注册 `UIObjectFactory.SetPackageItemExtension(url, typeof(X))` 必须在该组件构建前（UIPanel 的 Awake）。

## 5. 控制器与齿轮

- `<controller name="..." pages="0,页名,1,页名" selected="n"/>`；页 id 是数字，`pages` 存页 id。
- `首页`：第一页 / 指定页面 / 匹配分支名称 / 匹配变量名称（`UIPackage.SetVar`）。
- `导出为组件属性` 后实例检查器可见；`动作`：切页时播动效或切其他控制器页面（"相同索引/相同名称的页面"用于同步）。
- gear 类型与 XML 标签：

| 齿轮 | XML | 作用对象 | 说明 |
| --- | --- | --- | --- |
| 显示控制 | `gearDisplay` | 任意 | `pages` 列出可见页；与元件 `visible` 是"与"关系 |
| 显示控制-2 | `gearDisplay2` | 任意 | 可设"与/或"，两个控制器共同控制显隐 |
| 位置控制 | `gearXY` | 任意 | 支持百分比坐标与缓动 |
| 大小控制 | `gearSize` | 任意 | 宽、高、ScaleX、ScaleY |
| 外观控制 | `gearLook` | 任意 | 透明度/变灰/旋转/不可触摸；只有透明度和旋转参与缓动 |
| 颜色控制 | `gearColor` | 图片/文本/装载器 | `values="#848484,#000000|#ffffff,#000000"` |
| 文本控制 | `gearText` | 文本/富文本/标签/按钮/下拉框 | |
| 图标控制 | `gearIcon` | 装载器/标签/按钮 | `values="ui://...|ui://..."` |
| 动画控制 | `gearAni` | 动画/装载器 | 改 playing/frame |
| 字体大小 | `gearFontSize` | 文本类 | |

- 按钮联动：普通按钮点击跳页；单选按钮选中时跳页，控制器进出该页也会同步按钮选中态（用它做 RadioGroup/TabControl，FairyGUI 没有专门复合组件）。
- 代码里优先只切 `controller.selectedIndex`，视觉全部交给齿轮；`GetGear(n)`：0 显示、1 位置、2 大小、3 外观、4 颜色、5 动画、6 文字、7 图标。
- 想临时去掉缓动：`GearBase.disableAllTweenEffect = true`，用完复原。

## 6. 关联系统（relation）

- `X->Y` = 保持 A 的 X 边与目标 Y 边的距离；"延展"类会改 A 的宽/高；`right-*` 系列在 A 自身改宽时也会移动以保持距离。
- 水平：`left-left`、`left-center`、`left-right`、`center-center`、`right-left`、`right-center`、`right-right`、`left-left-ext`…、`width-width`；垂直同理（`top-*`、`bottom-*`、`height-height`）。
- 编辑器里可勾 `%` 改为比例距离（居中记 50%）。
- 坑：关联≠对齐（只保持既有距离，初始位置仍要自己摆）；给容器设"右延展"后容器宽度被内容锁死；关联没有保持宽高比能力（图片用装载器填充模式）；满屏要先 `SetSize(GRoot.width, GRoot.height)` 再加 Size 关联。

## 7. 列表 / 树 / 滚动容器

### list
- 布局：`单列`（column）/`单行`（row）/`横向流动`（flow_hz）/`竖向流动`（flow_vt）/`分页`（pagination）；行数/列数只对流动与分页有效，0=不限；行距/列距可负。
- 溢出处理与布局独立（单行列表配垂直滚动会滚不动）。
- 选择模式：无/单选/多选(shift)/多选(单击)；**item 参与单选的前提是它是 Radio 按钮**，列表的"选择控制"要绑组件内控制器，且页数 ≥ 项数。
- `项目资源`（defaultItem）= 默认 item 组件（ui://）；支持混排（itemProvider）；`自动调整列表项目大小`、`折叠隐藏的项目`、`点击项目自动滚动到可见`。
- 运行时：对象池 `AddItemFromPool`/`RemoveChildrenToPool`；`itemRenderer` 渲染（可写 `numItems`，`numChildren` 只读）；虚拟列表 `SetVirtual()` 三前提（itemRenderer + 滚动 + defaultItem），只能开不能关，不能用 AddChild/RemoveChild，清空用 `numItems=0`；循环列表 `SetVirtualAndLoop()` 只能虚拟、单行/单列。
- 坑：自动排列会覆盖 item 坐标/大小/深度，别自己设；虚拟 itemRenderer 不能闭包注册事件、不能保存 item 实例做异步回填；item 复用要重设所有可变状态。

### tree
- 列表勾 `树视图`；`每级缩进`、`点击文件夹展开/折叠`（单击/双击）。
- 节点约定：`expanded` 控制器（文件夹展开=页1/折叠=页0）、`leaf` 控制器（文件夹页0/叶页1）、`indent` 对象（宽度=缩进像素）、`expandButton`（Check 按钮，gearDisplay 绑 leaf、checked 绑 expanded）。
- `GTree` 继承 GList，**不支持虚拟化**；`rootNode` 是假节点；`treeNodeWillExpand` 里动态加子节点。

### scrollpane
- 任何组件把 `溢出处理` 设为滚动即成为滚动容器；`滚动条显示`（默认/可见/滚动时显示/隐藏）、`边缘回弹`、`触摸滚动`、`页面模式`（与拖动滚动条互斥）、`禁用剪裁`、`浮动显示`。
- XML 根属性：`overflow="scroll" scroll="vertical|horizontal|both" scrollBar="visible|auto|hidden" margin clipSoftness`。
- API：`scrollPane.posX/posY`、`SetPercX/Y`、`ScrollToView`、`ScrollLeft/Right/Up/Down`；事件 `Scroll`/`ScrollEnd`。

## 8. 窗口 / Popup / 拖放

### window
- 窗口=内容组件 + `Window` 类；内容里放名为 `frame` 的组件（通常扩展为 Label、`initName="frame"`），frame 内约定（全部可选）：`closeButton`（按钮）、`dragArea`（**空白**图形）、`contentArea`（**空白**图形，用于 `ShowModalWait` 局部锁定）、`title`。
- 用法：`win.contentPane = UIPackage.CreateObject("包","内容").asCom; win.Show();`；`Hide` 只隐藏不销毁；`modal=true` 生成模态层。
- 流程钩子：`DoShowAnimation` 结束调 `OnShown`；`DoHideAnimation` 结束调 `HideImmediately`（调错会导致流程卡住）。
- 没有 `frame` 也能显示，但没有关闭按钮、不能拖、等待遮罩铺满整窗。

### popup
- `GRoot.inst.ShowPopup(comp)`（鼠标位置）/`ShowPopup(comp, target)`（目标下方，自动避屏）/`HidePopup()`（不传参关闭所有）。
- `PopupMenu` 容器组件里必须有名为 `list` 的列表，列表溢出处理选**可见**（菜单不要滚动条）。

### dragdrop
- `draggable=true`、`dragBounds`（**舞台坐标**）、`onDragStart/onDragMove/onDragEnd`；目标 `onDrop`，`context.data` 是 StartDrag 的 userData。
- 转换拖动：拖拽区 `draggable` + `onDragStart` 里 `PreventDefault()` 再 `StartDrag(真正对象)`；替身拖动用 `DragDropManager.inst.StartDrag(null, icon, userData, pointerId)`，结束后只能监听 `dragAgent.onDragEnd`。

## 9. 动效 / 适配 / 多语言

### transition
- XML：`<transition name="t0"><item time="0" type="Visible" value="true"/><item time="0" type="XY" tween="true" startValue="391,-" endValue="0,0" duration="9"/></transition>`。
- 类型：位置/大小/透明度/旋转/缩放/倾斜/颜色/动画/轴心/可见性/播放动效/声音/震动/颜色滤镜/文本/图标；帧可加 `label` 供代码 `SetHook`。
- API：`GetTransition("t0").Play()`、`Play(times, delay, start, end)`、`Stop(setToComplete, processCallback)`、`SetValue`/`SetDuration`/`SetTarget`；Unity 可设 `ignoreEngineTimeScale`/`timeScale`。
- 坑：**播完停在最后一帧**（要复原需末尾补一帧）；动效编辑时不能增删元件/改控制器；倒放前必须先正放；改名会让代码取不到。

### adaptation
- 设计分辨率（如 1136×640）→ 全局缩放 → 逻辑屏幕（`GRoot.inst.width/height`）。
- `GRoot.inst.SetContentScaleFactor(1136, 640, ScreenMatchMode.MatchWidthOrHeight|MatchWidth|MatchHeight)`；Unity 也可用 `UIContentScaler` 组件。
- 全屏界面：`MakeFullScreen()` 或 `SetSize(GRoot.inst.width, GRoot.inst.height)` + `AddRelation(GRoot.inst, RelationType.Size)`；内部靠关联布局。
- 坑：`MatchHeight` 时水平可能超出，要留安全区；图片铺满保比例用装载器填充，不要靠关联；`UIPanel.fitScreen` 与 GRoot 缩放两条路不要混用。

### i18n
- 流程：拼界面 → `工具 → 字符串导入与导出` 导出 xml（`name` 是唯一 id 不可改，`mz` 仅提示）→ 翻译 → 运行时 `UIPackage.SetStringsSource(xml)`。
- 语言文件**必须在创建 UI 前载入，不支持实时切换**；切换语言只能销毁 UI、卸载包后重载。
- 翻译键 = 包 id + 资源 id + "-" + **节点 id**（后缀 `-text`/`-prompt`/`-tips`/`-texts_<i>`/`-cp-<target>`，列表项还带序号）；改 `name` 只影响代码字段名，改 `id` 会同时破坏翻译与发布数据锚点——**id 必须稳定唯一**。
- 字体切换的 `Font Name` 只在编辑器生效，代码要设 `UIConfig.defaultFont`。

## 10. 发布与代码生成

- 打包：`发布路径`（支持 `{publish_file_name}`、`{branch_name}`、自定义属性变量）、`扩展名`（Unity 固定 `bytes`）、`使用二进制格式`（3.9+，更紧凑/更快）、`其他分辨率`（@2x/3x/4x）、`分支处理`。
- 纹理集：`最大尺寸`（一般 2048）、`超出后自动分页`、`尺寸选项`（2 的 n 次幂/4 的倍数/不限制）、`允许旋转`、`裁剪图片边缘空白`。
- 图片质量：`JPEG品质`、`压缩PNG`（PNG8，**Unity 不要用**）。
- 发布代码：`允许发布代码`、`组件名前缀`、`成员名称前缀`（建议非空，避免与 `icon` 等基类属性冲突）、`不生成使用默认名称的成员`、`使用名称获取成员对象`（不勾=索引，效率高，推荐）、`包名称`（C# namespace）。
- **动画与位图字体不支持纹理分页**：开自动分页后若被分到不同页会发布报错，必须放单独纹理集。
- 命令行：`FairyGUI-Editor -batchmode -p <project.fairy> [-b 包名] [-t 分支] [-o 输出] [-logFile 日志]`。
- 视图类生成条件：组件导出 + 至少一个改过名的子控件（全是 `n0`/`n13` 默认名则不生成）。
- 生成类基类由 `extention` 决定：`Label→GLabel`、`Button→GButton`、`ProgressBar→GProgressBar`、`Slider→GSlider`、`ComboBox→GComboBox`、无→`GComponent`；字段名=子控件 `name`，`GetChildAt(i)` 用显示索引，控制器 `GetControllerAt(i)` 按声明顺序。
- 使用：先 `XXXBinder.BindAll()`（创建任何 UI 之前），实例用 `XXX.CreateInstance()`，不能 `new`；扩展类注册 `UIObjectFactory.SetPackageItemExtension(Xxx.URL, typeof(Xxx))`。
- 本插件：`fairyui_sync_views` 按发布器规则生成 utf-8-sig + CRLF 到 `<工程>/../Code/Game/Scripts/UI/View/<包名>/`（`codeRoot` 可覆盖）；`fairyui_check_views` 反向校验。

## 11. 运行时契约（官方示例提炼）

代码是"按名字和 URL 找东西"，UI 侧必须先把这些定稿：

1. **初始化顺序**：`UIPackage.AddPackage` → `UIObjectFactory.SetPackageItemExtension` → `UIConfig.*` → `GRoot.SetContentScaleFactor` / `UIPanel.fitScreen` → 取 UI/`CreateObject` → 取子元件/设 `numItems`。扩展类注册必须早于该组件第一次创建。
2. **列表**：`defaultItem` 必须是 `ui://` 地址（不能写文件名或裸组件名；同包可用 id 形式且不要求导出）；虚拟列表要求列表 `overflow=scroll`，顺序 `SetVirtual → itemRenderer → numItems`；循环列表只能单行/单列、不能 flow。
3. **列表选择**：选择控制器的页数 ≥ 项数，item 必须是 Radio 按钮；树的展开/叶子靠 item 的 `expanded`/`leaf` 控制器。
4. **窗口**：内容组件里 `frame`（Label 扩展、`initName="frame"`）+ `closeButton`/`dragArea`/`contentArea`。
5. **下拉/菜单**：ComboBox 的 `dropdown` 容器与 PopupMenu 容器里都必须有名为 `list` 的列表。
6. **适配**：`CreateObject` 出来的组件不会自适应，必须 `MakeFullScreen()`/`SetSize + AddRelation(GRoot.inst, RelationType.Size)`。
7. **loader**：`ui://` 前缀走包内，其它走 `Resources.Load`；混用表现为"图标空白但不报错"。
8. **多语言**：翻译键依赖组件/元素 id，id 不要重置。
9. **过渡**：`GetTransition("t0")` 名字大小写敏感；改子元件名会让过渡静默失效。
10. **复用**：列表 item 会被池化复用，`itemRenderer` 必须重设所有可变状态（文本/图标/选中/`scrollPane.posX`/控制器页）。

### 官方示例 → 结构契约（摘选）

| 示例 | 能力 | UI 侧硬性结构 |
| --- | --- | --- |
| Basics | 全控件总览 | 主界面控制器 `c1`；容器 `container` + gearXY(tween)；入口按钮放进名为 `btns` 的组 |
| Bag | 窗口 + 虚拟列表 + 自定义 Loader | 窗口 `BagWin`；列表 `overflow=scroll` + `defaultItem`；item 是 Button |
| VirtualList | 1000 项虚拟列表 | 列表 `overflow=scroll`；item 不导出也可；itemRenderer 每次重设全部状态 |
| LoopList / Curve | 循环列表 | 单行/单列、`overflow=scroll`、`scrollBar=hidden`；item 为 Button + `icon`，`pivot=0.5,0.5` |
| TreeView | 树 | 列表 `treeView` + `indent` + `clickToExpand`；TreeItem 必须有 `expanded`/`leaf`/`button` 控制器与 `indent`/`title`/`icon`/`expandButton` |
| Emoji | 混排虚拟列表 + 富文本 + 弹层 | 两个 item 都要有 `msg`/`name`/`icon`；`itemProvider` 返回 `ui://` |
| Extension | 组件扩展类 + 入场动画 | `mailItem` 有 `timeText`、控制器 `IsRead`/`c1`、过渡 `t0` |
| ModalWaiting | 全局/窗口等待遮罩 | 两个等待组件要自己全屏；`TestWin` 需要 `frame` |
| PullToRefresh | 下拉刷新 | 列表必须挂 Header/Footer；Header 控制器 `c1` 四页；Header/Footer `overflow=hidden` |
| ScrollPane | item 横向滑动 | item 根节点 `overflow=scroll` + `scroll=horizontal`；复用时归零 `scrollPane.posX` |
| HeadBar | 头顶血条 | `pivot=0.5,1` + anchor；`blood`(ProgressBar)/`name`(richtext)/`sign`(loader) |
| Guide | 引导挖洞 | 组件 `mask` + `reversedMask=true`；高亮框名 `window` |
| Cooldown | 冷却遮罩 | Button 内 `icon`(loader) + `mask`(image, radial360) |

### XML 生成硬规则（官方 205 个组件实测）

1. **根元素顺序固定**：`<component size [extention] [initName]>` → `<controller>`* → `<displayList>` → 扩展尾元素 → `<transition>`*。
2. **节点 id 唯一**；`name` == `id` 即匿名件，不生成字段但占索引；增删节点后要重生成视图类。
3. **扩展名与保留名成对**：`title`/`icon`/`bar`/`bar_v`/`grip`/`ani`/`arrow1`/`arrow2`/`indent`/`expandButton`/`frame`/`closeButton`/`dragArea`/`contentArea`/`list`，一个都不能改。
4. **列表项想用 `item.title`/`item.icon` 简写，模板里必须有 `title`/`icon`**；用 `t0`/`t1`/`t2` 命名就只能 `GetChild("t0")` 赋值。
5. `defaultItem` 必须 `ui://`；同包引用不要求导出，跨包/代码创建必须导出；窗口内容组件必须导出。
6. 窗口：`extention="Label"` + `initName="frame"` 的框架组件 + 实例节点命名 `frame`，框架内 `closeButton`/`dragArea`/`contentArea`/`title`。
7. 控制器 `pages` 成对写 `序号,页名`（无名页留空）；控制器名/页名要是合法标识符（页名会生成 C# 常量）；`button`/`grayed`/`expanded`/`leaf`/`checked` 是保留名。
8. gear `values` 用 `|` 按页分列，`-` 表示该页不改；字段顺序：`gearXY=x,y`、`gearSize=w,h,sx,sy`、`gearLook=alpha,rotation,grayed,touchable`、`gearColor=color[,strokeColor]`、`gearAni=frame,p`。
9. **九宫格只改 package.xml 资源行**，节点不写 `scale9grid`。
10. 裁剪/滚动/遮罩/命中写在组件根属性；`autoClearText`/`autoClearItems=true` 时发布即清空设计期样例数据。

## 12. 示意图 → 节点映射与工具流程

| 示意图元素 | node type | 关键参数 |
| --- | --- | --- |
| 图片/图标/背景 | image | `asset`=包内图片名，`fit:contain` 等比，`scale9grid` 九宫格 |
| 纯色/描边/圆角底板 | graph | `fill`/`line`/`lineWidth`/`corner`/`shape` |
| 标题/正文/数字 | text | `text`/`fontSize`/`color`/`align`/`vAlign` |
| 输入框 | inputtext | `prompt`/`maxLength` |
| 富文本 | richtext | `ubb`、HTML/UBB 文本 |
| 列表/背包格/排行 | list | `defaultItem`、`layout`、`items` |
| 按钮 | button | `title`/`icon`/`mode`，复用 Button 扩展组件 |
| 进度/滑动/下拉/树/窗口 | progressbar/slider/combobox/tree/window | 见对应工具 |
| 异步图/大图/模型 | loader | `url`=ui:// 或 http，`fill` |
| 跨包控件 | component | `asset:"Common1/CommonBtn"` |

标准流程：

1. `fairyui_mockup_grid` 量坐标；小字/图标用 `fairyui_crop` 放大，`fairyui_ocr` 取文案与框，`fairyui_palette` 取色。
2. `fairyui_inspect`（必要时 `details:true`）确认包、模板、扩展类型、控制器/齿轮。
3. 用 `fairyui_build` 生成（`extention` 按需、`previewPages` 看多态、批量用 `components`）。
4. `read_image` 看预览；`fairyui_diff` 量化差异，`fairyui_overlay` 叠框核对位置。
5. 覆盖已有组件且返回 `indexChanged` → `fairyui_sync_views` → `fairyui_check_views`。
6. `fairyui_open` 在编辑器复核/发布。

## 13. 常见坑

**项目侧（真实项目踩过）**

1. 对已有组件重 build 会重写显示列表；`extention` 会被保留，但不在 spec 里的手写节点会丢。
2. 中间插匿名底板 → `indexChanged`，不重生成视图类就运行期取错节点/类型转换崩溃。
3. 列表 `defaultItem` 必须是 `ui://` 或可解析组件名；模板要存在。
4. 列表/树 `autoClearItems="true"`、文本 `autoClearText="true"` 是发布时清空，示例数据只用于预览。
5. 跨包实例 `pkg` 是包 id（工具里写 `包名/元件名` 自动换算）。
6. `window` frame 必须 `extention="Label"` + `initName="frame"`，并有 `closeButton`/`title`/`dragArea`/`contentArea`。
7. ComboBox 需要 `dropdown` + item 模板；ProgressBar 需要 `bar`/`bar_v`；Slider 需要 `grip`；ScrollBar 需要 `arrow1`/`arrow2`。
8. 组不生成字段；组成员写 `group="<组id>"`。

**官方示例侧**

9. `SetVirtual` 前列表必须 `overflow=scroll`，否则无 scrollPane，虚拟化报错无效。
10. 虚拟模式先设 `numItems` 会抛 "Set itemRenderer first!"。
11. 循环列表不能 flow 布局。
12. `CreateObject` 出来的组件不自适应，要 `MakeFullScreen` + Size 关联。
13. 窗口动画不回调 `OnShown`/`HideImmediately` 会卡在显示/隐藏流程。
14. `GearBase.disableAllTweenEffect` 是全局开关，用完要还原。
15. `sortingOrder` 只在同一父容器内比较。
16. 预览是 GDI+ 近似：列表/树画占位框，跨包组件会递归展开；最终以编辑器/运行库为准。

## 14. 工具速查

| 工具 | 用途 |
| --- | --- |
| fairyui_inspect | 看包/组件/扩展类型/控制器/齿轮（`details:true`） |
| fairyui_asset_sheet | 图片缩略图总览，按名选素材 |
| fairyui_mockup_grid | 示意图坐标网格 |
| fairyui_ocr | 文字行 + 框 + 估算字号 |
| fairyui_crop | 局部放大 / 九宫格切图 |
| fairyui_annotate | 在示意图上标候选区域 |
| fairyui_palette | 主色 HEX + 占比 |
| fairyui_build | 按 spec 生成/覆盖组件 + 预览 + indexChanged |
| fairyui_diff | 预览 vs 示意图差异指标与热力图 |
| fairyui_overlay | 组件框叠到示意图 |
| fairyui_sync_views | 按 XML 重生成 C# 视图类 |
| fairyui_check_views | XML ↔ 视图类一致性校验 |
| fairyui_template | 建扩展模板（Button/Label/ProgressBar/Slider/ComboBox/Tree/Window） |
| fairyui_conventions | 读/存 UI 规范（`conventionsPath` 可指定正本） |
| fairyui_package_create | 新建空包 |
| fairyui_lint | 命名检查（`folder`/`components` 聚焦） |
| fairyui_open | 用 FairyGUI 编辑器打开工程 |
