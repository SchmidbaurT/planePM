import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingDialog } from "./blocking-dialog";
import { useTimeLineRelationOptions } from "@/components/relations";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/api.service", () => ({ APIService: class { get = get; } }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const source = { id: "source", name: "Material", project_id: "project", project__name: "Build", project__identifier: "B", sequence_id: 1, state__name: "Open" };
beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => ({ data: url.includes("issue-relation") ? { blocked_by: [] } : url.includes("blocking-work-items") ? { results: [source], count: 1, next_cursor: null } : { updated_at: "2026-10-15T10:00:00Z" } }));
});
function mount(save = vi.fn(), close = vi.fn()) {
  render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><BlockingDialog workspace="workspace" project="project" issueId="target" save={save} close={close} /></SWRConfig>);
  return { save, close };
}
describe("required blocker selection", () => {
  it("requires a cause and saves selection and version together", async () => {
    const { save } = mount();
    expect((screen.getByRole("button", { name: "save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole("checkbox", { name: /B-1 Material/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "save" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(["source"], "2026-10-15T10:00:00Z"));
  });
  it("cancel never persists a partial status change", async () => {
    const { save, close } = mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: /B-1 Material/ }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(close).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("requires confirmation to remove the last cause and retains failed input", async () => {
    get.mockImplementation(async (url: string) => ({ data: url.includes("issue-relation") ? { blocked_by: [source] } : url.includes("blocking-work-items") ? { results: [], count: 0, next_cursor: null } : { updated_at: "2026-10-15T10:00:00Z" } }));
    const save = vi.fn().mockRejectedValueOnce(new Error("Conflict"));
    const { close } = mount(save);
    fireEvent.click(await screen.findByRole("button", { name: "remove: Material" }));
    expect((screen.getByRole("button", { name: "save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "planning.clear_blockers" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await screen.findByRole("alert");
    expect(close).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith([], "2026-10-15T10:00:00Z");
  });
  it("hides obsolete inputs but retains blocked-by and scheduling relations", () => {
    const options = useTimeLineRelationOptions();
    expect(options.relates_to).toBeUndefined();
    expect(options.duplicate).toBeUndefined();
    expect(options.blocking).toBeUndefined();
    expect(options.blocked_by).toBeTruthy();
    expect(options.finish_to_start).toBeTruthy();
  });
});