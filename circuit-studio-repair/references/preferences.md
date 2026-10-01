# Confirmed local preferences

Optional local memory records a user's explicitly confirmed project preference or correction. It supplies inspectable context for later tasks; it does not train or update a model. The repository contains no personal memory. Store `MEMORY.json` and real entry files outside the repository and installed skill.

## Commands

```text
node "SKILL_DIR/scripts/memory.mjs" list MEMORY.json PROJECT_ID
node "SKILL_DIR/scripts/memory.mjs" remember MEMORY.json ENTRY.json
node "SKILL_DIR/scripts/memory.mjs" forget MEMORY.json PROJECT_ID ENTRY_ID
```

An entry uses this structure:

```json
{
  "id": "example-preference",
  "projectId": "example-project",
  "type": "preference",
  "text": "Keep existing designators unless I explicitly request renaming.",
  "confirmation": {
    "quote": "Remember this for example-project: keep existing designators unless I explicitly request renaming.",
    "at": "2026-10-01T12:00:00Z"
  },
  "source": {
    "file": "path-to-confirmation-record",
    "sha256": "actual-source-hash"
  }
}
```

`type` is preference or correction. `source` is optional; include only an actual inspected file/hash. This is a schema illustration, not a real user's confirmation and not an instruction to create memory.

## Confirmation and use

Before `remember`, obtain an explicit statement from the user confirming that the specific preference or correction should be saved for that exact project. Record the user's quotation and the actual confirmation timestamp. Do not save an inferred preference because it appears sensible, because the Agent has repeated a choice, or because a report note suggests it. A correction to the current task alone is not permission to remember it for later tasks.

The command validates record fields; it cannot establish who spoke the quotation or whether consent occurred. The Agent must ground the entry in the user's real confirmation. Do not fabricate quotations, times, or source evidence. Existing explicit authorization to save that entry need not be requested again.

Load only entries matching the current exact `projectId`. Never borrow another project's entries, infer a global default, or treat a filename as project identity. If scope cannot be determined, omit memory until it can be matched. List entries before applying them and include used IDs in the plan's optional `context.preferenceIds`.

Current instructions take priority. A remembered preference cannot override live design state, evidence, engineering constraints, or a missing decisive design choice. A preference for reusing labels, for example, does not establish that distinct nets should be connected. Mark a remembered correction as context rather than current schematic evidence.

Entries remain readable, editable, and removable. To revise an entry, prepare the confirmed replacement and use `remember`; use `forget` with its project and ID to remove it. Keep the confirmation record with the stored meaning and do not silently broaden its scope.
