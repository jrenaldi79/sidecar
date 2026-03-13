import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src/mcp-app",
  plugins: [viteSingleFile()],
  build: {
    target: "esnext",
    rollupOptions: { input: "src/mcp-app/mcp-app.html" },
    outDir: "../../dist",
    emptyOutDir: false,
  },
});
