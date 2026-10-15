import { useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router";
import { useFormContext } from "react-hook-form";
import useSWR, { useSWRConfig } from "swr";
import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { Button } from "@makeplane/propel/components/button";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssue, TResourceRequirement, TWorkspaceResource } from "@plane/types";
import { planningInputClass } from "@/components/project/view-controls";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { planningService } from "@/services/planning.service";
import { PlanningError } from "./error";

function RequirementFields({
  workspace,
  resources,
  value,
  change,
  disabled,
}: {
  workspace: string;
  resources: TWorkspaceResource[];
  value: TResourceRequirement[];
  change: (value: TResourceRequirement[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const available = resources.filter(
    (resource) => !resource.archived_at && !value.some((item) => item.resource_id === resource.id)
  );
  return (
    <div className="space-y-2">
      {value.map((requirement, index) => (
        <div key={requirement.resource_id} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 text-13 break-words">
            {resources.find((resource) => resource.id === requirement.resource_id)?.name ?? t("planning.resources")}
          </span>
          <label className="flex shrink-0 items-center gap-1 text-12">
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              required
              disabled={disabled}
              aria-label={`${t("planning.allocation")} ${resources.find((resource) => resource.id === requirement.resource_id)?.name ?? ""}`}
              className={`${planningInputClass} w-16 px-2 py-1`}
              value={requirement.allocation_percent}
              onChange={(event) =>
                change(
                  value.map((item, position) =>
                    position === index ? { ...item, allocation_percent: Number(event.target.value) } : item
                  )
                )
              }
            />
            %
          </label>
          <button
            type="button"
            title={t("remove")}
            aria-label={t("remove")}
            disabled={disabled}
            className="grid size-7 shrink-0 place-items-center rounded hover:bg-layer-1 disabled:opacity-40"
            onClick={() => change(value.filter((_, position) => position !== index))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div>
        <label className="flex items-center gap-2">
          <Plus size={14} className="shrink-0 text-tertiary" />
          <select
            disabled={disabled || available.length === 0}
            aria-label={t("planning.resources")}
            className={`${planningInputClass} py-1.5`}
            value=""
            onChange={(event) => {
              if (event.target.value) change([...value, { resource_id: event.target.value, allocation_percent: 100 }]);
            }}
          >
            <option value="">
              {t("add")} / {t("planning.resources")}
              {available.length === 0 ? ` (${t("planning.empty")})` : ""}
            </option>
            {available.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>
        {resources.length === 0 && (
          <Link
            to={`/${workspace}/resources`}
            className="mt-2 inline-flex items-center gap-2 text-12 text-accent-primary hover:underline"
          >
            <Wrench size={13} />
            {t("planning.resources")}
          </Link>
        )}
      </div>
    </div>
  );
}

function RequirementPreview({
  workspace,
  issueId,
  requirements,
  start,
  end,
}: {
  workspace: string;
  issueId?: string;
  requirements: TResourceRequirement[];
  start: string | null;
  end: string | null;
}) {
  const { data: user } = useUser();
  const validRange =
    start && end && start <= end && (new Date(end).getTime() - new Date(start).getTime()) / 86400000 <= 365;
  const { data } = useSWR(
    validRange && requirements.length && user
      ? ["resource-preview", workspace, user.id, issueId, JSON.stringify(requirements), start, end]
      : null,
    () =>
      Promise.all(
        requirements.map(async (requirement) => {
          const availability = await planningService.availability(workspace, requirement.resource_id, start!, end!);
          return availability.days.find((day) => {
            const own = availability.bookings
              .filter(
                (booking) =>
                  booking.issue_id === issueId && booking.start_date <= day.date && booking.target_date >= day.date
              )
              .reduce((total, booking) => total + booking.allocation_percent, 0);
            return day.allocated_percent - own + requirement.allocation_percent > 100;
          });
        })
      )
  );
  const conflict = data?.find(Boolean);
  return <PlanningError error={conflict ? { code: "RESOURCE_CAPACITY_EXCEEDED", date: conflict.date } : undefined} />;
}

export const IssueResourceFormField = observer(function IssueResourceFormField({
  workspace,
  projectId,
  disabled,
}: {
  workspace: string;
  projectId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const allowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspace,
    projectId
  );
  const { data: resources, error } = useSWR(user && allowed ? ["planning-resources", workspace, user.id] : null, () =>
    planningService.resources(workspace)
  );
  const { watch, setValue } = useFormContext<TIssue>();
  const values = watch("resource_requirements") ?? [];
  const start = watch("start_date"),
    end = watch("target_date");
  if (!allowed) return null;
  return (
    <fieldset className="mx-6 mb-4 border-t border-subtle pt-3">
      <legend className="flex items-center gap-2 text-13 font-medium">
        <Wrench size={14} />
        {t("planning.resources")}
      </legend>
      <RequirementFields
        workspace={workspace}
        resources={resources ?? []}
        value={values}
        disabled={disabled}
        change={(value) => setValue("resource_requirements", value, { shouldDirty: true })}
      />
      {!!values.length && (!start || !end) && (
        <p className="mt-2 text-12 text-secondary">{t("planning.pending_dates")}</p>
      )}
      <RequirementPreview workspace={workspace} requirements={values} start={start} end={end} />
      <PlanningError error={error} />
    </fieldset>
  );
});

export const IssueResources = observer(function IssueResources({
  workspace,
  projectId,
  issueId,
  startDate,
  endDate,
  stateGroup,
  disabled,
}: {
  workspace: string;
  projectId: string;
  issueId: string;
  startDate: string | null;
  endDate: string | null;
  stateGroup?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const canRead = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspace
  );
  const editable =
    !disabled &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspace,
      projectId
    );
  const { data: resources } = useSWR(user && canRead ? ["planning-resources", workspace, user.id] : null, () =>
    planningService.resources(workspace)
  );
  const { data, error, mutate } = useSWR(
    user ? ["issue-resources", workspace, user.id, projectId, issueId, startDate, endDate, stateGroup] : null,
    () => planningService.requirements(workspace, projectId, issueId)
  );
  const { mutate: invalidate } = useSWRConfig();
  const [draft, setDraft] = useState<TResourceRequirement[] | null>(null);
  const [writeError, setWriteError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (draft === null) return;
    setBusy(true);
    setWriteError(undefined);
    try {
      const saved = await planningService.saveRequirements(workspace, projectId, issueId, draft);
      await mutate(saved, { revalidate: false });
      await invalidate(
        (key) => Array.isArray(key) && key[1] === workspace && ["portfolio", "resource-availability"].includes(key[0])
      );
      setDraft(null);
    } catch (failure) {
      setWriteError(failure);
    } finally {
      setBusy(false);
    }
  };
  const reserved = !!startDate && !!endDate && !["completed", "cancelled"].includes(stateGroup ?? "");
  return (
    <section className="min-w-0 border-t border-subtle pt-3 whitespace-normal">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-13 font-medium">
          <Wrench size={14} />
          {t("planning.resources")}
        </h3>
        {editable && draft === null && (
          <button
            type="button"
            aria-label={t(data?.length ? "edit" : "add")}
            title={t(data?.length ? "edit" : "add")}
            disabled={!data || busy}
            onClick={() => {
              setDraft(data ?? []);
              setWriteError(undefined);
            }}
            className="flex min-h-7 items-center gap-1 rounded px-2 text-12 text-accent-primary hover:bg-layer-1 disabled:opacity-40"
          >
            {data?.length ? <Pencil size={14} /> : <Plus size={14} />}
            {t(data?.length ? "edit" : "add")}
          </button>
        )}
      </div>
      <PlanningError error={error || writeError} />
      {draft !== null ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <RequirementFields
            workspace={workspace}
            value={draft}
            change={(value) => {
              setDraft(value);
              setWriteError(undefined);
            }}
            resources={resources ?? []}
            disabled={busy}
          />
          {draft.length > 0 && !reserved && (
            <p className="text-12 text-secondary">
              {!startDate || !endDate ? t("planning.pending_dates") : t("planning.pending")}
            </p>
          )}
          {reserved && !writeError && (
            <RequirementPreview
              workspace={workspace}
              issueId={issueId}
              requirements={draft}
              start={startDate}
              end={endDate}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              label={t("cancel")}
              disabled={busy}
              onClick={() => setDraft(null)}
            />
            <Button type="submit" variant="primary" size="sm" stretch="auto" label={t("save")} disabled={busy} />
          </div>
        </form>
      ) : (
        <>
          {!data && !error && (
            <p role="status" className="text-12 text-secondary">
              {t("loading")}
            </p>
          )}
          {data?.map((requirement) => (
            <div
              key={requirement.resource_id}
              className="flex flex-wrap items-center justify-between gap-2 py-1 text-12"
            >
              {canRead ? (
                <Link
                  className="min-w-0 break-words text-accent-primary hover:underline"
                  to={`/${workspace}/resources/${requirement.resource_id}`}
                >
                  {resources?.find((resource) => resource.id === requirement.resource_id)?.name ??
                    t("planning.resources")}
                </Link>
              ) : (
                <span>{t("planning.resources")}</span>
              )}
              <span className="text-secondary">
                {requirement.allocation_percent}% / {t(reserved ? "planning.reserved" : "planning.pending")}
              </span>
            </div>
          ))}
          {data && !data.length && <p className="text-12 text-secondary">{t("planning.empty")}</p>}
        </>
      )}
    </section>
  );
});
