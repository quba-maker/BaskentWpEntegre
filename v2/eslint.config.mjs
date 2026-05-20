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
  // ── NON-PRODUCTION SCRIPTS & TESTS OVERRIDES ──
  // Allow require imports and any types in test suites, scripts, and local configs
  {
    files: [
      "*.js",
      "*.mjs",
      "*.ts",
      "tests/**/*",
      "scripts/**/*",
      "src/tests/**/*"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/ban-ts-comment": "off"
    }
  },
  // ── GLOBAL QUALITY GATE RELAXATION ──
  // Relaxes strict rules in src/ files to allow any usage, require imports, and comments
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prefer-const": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off"
    }
  }
]);

export default eslintConfig;
