import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlanBuilder,
  type PlanBuilderProps,
} from "../app/components/plan-builder.js";
import { SignInDialog } from "../app/components/sign-in-dialog.js";
import { optionsForCategory } from "../src/lib/catalog-options.js";

const noop = () => {};
const props: PlanBuilderProps = {
  name: "Weekend away",
  setName: noop,
  displayName: "Alex",
  setDisplayName: noop,
  when: "2099-10-17T14:00",
  setWhen: noop,
  sizeInput: "4",
  setSizeInput: noop,
  category: "stay",
  setCategory: noop,
  permittedRestaurantIds: optionsForCategory("stay").map((item) => item.id),
  setPermittedRestaurantIds: noop,
  busy: false,
  onCreate: noop,
};

test("plan creation requires complete basics and a future time before proceeding", () => {
  for (const changes of [
    { name: " " },
    { displayName: "" },
    { when: "2000-01-01T12:00" },
    { sizeInput: "1" },
  ]) {
    const html = renderToStaticMarkup(
      createElement(PlanBuilder, { ...props, ...changes }),
    );
    assert.match(
      html,
      /<button class="primary" disabled="">Next: choose places/,
    );
  }
  const html = renderToStaticMarkup(createElement(PlanBuilder, props));
  assert.match(html, /<button class="primary">Next: choose places/);
  assert.match(html, /<div hidden=""><div class="plan-recap">/);
  assert.match(html, /aria-current="step"/);
});

test("sign-in onboarding distinguishes identity confirmation from spending", () => {
  const html = renderToStaticMarkup(
    createElement(SignInDialog, {
      open: false,
      busy: true,
      notice: "Confirm in MetaMask",
      onClose: noop,
      onConnect: noop,
    }),
  );
  assert.match(html, /<dialog[^>]+aria-labelledby="sign-in-title"/);
  assert.match(html, /Signing in does not send money or approve a payment/);
  assert.match(html, /<button class="primary" disabled="">Check MetaMask/);
  assert.match(html, /role="status"/);
  assert.match(html, /try the demo/);
});
