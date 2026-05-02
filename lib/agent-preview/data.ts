// Public barrel for agent-preview seed data. The actual contents live in
// three siblings:
//   data-types.ts      — stable IDs, PreviewTableName, PreviewDatabase row shape
//   data-factories.ts  — date + race-segment helpers used to build the seed
//   data-scenarios.ts  — concrete getPreviewUser() + createPreviewDatabase()
//                        plus the global-cache wrappers
//
// External callers should keep importing from "@/lib/agent-preview/data" —
// this file preserves that public surface.

export type { PreviewDatabase } from "./data-types";
export {
  createPreviewDatabase,
  getPreviewDatabase,
  getPreviewUser,
  resetPreviewDatabase
} from "./data-scenarios";
