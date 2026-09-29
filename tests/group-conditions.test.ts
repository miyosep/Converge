import test from "node:test";
import assert from "node:assert/strict";
import {
  permittedGroupMerchants,
  permittedRestaurantIdsSchema,
} from "../src/lib/group-conditions.js";
import { createRestaurantCatalog } from "../src/lib/fixtures/restaurants.js";
import roles from "../contracts/deployments/demo-roles.11155111.json";
import { demoRolesSchema } from "../src/lib/demo-roles.js";

test("saved group permissions cannot reintroduce an excluded or server-disallowed merchant", () => {
  const catalog = createRestaurantCatalog(demoRolesSchema.parse(roles), [
    "2026-10-01T10:00:00Z",
  ]);
  const result = permittedGroupMerchants(
    ["B", "C", "D", "E"],
    catalog,
    Object.values(roles.merchants),
  );
  assert.equal(
    result.some(
      (address) => address.toLowerCase() === roles.merchants.A.toLowerCase(),
    ),
    false,
  );
  assert.deepEqual(
    permittedGroupMerchants(["A", "B"], catalog, [roles.merchants.B]),
    [roles.merchants.B],
  );
  for (const invalid of [[], ["A", "A"], ["arbitrary-merchant"]])
    assert.equal(
      permittedRestaurantIdsSchema.safeParse(invalid).success,
      false,
    );
});
