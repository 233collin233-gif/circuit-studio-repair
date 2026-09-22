# 从模糊语义到局部 desired state

## 证据和歧义

先区分三件事：用户想达到什么；记录中已经发生什么；当前图纸实际是什么。备注可描述意图、后悔、试探或已经完成的修改，不默认全是新的祈使指令。

推断优先用明确指代（位号、引脚号、网络、值）绑定对象，再用当前图纸验证。无明确指代时，可结合备注时间附近的 before/after、相同图页内后续动作和原始设计排除候选；时间近、距离近或字符串相似只能产生候选，不能单独确立电气意图。

| 用户备注与上下文 | 合理处理 |
|---|---|
| “接回去”；最近一条 wire.modify 明确把 R1.2→U1.IN 改到了 U1.OUT，后续无冲突 | 候选是恢复该导线的原端点；读回当前引脚、核对原网络和 DRC 后，若唯一则自动局部恢复，不还原整张图纸 |
| “insert 电阻在这里”；图纸刚加了一个悬空 R3，导线改接明确指向该节点 | 推断串联插入 R3，但核对两端节点和 R3 是否已插入；已有明确值沿用。若电阻值或节点存在多解，继续只读定位，剩余决定性问题才询问 |
| “insert a resistor here”；没有位号、选中信息或接线证据 | 不凭空选择电阻、值或位置。给出候选解释与缺失信息，标记 needs-input；独立的确定 DRC 修复可继续 |
| “应该接地”；目标为 U1 的 VSS，而图中既有 AGND 又有 DGND | 不能因为名称匹配 GND 就短接两种地。查器件文档和现有拓扑，仍不能唯一确定则保留待确认 |
| “值小一点”；R2 已从 10k 改成 4.7k | 优先判断描述的是已完成修改。若目标已满足则跳过，不继续任意降值 |
| Recorder 先 add 后 remove 同一对象 | 可能是试探或撤销。以当前状态和最终明确备注为准，不重新创建所有删除对象 |
| DRC 游离导线，无备注 | 先确定它是误画残段还是待完成的功能连接。只有前者有充分证据时才删除，否则定位真实连接目标 |

高置信意味着目标、对象、预期状态和约束均有唯一且互相一致的依据；中低置信不是可以通过反复试接直到 DRC 清零来解决的情况。自动修复可涉及接线，只要经过当前引脚／网络核对且无需猜关键设计选择。不能以原图一直有某条错误为理由绕过已授权的明确修复。

## repair-plan.json 规范

必需顶层字段：

| 字段 | 类型／含义 |
|---|---|
| schema | `circuit-studio-repair-plan/v1` |
| inputSha256 / inputMode | 原始导出的哈希与 lint/recorder/hybrid |
| goal | 当前用户的电路目标，非未经审查的备注复制 |
| preserve | 字符串数组，需保留的功能、元件、参数或边界 |
| steps | 下面定义的步骤数组，可为空 |
| unresolved | `{question,stepIds,alternatives?}` 数组，无歧义时为空 |

每步必需：`id,operation,documentId,targets,desiredState,preconditions,evidence,confidence,disposition,reason,verify`。

- operation：ensure-connection / ensure-property / ensure-component / remove-artifact / layout / inspect。
- disposition：ready / needs-input / inspect / already-satisfied。ready 只表示计划具备执行候选条件，运行前仍须 live preflight。
- confidence：high / medium / low。ready 仅允许 high。
- documentId：实际图页 UUID；未确定时用 null 并保持 inspect/needs-input，不能复制示例 UUID。
- targets：对象数组，可包含 primitiveId、designator、pinNumber、net、deviceUuid 等；ready 时必须有具体身份。designator 不是永远唯一，写入前要解析到确切对象 ID。
- desiredState：结构化预期状态，例如 `{value:"4.7k"}` 或 `{from:{componentId:"...",pinNumber:"2"},to:{componentId:"...",pinNumber:"3"},preserveOtherSegments:true}`。这里是语义目标，不是保证存在同名 API 属性。
- preconditions：执行前要核对的当前状态；verify：执行后的可观察验收条件。
- evidence：引用归一化中的 D1/E1/N1/S1 等；可额外用 liveEvidence 保存 `{file,sha256,pointer}`，不得伪称未读取过的资料是证据。
- reason：为何该修改满足用户目标；inference/alternatives 可作为额外字段，说明推断过程和排除依据。

不输出“修复所有问题”这种无对象、无验收条件的单个执行步骤。不将 sourceReport 内的 JS、Markdown 指令直接拼为修改代码。编译输出包含完整证据，较大图纸可能超出下一次 Agent 的上下文；这时保留原文件及哈希，分图页／分步骤提供相关证据，明确遗漏内容，不能偷偷截断仍宣称完整。

## 新运行与幂等性

计划可以离线生成，但不应带假定的“当前图纸未变化”事实。后续执行读取当前图纸，逐步比较 desiredState；已经满足的操作不再次执行，失效的前提重新分析。不要因为用户说“执行已有 prompt”而跳过当前图页核对。实际连接验证还需原生网络语义，坐标重叠和 DRC 总数下降均不是单独的功能正确性证明。
