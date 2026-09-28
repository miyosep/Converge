import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

async function main(): Promise<void> {
  let env = await readFile(".env", "utf8");
  const personas = ["Alice", "Bob", "Charlie", "Dana", "Erin", "Farah"];
  const participants = personas.map((persona, index) => {
    const keyName = `DEMO_PARTICIPANT_${index + 1}_PRIVATE_KEY`;
    const pattern = new RegExp(`^${keyName}=([^\\r\\n]*)`, "gm");
    const matches = [...env.matchAll(pattern)];
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${keyName} entry in .env`);
    }
    const existing = matches[0]![1]!.trim();
    if (existing && !/^0x[0-9a-fA-F]{64}$/.test(existing)) {
      throw new Error(`Invalid ${keyName}; no keys were written`);
    }
    const privateKey = existing ? (existing as Hex) : generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    env = env.replace(pattern, `${keyName}=${privateKey}`);
    return { persona, address: account.address };
  });
  if (new Set(participants.map((p) => p.address.toLowerCase())).size !== 6) {
    throw new Error(
      "Participant addresses must be distinct; no keys were written",
    );
  }

  const path = "contracts/deployments/demo-participants.11155111.json";
  const manifest = {
    schemaVersion: 1,
    chainId: 11155111,
    mode: "single-operator-demo",
    participants,
  };
  try {
    const existingManifest = JSON.parse(await readFile(path, "utf8"));
    if (JSON.stringify(existingManifest) !== JSON.stringify(manifest)) {
      throw new Error(
        "Existing participant manifest differs; no keys were written",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Persist keys first so reruns recover the same accounts if manifest writing fails.
  await writeFile(".env", env, { mode: 0o600 });
  await mkdir("contracts/deployments", { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const participant of participants) {
    process.stdout.write(`${participant.persona}: ${participant.address}\n`);
  }
  process.stdout.write(`Public manifest: ${path}\n`);
}

main().catch(() => {
  process.stderr.write(
    "Demo wallet setup failed. Check local .env entries and manifest consistency; existing keys are never intentionally replaced.\n",
  );
  process.exitCode = 1;
});
