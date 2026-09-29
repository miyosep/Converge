# Kiln Integration

## Selected Model

The project owner reported an updated competition announcement on September 29,
2026 (KST) and explicitly selected `qwen3-32b` for all project work. This replaces
the old model requirement in the original pasted brief; the historical brief is
not edited. Constants, usage validation, tests, environment examples, and project
documentation now agree on the new model. It is not a temporary fallback.

The official [model reference](https://kiln.bricksum.com/docs/en/models) lists
Qwen3 32B as available and without structured-output support. Availability must
be checked against the live authenticated model list or actual successful calls,
not assumed permanently from documentation.

## Setup and Live Check

Use Node.js 24.19.0 and pnpm 11.19.0 on Windows or macOS. Put credentials only in
the ignored root `.env`:

```dotenv
KILN_API_KEY=<local secret>
KILN_BASE_URL=https://api.bricksum.com/v1
KILN_MODEL=qwen3-32b
```

Run `pnpm kiln:check`. It sends two synthetic preferences, checks the schema and
expected meanings, and replaces `docs/evidence/kiln-smoke.json` with the latest
result. Every invocation consumes API usage. No wallet keys are used, no user
confirmation is invented, and no transactions are sent. The saved synthetic text
is intentional; production inputs and outputs must not go into public evidence.
The script is a single-process smoke tool, not a concurrent production logger.

The initial live check passed with two HTTP 200 responses and no retries. The
provider reported 2,004 input tokens, 824 output tokens, and 2,828 total tokens;
reported costs sum to USD 0.00035184. These are observed responses, not a price
guarantee. Two synthetic examples do not prove extraction quality for arbitrary
preferences or the complete six-person application.

## Adapter Contract

`createKilnClient` is Node-only and accepts credentials explicitly. It allows
only the verified HTTPS base URL and rejects redirects. Calls use non-streaming
chat completions, a default 2,048-token output budget, and no tools, forced JSON
format, or model-specific reasoning-effort setting. The extraction prompt asks
for JSON and treats the preference text as untrusted data, not instructions.
All returned output is parsed and validated against a strict application schema.
This is validation, not a guarantee of semantic correctness: user review remains
mandatory before a real preference revision can be confirmed.

The adapter defaults to a 45-second timeout per attempt, two total attempts,
and a 256 KiB response limit. Authentication and credit errors do not retry.
Network errors, HTTP 429, and server errors may retry within the attempt budget.
Provider retry delays above five seconds are returned to the caller instead of
being violated. One malformed JSON/schema repair can use the remaining attempt;
the previous response is not fed back into the prompt. Truncated completions,
unexpected tool calls, empty output, or wrong model identity fail closed.

See the official [chat API](https://kiln.bricksum.com/docs/en/api-reference/chat-completions)
and [error reference](https://kiln.bricksum.com/docs/en/errors) for the provider
contract. No opaque provider error body is included in application errors.

## Usage and Privacy

Every inference attempt invokes the required `onAttempt` callback, including
failed and repaired attempts. A storage failure prevents reporting success.
The record includes run/flow, local and provider request IDs, model, attempt,
status, timestamps, latency, token counts, reported USD cost, cached-input and
reasoning counts when present, and prompt/schema versions. Unknown values are
`null`, never fabricated zeroes. Energy remains `null`; these responses do not
independently attest NPU execution or energy savings.

The callback excludes prompts, outputs, authorization headers, and API keys.
Production storage must preserve this boundary and authorize access to per-user
data. Provider billing semantics are documented under
[usage and billing](https://kiln.bricksum.com/docs/en/usage-billing).

## Remaining Integration

Authenticated private submissions, persistent revisions, human corrections,
explicit confirmations, and blocking of unresolved clarifications are connected
to the web app. The ordinary-group decision engine also saves public candidate
results and prepares an immutable off-chain policy. Pending work includes
privacy-safe explanation generation, durable per-flow aggregates, application
cache accounting, on-chain ordinary-group execution, and the baseline plus two
changed-condition full application runs. The existing blockchain-only baseline
predates these live calls and must not be labeled AI-driven retroactively.
