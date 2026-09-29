import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupWorkspace } from "../app/components/group-workspace.js";
import { WelcomeWorkspace } from "../app/components/product-ui.js";

test("signed-out home, creation and preference pages show the introduction without planning controls", () => {
  for (const mode of ["home", "create", "preferences"] as const) {
    const html = renderToStaticMarkup(
      createElement(GroupWorkspace, {
        mode,
        ...(mode === "preferences" ? { initialGroupId: "invited-group" } : {}),
      }),
    );
    assert.match(html, /Every voice/);
    assert.match(html, /One shared plan/);
    assert.match(html, /converge-orbit/);
    assert.match(html, /Checking your session/);
    assert.doesNotMatch(
      html,
      /What are you planning|Create a decision|Group name|Your requirements|Group workflow/,
    );
    assert.doesNotMatch(html, /<input|<textarea|<select/);
  }
});

test("welcome explains sign-in, preserves invitation context and announces connection feedback", () => {
  const html = renderToStaticMarkup(
    createElement(WelcomeWorkspace, {
      busy: true,
      notice: "Confirm the sign-in message in MetaMask.",
      invited: true,
      onConnect: () => {},
    }),
  );
  assert.match(html, /Your wallet is your sign-in/);
  assert.match(html, /Your group is waiting/);
  assert.match(html, /Connecting/);
  assert.match(html, /disabled/);
  assert.match(html, /role="status"/);
  assert.match(html, /Confirm the sign-in message/);
});
