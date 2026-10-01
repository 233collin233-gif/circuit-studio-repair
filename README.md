# Circuit Studio Repair

分析 Circuit Studio 的 **Lint、Recorder、Hybrid** 导出文件，把 DRC、备注和录制变化整理成有证据的修改方案与 prompt，再由 Agent 通过 EasyEDA Bridge 修改原理图并复查。

支持 Circuit Studio v1.2.19 / v1.2.20，以及导出结构兼容的 **v1.2.21 英文界面版**。修复 skill 的脚本需要 **Node.js 18+**，没有 npm 依赖。语义分析由调用 skill 的外部 Agent 完成；本仓库不包含模型、模型账号或 EasyEDA Bridge 安装包。

## Circuit Studio v1.2.21 扩展

- [下载 v1.2.21 安装包](https://github.com/233collin233-gif/circuit-studio-repair/raw/main/releases/circuit-studio_v1.2.21.eext)
- [扩展源码与构建说明](extension/README.md)
- [本次版本说明](releases/v1.2.21.md) · [SHA-256 校验值](releases/SHA256SUMS.txt)

在 EasyEDA 扩展管理器中导入 `.eext`，关闭旧面板，再打开 **Circuit Studio → Circuit Studio Panel**，确认标题显示 **v1.2.21**。

| 模式 | v1.2.21 操作顺序 |
| --- | --- |
| Lint | 用户先在 EasyEDA 运行原生 DRC → **Copy DRC** → **Export JSON report**。复制按钮不运行新的检查。 |
| Recorder | **Start recording** → 编辑并按需 **Insert note** → **Stop and save** → **Export recording**。 |
| Hybrid | **Start recording** → 编辑并按需 **Insert note** → **Stop and check** → 等待一次全新原生 DRC → **Export recording + DRC**。 |

扩展只采集、组织和导出 evidence，不调用模型。意图解释、澄清、通过 Bridge 执行修改及修改后的复查属于 external Agent 工作流。Hybrid 的结束检查只覆盖结束时的活动工作表，不锁定画布；用户应等待检查完成再继续编辑。英文界面保留原生 DRC、设计名称和用户备注的原始语言。

## 安装

仓库地址：[233collin233-gif/circuit-studio-repair](https://github.com/233collin233-gif/circuit-studio-repair)。

1. 在本仓库点击 **Code → Download ZIP**，解压。
2. 将包含 `SKILL.md` 的整个目录命名为 `circuit-studio-repair`，放到技能目录：
   - Windows：`%USERPROFILE%\.codex\skills\circuit-studio-repair`
   - macOS / Linux：`~/.codex/skills/circuit-studio-repair`
3. 在 Agent 中确认可调用 `$circuit-studio-repair`。如果当前任务尚未发现它，直接让 Agent 读取该目录的 `SKILL.md`。
4. 需要自动修改时，打开目标 EasyEDA Pro 原理图，并连接实验提供的 EasyEDA Bridge。Agent 需要读取本地文件、运行 Node.js 和调用本地 Bridge 的能力。

正确的目录是 `circuit-studio-repair/SKILL.md`，不要多套一层同名文件夹。其他支持文件技能的 Agent 也可读取 `SKILL.md`，但需要按自己的工具环境接入 Bridge。

## 最快开始

把真实导出 JSON 交给 Agent，再发送：

```text
使用 $circuit-studio-repair 分析我附上的导出文件。
结合 DRC、备注和 recording 理解修改意图，生成 evidence.json、
repair-plan.json 和 repair-prompt.md，然后执行能确定的修改并重新运行 DRC。
已满足的目标跳过；只对影响接线或参数选择的剩余歧义向我提问。
```

只要方案时，把最后的执行要求替换成“只生成 prompt，暂不修改图纸”。后续继续执行：

```text
使用 $circuit-studio-repair 执行 repair-prompt.md。
先核对当前图纸与计划，跳过已经满足的目标，完成其余明确修改并复查。
```

## 三种模式

| 模式 | 如何导出 | Agent 如何理解 |
| --- | --- | --- |
| Lint | 先在 EasyEDA 运行 DRC，再复制并导出底部结果 | 保留全部原文、重复行、时间和信息行。`issues.length` 是日志行数，不是缺陷数。 |
| Recorder | 开始录制 → 编辑并插入备注 → 停止 → 导出 | 根据 `before/after`、接线证据、原生事件和备注判断目标。录制是已发生的历史，不直接重放。 |
| Hybrid | 开始录制 → 编辑并插入备注 → 停止录制并检查 → 等待 → 导出 | 结合录制收尾后的新一轮 DRC。检查失败仍可分析录制；失败或缺失结果不能当零错误。 |

字段说明见 [导出格式](references/export-formats.md)，实验参与者可阅读 [操作说明](assets/participant-guide.md)。

## 备注可以不写成技术指令

例如“这根线接回去”“insert 一个电阻在这里”“这个值小一点，别改其他地方”。Agent 会结合前后状态、引脚、网络和当前图纸寻找解释。

如果记录明确显示一根线从 U1.IN 移到了 U1.OUT，“接回去”可以结合这些证据定位；如果有两个同样合理的目标，就需要补充具体引脚。未知阻值、供电或拓扑不会凭空填写。已完成的正确修改也不会因为历史记录而被撤销。

## 输出

| 文件 | 用途 |
| --- | --- |
| `evidence.json` | 保存原始报告，建立带 JSON Pointer 的证据索引。 |
| `repair-plan.json` | 每步的目标、前置状态、证据 ID、置信度、处置和验收条件。 |
| `repair-prompt.md` | 可交给下次 Agent 执行的完整修改说明，与输入 SHA-256 绑定。 |
| `execution-result.json` | 实际执行后记录已改、已满足、待澄清、失败和未执行的步骤。 |
| 修改前后图纸与 DRC | 支持复查、比较和定向恢复。 |

生成 prompt 不代表已经修改电路。实际写入还需要可用的 Bridge、匹配的图纸身份和用户的修改要求。

## 命令行与示例

在仓库根目录运行：

```shell
node scripts/self-check.mjs
node scripts/report.mjs normalize assets/examples/recorder.json evidence.json
node scripts/report.mjs compile assets/examples/recorder.json assets/examples/recorder-plan.json repair-prompt.md
node scripts/bridge.mjs health
```

前 3 条命令可离线运行。`normalize` 负责解析；真实 `repair-plan.json` 需要 Agent 根据证据编写，`compile` 负责校验和生成 prompt，不会自动推断意图。

`assets/examples/` 提供三种模式的合成报告、计划与 prompt，文档 ID 为 `SYNTHETIC-EXAMPLE`，仅供阅读和离线测试。Hybrid 示例特意展示 DRC 失败时仍保留录制的情况；不要将示例计划应用到真实电路。

Bridge 默认发现本机 `127.0.0.1:49620–49629` 的 `easyeda-bridge` 服务。多窗口需匹配窗口和图纸 UUID。更多命令见 [Bridge 执行说明](references/bridge-execution.md)。

## 能力边界

- Lint 通常没有图纸 UUID，不能仅凭“当前打开的窗口”认定归属。
- 接线记录中的坐标接触是证据；电气连接仍需通过当前图纸、网表或 DRC 核实。
- 模糊备注不一定能唯一消歧，快速连续编辑也可能缺少中间状态。
- DRC 无错误不等于电路功能正确；验收还要检查目标网络、参数和保留约束。
- 修改通常最多进行两轮；无进展或写入结果未知时先读回检查，不盲目重试。

自检覆盖解析、证据引用、prompt 编译和模拟 Bridge 流程，不替代真实 EasyEDA 的端到端验证。

## 目录与维护

`SKILL.md` 是 Agent 入口；`references/` 保存格式和执行规范；`scripts/` 保存解析、编译与 Bridge 辅助程序；`assets/` 保存参与者说明和示例；`agents/` 保存技能展示信息。

真实导出可能包含完整图纸源码。实验记录、参与者资料和 Bridge 凭据应保存在仓库外；公开问题报告请使用脱敏样例。本仓库只提供合成演示数据。

许可见 [LICENSE](LICENSE)。`scripts/drc-reader.js` 与 `extension/linter.js` 及原始 v1.2.21 安装包中的 DRC 读取实现一致，保留其 MIT 许可与作者信息。

## English quick start

Copy this folder to `~/.codex/skills/circuit-studio-repair`, install Node.js 18+, and attach a Circuit Studio export to an agent with local file and tool access. Connect the supplied EasyEDA Bridge for actual edits.

The v1.2.21 extension package is in [`releases/`](releases/v1.2.21.md), with source and build instructions in [`extension/`](extension/README.md). Lint requires a user-run native DRC before copying; Hybrid runs one fresh check after recording stops. The extension itself calls no model. The repair scripts remain dependency-free; only building the extension requires its two development dependencies.

```text
Use $circuit-studio-repair to analyze this export, infer the intended circuit
changes from its DRC, notes and recording, and generate a repair plan and prompt.
Apply well-supported changes to the matching schematic and run a fresh DRC.
Skip goals already satisfied; ask a focused question for unresolved ambiguity.
```

Lint mirrors existing DRC text; Recorder describes edits that already happened; Hybrid combines recording with a fresh post-recording check. Failed checks are not zero-error results. The scripts have no npm dependencies or embedded model. The examples are synthetic and must not be executed against real schematics.
