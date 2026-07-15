import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works at any mount point — the domain
  // root, GitHub Pages' /VimTrainer/ subpath, or anywhere else.
  base: "./",
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
