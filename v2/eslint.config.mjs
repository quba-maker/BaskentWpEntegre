import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { qubaPlugin } from "./eslint-rules/index.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // ── QUBA GOVERNANCE RULES ──
  // These rules enforce platform design governance.
  // They prevent entropy regression after v1.0-governance-lock.
  {
    plugins: {
      quba: qubaPlugin,
    },
    files: ["src/**/*.tsx", "src/**/*.jsx", "src/**/*.ts"],
    rules: {
      // Block hardcoded HEX colors — use tokens.css
      "quba/no-hardcoded-hex": "warn",
      // Block native dialogs — use inline feedback
      "quba/no-native-dialog": "error",
    },
  },
]);

export default eslintConfig;
