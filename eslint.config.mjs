import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    "public/mediapipe/**",
    // The Sports2D reference tool's virtual environment. It is not committed,
    // but it lives inside the repo, and matplotlib ships browser JS that this
    // config would otherwise lint as if it were ours — seven errors from
    // vendored code in a directory git already ignores.
    "tools/sports2d/.venv/**",
    "tools/sports2d/out/**",
  ]),
]);

export default eslintConfig;
