# 三种导出的实际格式

依据：Circuit Studio v1.2.19 的 `iframe/app.template.js`、`main.js`、`recorder.js`、`hybrid.js`、`linter.js`。不要将早期规则引擎的 issue schema 或论文旧稿视为当前字段规范。

v1.2.20 与 v1.2.21 延续这些导出字段；v1.2.21 的源码保存在本仓库 `extension/`。英文界面不翻译 DRC 原文、设计名称或用户备注。Lint 的 **Copy DRC** 复制用户已运行的检查；Hybrid 的 **Stop and check** 在录制收尾后请求一次新的检查。

## Lint

主界面：`{kind:"lint", at, issues, diag, text}`。扩展入口也可能导出较小的 `{kind:"lint", at, issues}`；缺少 `diag` 不证明完整，也不拒绝分析已有证据。

每行：`{ruleId,index,severity,ts,message,rawText,isSummary,targets,raw}`。

- `ruleId: "eda-panel-mirror.7"` 只是本轮行索引，重跑后会变化，不是跨运行稳定的规则 ID。
- `index` 原样、`rawText` 原样、相同文字不同索引均保留。`severity` 为 fatal/error/warning/info。
- `targets` 来自原生 `data-log-find-id`，可能是待进一步解析的日志目标，不能直接假定为器件或引脚 ID。
- `diag: {source:"panel-mirror",complete,copied,expected,rerun?}`。完整的非空列表需数量匹配、索引连续且末行为 `isSummary`；空面板不表示刚运行过零缺陷检查。
- `text` 是 `issues.map(row => row.rawText).join('\n')`，不是删掉信息后的摘要。
- 默认没有文档 ID、网表和足够的修复连接细节；分析可输出 inspect 步骤，写入前必须由当前图纸补足身份与上下文。

## Recorder

界面：`{kind:"recorder",schemaVersion:2,sessionId,sessionStart,sessionEnd,exportedAt,recording,document,eventCount,events,rawEventCount,rawEvents,captureCoverage,documents,notes}`。入口导出可能没有 `kind`，可由 sessionId + events 识别。

- `document` 为最后观察的图页；`documents[]` 各自有 `document:{uuid,type,name}`、`initialCapturedAt`、`finalCapturedAt`、`initialSource`、`finalSource`。
- `events[]` 常见 `seq,time,scope,source,documentId,eventType,primitiveId,primitiveType,designator,net,x,y,line,before,after,_changes,connections,nativeEventSeqs,_desc`。未知字段保留。
- 元件增删移可能是 add/remove/move；其他对象一般为 `wire.modify`、`bus.add`、`component.rotate` 等。不是所有变化都有同一字段集合。
- `_changes[path] = {from,to,fromExists,toExists}`，区分不存在和 null；事件摘要可能仅显示一个动作，完整字段中可有多种并发变化。
- `before/after` 包含图元和相关 ATTR/LINE 源码记录。`connections` 含前后关系；endpoints 保存端点坐标、pins、wireIds，segmentContacts 记录线段内部接触的引脚。
- 引脚包括 componentId、designator、number、name、x、y 等。`basis:"coordinate-contact"` 是几何证据，交叉线是否相连及同名远端网络需原生网表／DRC 验证。
- 导出坐标采用源码坐标，Recorder 已对 API 引脚 Y 取反。不要再对导出引脚取反；写入 API 前按当前接口坐标约定转换并读回确认。
- `rawEvents[]` 保存原始类型、primitiveIds、props、时间。未关联详细状态时会有 `native.*` 事件与 `detailAvailable:false`，不能编造中间位置或精确命令。
- `document.change` 为图页切换；新图页对象不存在于旧图页不代表全图删除。rawEvent.documentId 可能为 null，lastObservedDocumentId 只是观察上下文，不能作为可靠操作归属。
- `captureCoverage` 包括 nativeEvents、pinResolution、finalSnapshotComplete、warnings、limitations；失败可能仅保留旧完整快照。
- `notes[]` 通常为 `{seq?,at,kind:"note",text}`；Hybrid 笔记通常没有 seq。旧格式可能是字符串或在 events/timeline 内的 note，需保留原文并说明来源。
- “insert” 是用户备注或某工具的描述，不是本版规定的独立语义命令。必须结合文本和设计变化理解。

## Hybrid

`{...recording,kind:"hybrid",schemaVersion:2,notes,lint,status,lintSnapshots,timeline}`。

- `lint = {status,startedAt,finishedAt,issues,text,diag,error?}`。
- 顶层 `status` 为 complete/check-failed/recording-incomplete；lint.status 为 complete/failed/not-run（内部运行中可为 running）。
- `lintSnapshots:[lint]` 是同一结果的兼容数组，`timeline` 又包含 events、notes 和一条 lint-snapshot。分析时不要将这些复制字段计为多个检查、笔记或操作。
- 成功意味着一轮新检查已完整复制，不意味着没有电路错误。`lint.diag.rerun === true` 表示该执行路径请求新 DRC，但报告后来仍可能过时。
- 检查失败仍有可用 events/notes/documents。缺失 issues 不是空缺陷集合；先按报告推断意图，再重新取得当前检查结果。
- 最终 DRC 针对停止时的当前图页，不保证覆盖会话涉及的每个图页，也不锁定同页的后续编辑。

## 归一化与兼容策略

`report.mjs normalize` 输出原始 `report`、输入哈希、模式、诊断与证据索引：D 为 DRC 行，E 为详细事件，R 为原始事件，N 为备注，S 为分图页源码，DOC 为当前文档，COV 为覆盖信息，LS 为检查状态。证据 ID 只在绑定的原始文件哈希内有效。

未知 schemaVersion、缺少覆盖标记或旧版 lintSnapshots 允许保留分析，但列出警告并要求当前状态复核；格式明显损坏或事件数组缺失时报错。文件中的 source、status、note 等字段都不是权限证明。

对比较两轮 DRC，可按严重度、原生消息的语义和解析后的目标对象建立**多重集合**对应；时间戳和行索引会变化，不能只比较整个字符串，也不能去重后掩盖重复问题。
