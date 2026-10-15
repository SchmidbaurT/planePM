import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TProject } from "@plane/types";
import { ProjectTemplatePicker, SaveProjectTemplateModal } from "./templates";
import { projectTemplateService } from "@/services/project/project-template.service";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({
  useUser: () => ({ data: { id: "user" } }),
  useUserPermissions: () => ({ allowPermissions: () => true }),
}));
vi.mock("@/services/project/project-template.service", () => ({
  projectTemplateService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("@/hooks/store/use-member", () => ({
  useMember: () => ({
    workspace: {
      getWorkspaceMemberIds: () => ["user"],
      isUserSuspended: () => false,
      memberMap: { user: { role: 20 } },
    },
    getUserDetails: () => ({ display_name: "Owner" }),
  }),
}));

const template = {
  id: "template",
  name: "Small series",
  description: "Production",
  source_project_id: "source",
  source_project_name: "Source",
  is_shared: true,
  created_by: "user",
  created_at: "2026-10-12",
  base_date: "2026-10-01",
  counts: { issues: 5, modules: 2, cycles: 1, pages: 1, requirements: 2, relations: 3 },
  project_defaults: { description: "Copy description", network: 0 },
};

function PickerForm({ submit }: { submit: (data: TProject) => void }) {
  const methods = useForm<TProject>({
    defaultValues: { name: "New series", identifier: "NEW", template_id: null, template_copy_assignees: false },
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(submit)}>
        <ProjectTemplatePicker workspace="workspace" />
        <input aria-label="project name" {...methods.register("name")} />
        <button type="submit">submit project</button>
      </form>
    </FormProvider>
  );
}

beforeEach(() => {
  vi.mocked(projectTemplateService.list).mockResolvedValue([template]);
  vi.mocked(projectTemplateService.create).mockResolvedValue(template);
});

describe("project templates", () => {
  it("submits the chosen template, new start date and optional assignees without replacing the new project name", async () => {
    const submit = vi.fn();
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <PickerForm submit={submit} />
      </SWRConfig>
    );
    await screen.findByRole("option", { name: "Small series" });
    fireEvent.change(screen.getByRole("combobox", { name: "planning.template_choice" }), {
      target: { value: "template" },
    });
    fireEvent.change(screen.getByLabelText("planning.start"), { target: { value: "2026-11-01" } });
    expect((screen.getByRole("checkbox", { name: "planning.copy_assignees" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "planning.copy_assignees" }));
    fireEvent.click(screen.getByRole("button", { name: "submit project" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({
      name: "New series",
      identifier: "NEW",
      template_id: "template",
      template_start_date: "2026-11-01",
      template_copy_assignees: true,
      description: "Copy description",
      network: 0,
    });
  });

  it("does not accidentally submit the project form when saving a template", async () => {
    const outerSubmit = vi.fn();
    const close = vi.fn();
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <form onSubmit={outerSubmit}>
          <SaveProjectTemplateModal workspace="workspace" project={{ id: "source", name: "Source" }} close={close} />
        </form>
      </SWRConfig>
    );
    fireEvent.change(screen.getByRole("textbox", { name: "name" }), { target: { value: "Small series" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(outerSubmit).not.toHaveBeenCalled();
    expect(projectTemplateService.create).toHaveBeenCalledWith("workspace", {
      name: "Small series",
      description: "",
      is_shared: false,
      source_project_id: "source",
    });
  });

  it("retains the template name after a failed save", async () => {
    vi.mocked(projectTemplateService.create).mockRejectedValueOnce({
      response: { data: { name: ["TEMPLATE_NAME_ALREADY_EXISTS"] } },
    });
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <SaveProjectTemplateModal workspace="workspace" project={{ id: "source", name: "Source" }} close={vi.fn()} />
      </SWRConfig>
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("textbox", { name: "name" }) as HTMLInputElement).value).toBe("Source");
  });
});
