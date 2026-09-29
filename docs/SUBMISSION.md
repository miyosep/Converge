# Track A Submission Checklist

Source: the organizer's complete submission email supplied by the project owner. Submission deadline: **September 30, 2026, 12:00 KST**, with no late submissions accepted. Initial judging reviews the submitted materials; the Top 3 announcement is at 15:00 KST, followed by final presentations at 16:00 KST. Remote finalists use the organizer's Zoom link.

## Required Deliverables

| Deliverable | Current record | Remaining work |
| --- | --- | --- |
| Public repository with a top-level declaration and run instructions | [README](../README.md) includes the declaration, setup, prior-work disclosure and per-flow evidence. | Check the submitted URL and anonymous access to the final branch. |
| Video, at most 3 minutes | Normal and lower-budget run evidence exists; no final video link is recorded here. | Record and link all three Track A behaviors below. |
| PDF or PPT deck, at most 10 pages | No final deck link is recorded here. | Produce and attach the deck used for a potential Top 3 pitch. |
| On-chain proof and Kiln API call logs per flow | [Three linked runs](../README.md#per-flow-on-chain-proof-and-kiln-logs) include receipts, logs and provider attempts. | Ensure the submitted video accurately identifies which flow each record proves. |
| Before/during-event disclosure | Owner confirmed no project-specific pre-built code, designs, templates or assets. [Disclosure](../README.md#pre-built-vs-hackathon-built-work) separates external dependencies. | Keep the disclosure accurate if additional material is introduced. |
| Team roster | Task ownership is recorded separately from final contributions. | Confirm the submitted team matches registration, or that changes were notified to the organizers. |

## The Three Track A Runs

| Run | What the video must show | Evidence currently available |
| --- | --- | --- |
| Normal | Inputs, the agent's interpretation, approval, permitted action and outcome. | [Baseline](evidence/group-acceptance-001-baseline.json): Restaurant A, 45 MockUSDC payment and six refunds. |
| Adaptation | Change a budget or deadline, then show the resulting changed decision and outcome. | [Lower budget](evidence/group-acceptance-001-lower-budget.json): $35 to $25 for one member, Restaurant B, 36 MockUSDC payment and six refunds. |
| Refusal | Supply an unattainable goal; show the explicit reason and stopped action. | `NO_MATCH` and policy blocking have [test coverage](../tests/decision-engine.test.ts); a recorded live refusal remains to be added. |

The [excluded-merchant run](evidence/group-acceptance-001-merchant-excluded.json) successfully purchases from B. It demonstrates adaptation, not refusal. Likewise, a contract rejecting an excessive payment proves a spending control; by itself it does not demonstrate the agent declining an unattainable user goal.

An illustrative refusal for the fixture flow is a budget that no permitted fixture can satisfy. Rehearse and record the actual response before using it in the submission. Live place search preserves unknown prices, so an extremely low budget must not be described as a demonstrated refusal unless the running system explicitly declines. Do not claim a stopped action based solely on an absent transaction.

Suggested video allocation, not a record of an existing video: 0:00–0:15 user problem; 0:15–1:10 normal run; 1:10–1:55 adaptation; 1:55–2:35 explicit refusal; 2:35–3:00 matching logs, receipts and prototype scope. If chain waits are edited out, label the cuts and show actual resulting receipts.

## Scope to Keep Visible

- Real Kiln calls and Sepolia transactions exist. Test tokens, demo recipients and simulated booking confirmation must remain labelled.
- Friends live-provider and local-chain checks are separate; do not relabel them as a continuous multi-human Sepolia run.
- Guided demo automated participants are disclosed. Recording them does not establish six independent users.
- Keep real private preferences and credentials out of public logs. Existing published inputs are synthetic.

The organizer requires both Kiln usage and on-chain integration, and says undisclosed pre-built work results in disqualification. This checklist is preparation material, not confirmation that a submission has been made.
