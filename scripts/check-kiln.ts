import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { KILN_MODEL } from "../src/lib/constants.js";
import {
  createKilnClient,
  KilnError,
  KILN_BASE_URL,
  type KilnAttempt,
} from "../src/lib/kiln/client.js";
import { extractPreferences } from "../src/lib/kiln/extraction.js";

const attempts: KilnAttempt[] = [];
const outputs: unknown[] = [];
const path = "docs/evidence/kiln-smoke.json";
async function save(status: string, errorCode: string | null = null) {
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        schemaVersion: 1,
        checkedAt: new Date().toISOString(),
        model: KILN_MODEL,
        status,
        errorCode,
        syntheticInputs: true,
        participantConfirmed: false,
        scope:
          "Live extraction smoke test only; no app session, policy, or transaction.",
        attempts,
        outputs,
      },
      null,
      2,
    ) + "\n",
  );
}
try {
  if (process.env.KILN_MODEL !== KILN_MODEL)
    throw new KilnError("MODEL_CONFIGURATION_MISMATCH");
  const client = createKilnClient({
    apiKey: process.env.KILN_API_KEY ?? "",
    baseUrl: process.env.KILN_BASE_URL || KILN_BASE_URL,
    onAttempt: async (attempt) => {
      attempts.push(attempt);
      await save("running");
    },
  });
  const samples = [
    {
      persona: "Alice",
      text: "My maximum meal budget is 35 USD per person. I prefer a quiet restaurant.",
    },
    {
      persona: "Bob",
      text: "I have a shellfish allergy. Shellfish-safe food is mandatory. I prefer being near a subway station.",
    },
  ];
  for (const sample of samples) {
    const extraction = await extractPreferences(client, {
      runId: "kiln-smoke",
      text: sample.text,
    });
    outputs.push({ ...sample, extraction });
    assert.deepEqual(extraction.clarifications, []);
    assert.deepEqual(extraction.unsupportedRequirements, []);
    if (sample.persona === "Alice") {
      assert.equal(extraction.constraints.length, 2);
      assert.ok(
        extraction.constraints.some(
          (c) => c.field === "budget_per_person_cents" && c.value === 3500,
        ),
      );
      assert.ok(
        extraction.constraints.some(
          (c) => c.type === "soft" && c.field === "quiet" && c.weight === 1,
        ),
      );
    } else {
      assert.equal(extraction.constraints.length, 2);
      assert.ok(
        extraction.constraints.some(
          (c) => c.field === "shellfish_safe" && c.value === true,
        ),
      );
      assert.ok(
        extraction.constraints.some(
          (c) =>
            c.type === "soft" &&
            c.field === "subway_proximity" &&
            c.weight === 1,
        ),
      );
    }
  }
  await save("passed");
  console.log(
    `Live ${KILN_MODEL} extraction passed for two synthetic inputs. Evidence: ${path}`,
  );
} catch (error) {
  const code = error instanceof KilnError ? error.code : "SMOKE_CHECK_FAILED";
  await save("failed", code);
  console.error(`Kiln smoke check failed: ${code}. See sanitized evidence.`);
  process.exitCode = 1;
}
