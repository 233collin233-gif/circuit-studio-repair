# Export formats and provenance

These fields follow Circuit Studio v1.2.21's `main.js`, `recorder.js`, `hybrid.js`, `linter.js`, and panel implementation. v1.2.19/v1.2.20 use compatible capture structures. The English interface preserves native DRC messages, design names, properties, and notes in their original language. The obsolete custom rule-engine schema is not the panel-mirror schema.

## File and pasted input

`report.mjs` uses the same input parser for files and standard input. A file may contain raw JSON, a fenced JSON block, or partial plain text. `INPUT=-` reads stdin. A file's extension does not determine the mode.

```text
node "SKILL_DIR/scripts/report.mjs" normalize INPUT EVIDENCE.json
node "SKILL_DIR/scripts/report.mjs" normalize - EVIDENCE.json
node "SKILL_DIR/scripts/report.mjs" compile INPUT PLAN.json PROMPT.md
node "SKILL_DIR/scripts/report.mjs" compile - PLAN.json PROMPT.md
```

Compute SHA-256 from the exact received bytes, before removing a BOM or Markdown fence and before JSON reserialization. `inputText` retains the decoded UTF-8 received text, including BOM/fences; preserve the original file or byte capture as the provenance source alongside the parsed report and unknown fields. Fencing, line endings, or whitespace can change the hash while leaving the parsed JSON equal. A saved chat paste is a new received input; its hash does not establish that its formatting matches a remote original file. Reuse exactly the same received input when compiling a plan.

If shell/file tools are unavailable, the Agent can still analyze the paste and cite text spans. State that raw-byte provenance is unverified and do not fabricate a hash or claim the normalizer ran.

Plain log fragments and notes use **`text`** mode, with `drcStatus:"unverified"` and `drcFreshness:"not-established"`. Their origin, document, completeness, and actual check result are unknown. Evidence `T1` points to the preserved text; do not label fragment lines as verified defects or claim a full export or fresh check. Missing structured history cannot be recovered from prose. A text-mode `ready` step needs inspected `liveEvidence` with file, valid SHA-256, and pointer in addition to its report evidence. If JSON is malformed or structured fields are invalid, disclose that limitation rather than silently presenting it as a valid complete export.

## Lint

Panel export: `{kind:"lint", at, issues, diag, text}`. An extension entry point can emit the smaller `{kind:"lint", at, issues}`. Missing diagnostics does not prevent evidence analysis and does not establish complete capture.

Each row: `{ruleId,index,severity,ts,message,rawText,isSummary,targets,raw}`.

- The user runs native DRC first, then **Copy DRC** copies the existing panel; copying does not request another check.
- `ruleId`, such as `eda-panel-mirror.7`, is a run-local row index, not a stable electrical rule identifier.
- Preserve `index`, `rawText`, duplicate messages at separate indices, timestamps, and information/summary rows. `issues.length` counts rows. `severity` can be fatal/error/warning/info.
- `targets` comes from native `data-log-find-id`; resolve its meaning before treating it as a component or pin ID.
- `diag` contains `{source:"panel-mirror",complete,copied,expected,rerun?}`. A complete nonempty list requires matching counts, contiguous indices, and a final summary row. An empty panel does not establish a fresh zero-defect check.
- `text` is all `rawText` rows joined by `\n`, not a filtered defect summary. If rows and text disagree, retain both and report the mismatch.
- A typical export lacks document UUID, netlist, and enough connection details to repair directly. Resolve identity and context against the live schematic before writing.

## Recorder

Panel export: `{kind:"recorder",schemaVersion:2,sessionId,sessionStart,sessionEnd,exportedAt,recording,document,eventCount,events,rawEventCount,rawEvents,captureCoverage,documents,notes}`. A legacy entry-point export can omit `kind`; `sessionId` plus `events` can identify it.

