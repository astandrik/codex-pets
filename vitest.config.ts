import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ".scratch/**", ".worktrees/**"],
    server: {
      deps: {
        // Gravity UI ESM build imports its own .css files; inline the
        // packages so vitest's pipeline stubs those imports instead of
        // handing them to Node's loader (DOM-rendered component tests).
        inline: ["@gravity-ui/uikit", "@gravity-ui/icons"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
