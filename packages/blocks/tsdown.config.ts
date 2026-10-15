import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/*/index.ts", "src/charts/*/index.ts", "src/emoji-icon-picker/data.ts"],
  format: ["esm"],
  dts: true,
  loader: { ".png": "dataurl" },
  copy: ["src/brand/brand.css"],
  platform: "neutral",
});
