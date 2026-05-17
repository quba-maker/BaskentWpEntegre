import { noRawSql } from "./no-raw-sql.js";
import { forcedTraceContext } from "./forced-trace-context.js";
import { noDefaultExport } from "./no-default-export.js";

export const qubaPlugin = {
  rules: {
    "no-raw-sql": noRawSql,
    "forced-trace-context": forcedTraceContext,
    "no-default-export": noDefaultExport,
  },
};
