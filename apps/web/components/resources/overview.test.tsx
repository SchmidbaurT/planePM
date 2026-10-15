import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { ResourceOverview } from "./overview";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "user" } }) }));
vi.mock("@/services/planning.service", () => ({
  planningService: {
    resourceOverview: async () => ({
      from: "2026-10-12",
      to: "2026-10-13",
      as_of_date: "2026-10-12",
      resources: [
        {
          id: "booth",
          name: "Paint booth",
          category: "Production",
          location: "Hall A",
          archived_at: null,
          average_percent: 100,
          pending_count: 2,
          days: [
            { date: "2026-10-12", allocated_percent: 100, maintenance: false },
            { date: "2026-10-13", allocated_percent: 100, maintenance: true },
          ],
        },
        {
          id: "table",
          name: "Welding table",
          category: "Production",
          location: "Hall A",
          archived_at: null,
          average_percent: 0,
          pending_count: 0,
          days: [
            { date: "2026-10-12", allocated_percent: 0, maintenance: false },
            { date: "2026-10-13", allocated_percent: 0, maintenance: false },
          ],
        },
      ],
    }),
  },
}));

function renderOverview() {
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map() }}>
        <ResourceOverview
          workspace="workspace"
          resources={[]}
          from="2026-10-12"
          to="2026-10-13"
          setFrom={vi.fn()}
          setTo={vi.fn()}
        />
      </SWRConfig>
    </MemoryRouter>
  );
}

describe("resource capacity overview", () => {
  it("shows all resources with allocation, maintenance and a day-specific detail link", async () => {
    renderOverview();
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: "Paint booth" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Welding table" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Paint booth:.*planning.blackouts/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Paint booth:.*planning.allocation: 100%/ }).getAttribute("href")).toBe(
      "/workspace/resources/booth?from=2026-10-12&to=2026-10-12"
    );
  });
  it("filters by full allocation and unscheduled demand", async () => {
    renderOverview();
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "planning.allocation" }), {
      target: { value: "fully_booked" },
    });
    expect(screen.queryByRole("link", { name: "Welding table" })).toBeNull();
    expect(screen.getByRole("link", { name: "Paint booth" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "planning.allocation" }), { target: { value: "pending" } });
    expect(screen.getByRole("link", { name: "Paint booth" })).toBeTruthy();
  });
});
