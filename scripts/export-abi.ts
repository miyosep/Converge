import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const contracts = [
  ["MockUSDC", "mockUSDC.json"],
  ["ConvergeGroupWallet", "convergeGroupWallet.json"],
] as const;

const outputDir = join("src", "lib", "abi");
await mkdir(outputDir, { recursive: true });

for (const [contract, file] of contracts) {
  const artifact = JSON.parse(
    await readFile(
      join("contracts", "out", `${contract}.sol`, `${contract}.json`),
      "utf8",
    ),
  ) as { abi?: unknown };
  if (!Array.isArray(artifact.abi)) {
    throw new Error(
      `${contract} artifact has no ABI; run pnpm contracts:build first`,
    );
  }
  await writeFile(
    join(outputDir, file),
    `${JSON.stringify(artifact.abi, null, 2)}\n`,
  );
  process.stdout.write(`Exported ${contract} ABI\n`);
}
