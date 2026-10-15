import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { PortfolioRoot } from "./root";
import { ResourceCapacitySummary } from "@/components/resources/overview";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({
  useUser: () => ({ data: { id: "user" } }),
  useUserPermissions: () => ({ allowPermissions: () => true }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    fetchProjects: async () => [],
    totalProjectIds: ["project"],
    getProjectById: () => ({ name: "Project A" }),
  }),
}));
vi.mock("@/hooks/use-project-overview-preferences", async () => {
  const { normalizePlanningPreferences } = await import("@/helpers/planning");
  return {
    useProjectOverviewPreferences: () => ({
      preferences: normalizePlanningPreferences({}),
      save: vi.fn(),
      isLoading: false,
    }),
  };
});
vi.mock("@/components/core/page-title", () => ({ PageHead: () => null }));
vi.mock("@/components/gantt-chart", () => ({
  GanttChartRoot: (props: {
    sidebarToRender: () => React.ReactNode;
    extraRows?: { id: string; sidebar: React.ReactNode }[];
  }) => (
    <div data-testid="project-gantt">
      {props.sidebarToRender()}
      {props.extraRows?.map((row) => (
        <div key={row.id}>{row.sidebar}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/project/milestones", () => ({
  MilestoneManager: () => null,
  MilestoneTimelineMarker: () => null,
}));
vi.mock("@/components/resources/overview", () => ({
  ResourceCapacitySummary: vi.fn(() => <div>resource-capacity-summary</div>),
}));
vi.mock("@/services/planning.service", () => ({
  planningService: {
    resources: async () => [],
    detail: vi.fn(async () => ({
      results: [
        { id: "parent", name: "Parent task", parent_id: null, start_date: "2026-10-01", target_date: "2026-10-10" },
        { id: "child", name: "Child task", parent_id: "parent", start_date: "2026-10-02", target_date: "2026-10-03" },
      ],
      next_cursor: null,
    })),
    portfolio: async () => ({
      results: [
        {
          id: "project",
          name: "Project A",
          identifier: "PA",
          start_date: "2026-10-01",
          target_date: "2026-10-14",
          progress: 50,
          total: 2,
          completed: 1,
          overdue: 1,
          dependencies: 0,
          resource_ids: [],
          undated_issue_count: 0,
          partial_dates_count: 0,
          invalid_dates_count: 0,
          milestones: [
            {
              id: "acceptance",
              name: "Customer acceptance",
              target_date: "2026-10-15",
              owner_name: "Owner",
              status: "open",
              is_late: false,
            },
          ],
        },
      ],
      next_cursor: null,
      selected_project_count: 1,
      as_of_date: "2026-10-12",
      from: "2026-10-01",
      to: "2026-10-14",
      metrics: { projects: 1, total: 2, completed: 1, overdue_projects: 1, dependencies: 0, pending_resources: 0 },
      dependencies: [],
      people_overlaps: [],
    }),
  },
}));

function renderView(timeline = false) {
  render(
    <MemoryRouter initialEntries={[`/workspace/projects/${timeline ? "timeline" : "dashboard"}`]}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <Routes>
          <Route path="/:workspaceSlug/projects/:view" element={<PortfolioRoot timeline={timeline} />} />
        </Routes>
      </SWRConfig>
    </MemoryRouter>
  );
}

describe("separate project overview layouts", () => {
  it("renders an actual dashboard without the full timeline by default", async () => {
    renderView();
    await screen.findByRole("heading", { name: "planning.dashboard" });
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("button", { name: "PA Project A" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "planning.dependencies" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "planning.people" })).toBeTruthy();
    expect(screen.getByText("resource-capacity-summary")).toBeTruthy();
    expect(vi.mocked(ResourceCapacitySummary).mock.calls.at(-1)?.[0]).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-14",
    });
    expect(screen.queryByTestId("project-gantt")).toBeNull();
  });
  it("reserves the full gantt layout for the timeline view", async () => {
    renderView(true);
    await screen.findByRole("heading", { name: "planning.timeline" });
    expect(screen.getByTestId("project-gantt")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("heading", { name: "planning.dependencies" })).toBeNull();
  });
  it("expands projects and children without duplicate top-level tasks", async () => {
    renderView(true);
    await screen.findByRole("heading", { name: "planning.timeline" });
    expect(screen.getByText("Customer acceptance")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.sub_work_items: Project A" }));
    await screen.findByRole("link", { name: "Parent task" });
    expect(screen.queryByRole("link", { name: "Child task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.sub_work_items: Parent task" }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Child task" })).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "common.sub_work_items: Project A" }));
    expect(screen.queryByRole("link", { name: "Parent task" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Child task" })).toBeNull();
  });
});
