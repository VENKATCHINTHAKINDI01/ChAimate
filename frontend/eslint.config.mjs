import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Three Fiber scenes animate by mutating three.js objects inside useFrame — that's the library's design,
  // so the React Compiler's immutability rules don't apply to the 3D scene files.
  { files: ["components/three/**"], rules: { "react-hooks/immutability": "off", "react-hooks/purity": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/**",
  ]),
]);

export default eslintConfig;
