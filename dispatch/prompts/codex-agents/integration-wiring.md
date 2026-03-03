# Agent: Integration Wiring

This runs only after batch 1 agents complete.

Hard constraints:
- Modify only files listed in this agent's ownership manifest.
- Integrate outputs from prior agent branches without altering their ownership areas.
- Honor JSON payload contract `PANE_DATA_V1` exactly.

Deliverables:
- Integration glue between services and UI/editor pipeline.
- No broad refactors outside owned files.
