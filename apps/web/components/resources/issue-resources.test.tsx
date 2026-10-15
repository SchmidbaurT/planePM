import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { IssueResources } from "./issue-resources";
import { planningService } from "@/services/planning.service";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({
  useUser: () => ({ data: { id: "user" } }),
  useUserPermissions: () => ({ allowPermissions: () => true }),
}));
vi.mock("@/services/planning.service", () => ({
  planningService: {
    resources: vi.fn().mockResolvedValue([{ id: "booth", name: "Paint booth", archived_at: null }]),
    requirements: vi.fn().mockResolvedValue([{ resource_id: "booth", allocation_percent: 100 }]),
    availability: vi.fn().mockResolvedValue({ days: [], bookings: [], blackouts: [] }),
    saveRequirements: vi.fn(),
  },
}));

describe("resource requirements", () => {
  it("offers a visible add action and saves the selected resource", async () => {
    vi.mocked(planningService.requirements).mockResolvedValueOnce([]);
    vi.mocked(planningService.saveRequirements).mockResolvedValueOnce([
      { resource_id: "booth", allocation_percent: 100 },
    ]);
    render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <IssueResources
            workspace="workspace"
            projectId="project"
            issueId="new"
            startDate={null}
            endDate={null}
            disabled={false}
          />
        </SWRConfig>
      </MemoryRouter>
    );
    const add = await screen.findByRole("button", { name: "add" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    fireEvent.change(screen.getByRole("combobox", { name: "planning.resources" }), { target: { value: "booth" } });
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("100");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(planningService.saveRequirements).toHaveBeenCalledWith("workspace", "project", "new", [
        { resource_id: "booth", allocation_percent: 100 },
      ])
    );
  });

  it("keeps the resource selector visible when the workspace has no resources", async () => {
    vi.mocked(planningService.resources).mockResolvedValueOnce([]);
    vi.mocked(planningService.requirements).mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <IssueResources
            workspace="workspace"
            projectId="project"
            issueId="empty"
            startDate={null}
            endDate={null}
            disabled={false}
          />
        </SWRConfig>
      </MemoryRouter>
    );
    const add = await screen.findByRole("button", { name: "add" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    expect((screen.getByRole("combobox", { name: "planning.resources" }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "planning.resources" }).getAttribute("href")).toBe("/workspace/resources");
  });

  it("retains entered allocation when the server rejects the booking", async () => {
    vi.mocked(planningService.availability).mockResolvedValue({
      days: [{ date: "2026-10-01", allocated_percent: 100 }],
      bookings: [],
      blackouts: [],
    });
    vi.mocked(planningService.saveRequirements).mockRejectedValue({ code: "RESOURCE_CAPACITY_EXCEEDED" });
    render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <IssueResources
            workspace="workspace"
            projectId="project"
            issueId="issue"
            startDate="2026-10-01"
            endDate="2026-10-03"
            disabled={false}
          />
        </SWRConfig>
      </MemoryRouter>
    );
    await screen.findByText("Paint booth");
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await screen.findByText("planning.conflict");
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "save" }) as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("60");
    expect(planningService.saveRequirements).toHaveBeenCalledWith("workspace", "project", "issue", [
      { resource_id: "booth", allocation_percent: 60 },
    ]);
  });
  it("shows missing dates as unreserved demand", async () => {
    render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map() }}>
          <IssueResources
            workspace="workspace"
            projectId="project"
            issueId="pending"
            startDate={null}
            endDate={null}
            disabled
          />
        </SWRConfig>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/planning.pending/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
  });
});
