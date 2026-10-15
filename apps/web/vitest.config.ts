import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: [
      "helpers/planning.test.ts",
      "helpers/timeline-dependencies.test.ts",
      "components/resources/**/*.test.tsx",
      "components/portfolio/**/*.test.tsx",
      "components/gantt-chart/**/*.test.tsx",
      "components/project/templates.test.tsx",
      "components/project/milestones.test.tsx",
      "components/profile/overview/work-plan.test.tsx",
      "components/dropdowns/state/*.test.tsx",
    ],
    environment: "jsdom",
    setupFiles: ["../../packages/blocks/vitest.setup.dom.ts"],
  },
});
