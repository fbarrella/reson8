// ESLint 10 flat config for the whole monorepo (PRD 18.1).
//
// Deliberately NOT type-aware (`recommended`, not `recommendedTypeChecked`):
// a type-aware run over a ~10k-line renderer.ts is slow, `tsc --noEmit` already
// is the project's type check, and this keeps `npm run lint` fast enough to run
// after every item. Formatting is Prettier's job; `eslint-config-prettier` goes
// LAST so no stylistic rule can fight it.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
    globalIgnores([
        "**/dist/**",
        "**/release/**",
        "**/node_modules/**",
        // Vendored third-party payloads (noise-cancelling WASM/ONNX, fonts, sounds).
        "apps/client/assets/**",
        // NAPI-RS generated loader + typings (carry `eslint-disable` headers) and
        // the Rust build output. The hand-written packages/native-audio/index.js
        // next to them IS linted.
        "packages/native-audio/prebuilds/**",
        "packages/native-audio/target/**",
        "**/*.node",
        // Staging copies made by scripts/before-pack.mjs (git-ignored build output).
        "apps/client/.release-vendor/**",
        // SQL migrations are not JS, listed so a future glob widening can't pick them up.
        "apps/server/prisma/migrations/**",
        // Phase 19 design handoff: HTML-study runtime and design-system bundles,
        // reference material only (never shipped, never ported).
        "app-planning/design_handoff_reson8_ui_overhaul/**",
    ]),

    js.configs.recommended,
    tseslint.configs.recommended,

    {
        rules: {
            // The codebase uses `any` at socket/IPC boundaries on purpose.
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
            ],
            // `catch { /* best effort */ }` is an intentional, widespread pattern.
            "no-empty": ["error", { allowEmptyCatch: true }],
        },
    },

    // ── Environments ───────────────────────────────────────────────────────
    {
        // Server, scripts and everything that runs in plain Node / Electron main.
        files: [
            "apps/server/**/*.{ts,mjs,mts}",
            "apps/client/src/*.ts",
            "apps/client/scripts/**/*.mjs",
            "scripts/**/*.mjs",
            "packages/**/*.{js,ts}",
            "*.mjs",
        ],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        // Preload scripts and the voice engine share the renderer's DOM and
        // Node's `require`/`process`, so they see both sets of globals.
        files: ["apps/client/src/preload*.ts", "apps/client/src/services/**/*.ts"],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        // The renderer is a CLASSIC script (no bundler, strict CSP, no imports):
        // its top-level functions are called from index.html and from DevTools
        // `Runtime.evaluate` in the headless tests, so only variables declared
        // INSIDE functions are checked for being unused.
        files: ["apps/client/src/renderer/**/*.ts"],
        languageOptions: { globals: { ...globals.browser } },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { vars: "local", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
            ],
        },
    },
    {
        // CommonJS files legitimately call require().
        files: ["**/*.cjs", "packages/native-audio/index.js", "apps/client/src/preload*.ts"],
        rules: { "@typescript-eslint/no-require-imports": "off" },
    },

    prettier,
]);
