import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSeparateDemoRoles,
  demoRolesSchema,
} from "../src/lib/demo-roles.js";

const roles = {
  schemaVersion: 1,
  chainId: 11155111,
  mode: "single-operator-demo",
  executor: "0x0000000000000000000000000000000000000001",
  merchants: {
    A: "0x0000000000000000000000000000000000000002",
    B: "0x0000000000000000000000000000000000000003",
    C: "0x0000000000000000000000000000000000000004",
    D: "0x0000000000000000000000000000000000000005",
    E: "0x0000000000000000000000000000000000000006",
  },
};

test("demo roles require the selected network and five unique merchant addresses", () => {
  assert.ok(demoRolesSchema.safeParse(roles).success);
  assert.equal(
    demoRolesSchema.safeParse({ ...roles, chainId: 84532 }).success,
    false,
  );
  assert.equal(
    demoRolesSchema.safeParse({ ...roles, executor: roles.merchants.A })
      .success,
    false,
  );
  assert.equal(
    demoRolesSchema.safeParse({
      ...roles,
      merchants: { ...roles.merchants, E: roles.merchants.A },
    }).success,
    false,
  );
  assert.equal(
    demoRolesSchema.safeParse({
      ...roles,
      merchants: { ...roles.merchants, E: undefined },
    }).success,
    false,
  );
  assert.equal(
    demoRolesSchema.safeParse({ ...roles, privateKey: "not-public-data" })
      .success,
    false,
  );
});

test("demo execution and merchant roles cannot overlap protected accounts", () => {
  const parsed = demoRolesSchema.parse(roles);
  assert.doesNotThrow(() =>
    assertSeparateDemoRoles(parsed, [
      "0x0000000000000000000000000000000000000007",
    ]),
  );
  assert.throws(() => assertSeparateDemoRoles(parsed, [roles.executor]));
  assert.throws(() => assertSeparateDemoRoles(parsed, [roles.merchants.C]));
});
