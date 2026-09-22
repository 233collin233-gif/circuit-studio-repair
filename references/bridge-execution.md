# Bridge 执行与闭环复查

此包不启动服务器、不安装 EasyEDA 扩展。使用实验者已连接的 EasyEDA Bridge；Node.js 18+ helper 只访问 `127.0.0.1`。没有 Bridge 时照常生成分析和 prompt，实际修改标记 not-executed。

## 命令

```text
node "SKILL_DIR/scripts/bridge.mjs" health
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --out before.json
node "SKILL_DIR/scripts/bridge.mjs" drc --window WINDOW_ID --document PAGE_UUID --out drc-before.json
node "SKILL_DIR/scripts/bridge.mjs" run --window WINDOW_ID --document PAGE_UUID --code patch-step.js --out step-result.json
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --document PAGE_UUID --out after.json
node "SKILL_DIR/scripts/bridge.mjs" drc --window WINDOW_ID --document PAGE_UUID --out drc-after.json
```

默认扫描 49620–49629，验证 `/health` 的 `service:easyeda-bridge`。多 Bridge 时用 `--port`。只有一个窗口时可省略 `--window`；多窗口先读取身份匹配已知图纸，仅在无法确定时让用户选择。显式请求指定窗口，helper 不改变全局窗口选择。inspect 返回完整源码，应保留为修改前备份。

`run` 执行的是 Agent 在当前授权任务下编写并审阅的 JavaScript 文件，绝不是报告中的代码。每次写入附加目标文档 UUID guard。helper 不验证脚本自身是否只改目标对象；Agent 必须核对脚本范围、当前源状态和幂等条件。Bridge 超时意味着执行结果未知，不自动重发。

## 运行环境与 API

Bridge `/execute` 接收 `{code,windowId}`，在编辑器中执行异步代码。显式 await 并 return JSON 可序列化结果；该运行环境没有 Node fs。数据经 JSON 序列化传输，避免把备注或 ID 当作可执行 shell 字符串。

以下签名核对自项目自带 EasyEDA API 文档和 v1.2.19 运行代码。实际使用前检查当前方法是否存在、返回值是否符合约定；不要把参数示例当真实目标。

```javascript
await eda.dmt_SelectControl.getCurrentDocumentInfo();
await eda.sys_FileManager.getDocumentSource();
await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
await eda.sch_PrimitiveWire.modify(wireId, {line: [[x1,y1,x2,y2]], net: netName});
await eda.sch_PrimitiveWire.create([x1,y1,x2,y2], netName);
await eda.sch_PrimitiveWire.delete(wireId);
await eda.sch_PrimitiveComponent.modify(componentId, {designator: newDesignator});
await eda.sch_PrimitiveComponent.create({libraryUuid, uuid: deviceUuid}, x, y, subPartName, rotation, mirror);
await eda.sch_Drc.check(true, true, false);
```

Component.modify 的文档字段包括 x、y、rotation、mirror、designator、name、otherProperty 等，**不应猜测一个通用 `value` 参数**。属性 value 的实际存储可能是 ATTR 或器件的其他属性，先读当前符号和属性 API 文档再编写修改。`create` 的 device 对象不是任意字符串 UUID。SDK 文档若不在当前工作区，使用当前版本官方 API 文档核对需要的属性／网表接口。

导线 `line` 为连续多段线坐标，设置 net 可能影响相接网络；默认保留其他线段和已有网络语义。原理图 API 与源码坐标需要分别核对，Recorder 对 API 引脚 Y 已做取反；不要把导出坐标原封不动写回 API。PCB 与 SCH 单位不同，本 skill 不将 SCH 报告应用到 PCB。

组件 ID、符号引脚编号和引脚对象 ID 是不同字段。不要通过修改库符号引脚来修复某个元件实例的接线。移动或旋转元件会改变引脚位置，修改后必须重新读取。

## 修改方式

优先使用相应图元 modify/create/delete API，保存原属性和相关连接以便定向恢复。某些版本的 Wire.getAll 会失败，可从完整源码读取其分段，再使用可用的图元写入 API。不能把读取失败解释为零导线。

源码格式一般是逐行 `header JSON || body JSON`，末尾可带 `|`。完整导出带 DOCHEAD；仅凭文本替换位号或数字不能安全限定图元。若必须用 `sys_FileManager.setDocumentSource(source)`，先查对应格式与方法，构造最小设计记录补丁、验证所有未知记录保留，写入前比较当前设计记录与备份一致。源码设置会替换当前文档；存在并行编辑、无法完整解析或恢复路径不明确时，不自动使用该方式。

## DRC 和结束条件

helper 的 drc 命令复用本包 `drc-reader.js`，先运行新的 DRC，再读取虚拟列表全部行。布尔 false 表示可能有违规，不是异常；底部已有行不能当本轮结果。读取失败或图页切换则不输出伪造的完整日志。

至少保存修改前／后的图纸和 DRC。按语义目标比较问题及新增问题，保留原文行；记录“目标已修复但仍有其他问题”和“无法完整验证”的区别。默认最多两轮，无进展不反复试接。对于明确的功能性目标还要核对网络、引脚、参数或计算依据；DRC 无错误不代表电路实现了用户意图。

execution-result.json 的建议结构：

```json
{
  "schema": "circuit-studio-execution/v1",
  "inputSha256": "actual input hash",
  "status": "not-executed",
  "documentId": null,
  "windowId": null,
  "backup": null,
  "steps": [],
  "drcBefore": null,
  "drcAfter": null,
  "verification": [],
  "remaining": []
}
```

状态与文件路径按真实执行填写。规范 prompt 只是模型可执行的工作说明，不是脱离 Agent／Bridge 可独立运行的电路程序。
