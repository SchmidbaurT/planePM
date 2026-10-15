import { useState } from "react";
import { observer } from "mobx-react";
import { Controller, useFormContext } from "react-hook-form";
import useSWR, { useSWRConfig } from "swr";
import { BookCopy, Pencil, Trash2 } from "lucide-react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TProject, TProjectTemplate } from "@plane/types";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { projectTemplateService } from "@/services/project/project-template.service";
import { planningInputClass } from "./view-controls";
import { PlanningError } from "@/components/resources/error";
import { getResourceConflict } from "@/helpers/planning";
import { useMember } from "@/hooks/store/use-member";

function useTemplates(workspace: string) {
  const { data: user } = useUser();
  return useSWR(user ? ["project-templates", workspace, user.id] : null, () => projectTemplateService.list(workspace));
}

export function TemplateError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  if (getResourceConflict(error)) return <PlanningError error={error} />;
  const outer =
    typeof error === "object" && error !== null
      ? (error as { response?: { data?: Record<string, unknown> }; data?: Record<string, unknown>; status?: number })
      : {};
  const data = outer.response?.data ?? outer.data ?? {};
  const message = data.template_start_date
    ? t("planning.template_start_required")
    : data.template_id || outer.status === 404
      ? t("planning.template_unavailable")
      : JSON.stringify(data)?.includes("TEMPLATE_NAME_ALREADY_EXISTS")
        ? t("planning.template_name_exists")
        : JSON.stringify(data)?.includes("PROJECT_NAME_ALREADY_EXIST")
          ? t("project_name_already_taken")
          : JSON.stringify(data)?.includes("PROJECT_IDENTIFIER_ALREADY_EXIST")
            ? t("project_identifier_already_taken")
            : t("planning.error");
  return (
    <p role="alert" className="text-13 text-danger-primary">
      {message}
    </p>
  );
}

