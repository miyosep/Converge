import { spawn } from "node:child_process";

// Local HTTP/Inngest smoke test. All external integrations are disabled, even
// when Next.js loads the developer's usual .env file during startup.
if (process.env.NEON_BRANCH !== "dev-vercel-inngest")
  throw new Error("Isolated test branch required");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  CONVERGE_BUILD_DIR: ".next-serverless",
  BACKGROUND_DRIVER: "inngest",
  BACKGROUND_JOBS_ENABLED: "true",
  EXPLORE_DEMO_ENABLED: "false",
  GROUP_EXECUTION_ENABLED: "false",
  RPC_URL: "http://127.0.0.1:1",
  KILN_API_KEY: "disabled-for-smoke-test",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "",
  INNGEST_DEV: "true",
  INNGEST_BASE_URL: "http://127.0.0.1:8288",
  INNGEST_EVENT_KEY: "local-smoke-test",
  APP_ORIGIN: "http://localhost:3011",
};
for (const name of Object.keys(env))
  if (name.endsWith("PRIVATE_KEY")) delete env[name];
for (const name of [
  "AGENT_EXECUTOR_PRIVATE_KEY",
  "DEPLOYER_PRIVATE_KEY",
  ...Array.from(
    { length: 6 },
    (_, i) => `DEMO_PARTICIPANT_${i + 1}_PRIVATE_KEY`,
  ),
])
  Object.assign(env, { [name]: "disabled-for-smoke-test" });
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", "3011"],
  { env, stdio: "inherit", windowsHide: true },
);
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
