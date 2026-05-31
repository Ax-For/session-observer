import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    include: ["src/**/*.test.{js,jsx}"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }
          if (id.includes("/recharts/") || id.includes("/d3-")) {
            return "vendor-charts";
          }
          if (id.includes("/@mantine/")) {
            return "vendor-mantine";
          }
          if (id.includes("/@tabler/")) {
            return "vendor-icons";
          }
          if (id.includes("/react-markdown/") || id.includes("/remark-") || id.includes("/micromark") || id.includes("/mdast-") || id.includes("/hast-")) {
            return "vendor-markdown";
          }
          return "vendor";
        },
      },
    },
  },
});
