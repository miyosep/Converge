import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlansOverview } from "../app/components/plans-overview.js";

const base = {
  wallet: "0x1111111111111111111111111111111111111111",
  groups: [],
  loading: false,
  error: false,
  busy: false,
  notice: "",
  onRetry() {},
  onSignOut() {},
};

test("empty plans offers one creation entry without duplicate workspace navigation", () => {
  const html = renderToStaticMarkup(createElement(PlansOverview, base));
  assert.equal((html.match(/href="\/group\/new"/g) ?? []).length, 1);
  assert.match(html, /Start a plan/);
  assert.doesNotMatch(html, /Workspace navigation|Your shared decisions/);
  assert.match(html, /Open the link your friend shared/);
});

test("saved plan cards preserve real membership, dates, status and group destinations", () => {
  const html = renderToStaticMarkup(
    createElement(PlansOverview, {
      ...base,
      groups: [
        {
          id: "dinner/one",
          name: "Our dinner",
          category: "restaurant",
          startsAt: "2026-10-09T10:00:00Z",
          timeZone: "Asia/Seoul",
          locked: false,
          memberCount: 3,
          targetMemberCount: 6,
          confirmedCount: 2,
        },
      ],
    }),
  );
  assert.match(html, /href="\/group\/dinner%2Fone"/);
  assert.match(html, /3 of 6 joined/);
  assert.match(html, /2 confirmed/);
  assert.match(html, /Gathering preferences/);
  assert.match(html, /Asia\/Seoul/);
  assert.match(html, /dateTime="2026-10-09T10:00:00Z"/);
  assert.doesNotMatch(html, /YOUR FIRST GATHERING|Proposal saved/);
});

test("loading and failed requests never masquerade as an empty plans list", () => {
  const loading = renderToStaticMarkup(
    createElement(PlansOverview, { ...base, loading: true }),
  );
  const failed = renderToStaticMarkup(
    createElement(PlansOverview, { ...base, error: true }),
  );
  assert.match(loading, /role="status"/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Try again/);
  for (const html of [loading, failed])
    assert.doesNotMatch(html, /YOUR FIRST GATHERING/);
});
