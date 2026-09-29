# Qwen tool-calling evaluation

Scope: English restaurant requests, live Kiln `qwen3-32b` inference, synthetic
search results. No actual Kakao/Google search, booking, payment or blockchain
transaction is included. The English-only scope was requested by the owner.

## Capability and application boundary

The [official model table](https://kiln.bricksum.com/docs/en/models) lists auto
tool calling, but not forced/named tool choice, parallel calls or structured
outputs for this model. The authenticated model list and successful inference
calls also verified model availability during this evaluation.

`src/lib/kiln/client.ts` currently rejects tool calls. Restaurant discovery
currently extracts constraints, then calls the provider from application code.
The evaluation script is separate; it does not enable tools in that adapter.

Run `scripts/verify-kiln-tool-calling.ts --live` with the existing Node/tsx
environment and local Kiln credentials to repeat the metered English suite.
Evidence contains synthetic inputs, outputs, request IDs, latency and usage by
flow. Keys are excluded. Every run writes a new file under `docs/evidence`.

## Observed English-only results (September 30, 2026 KST)

[Raw evidence](evidence/kiln-tool-calling-2026-09-29T15-22-53-297Z.json):
10 scenarios, 18 inference calls, 5/10 strict automated passes. No retries.

| Flow | Calls | Input tokens | Output tokens | Total tokens | Reported USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tool selection | 10 | 7,400 | 3,774 | 11,174 | 0.00136208 |
| Result interpretation | 8 | 6,925 | 3,297 | 10,222 | 0.00123828 |
| Total | 18 | 14,325 | 7,071 | 21,396 | 0.00260036 |

Eight of nine requests expected to search produced exactly one valid tool call;
all eight preserved the tested area, cuisine, numeric budget and party size.
The missing-area request correctly clarified without searching. The request
without a budget/party size incorrectly requested those optional details instead
of searching with null arguments.

Three failures wrapped otherwise plausible final JSON in Markdown fences
(repeated baseline, provider error, injected result). An empty successful search
was incorrectly labeled unavailable rather than completed with no candidates.
The injected result did not cause a payment tool call or inclusion of the
over-budget candidate, but this single example is not a security benchmark.

Manual review found an additional semantic defect in the automatically passing
lower-budget case: flags correctly said quietness was unverified, but the prose
said "Found 1 quiet Japanese candidate". Thus 5/10 is an automated contract score,
not a claim that five responses are fully correct. Do not rely on generated prose
for evidence labels. The complete logs preserve this defect.

The earlier mixed-language exploration is preserved in
[its own evidence](evidence/kiln-tool-calling-2026-09-29T15-19-29-351Z.json)
(15 calls, 16,693 tokens, reported USD 0.00188032). It is excluded from the
English-only score. Both runs together used 33 calls, 38,089 tokens and reported
USD 0.00448068. These small fixed fixtures do not measure general reliability,
multi-cuisine coverage, real search quality, multi-turn condition changes or
end-to-end spending control. The changed-condition cases are independent requests.

## MVP recommendation

Use Qwen to propose one `search_places` call, validate its arguments on the
server, execute the approved read-only provider, and return its results with the
matching tool-call ID. Keep the number of inference and tool steps bounded.
Do not require parallel calls or forced function selection.

Final UI status, candidate identity, budget enforcement and evidence labels
should be enforced by code using provider data. Never infer verified quietness
or group seating from a search hit. Kakao keyword results do not supply the
synthetic price fields used by this test, so real budget matching remains
unverified when the provider has no price evidence.

Validate final output against a schema. A narrowly defined whole-response JSON
code-fence unwrap can handle formatting, but cannot repair incorrect semantics.
On invalid output, use bounded repair or an explicit failure; do not accept it
silently. Keep search tools separate from payment authorization and execution.

## Hackathon fit

The brief requires actual Kiln calls whose results inform decisions, inspectable
workflow records, usage by flow, an on-chain outcome and two changed-condition
end-to-end runs. It does not explicitly require the function-calling protocol.
Tool calling can make the agent's search action more visible, but this isolated
test does not establish those end-to-end acceptance criteria.

The historical brief names `gpt-oss-120b`; `docs/KILN.md` records the owner's
September 29 confirmation that `qwen3-32b` is the current competition model.
This evaluation verifies technical capability, not organizer approval. Energy
is unmeasured and remains null; token usage is not an energy measurement.
