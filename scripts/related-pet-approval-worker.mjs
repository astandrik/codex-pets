import { runRelatedPetApprovalWorkerOnce } from "../src/lib/pets/related-pets-approval-worker.ts";

const once = process.argv.includes("--once");
const workerId = process.env.HOSTNAME?.trim() || `worker-${process.pid}`;

do {
  const status = await runRelatedPetApprovalWorkerOnce(workerId);
  console.log(JSON.stringify({ operation: "approval-worker", status }));
  if (once) break;
  await new Promise((resolve) =>
    setTimeout(resolve, status === "idle" ? 30_000 : 1_000),
  );
} while (true);
