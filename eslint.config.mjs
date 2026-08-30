import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Hooks after an early return, as an ERROR rather than a warning lost among
    // the ~370 other lint problems in this repo.
    //
    // lib/jan-ui/DataTable.tsx has an `if (error) return <ErrorState/>` guard,
    // and a useMemo drifted below it TWICE. Each time, the first render that
    // errored called one hook fewer than the render before it, React threw
    // #300, and the whole page white-screened — so the error state that guard
    // exists to show could never actually paint. The file carries a prose
    // comment saying every hook must sit above the return; prose did not hold.
    // This rule reproduces that bug's exact wording and is currently at zero
    // violations across app/, components/, lib/ and hooks/.
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
