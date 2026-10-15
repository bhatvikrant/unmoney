import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("materialise repeat schedules", { hourUTC: 0, minuteUTC: 5 }, internal.repeats.materialiseAll);
crons.daily("prune old sync ops", { hourUTC: 3, minuteUTC: 0 }, internal.sync.pruneSyncOps, {});
export default crons;
