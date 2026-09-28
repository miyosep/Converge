import { z } from "zod";
import { addressSchema } from "./schemas/primitives.js";

export const MERCHANT_IDS = ["A", "B", "C", "D", "E"] as const;
export const demoRolesSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    chainId: z.literal(11155111),
    mode: z.literal("single-operator-demo"),
    executor: addressSchema,
    merchants: z.strictObject({
      A: addressSchema,
      B: addressSchema,
      C: addressSchema,
      D: addressSchema,
      E: addressSchema,
    }),
  })
  .superRefine((roles, context) => {
    const addresses = [roles.executor, ...Object.values(roles.merchants)];
    if (new Set(addresses.map((address) => address.toLowerCase())).size !== 6) {
      context.addIssue({
        code: "custom",
        message: "Executor and merchants must be distinct",
      });
    }
  });

export type DemoRoles = z.infer<typeof demoRolesSchema>;

export function assertSeparateDemoRoles(
  roles: DemoRoles,
  reserved: readonly string[],
): void {
  const excluded = new Set(reserved.map((address) => address.toLowerCase()));
  for (const address of [roles.executor, ...Object.values(roles.merchants)]) {
    if (excluded.has(address.toLowerCase())) {
      throw new Error(
        "Demo role overlaps a participant, deployer, or deployed contract",
      );
    }
  }
}
