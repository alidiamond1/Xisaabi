import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("clean old scanner sessions", { hours: 24 }, internal.scanner.cleanup, {});
export default crons;
