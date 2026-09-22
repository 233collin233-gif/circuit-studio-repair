# 给实验者／受试者的使用说明

此 skill 用来理解 Circuit Studio 导出的内容，把 DRC、备注及录制证据整理成修改 prompt，再由 Agent 经 Bridge 操作原理图。需要能读取文件并使用本机工具的 Agent；单纯聊天粘贴 prompt 不会自行连接 EasyEDA。

## 准备

1. 把整个 `circuit-studio-repair` 文件夹放入 Agent 的技能目录。Codex 使用用户目录下的 `.codex/skills/`。若当前任务尚未发现新 skill，可直接让 Agent 读取文件夹中的 `SKILL.md` 后执行。
2. 安装 Node.js 18 或更高版本。这个 skill 的脚本无需 `npm install`，无需额外 API key。
3. 需要自动修改时，先打开对应 EasyEDA 原理图并连接实验使用的 Bridge。多窗口时让 Agent 按图纸身份定位，必要时明确指定窗口。
4. 给 Agent 提供真实导出 JSON，并按实验分配使用对应的模式。skill 不改变实验任务或用户所在条件。

## 导出与调用

**Lint**：在 EasyEDA 运行 DRC，然后在扩展复制并导出。

```text
使用 $circuit-studio-repair 分析这个 Lint JSON，生成规范修改 prompt，然后自动修复能确定的问题并运行 DRC 复查。
```

**Recorder**：开始录制，修改电路并插入备注，停止后导出。可以写自然语言，不需要 API 或严格格式。

```text
使用 $circuit-studio-repair 理解这份 Recorder 的备注和修改前后状态。我写的“这根线接回去”指我正在尝试修正的接线，请结合图纸判断；生成规范 prompt 后自动执行能确定的修改。
```

**Hybrid**：开始录制，修改并写备注，点击“停止录制并检查”，等结果完成再导出。失败报告也可以提供，Agent 会区分缺少 DRC 与没有错误。

```text
使用 $circuit-studio-repair 结合这份 Hybrid 的 DRC、备注和 recording，生成规范修改 prompt，并据此修改电路和重新检查。
```

只想得到文字方案时，将最后一句改成“只生成 prompt，暂不修改图纸”。后续继续：

```text
使用 $circuit-studio-repair 执行 repair-prompt.md。先核对当前图纸，目标已满足的步骤跳过，其余明确步骤自动完成。
```

## 模糊备注可以怎样写

“insert 电阻在这里”“接回原来的输入”“值小一点”“这个保留”都可以作为意图线索。Agent 会结合前后变化、引脚、网络和当前图纸推断，不会盲目重放录制。

有两个同样合理的接法、缺少决定性阻值或无法知道“这里”是哪两个节点时，Agent 会问一个具体问题；不会随机选一个接法只为了让 DRC 清零。补充位号或引脚能提高确定性，例如“R3 串到 U1 输入前，先保留原阻值”。

## 会得到什么

- `evidence.json`：原始导出及定位索引。
- `repair-plan.json`：每步修改的对象、目标状态、依据、置信度和验收条件。
- `repair-prompt.md`：可以再次调用的完整规范 prompt。
- 实际执行后：图纸备份、前后 DRC、`execution-result.json`，列明已改、已满足、待澄清和失败项。

看到“生成了 prompt”不代表已修改电路；以执行结果和重新检查的实际记录为准。复查等待期间暂停编辑该图页，避免与 Agent 的修改混在一起。

## 示例与验证

本目录 `examples/` 中的 `lint.json`、`recorder.json`、`hybrid.json` 和各自的 `*-plan.json`、`*-prompt.md` 都是合成演示。Recorder 样例通过 v1.2.19 的真实 Recorder 类在模拟 API 上生成，包含一条导线从 U1.IN 改到 U1.OUT 的前后记录。Hybrid 样例刻意展示 DRC 失败但录制仍保留的情况。

示例只供理解格式，文档 UUID 为 `SYNTHETIC-EXAMPLE`，所有演示步骤均要求先 inspect，不得用于真实原理图。

运行 `node scripts/self-check.mjs` 可检查解析、prompt 生成和模拟 Bridge 流程；它不会修改真实 EasyEDA 电路。测试不保证 Agent 能准确猜中任意模糊表达，也不替代实际图纸的电气验证。
