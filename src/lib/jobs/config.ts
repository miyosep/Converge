export function serverlessJobs() {
  const driver = process.env.BACKGROUND_DRIVER || "local";
  if (!["local", "inngest", "hybrid"].includes(driver))
    throw new Error("Unknown BACKGROUND_DRIVER");
  if (process.env.VERCEL && driver === "local")
    throw new Error("Vercel requires BACKGROUND_DRIVER=inngest or hybrid");
  return driver !== "local";
}

export function inngestJobsEnabled() {
  return jobsEnabled() && process.env.BACKGROUND_DRIVER === "inngest";
}

export function executionEnabled() {
  return (
    jobsEnabled() &&
    (process.env.BACKGROUND_DRIVER !== "hybrid" ||
      (!process.env.VERCEL && process.env.HYBRID_WORKER_PROCESS === "true"))
  );
}

export function jobsEnabled() {
  return (
    serverlessJobs() &&
    process.env.BACKGROUND_JOBS_ENABLED === "true" &&
    (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production")
  );
}

export function assertLocalWorker() {
  if (serverlessJobs())
    throw new Error(
      "Legacy file workers are disabled with a database driver; use the hybrid worker or Inngest",
    );
}
