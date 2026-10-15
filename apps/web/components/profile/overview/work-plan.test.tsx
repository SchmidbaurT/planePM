import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { ProfileWorkPlan } from "./work-plan";
import { milestoneService } from "@/services/project/milestone.service";
import type { TWorkPlan } from "@/services/project/milestone.service";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({
  useUser: () => ({ data: { id: "user" } }),
  useUserPermissions: () => ({ allowPermissions: () => true }),
}));
vi.mock("@/components/dropdowns/state/state-select", () => ({ StateSelect: () => null }));
vi.mock("@/services/project/milestone.service", () => ({ milestoneService: { workPlan: vi.fn() } }));
vi.mock("@/components/project/milestones", () => ({
  MilestoneManager: () => null,
  MilestoneStatus: () => <span>Open milestone</span>,
  MilestoneError: ({ error }: { error: unknown }) => (error ? <p role="alert">Load failed</p> : null),
}));

function renderPlan() {
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
        <ProfileWorkPlan workspace="workspace" userId="user" />
      </SWRConfig>
    </MemoryRouter>
  );
}
describe("personal work overview", () => {
  it("shows actionable tasks, blocker links and a path to all assigned work", async () => {
    const empty = { count: 0, next_cursor: null, items: [] };
    const data: TWorkPlan = {
      as_of_date: "2026-10-14",
      week_end: "2026-10-18",
      sections: {
        today: {
          count: 1,
          next_cursor: null,
          items: [
            {
              id: "task",
              name: "Paint container",
              project_id: "project",
              project__name: "Production",
              project__identifier: "PR",
              sequence_id: 1,
              target_date: "2026-10-13",
              priority: "high",
              parent_id: null,
              state__name: "Open",
              blockers: [{ id: "blocker", name: "Material delivery", project_id: "project" }],
            },
          ],
        },
        week: empty,
        blocked: empty,
        milestones: empty,
      },
    };
    vi.mocked(milestoneService.workPlan).mockResolvedValueOnce(data);
    renderPlan();
    await screen.findByRole("link", { name: "Paint container" });
    expect(screen.getByRole("link", { name: "Material delivery" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "planning.week_work 0" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "profile.stats.assigned" }).getAttribute("href")).toBe(
      "/workspace/profile/user/assigned/"
    );
  });
  it("does not claim there is no work when loading fails", async () => {
    vi.mocked(milestoneService.workPlan).mockRejectedValueOnce(new Error("Offline"));
    renderPlan();
    await screen.findByRole("alert");
    expect(screen.queryByText("planning.empty")).toBeNull();
  });
});
