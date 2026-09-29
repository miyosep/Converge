import { z } from "zod";
import { addressSchema } from "./schemas/primitives.js";

export const MIN_GROUP_MEMBERS = 2;
export const MAX_GROUP_MEMBERS = 100;
export const groupSizeSchema = z
  .number()
  .int()
  .min(MIN_GROUP_MEMBERS)
  .max(MAX_GROUP_MEMBERS);

// The deployed v1 payment policy and Explore demo keep their six-wallet schema.
export const groupMembersSchema = z
  .array(addressSchema)
  .min(MIN_GROUP_MEMBERS)
  .max(MAX_GROUP_MEMBERS)
  .refine(
    (members) =>
      new Set(members.map((member) => member.toLowerCase())).size ===
      members.length,
    "Participants must have distinct wallet addresses",
  );
