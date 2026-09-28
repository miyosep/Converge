import { readFile, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  assertSeparateDemoRoles,
  demoRolesSchema,
  MERCHANT_IDS,
} from "../src/lib/demo-roles.js";

async function main(): Promise<void> {
  let env = await readFile(".env", "utf8");
  const addressFor = (name: string) => {
    const pattern = new RegExp(`^${name}=([^\\r\\n]*)`, "gm");
    const matches = [...env.matchAll(pattern)];
    if (matches.length > 1) throw new Error("Duplicate environment entry");
    const existing = matches[0]?.[1]?.trim();
    if (existing && !/^0x[0-9a-fA-F]{64}$/.test(existing))
      throw new Error("Invalid existing key");
    const key = existing ? (existing as Hex) : generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    if (matches.length) env = env.replace(pattern, `${name}=${key}`);
    else env = `${env.trimEnd()}\n${name}=${key}\n`;
    return address;
  };
  const roles = demoRolesSchema.parse({
    schemaVersion: 1,
    chainId: 11155111,
    mode: "single-operator-demo",
    executor: addressFor("AGENT_EXECUTOR_PRIVATE_KEY"),
    merchants: Object.fromEntries(
      MERCHANT_IDS.map((id) => [
        id,
        addressFor(`DEMO_MERCHANT_${id}_PRIVATE_KEY`),
      ]),
    ),
  });
  const participants = JSON.parse(
    await readFile(
      "contracts/deployments/demo-participants.11155111.json",
      "utf8",
    ),
  );
  const deployment = JSON.parse(
    await readFile("contracts/deployments/11155111.json", "utf8"),
  );
  assertSeparateDemoRoles(roles, [
    ...participants.participants.map((p: { address: string }) => p.address),
    deployment.deployer,
    deployment.mockUSDC.address,
    deployment.convergeGroupWallet.address,
  ]);
  const path = "contracts/deployments/demo-roles.11155111.json";
  try {
    const existing = demoRolesSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (JSON.stringify(existing) !== JSON.stringify(roles))
      throw new Error("Existing role manifest differs");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(".env", env, { mode: 0o600 });
  await writeFile(path, `${JSON.stringify(roles, null, 2)}\n`);
  process.stdout.write(`Executor: ${roles.executor}\n`);
  for (const id of MERCHANT_IDS)
    process.stdout.write(`Restaurant ${id}: ${roles.merchants[id]}\n`);
}

main().catch(() => {
  process.stderr.write(
    "Role setup failed. Check local key entries and public manifests; no secret values are logged.\n",
  );
  process.exitCode = 1;
});
