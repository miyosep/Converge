import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getAddress } from "viem";
import {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_STAGES,
  diagnosticSchema,
  SHARED_FALLBACK_CODES,
} from "../src/lib/diagnostics/index.js";

const codes = Object.keys(DIAGNOSTIC_CODES);

test("every registered code declares a complete, self-consistent specification", () => {
  for (const code of codes) {
    const spec = DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES];
    assert.match(code, /^(DEC|PRF|PLN|FUND|CHN|SET|INF|SHR)_[A-Z0-9_]+$/, code);
    assert.ok(DIAGNOSTIC_STAGES.includes(spec.stage), code);
    assert.ok(["info", "warning", "error"].includes(spec.severity), code);
    assert.ok(
      ["user", "group", "operator", "none"].includes(spec.remedy),
      code,
    );
    assert.equal(typeof spec.retryable, "boolean", code);
    assert.equal(typeof spec.shareable, "boolean", code);
    assert.ok(spec.title.length > 0 && spec.title.length <= 200, code);
    assert.ok(spec.guidance.length > 0 && spec.guidance.length <= 500, code);
  }
});

test("the code prefix agrees with the declared stage", () => {
  const prefixStage: Record<string, string> = {
    DEC: "eligibility",
    PRF: "preference",
    PLN: "approval",
    FUND: "funding",
    CHN: "execution",
    SET: "settlement",
    INF: "infrastructure",
  };
  for (const code of codes) {
    const spec = DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES];
    const prefix = code.slice(0, code.indexOf("_"));
    // SHR_ codes are stage-agnostic by design: there is exactly one stand-in per
    // stage, so the prefix deliberately does not imply a stage.
    if (prefix === "SHR") continue;
    // DEC_ also covers the input and ranking stages, which share its prefix.
    if (prefix === "DEC")
      assert.ok(
        ["input", "eligibility", "ranking"].includes(spec.stage),
        `${code} -> ${spec.stage}`,
      );
    else assert.equal(spec.stage, prefixStage[prefix], code);
  }
});

test("every non-shareable code has a shareable stage stand-in, and no stand-in is itself private", () => {
  // This is the invariant the group-visible projection depends on. If a stage
  // fallback were itself marked non-shareable, `publicDiagnostic` would swap one
  // private code for another and leak the condition it was meant to hide.
  for (const code of codes) {
    const spec = DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES];
    if (!spec.shareable)
      assert.ok(
        SHARED_FALLBACK_CODES[spec.stage],
        `${code} (${spec.stage}) has no stand-in`,
      );
  }
  for (const [stage, code] of Object.entries(SHARED_FALLBACK_CODES)) {
    const spec = DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES];
    assert.ok(spec, `${stage} stand-in ${code} is not registered`);
    assert.equal(spec.shareable, true, `${code} must be shareable`);
    assert.match(code, /^SHR_/, `${code} must be a dedicated stand-in`);
    assert.equal(
      DIAGNOSTIC_STAGES.includes(stage as never),
      true,
      `unknown stage ${stage}`,
    );
  }
  // A stand-in must never be emitted by an analyzer, only by the projection.
  const standins = new Set(Object.values(SHARED_FALLBACK_CODES));
  const stages = new Set(DIAGNOSTIC_STAGES);
  assert.equal(
    [...standins].some((code) => !stages.has(DIAGNOSTIC_CODES[code].stage)),
    false,
  );
});

test("no stand-in code is used as a real condition anywhere in the source", async () => {
  // A `SHR_` code reaching `diagnostic()` directly would mean a condition was
  // reported generically when it could have been reported precisely.
  const analyzerModules = ["evaluation", "operations", "chain"];
  const projected = await readFile(
    new URL("../src/lib/diagnostics/types.ts", import.meta.url),
    "utf8",
  );
  for (const name of analyzerModules) {
    const source = await readFile(
      new URL(`../src/lib/diagnostics/${name}.ts`, import.meta.url),
      "utf8",
    );
    const emitted = [...source.matchAll(/code:\s*"(SHR_[A-Z0-9_]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(emitted, [], `${name}.ts emits a stand-in directly`);
  }
  // The stand-ins must be reachable only through the projection table.
  for (const code of Object.values(SHARED_FALLBACK_CODES))
    assert.equal(
      projected.includes(code),
      true,
      `${code} missing from types.ts`,
    );
});

test("guidance text carries no participant addresses or revision identifiers", () => {
  for (const code of codes) {
    const spec = DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES];
    assert.equal(/0x[0-9a-fA-F]{40}/.test(spec.guidance), false, code);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(spec.guidance), false, code);
    // Guidance is shared verbatim, so it must not name a specific catalog field
    // value that would reveal one participant's constraint.
    assert.equal(/\$\d/.test(spec.guidance), false, code);
  }
});

