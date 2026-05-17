import { noRawSql } from "./no-raw-sql.js";
import { forcedTraceContext } from "./forced-trace-context.js";
import { noDefaultExport } from "./no-default-export.js";
import { noHardcodedHex } from "./no-hardcoded-hex.js";
import { noNativeDialog } from "./no-native-dialog.js";

export const qubaPlugin = {
  rules: {
    "no-raw-sql": noRawSql,
    "forced-trace-context": forcedTraceContext,
    "no-default-export": noDefaultExport,
    // ── Governance Rules ──
    "no-hardcoded-hex": noHardcodedHex,
    "no-native-dialog": noNativeDialog,
  },
};
