import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.hourly("materialise repeat schedules", { minuteUTC: 5 }, internal.repeats.materialiseAll, {});
crons.daily("prune old sync ops", { hourUTC: 3, minuteUTC: 0 }, internal.sync.pruneSyncOps, {});
crons.hourly("check Gmail for new money mail", { minuteUTC: 20 }, internal.gmail.syncAll, {});
crons.daily("prune resolved Gmail drafts", { hourUTC: 3, minuteUTC: 10 }, internal.sync.pruneDrafts, {});
export default crons;
