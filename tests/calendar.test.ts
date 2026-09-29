import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  CALENDAR_SCOPE,
  authorizationUrl,
  calendarEvent,
  eventId,
  insertCalendarEvent,
  seal,
  unseal,
} from "../src/lib/calendar/google.js";
import type { GroupOverview } from "../src/lib/group-view.js";

const overview = {
  group: {
    id: "group",
    name: "Weekend",
    startsAt: "2030-01-05T10:00:00Z",
    timeZone: "Asia/Seoul",
  },
  evaluation: { winnerId: "a", catalog: [{ id: "a", name: "Example cabin" }] },
  signingPolicy: { policy: { private: "must not leave" } },
  participants: [{ walletAddress: "0xprivate", displayName: "Private person" }],
} as unknown as GroupOverview;
test("calendar event uses explicit duration, prototype status and only public plan details", () => {
  const event = calendarEvent(overview, 120, "abc");
  assert.equal(event.end.dateTime, "2030-01-05T12:00:00.000Z");
  assert.equal(event.status, "tentative");
  assert.equal(event.visibility, "private");
  assert.equal(event.transparency, "transparent");
  assert.equal(event.start.timeZone, "Asia/Seoul");
  assert.match(event.summary, /prototype/);
  assert.doesNotMatch(
    JSON.stringify(event),
    /0xprivate|Private person|must not leave/,
  );
  assert.equal("attendees" in event, false);
  assert.throws(() => calendarEvent(overview, 0, "abc"));
  assert.throws(() =>
    calendarEvent({ ...overview, signingPolicy: null }, 120, "abc"),
  );
});
test("encrypted Google tokens are authenticated and bound to their owning wallet", () => {
  const key = randomBytes(32),
    encrypted = seal("refresh-secret", "wallet-a", key);
  assert.equal(unseal(encrypted, "wallet-a", key), "refresh-secret");
  assert.throws(() => unseal(encrypted, "wallet-b", key));
  const tampered = Buffer.from(encrypted, "base64url");
  tampered[15] = tampered[15]! ^ 1;
  assert.throws(() => unseal(tampered.toString("base64url"), "wallet-a", key));
  assert.doesNotMatch(encrypted, /refresh-secret/);
});
test("calendar IDs survive retries but isolate Google accounts and group members", () => {
  assert.equal(eventId("g", "0xAB", "s"), eventId("g", "0xab", "s"));
  assert.notEqual(eventId("g", "a", "s"), eventId("g", "b", "s"));
  assert.notEqual(eventId("g", "a", "s"), eventId("g", "a", "t"));
  assert.match(eventId("g", "a", "s"), /^[a-f0-9]{64}$/);
});
test("Google authorization uses offline consent, PKCE and limited event scope; duplicate insertion recovers the existing event", async () => {
  const previous = { ...process.env },
    originalFetch = globalThis.fetch;
  process.env.GOOGLE_CLIENT_ID = "test";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  process.env.APP_ORIGIN = "http://localhost:3000";
  try {
    const url = new URL(authorizationUrl("state", "verifier"));
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      url.searchParams.get("scope"),
      `openid email ${CALENDAR_SCOPE}`,
    );
    const event = calendarEvent(overview, 60, "abc"),
      calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const address = String(input);
      calls.push(address);
      if (address.includes("oauth2.googleapis.com"))
        return Response.json({ access_token: "access" });
      if (init?.method === "POST") {
        assert.match(address, /sendUpdates=none/);
        return new Response(null, { status: 409 });
      }
      return Response.json({
        id: "abc",
        status: "tentative",
        htmlLink: "https://www.google.com/calendar/event?eid=test",
        extendedProperties: { private: { convergeEvent: "abc" } },
      });
    };
    assert.match(
      await insertCalendarEvent("refresh", event),
      /^https:\/\/www.google.com/,
    );
    assert.equal(calls.length, 3);
    assert.match(calls[2]!, /events\/abc$/);
    globalThis.fetch = async (input) =>
      String(input).includes("oauth2.googleapis.com")
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({});
    await assert.rejects(
      () => insertCalendarEvent("revoked", event),
      /RECONNECT_GOOGLE/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_TOKEN_ENCRYPTION_KEY",
      "APP_ORIGIN",
    ]) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
