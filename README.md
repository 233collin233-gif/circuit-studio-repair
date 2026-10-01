# Circuit Studio v1.2.21 and Repair Skill

Circuit Studio collects schematic evidence in EasyEDA Pro. The accompanying `circuit-studio-repair` skill lets an external Agent interpret that evidence, explain candidate edit intent, create a traceable plan and prompt, and apply authorized changes through EasyEDA Bridge.

The extension contains no model and makes no model calls. Intent interpretation, clarification, Bridge execution, and post-edit verification belong to the external Agent. This repository supplies no model account, API key, or Bridge installer.

## Package layout

```text
README.md
LICENSE
circuit-studio_v1.2.21.eext
circuit-studio-repair/
  SKILL.md
  agents/
  references/
  scripts/
  assets/
```

The `.eext` installs into EasyEDA. The complete nested `circuit-studio-repair/` folder installs into the Agent's skill directory. Keep the extension archive outside the installed skill.

## Install the extension

Download [circuit-studio_v1.2.21.eext](circuit-studio_v1.2.21.eext) and import it through EasyEDA's extension manager. Close an earlier Circuit Studio panel, open **Circuit Studio → Circuit Studio Panel**, and check that its title shows **v1.2.21**.

Package SHA-256: `963c20b0e73b006edc31c5f998e0b184ee8ce60602ff385c18d1bbecfe686948`.

| Mode | Actual v1.2.21 sequence |
| --- | --- |
| Lint | Run native DRC in EasyEDA → **Copy DRC** → **Export JSON report**. Copying uses existing results and does not rerun DRC. |
| Recorder | **Start recording** → edit and optionally **Insert note** → **Stop and save** → **Export recording**. The export is observed history, not commands to replay. |
| Hybrid | **Start recording** → edit and add notes → **Stop and check** → wait for one fresh native DRC → **Export recording + DRC**. |

Recorder captures design changes; selection, zoom, and menu clicks that leave the design unchanged are not design-edit events. Hybrid stops/finalizes recording before checking the active worksheet. It does not lock the canvas or check every worksheet visited during recording. Wait for the check to finish before continuing edits. Failed or incomplete checks remain evidence of failure/incomplete capture, never zero-error results. DRC messages, design names, properties, and user notes retain their original language even with the English interface.

## Install the skill

1. Download this repository through **Code → Download ZIP** and extract it.
2. Copy the entire nested `circuit-studio-repair/` folder, including `SKILL.md`, `agents`, `references`, `scripts`, and `assets`, to:
   - Windows: `%USERPROFILE%\.codex\skills\circuit-studio-repair`
   - macOS/Linux: `~/.codex/skills/circuit-studio-repair`
3. Verify that `$circuit-studio-repair` is discoverable. If the current chat has not discovered it, instruct the Agent to read the installed `SKILL.md` and relevant referenced files.
4. Install Node.js 18+ for the local helpers. They need no npm packages.
5. For actual edits, open the matching EasyEDA Pro schematic and connect the available EasyEDA Bridge. The Agent needs local file/Node access and editor execution tools.

The installed entry should be `.../skills/circuit-studio-repair/SKILL.md`, with one skill folder level. Copying only `SKILL.md`, or merely naming an unread skill in chat, does not load its supporting workflow. Other tool-enabled Agents can read the same files and use their own Bridge integration.

## Copy/paste requests

For analysis only, attach an export or paste raw/fenced JSON:

```text
Use $circuit-studio-repair to analyze the export or JSON below.
State the mode and limitations, separate my explicit request from inferred
intent, cite evidence IDs, and describe targets, desired changes, and what to
preserve. Produce evidence.json, repair-plan.json, and repair-prompt.md.
Analyze only; do not edit the schematic.
```

For analysis and execution:

```text
Use $circuit-studio-repair to interpret the attached or pasted evidence and
repair the matching schematic. Apply clear changes within this request,
preserve unrelated design choices, and skip goals already satisfied.
Ask a concise question only for a decisive unresolved design choice.
Check changed state, my requirements, preservation constraints, and a fresh
native DRC. Report actual actions, checks, and remaining unknowns.
```

For a partial pasted log:

```text
Use $circuit-studio-repair to analyze the pasted text below as partial evidence.
Its original export mode and DRC freshness are unknown. Explain supported
interpretations and missing information; do not claim a full export or make
schematic edits from this fragment alone.
```

To continue a saved plan:

```text
Use $circuit-studio-repair to execute repair-prompt.md within my requested scope.
Match the current worksheet, inspect current state, skip satisfied goals,
reassess changed preconditions, and complete remaining clear steps.
Report requirement and preservation checks, fresh DRC, and unknowns.
```

