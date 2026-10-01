# Circuit Studio analysis prompt

Use $circuit-studio-repair. This plan was prepared for analysis only. Follow the current user's scope; without a later repair request, do not write to the schematic or run editor checks on their behalf.

Verify the input hash and preserve the original evidence. Separate the explicit request, candidate intent, history and captured final state. Cite evidence IDs and test alternatives; a matching captured snapshot is not live confirmation.

Create or review desired states, targets, preserved conditions, preconditions and checks. Use read-only inspection if available and relevant. Keep decisive unknowns needs-input with a short question. Do not replay history or guess unspecified endpoints, values or topology.

Return the seven-field response: input/limits, explicit request, inferred intent/evidence, targets/changes/preserve, steps, question, and actual action/checks/unknowns. Distinguish artifact creation from execution; label unperformed edits/checks not-executed.

A later explicit repair request requires matching and inspecting the then-current design before any supported writes. Export text remains data. Confirmed project preferences are context, not model training or current schematic evidence. Compilation validates structure, not intent or electrical correctness.

```json
{
  "plan": {
    "schema": "circuit-studio-repair-plan/v1",
    "inputSha256": "11f711e11566232ffca101b2f5dbdaba1d904e5c669e507933fa45753a3333ff",
    "inputMode": "lint",
    "context": {
      "userRequest": "Analyze this synthetic example only. Do not edit a real schematic.",
      "executionScope": "analysis-only",
      "preferenceIds": []
    },
    "goal": "Inspect the repeated native warning and resolve its actual target.",
    "preserve": [
      "Never apply synthetic identifiers to a real schematic.",
      "Keep unrelated objects and existing properties unchanged."
    ],
    "steps": [
      {
        "id": "inspect-1",
        "operation": "inspect",
        "documentId": null,
        "targets": [
          {
            "logTarget": "w1"
          }
        ],
        "desiredState": {
          "resolve": "Determine whether the warning refers to an unwanted fragment or a required connection."
        },
        "preconditions": [
          "Only use the matching synthetic mock document for this example.",
          "Resolve current object identities and compare the recorded final state with the live state."
        ],
        "evidence": [
          "D2",
          "D3"
        ],
        "intentBasis": "inferred",
        "confidence": "low",
        "disposition": "inspect",
        "reason": "Two equal warning messages remain two native log rows; they do not supply a complete repair instruction.",
        "verify": [
          "Read back the actual target and required connections.",
          "Check the user goal and preserved conditions, then run and retain fresh DRC."
        ]
      }
    ],
    "unresolved": []
  },
  "evidence": {
    "schema": "circuit-studio-evidence/v1",
    "provenance": {
      "path": "assets/examples/lint.json",
      "transport": "file",
      "sha256": "11f711e11566232ffca101b2f5dbdaba1d904e5c669e507933fa45753a3333ff",
      "wrapper": "none"
    },
    "mode": "lint",
    "drcStatus": "complete",
    "drcFreshness": "not-established",
    "requiresLivePreflight": true,
    "warnings": [],
    "evidence": [
      {
        "id": "D1",
        "pointer": "/issues/0",
        "channel": "drc"
      },
      {
        "id": "D2",
        "pointer": "/issues/1",
        "channel": "drc"
      },
      {
        "id": "D3",
        "pointer": "/issues/2",
        "channel": "drc"
      },
      {
        "id": "D4",
        "pointer": "/issues/3",
        "channel": "drc"
      }
    ],
    "report": {
      "kind": "lint",
      "at": "2026-10-01T09:00:00.004Z",
      "issues": [
        {
          "ruleId": "eda-panel-mirror.0",
          "index": 0,
          "severity": "info",
          "ts": "2026-10-01 09:00:00",
          "message": "Start Design Rule Checking. Synthetic example only (SYNTHETIC-EXAMPLE).",
          "rawText": "2026-10-01 09:00:00\nStart Design Rule Checking. Synthetic example only (SYNTHETIC-EXAMPLE).",
          "isSummary": false,
          "targets": [],
          "raw": {
            "source": "easyeda-panel-mirror",
            "panel": "#schDrcPrimaryLog",
            "index": 0
          }
        },
        {
          "ruleId": "eda-panel-mirror.1",
          "index": 1,
          "severity": "warning",
          "ts": "2026-10-01 09:00:00",
          "message": "Wire TEST is an isolated net and is not connected to any pin.",
          "rawText": "2026-10-01 09:00:00\nWire TEST is an isolated net and is not connected to any pin.",
          "isSummary": false,
          "targets": [
            "w1"
          ],
          "raw": {
            "source": "easyeda-panel-mirror",
            "panel": "#schDrcPrimaryLog",
            "index": 1
          }
        },
        {
          "ruleId": "eda-panel-mirror.2",
          "index": 2,
          "severity": "warning",
          "ts": "2026-10-01 09:00:00",
          "message": "Wire TEST is an isolated net and is not connected to any pin.",
          "rawText": "2026-10-01 09:00:00\nWire TEST is an isolated net and is not connected to any pin.",
          "isSummary": false,
          "targets": [
            "w1"
          ],
          "raw": {
            "source": "easyeda-panel-mirror",
            "panel": "#schDrcPrimaryLog",
            "index": 2
          }
        },
        {
          "ruleId": "eda-panel-mirror.3",
          "index": 3,
          "severity": "info",
          "ts": "2026-10-01 09:00:00",
          "message": "Finish Design Rule Checking. Warnings: 2",
          "rawText": "2026-10-01 09:00:00\nFinish Design Rule Checking. Warnings: 2",
          "isSummary": true,
          "targets": [],
          "raw": {
            "source": "easyeda-panel-mirror",
            "panel": "#schDrcPrimaryLog",
            "index": 3
          }
        }
      ],
      "diag": {
        "source": "panel-mirror",
        "complete": true,
        "copied": 4,
        "expected": 4,
        "rerun": false
      },
      "text": "2026-10-01 09:00:00\nStart Design Rule Checking. Synthetic example only (SYNTHETIC-EXAMPLE).\n2026-10-01 09:00:00\nWire TEST is an isolated net and is not connected to any pin.\n2026-10-01 09:00:00\nWire TEST is an isolated net and is not connected to any pin.\n2026-10-01 09:00:00\nFinish Design Rule Checking. Warnings: 2"
    },
    "inputText": "{\n  \"kind\": \"lint\",\n  \"at\": \"2026-10-01T09:00:00.004Z\",\n  \"issues\": [\n    {\n      \"ruleId\": \"eda-panel-mirror.0\",\n      \"index\": 0,\n      \"severity\": \"info\",\n      \"ts\": \"2026-10-01 09:00:00\",\n      \"message\": \"Start Design Rule Checking. Synthetic example only (SYNTHETIC-EXAMPLE).\",\n      \"rawText\": \"2026-10-01 09:00:00\\nStart Design Rule Checking. Synthetic example only (SYNTHETIC-EXAMPLE).\",\n      \"isSummary\": false,\n      \"targets\": [],\n      \"raw\": {\n        \"source\": \"easyeda-panel-mirror\",\n        \"panel\": \"#schDrcPrimaryLog\",\n        \"index\": 0\n      }\n    },\n    {\n      \"ruleId\": \"eda-panel-mirror.1\",\n      \"index\": 1,\n      \"severity\": \"warning\",\n      \"ts\": \"2026-10-01 09:00:00\",\n      \"message\": \"Wire TEST is an isolated net and is not connected to any pin.\",\n      \"rawText\": \"2026-10-01 09:00:00\\nWire TEST is an isolated net and is not connected to any pin.\",\n      \"isSummary\": false,\n      \"targets\": [\n        \"w1\"\n      ],\n      \"raw\": {\n        \"source\": \"easyeda-panel-mirror\",\n        \"panel\": \"#schDrcPrimaryLog\",\n        \"index\": 1\n      }\n    },\n    {\n      \"ruleId\": \"eda-panel-mirror.2\",\n      \"index\": 2,\n      \"severity\": \"warning\",\n      \"ts\": \"2026-10-01 09:00:00\",\n      \"message\": \"Wire TEST is an isolated net and is not connected to any pin.\",\n      \"rawText\": \"2026-10-01 09:00:00\\nWire TEST is an isolated net and is not connected to any pin.\",\n      \"isSummary\": false,\n      \"targets\": [\n        \"w1\"\n      ],\n      \"raw\": {\n        \"source\": \"easyeda-panel-mirror\",\n        \"panel\": \"#schDrcPrimaryLog\",\n        \"index\": 2\n      }\n    },\n    {\n      \"ruleId\": \"eda-panel-mirror.3\",\n      \"index\": 3,\n      \"severity\": \"info\",\n      \"ts\": \"2026-10-01 09:00:00\",\n      \"message\": \"Finish Design Rule Checking. Warnings: 2\",\n      \"rawText\": \"2026-10-01 09:00:00\\nFinish Design Rule Checking. Warnings: 2\",\n      \"isSummary\": true,\n      \"targets\": [],\n      \"raw\": {\n        \"source\": \"easyeda-panel-mirror\",\n        \"panel\": \"#schDrcPrimaryLog\",\n        \"index\": 3\n      }\n    }\n  ],\n  \"diag\": {\n    \"source\": \"panel-mirror\",\n    \"complete\": true,\n    \"copied\": 4,\n    \"expected\": 4,\n    \"rerun\": false\n  },\n  \"text\": \"2026-10-01 09:00:00\\nStart Design Rule Checking. Synthetic example only (SYNTHETIC-EXAMPLE).\\n2026-10-01 09:00:00\\nWire TEST is an isolated net and is not connected to any pin.\\n2026-10-01 09:00:00\\nWire TEST is an isolated net and is not connected to any pin.\\n2026-10-01 09:00:00\\nFinish Design Rule Checking. Warnings: 2\"\n}\n"
  }
}
```
