import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import commonjs from "@rollup/plugin-commonjs";

export default defineConfig({
  root: "src/mcp-app",
  plugins: [commonjs(), viteSingleFile()],
  build: {
    target: "esnext",
    rollupOptions: { input: "src/mcp-app/mcp-app.html" },
    outDir: "../../dist",
    emptyOutDir: false,
  },
});
