export function serverlessJobs() {
  if (process.env.VERCEL && process.env.BACKGROUND_DRIVER !== "inngest")
    throw new Error("Vercel requires BACKGROUND_DRIVER=inngest");
  return process.env.BACKGROUND_DRIVER === "inngest";
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
      "Local workers are disabled when BACKGROUND_DRIVER=inngest",
    );
}
