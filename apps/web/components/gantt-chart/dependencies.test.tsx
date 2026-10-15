import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TTimelineRelation } from "@plane/types";
import { TimelineDependencies } from "./dependencies";
import { TimelineDependencyViewContext } from "./contexts";
import { planningService } from "@/services/planning.service";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "user" } }) }));
vi.mock("@/hooks/use-timeline-chart", () => ({
  useTimeLineChartStore: () => ({
    getBlockById: (id: string) => ({
      start_date: "2026-10-01",
      target_date: "2026-10-10",
      position: { marginLeft: id === "source" ? 100 : 200, width: 50 },
    }),
  }),
}));
vi.mock("@/services/planning.service", () => ({ planningService: { relations: vi.fn() } }));
const relation: TTimelineRelation = {
  id: "edge",
  relation_type: "blocked_by",
  source_id: "source",
  source_name: "Material",
  source_project_id: "project",
  target_id: "target",
  target_name: "Assembly",
  target_project_id: "project",
  source_date: "2026-10-10",
  target_date: "2026-10-05",
  date_conflict: true,
  is_assessable: true,
  is_blocking: true,
};
beforeEach(() => {
  vi.mocked(planningService.relations).mockResolvedValue([relation]);
});
function renderEdges(
  rows = ["source", "target"],
  view: { mode: "all" | "focus" | "conflicts"; focusId: string } = { mode: "all", focusId: "" }
) {
  return render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map() }}>
        <TimelineDependencyViewContext.Provider value={{ ...view, setFocusId: () => undefined }}>
          <TimelineDependencies
            workspace="workspace"
            issueIds={["source", "target"]}
            rowIds={rows}
            getIssue={() => undefined}
          />
        </TimelineDependencyViewContext.Provider>
      </SWRConfig>
    </MemoryRouter>
  );
}
describe("visible timeline relationships", () => {
  it("draws a directed conflict and opens actual connected tasks", async () => {
    const { container } = renderEdges();
    const edge = await screen.findByRole("button", { name: /Material.*Assembly/ });
    const path = container.querySelector("path[data-relation-id='edge']");
    expect(path?.getAttribute("data-conflict")).toBe("true");
    expect(path?.getAttribute("marker-end")).toBeTruthy();
    fireEvent.click(edge);
    expect(await screen.findByRole("link", { name: "Material" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Assembly" })).toBeTruthy();
    expect(screen.getByText("planning.date_conflict")).toBeTruthy();
  });
  it("keeps internal collapsed project relationships reachable without self arrows", async () => {
    const { container } = renderEdges(["project"]);
    await screen.findByRole("button", { name: /Material.*Assembly/ });
    expect(container.querySelector("path[data-relation-id='edge']")).toBeNull();
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe("transparent");
    expect(container.querySelector("rect")?.getAttribute("stroke")).toBe("none");
    expect(container.querySelector("text")?.getAttribute("font-size")).toBe("10");
    fireEvent.keyDown(screen.getByRole("button", { name: /Material.*Assembly/ }), { key: "Enter" });
    expect(screen.getByRole("complementary", { name: "planning.dependencies" })).toBeTruthy();
  });
  it("keeps contextual relationships out of the scheduling chart", async () => {
    vi.mocked(planningService.relations).mockResolvedValueOnce([
      { ...relation, relation_type: "relates_to", date_conflict: false, is_assessable: false, is_blocking: false },
    ]);
    const { container } = renderEdges();
    await screen.findByTestId("timeline-dependencies");
    expect(container.querySelector("path[data-relation-id='edge']")).toBeNull();
  });
  it("filters planned dependencies in the conflict view", async () => {
    vi.mocked(planningService.relations).mockResolvedValueOnce([
      { ...relation, relation_type: "finish_to_start", date_conflict: false, is_blocking: false },
    ]);
    const { container } = renderEdges(undefined, { mode: "conflicts", focusId: "" });
    await waitFor(() => expect(screen.getByLabelText("planning.connection_status")).toBeTruthy());
    expect(container.querySelector("path[data-relation-id='edge']")).toBeNull();
    expect(screen.getByRole("button", { name: "planning.planned_dependencies: 1" })).toBeTruthy();
  });
  it("shows only connections belonging to the focused task", async () => {
    const { container } = renderEdges(undefined, { mode: "focus", focusId: "unrelated" });
    await waitFor(() => expect(screen.getByLabelText("planning.connection_status")).toBeTruthy());
    expect(container.querySelector("path[data-relation-id='edge']")).toBeNull();
  });
  it("labels finish-start explicitly and uses a side inspector", async () => {
    vi.mocked(planningService.relations).mockResolvedValueOnce([{ ...relation, relation_type: "finish_to_start" }]);
    renderEdges();
    fireEvent.click(await screen.findByRole("button", { name: /Material.*planning.finish_start.*Assembly/ }));
    expect(screen.getByRole("complementary", { name: "planning.dependencies" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("aggregates collapsed links into one count and prioritizes the conflict", async () => {
    vi.mocked(planningService.relations).mockResolvedValueOnce([
      { ...relation, id: "normal", date_conflict: false, is_blocking: false },
      { ...relation, id: "conflict" },
    ]);
    const { container } = renderEdges(["project"]);
    await screen.findByRole("button", { name: /Material.*planning.date_conflict/ });
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(screen.getByText("2")).toBeTruthy();
  });
});