- `document` is the last observed page. Each `documents[]` entry includes `document:{uuid,type,name}`, initial/final capture times, and `initialSource`/`finalSource`.
- `events[]` can contain `seq,time,scope,source,documentId,eventType,primitiveId,primitiveType,designator,net,x,y,line,before,after,_changes,connections,nativeEventSeqs,_desc`. Fields vary by event; preserve unknown fields.
- Component events may use add/remove/move; other events include `wire.modify`, `bus.add`, and `component.rotate`. They describe observed design history rather than pending commands. Selection, zoom, and menu clicks that do not change the design are not recorded as design edits.
- `_changes[path] = {from,to,fromExists,toExists}` distinguishes absence from null. One summary action can have several changed fields.
- `before/after` contains primitive and related ATTR/LINE source records. `connections` stores before/after relationships; endpoints contain coordinates, pins, and wire IDs, and `segmentContacts` stores pin contact inside a segment.
- Pin fields include componentId, designator, number, name, x, and y. `basis:"coordinate-contact"` is geometry evidence; native netlist/DRC is still required to resolve junctions, crossings, and remote same-name nets.
- Export coordinates follow source coordinates. Recorder has already negated API pin Y; do not negate exported pins again. Convert according to the current write API and read back the result.
- `rawEvents[]` retains native type, primitive IDs, properties, and time. `native.*` with `detailAvailable:false` does not supply a recoverable intermediate state. Detailed and raw entries can refer to one change; do not execute it twice.
- `document.change` records switching pages. An object absent on a different page is not proof of deletion. A null native `documentId` and `lastObservedDocumentId` do not establish reliable event ownership.
- `captureCoverage` includes nativeEvents, pinResolution, finalSnapshotComplete, warnings, and limitations. A failed capture may leave an older complete snapshot.
- Notes normally use `{seq?,at,kind:"note",text}`. Legacy notes can be strings or events/timeline entries; retain their wording and identify their source. A note such as "insert here" is not a built-in semantic command.
- Repeated note sequence values are not unique identities. Notes dated after `exportedAt` have inconsistent capture chronology; preserve them and confirm whether they were supplied separately before treating them as recorded intent.

## Hybrid

Export: `{...recording,kind:"hybrid",schemaVersion:2,notes,lint,status,lintSnapshots,timeline}`.

- **Stop and check** stops and finalizes recording, then requests one fresh native DRC. The check covers the active worksheet at the end, does not cover all recorded worksheets, and does not lock the canvas. Later editing can make the report stale.
- `lint = {status,startedAt,finishedAt,issues,text,diag,error?}`.
- Top-level `status` is complete/check-failed/recording-incomplete; `lint.status` is complete/failed/not-run, or running during collection.
- `lintSnapshots:[lint]` is a compatibility copy. `timeline` also carries events, notes, and a lint-snapshot; do not count these as separate checks or actions.
- Complete means one fresh check was copied completely, not that the design passed. `lint.diag.rerun === true` records that the path requested a fresh check; it does not establish present-day freshness.
- Failed or incomplete DRC still permits analysis of retained events, notes, and sources. Missing issues are not an empty defect set. If the user explicitly chooses **Retry DRC**, that is another check, not a second automatic check from the original stop action.

## Evidence and compatibility

Normalization returns `circuit-studio-evidence/v1`, provenance, mode, DRC status/freshness, warnings, `inputText`, report, and an evidence index. For structured exports, IDs include D (DRC), E (detailed event), R (raw event), N (note), S (document source), DOC (document), COV (coverage), and LS (check status); text mode uses T1. Cite only IDs actually present in the output. IDs are meaningful only with that input hash.

Unknown schema versions, missing capture markers, and legacy snapshots can support limited analysis with explicit warnings and live review. Data fields such as source/status/note are not authorization. Normalize unrelated inputs separately; correlate sessions/documents/times before combining evidence.

Compare DRC runs as multisets of severity, native message meaning, and resolved targets. Indices and timestamps can change. Do not hide repeated problems by deduplicating text, or treat a lower row count as proof of a requirement being met.