function TemplateForm({
  workspace,
  project,
  template,
  close,
  saved,
}: {
  workspace: string;
  project?: { id: string; name: string };
  template?: TProjectTemplate;
  close: () => void;
  saved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(template?.name ?? project?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [shared, setShared] = useState(template?.is_shared ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (template)
        await projectTemplateService.update(workspace, template.id, { name, description, is_shared: shared });
      else if (project)
        await projectTemplateService.create(workspace, {
          name,
          description,
          is_shared: shared,
          source_project_id: project.id,
        });
      await saved();
      close();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogTitle>
              {template ? t("templates.settings.form.project.button.update") : t("planning.save_template")}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void submit();
              }}
            >
              <label className="flex flex-col gap-2 text-13">
                {t("name")}
                <input
                  className={planningInputClass}
                  required
                  maxLength={255}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-13">
                {t("description")}
                <textarea
                  className={planningInputClass}
                  maxLength={4000}
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-13">
                <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
                {t("planning.share_template")}
              </label>
              <p className="text-12 text-secondary">{t("planning.template_notice")}</p>
              <TemplateError error={error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  stretch="auto"
                  label={t("cancel")}
                  disabled={busy}
                  onClick={close}
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  stretch="auto"
                  label={t("save")}
                  disabled={busy || !name.trim()}
                />
              </div>
            </form>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

export function SaveProjectTemplateModal({
  workspace,
  project,
  close,
}: {
  workspace: string;
  project: { id: string; name: string };
  close: () => void;
}) {
  const { mutate } = useSWRConfig();
  return (
    <TemplateForm
      workspace={workspace}
      project={project}
      close={close}
      saved={() => mutate((key) => Array.isArray(key) && key[0] === "project-templates" && key[1] === workspace)}
    />
  );
}

function TemplateManager({ workspace, close }: { workspace: string; close: () => void }) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const admin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspace);
  const { data, error, mutate } = useTemplates(workspace);
  const [editing, setEditing] = useState<TProjectTemplate | null>(null);
  const [deleting, setDeleting] = useState<TProjectTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<unknown>();
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setWriteError(undefined);
    try {
      await projectTemplateService.remove(workspace, deleting.id);
      await mutate();
      setDeleting(null);
    } catch (failure) {
      setWriteError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent size="md">
          <DialogMain>
            <DialogHeader>
              <DialogTitle>{t("templates.settings.options.project.label")}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <TemplateError error={error} />
              {!data && !error && (
                <p role="status" className="text-13 text-secondary">
                  {t("loading")}
                </p>
              )}
              <ul className="divide-y divide-subtle">
                {data?.map((template) => (
                  <li key={template.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-medium break-words">{template.name}</p>
                      <p className="mt-1 text-12 break-words text-secondary">{template.description}</p>
                      <p className="mt-1 text-11 text-tertiary">
                        {t("work_items")}: {template.counts.issues}
                      </p>
                    </div>
                    {(admin || template.created_by === user?.id) && (
                      <>
                        <button
                          type="button"
                          title={t("edit")}
                          aria-label={`${t("edit")} ${template.name}`}
                          className="grid size-8 shrink-0 place-items-center rounded hover:bg-layer-1"
                          onClick={() => setEditing(template)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          title={t("remove")}
                          aria-label={`${t("remove")} ${template.name}`}
                          className="grid size-8 shrink-0 place-items-center rounded hover:bg-layer-1"
                          onClick={() => setDeleting(template)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {data && !data.length && <p className="text-13 text-secondary">{t("planning.empty")}</p>}
            </DialogBody>
          </DialogMain>
        </DialogContent>
      </Dialog>
      {editing && (
        <TemplateForm workspace={workspace} template={editing} close={() => setEditing(null)} saved={mutate} />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null);
          }}
        >
          <DialogContent size="sm">
            <DialogMain>
              <DialogHeader>
                <DialogTitle>
                  {t("remove")}: {deleting.name}
                </DialogTitle>
              </DialogHeader>
              <DialogBody>
                <TemplateError error={writeError} />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    stretch="auto"
                    label={t("cancel")}
                    disabled={busy}
                    onClick={() => setDeleting(null)}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    stretch="auto"
                    label={t("remove")}
                    disabled={busy}
                    onClick={() => void remove()}
                  />
                </div>
              </DialogBody>
            </DialogMain>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export const ProjectTemplatePicker = observer(function ProjectTemplatePicker({ workspace }: { workspace: string }) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { workspace: members, getUserDetails } = useMember();
  const { data, error } = useTemplates(workspace);
  const {
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useFormContext<TProject>();
  const selectedId = watch("template_id");
  const selected = data?.find((template) => template.id === selectedId);
  const [manage, setManage] = useState(false);
  const choose = (id: string) => {
    const template = data?.find((item) => item.id === id);
    setValue("template_id", id || null, { shouldDirty: true });
    setValue("template_copy_assignees", false);
    if (template) {
      setValue("description", template.project_defaults.description ?? "");
      if (template.project_defaults.logo_props) setValue("logo_props", template.project_defaults.logo_props);
      if (template.project_defaults.network !== undefined) setValue("network", template.project_defaults.network);
    }
  };
  return (
    <section className="space-y-3 border-b border-subtle pb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="project-template" className="flex items-center gap-2 text-13 font-medium">
          <BookCopy size={15} />
          {t("planning.template_choice")}
        </label>
        <button
          type="button"
          title={t("templates.settings.title")}
          aria-label={t("templates.settings.title")}
          className="text-12 text-accent-primary hover:underline"
          onClick={() => setManage(true)}
        >
          {t("templates.settings.title")}
        </button>
      </div>
      <select
        id="project-template"
        className={planningInputClass}
        value={selectedId ?? ""}
        disabled={isSubmitting || !data}
        onChange={(event) => choose(event.target.value)}
      >
        <option value="">{data ? t("planning.no_template") : t("loading")}</option>
        {data?.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
      <TemplateError error={error} />
      {selectedId && !selected && data && (
        <p role="alert" className="text-12 text-danger-primary">
          {t("planning.template_unavailable")}
        </p>
      )}
      {selected && (
        <>
          {selected.description && <p className="text-13 whitespace-pre-wrap text-secondary">{selected.description}</p>}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-12 sm:grid-cols-3">
            {(
              [
                ["issues", "work_items"],
                ["modules", "common.modules"],
                ["cycles", "common.cycles"],
                ["pages", "common.pages"],
                ["requirements", "planning.resources"],
                ["relations", "planning.dependencies"],
                ["milestones", "planning.milestones"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-secondary">{t(label)}</dt>
                <dd className="font-medium tabular-nums">{selected.counts[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <Controller
            name="template_start_date"
            control={control}
            rules={{ required: selected.base_date ? t("planning.template_start_required") : false }}
            render={({ field }) => (
              <label className="flex max-w-56 flex-col gap-2 text-13">
                {t("planning.start")}
                <input
                  className={planningInputClass}
                  type="date"
                  required={!!selected.base_date}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  ref={field.ref}
                  disabled={isSubmitting}
                />
                {errors.template_start_date && (
                  <span className="text-12 text-danger-primary">{errors.template_start_date.message}</span>
                )}
              </label>
            )}
          />
          <Controller
            name="template_copy_assignees"
            control={control}
            render={({ field }) => (
              <label className="flex items-center gap-2 text-13">
                <input
                  type="checkbox"
                  checked={field.value ?? false}
                  disabled={isSubmitting}
                  onChange={field.onChange}
                />
                {t("planning.copy_assignees")}
              </label>
            )}
          />
          {!!selected.counts.milestones && (
            <Controller
              name="template_milestone_owner_id"
              control={control}
              render={({ field }) => (
                <label className="flex flex-col gap-2 text-13">
                  {t("planning.milestone_owner")}
                  <select
                    className={planningInputClass}
                    value={field.value ?? user?.id ?? ""}
                    disabled={isSubmitting}
                    onChange={field.onChange}
                  >
                    {Array.from(new Set([...(user ? [user.id] : []), ...members.getWorkspaceMemberIds(workspace)]))
                      .filter(
                        (id) =>
                          !members.isUserSuspended(id, workspace) &&
                          (id === user?.id || (members.memberMap?.[id]?.role ?? 0) >= 15)
                      )
                      .map((id) => (
                        <option key={id} value={id}>
                          {getUserDetails(id)?.display_name ?? id}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            />
          )}
          <p className="text-12 text-secondary">{t("planning.template_notice")}</p>
        </>
      )}
      {manage && <TemplateManager workspace={workspace} close={() => setManage(false)} />}
    </section>
  );
});
