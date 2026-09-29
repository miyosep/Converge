import { parseEnv } from "node:util";

export function hybridEnvironment(
  inherited: NodeJS.ProcessEnv,
  template: string,
  config: string,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  // Retain OS settings such as PATH, but take all application settings from
  // the selected file. Node's --env-file alone gives inherited values priority.
  for (const key of [
    ...Object.keys(parseEnv(template)),
    "HYBRID_WORKER_PROCESS",
  ])
    delete env[key];
  return { ...env, ...parseEnv(config) };
}
