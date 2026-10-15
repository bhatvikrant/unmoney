import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("materialise repeat schedules", { hourUTC: 0, minuteUTC: 5 }, internal.repeats.materialiseAll);
export default crons;
