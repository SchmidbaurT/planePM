import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneManager } from "./milestones";
import { milestoneService } from "@/services/project/milestone.service";
import type { TProjectMilestone } from "@/services/project/milestone.service";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({
  useUser: () => ({ data: { id: "owner", display_name: "Owner" } }),
  useUserPermissions: () => ({ allowPermissions: () => true }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ getProjectById: () => ({ project_lead: "owner" }) }),
}));
vi.mock("@/hooks/store/use-member", () => ({
  useMember: () => ({
    project: { fetchProjectMembers: async () => [], getProjectMemberIds: () => ["owner"] },
    getUserDetails: () => ({ display_name: "Owner" }),
  }),
}));
vi.mock("@/services/project/milestone.service", () => ({
  milestoneService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), searchIssues: vi.fn() },
}));

const milestone: TProjectMilestone = {
  id: "milestone",
  project_id: "project",
  name: "Acceptance",
  description: "Customer confirms",
  target_date: "2026-10-15",
  original_target_date: "2026-10-15",
  owner_id: "owner",
  owner_name: "Owner",
  completed_at: null,
  completed_by: null,
  status: "open",
  is_late: false,
  issue_ids: [],
  issues: [],
  updated_at: "2026-10-14T10:00:00Z",
  history: [],
};

function renderManager() {
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
        <MilestoneManager workspace="workspace" project="project" />
      </SWRConfig>
    </MemoryRouter>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(milestoneService.list).mockResolvedValue([milestone]);
  vi.mocked(milestoneService.create).mockResolvedValue(milestone);
  vi.mocked(milestoneService.update).mockResolvedValue(milestone);
  vi.mocked(milestoneService.searchIssues).mockResolvedValue({ results: [], count: 0, next_cursor: null });
});

describe("milestone interactions", () => {
  it("creates a point event with required date and owner, without a start date", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "planning.milestones" }));
    fireEvent.click(await screen.findByRole("button", { name: "planning.new_milestone" }));
    expect((screen.getByRole("button", { name: "save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Delivery" } });
    fireEvent.change(screen.getByLabelText("planning.milestone_due"), { target: { value: "2026-11-01" } });
    expect(screen.queryByLabelText("planning.start")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(milestoneService.create).toHaveBeenCalledWith(
        "workspace",
        "project",
        expect.objectContaining({ name: "Delivery", target_date: "2026-11-01", owner_id: "owner" })
      )
    );
  });
  it("requires a reason for date changes and sends the current revision", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "planning.milestones" }));
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByLabelText("planning.milestone_due"), { target: { value: "2026-11-01" } });
    expect((screen.getByLabelText("planning.change_reason") as HTMLTextAreaElement).required).toBe(true);
    fireEvent.change(screen.getByLabelText("planning.change_reason"), {
      target: { value: "New customer appointment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(milestoneService.update).toHaveBeenCalledWith(
        "workspace",
        "project",
        "milestone",
        expect.objectContaining({ reason: "New customer appointment", expected_updated_at: milestone.updated_at })
      )
    );
  });
  it("confirms fulfillment only through an explicit action", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "planning.milestones" }));
    await screen.findByText("Acceptance");
    expect(milestoneService.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "planning.confirm_milestone" }));
    expect(milestoneService.update).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "planning.confirm_milestone" })
    );
    await waitFor(() =>
      expect(milestoneService.update).toHaveBeenCalledWith(
        "workspace",
        "project",
        "milestone",
        expect.objectContaining({ reached: true })
      )
    );
  });
  it("retains editor input after a failed save", async () => {
    vi.mocked(milestoneService.update).mockRejectedValueOnce({ response: { data: { code: "MILESTONE_CHANGED" } } });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "planning.milestones" }));
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("New name");
  });
  it("keeps selected task names after changing the search and supports independent milestones", async () => {
    vi.mocked(milestoneService.searchIssues).mockImplementation(async (_workspace, _project, query) => ({
      results:
        query === "other" ? [] : [{ id: "task", name: "Paint container", identifier: "PR-12", state__name: "Ready" }],
      count: query === "other" ? 0 : 1,
      next_cursor: null,
    }));
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "planning.milestones" }));
    fireEvent.click(await screen.findByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "planning.optional_work_items (0)" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /PR-12.*Paint container/ }));
    fireEvent.change(screen.getByLabelText("search"), { target: { value: "other" } });
    await waitFor(() =>
      expect(milestoneService.searchIssues).toHaveBeenLastCalledWith("workspace", "project", "other", 0)
    );
    expect(screen.getByText("Paint container")).toBeTruthy();
    expect(screen.getByRole("button", { name: "remove: Paint container" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "remove: Paint container" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(milestoneService.update).toHaveBeenCalledWith(
        "workspace",
        "project",
        "milestone",
        expect.objectContaining({ issue_ids: [] })
      )
    );
  });
});