Direct pasting supports analysis without Bridge. If local helpers are available, files and pasted raw/fenced JSON use the same parser. Plain incomplete text is accepted as `text` mode with unknown origin/check status. Generating a prompt does not modify a circuit; actual editing needs an executor connection and matching document.

## Intent and results

Natural notes such as "connect it back," "insert it here," or "keep this value" are useful evidence. The Agent compares notes, before/after states, object/pin identities, later events, and live state to test candidate interpretations. A decisive missing endpoint, property, or topology remains a question. The workflow cannot guarantee accurate interpretation of every ambiguous note and does not choose random edits until DRC is empty.

Reports use the same seven fields: input/mode/limitations; explicit request; inferred intent with evidence IDs and alternatives; targets/desired changes/preservation; steps (`ready`, `inspect`, `needs-input`, `already-satisfied`); decisive question; actual action/checks/unknowns.

| Artifact | Purpose |
| --- | --- |
| `evidence.json` | Received input, original parsed evidence, SHA-256, diagnostics, and a source index. |
| `repair-plan.json` | Goal, targets, desired states, preconditions, cited evidence, confidence, intent basis, and checks. |
| `repair-prompt.md` | English continuation instructions bound to the input hash, with raw evidence in its original language. |
| `execution-result.json` | Actual applied/satisfied/pending/failed/not-executed steps, checks, and unresolved issues. |
| Before/after design and DRC | Evidence of observed state and targeted recovery. |

The Agent checks changed state, user requirements, preservation constraints, and fresh DRC. A complete check or no DRC violations is not proof of electrical or functional correctness. Missing check data is not zero defects.

## Local commands

Run these from the repository root:

```shell
node circuit-studio-repair/scripts/self-check.mjs
node circuit-studio-repair/scripts/report.mjs normalize export.json evidence.json
node circuit-studio-repair/scripts/report.mjs normalize pasted.txt evidence.json
node circuit-studio-repair/scripts/report.mjs normalize - evidence.json
node circuit-studio-repair/scripts/report.mjs compile export.json repair-plan.json repair-prompt.md
node circuit-studio-repair/scripts/report.mjs compile - repair-plan.json repair-prompt.md
node circuit-studio-repair/scripts/bridge.mjs health
```

`-` reads standard input; provide the same exact input bytes for normalization and compilation. The hash covers received bytes before removing a BOM/fence or parsing JSON, so reformatting changes it. A locally saved paste's hash does not establish byte equality with a remote original file. The normalizer preserves evidence; the Agent writes the semantic plan. Compilation checks plan structure and references, not intent or engineering correctness. Chat-only analysis must state when byte-level provenance or script execution is unverified.

See [export formats](circuit-studio-repair/references/export-formats.md), [intent and plans](circuit-studio-repair/references/intent-and-plan.md), [Bridge execution](circuit-studio-repair/references/bridge-execution.md), and [participant instructions](circuit-studio-repair/assets/participant-guide.md).

## Optional confirmed preferences

Local memory can reuse an explicitly confirmed preference or correction for one exact project. It is an editable local record, not model training. The Agent must retain the user's actual confirmation quotation and timestamp; it cannot save its own inferred preferences. Current instructions, live state, and engineering constraints always take priority. No personal memory is included in this repository.

Keep memory files outside the repository and installed skill:

```shell
node circuit-studio-repair/scripts/memory.mjs list MEMORY.json PROJECT_ID
node circuit-studio-repair/scripts/memory.mjs remember MEMORY.json ENTRY.json
node circuit-studio-repair/scripts/memory.mjs forget MEMORY.json PROJECT_ID ENTRY_ID
```

See [confirmed local preferences](circuit-studio-repair/references/preferences.md) for the entry schema and scope rules. New plans can list used entry IDs in optional `context.preferenceIds`; older v1 plans remain compatible.

## Examples and boundaries

[Synthetic examples](circuit-studio-repair/assets/examples/) demonstrate Lint, Recorder, and failed Hybrid inputs with plans/prompts. Their document ID is `SYNTHETIC-EXAMPLE`. Read or test them offline; do not apply them to a real schematic. Self-checks validate parsing, prompt compilation, and a simulated Bridge, not live EasyEDA electrical behavior.

Bridge helpers discover local `easyeda-bridge` on ports 49620-49629; multiple windows require verified identity. Before writing, the Agent saves current source, verifies target objects and current preconditions, and uses bounded changes. It reads back uncertain outcomes before retrying and normally stops after two local repair rounds or a repeated failure/no progress.

Lint/text commonly lack document identity. Coordinate contact alone does not prove electrical connectivity, and rapid recording can omit intermediate states. Keep real participant records, design exports, and credentials outside this public repository; exports can contain complete schematic source.

The [skill entry](circuit-studio-repair/SKILL.md) is the Agent workflow. [LICENSE](LICENSE) provides the MIT terms. The DRC reader retains the v1.2.21 implementation's license and attribution.
