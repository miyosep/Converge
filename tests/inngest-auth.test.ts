import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

test("hosted Inngest endpoint rejects unsigned requests even with the dev flag set", async () => {
  const original = { ...process.env };
  try {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.INNGEST_DEV = "true";
    process.env.INNGEST_SIGNING_KEY = `signkey-test-${"a".repeat(64)}`;
    process.env.BACKGROUND_DRIVER = "inngest";
    process.env.BACKGROUND_JOBS_ENABLED = "true";
    const { POST } = await import("../app/api/inngest/route.js");
    const response = await POST(
      new NextRequest(
        "http://localhost/api/inngest?fnId=converge-process-saved-work&stepId=step",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: {
              name: "converge/job.requested",
              data: { kind: "explore", id: "a".repeat(64) },
            },
          }),
        },
      ),
      { params: Promise.resolve({}) },
    );
    assert.equal(response.status, 401);
  } finally {
    process.env = original;
  }
});