test("no duplicate codes exist and lookup refuses unregistered strings", async () => {
  const { isDiagnosticCode, diagnosticSpec } =
    await import("../src/lib/diagnostics/codes.js");
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(isDiagnosticCode("DEC_NO_ELIGIBLE_CANDIDATE"), true);
  assert.equal(isDiagnosticCode("DEC_NOT_A_REAL_CODE"), false);
  assert.equal(isDiagnosticCode("dec_no_eligible_candidate"), false);
  // An unregistered key has no specification. `isDiagnosticCode` is the guard
  // callers must use before reaching the registry.
  assert.equal(
    (DIAGNOSTIC_CODES as Record<string, unknown>)["NOPE"],
    undefined,
  );
  assert.equal(isDiagnosticCode("NOPE"), false);
  void diagnosticSpec;
});

test("diagnostic construction derives classification from the registry, not the caller", async () => {
  const { diagnostic, diagnosticSchema } =
    await import("../src/lib/diagnostics/types.js");
  const entry = diagnostic({ code: "CHN_EXPIRED" });
  assert.equal(entry.severity, "error");
  assert.equal(entry.stage, "execution");
  assert.equal(entry.retryable, false);
  assert.equal(entry.remedy, "operator");
  assert.equal(entry.participant, null);
  assert.equal(entry.revisionId, null);
  assert.equal(entry.field, null);
  assert.equal(entry.detail, null);
  // Re-deriving the same code yields the same classification regardless of how
  // the caller reached it, which is what makes the registry authoritative.
  const again = diagnostic({ code: "CHN_EXPIRED", participant: null });
  assert.deepEqual(again, entry);
  // The schema validates shape only. It cannot detect that a hand-built object
  // disagrees with the registry, which is exactly why `diagnostic()` exists and
  // why callers must not construct the object literal themselves.
  const forged = {
    ...entry,
    severity: "info",
    title: "Fine",
  };
  assert.doesNotThrow(() => diagnosticSchema.parse(forged));
  assert.notEqual(forged.severity, entry.severity);
  assert.notEqual(
    diagnostic({ code: "CHN_EXPIRED" }).severity,
    forged.severity,
  );
});

test("a diagnostic rejects an unknown code and an over-long detail value", async () => {
  const { diagnosticSchema } = await import("../src/lib/diagnostics/types.js");
  const valid = {
    code: "DEC_SCORE_TIE",
    severity: "info",
    stage: "ranking",
    retryable: false,
    remedy: "none",
    title: "Scores tied",
    guidance: "Deterministic tie-break applies.",
    participant: null,
    revisionId: null,
    field: null,
    detail: null,
  };
  assert.doesNotThrow(() => diagnosticSchema.parse(valid));
  assert.throws(() => diagnosticSchema.parse({ ...valid, code: "MADE_UP" }));
  assert.throws(() =>
    diagnosticSchema.parse({ ...valid, detail: { blob: "x".repeat(201) } }),
  );
});

test("participant attribution must be a valid EVM address when present", async () => {
  const { diagnostic } = await import("../src/lib/diagnostics/types.js");
  const address = getAddress(`0x${"1".repeat(40)}`);
  assert.equal(
    diagnostic({ code: "DEC_CONSTRAINT_UNSATISFIED", participant: address })
      .participant,
    address,
  );
  assert.throws(() =>
    diagnostic({
      code: "DEC_CONSTRAINT_UNSATISFIED",
      participant: "not-an-address",
    }),
  );
});
