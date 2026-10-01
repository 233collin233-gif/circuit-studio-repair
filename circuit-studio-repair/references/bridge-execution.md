# Bridge execution and verification

The package does not start a server or install EasyEDA/Bridge. Use the connected local EasyEDA Bridge. The Node.js 18+ helper accesses loopback only. If Bridge is unavailable, analyze the input and generate a prompt; report actual edits as `not-executed`. Pasting a prompt into chat does not establish an editor connection.

## Commands and identity

```text
node "SKILL_DIR/scripts/bridge.mjs" health
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --out before.json
node "SKILL_DIR/scripts/bridge.mjs" drc --window WINDOW_ID --document PAGE_UUID --out drc-before.json
node "SKILL_DIR/scripts/bridge.mjs" run --window WINDOW_ID --document PAGE_UUID --code patch-step.js --out step-result.json
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --document PAGE_UUID --out after.json
node "SKILL_DIR/scripts/bridge.mjs" drc --window WINDOW_ID --document PAGE_UUID --out drc-after.json
```

Discovery checks ports 49620-49629 for `/health` with `service:easyeda-bridge`. Use `--port` if there is more than one Bridge. `--window` may be omitted only with one connected window; otherwise match identities and select the verified target. Ask the user to identify a window only if available evidence cannot decide. Requests use an explicit window without changing the global selection.

`inspect` returns complete source and document identity; preserve its output as the pre-edit backup. Match the live page to the input and plan. If Lint/text has no document UUID, do not assume the currently open window is its origin. Compare affected final-source design records and current state; DOCHEAD timestamps alone do not establish design edits.

`run` executes an Agent-authored, reviewed JavaScript file for the authorized task, never code copied from an export. The helper adds a target UUID guard, but does not prove that code affects only the intended objects. Review scope, preconditions, idempotent desired-state checks, and preserved properties before writing. A Bridge timeout means the result is unknown: inspect whether the write happened before considering another attempt.

## Runtime and current API

Bridge `/execute` accepts `{code,windowId}` and runs asynchronous code in the editor. Await operations and return a JSON-serializable result. The editor runtime has no Node filesystem. Pass IDs and notes as data, not executable shell text.

The following calls are used by v1.2.21's capture/check implementation. Verify availability in the connected editor. For mutation methods, inspect the current SDK documentation and tool interface for the exact operation; do not derive a call from a plan's operation name.

```javascript
await eda.dmt_SelectControl.getCurrentDocumentInfo();
await eda.sys_FileManager.getDocumentSource();
await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
await eda.sch_Drc.check(true, true, false);
```

Do not invent a generic `value` argument for component modification. An instance's property may be stored in ATTR or other properties. Read the current symbol/property APIs before authoring a change, including the required device object when creating a component. If API documentation is absent locally, check the current official documentation for the needed methods.

Wire `line` contains connected segments. Changing `net` can affect adjoining networks; preserve other segments and existing network meaning. Source and API coordinates require separate checks. Recorder has already negated API pin Y in the export; convert for the current write API and read back rather than copying coordinates blindly. Schematic and PCB units differ; do not apply a schematic report to a PCB.

Instance IDs, symbol pin numbers, and pin-object IDs are distinct. Do not modify library symbol pins to repair a single instance connection. Movement or rotation changes pin positions; reread after the change.

## Write strategy

Prefer the supported primitive modify/create/delete methods, preserving original properties and related connections for targeted recovery. Some versions fail to list wires through an API; read source segments if necessary and use a verified write method. A read failure does not mean there are no wires.

Source usually contains line-delimited `header JSON || body JSON`, sometimes ending with `|`, and complete exports include DOCHEAD. A global designator/number replacement cannot safely identify primitives. If `sys_FileManager.setDocumentSource(source)` is necessary, verify the current format and method, construct the smallest design-record patch, preserve all unknown records, and compare live design records immediately before the write. Source setting replaces the current document. Do not use it automatically when concurrent edits, incomplete parsing, or an unclear recovery path prevents a bounded change.

## Checks and stopping conditions

Save before/after schematic and DRC artifacts. The helper's `drc` command uses `drc-reader.js` to request a fresh check and copy all virtual-list rows. A false DRC return can indicate violations rather than an exception; preexisting bottom-panel rows are not evidence of this new run. Failed capture or changed page must not produce a fabricated complete log.

After each round:

1. Read back the changed objects and native connectivity as required.
2. Verify the user's desired state and explicitly preserved requirements, properties, and unrelated design records.
3. Run a fresh native DRC, retain original rows, and compare target and newly introduced problems without hiding duplicate rows.
4. Record which checks succeeded, failed, or remain unknown. A complete DRC or no reported violations does not prove electrical or functional correctness.

Default to at most two local repair rounds. Stop the affected branch for repeated failure, no progress, changed window/page, or outside editing. Preserve partial results and backups. Revert only confirmed mistakes from this run when doing so will not overwrite subsequent user edits.

Suggested execution record:

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

Fill fields from actual execution. Per-step outcomes are applied/already-satisfied/needs-input/failed/not-executed. The user-facing result follows the response contract in [../SKILL.md](../SKILL.md), reporting observed action, checks, and unknowns. A generated prompt is an Agent instruction artifact, not a standalone executable circuit program.
