import { useState } from "react";
import { observer } from "mobx-react";
import { addDays, format } from "date-fns";
import { Link, useParams, useSearchParams } from "react-router";
import useSWR, { useSWRConfig } from "swr";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import type { TResourceBlackout, TWorkspaceResource } from "@plane/types";
import { PageHead } from "@/components/core/page-title";
import { planningInputClass } from "@/components/project/view-controls";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { planningService } from "@/services/planning.service";
import { PlanningError } from "./error";
import { ResourceOverview } from "./overview";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function ResourceForm({
  workspace,
  resource,
  close,
  saved,
}: {
  workspace: string;
  resource?: TWorkspaceResource;
  close: () => void;
  saved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Partial<TWorkspaceResource>>(
    resource ?? { name: "", description: "", category: "", location: "", archived_at: null }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await planningService.saveResource(workspace, draft, resource?.id);
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
            <DialogTitle>{resource ? resource.name : t("planning.new_resource")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="space-y-4"
            >
              {(["name", "category", "location", "description"] as const).map((key) => (
                <label key={key} className="flex flex-col gap-2 text-13">
                  {key === "name" || key === "description" ? t(key) : t(`planning.${key}`)}
                  {key === "description" ? (
                    <textarea
                      className={planningInputClass}
                      value={draft[key] ?? ""}
                      maxLength={4000}
                      rows={3}
                      onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    />
                  ) : (
                    <input
                      className={planningInputClass}
                      required={key === "name"}
                      maxLength={key === "category" ? 100 : 255}
                      value={draft[key] ?? ""}
                      onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    />
                  )}
                </label>
              ))}
              {resource && (
                <label className="flex items-center gap-2 text-13">
                  <input
                    type="checkbox"
                    checked={!draft.archived_at}
                    onChange={(event) =>
                      setDraft({ ...draft, archived_at: event.target.checked ? null : new Date().toISOString() })
                    }
                  />
                  {t("planning.active")}
                </label>
              )}
              <PlanningError error={error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  stretch="auto"
                  label={t("cancel")}
                  disabled={busy}
                  onClick={close}
                />
                <Button type="submit" variant="primary" size="md" stretch="auto" label={t("save")} disabled={busy} />
              </div>
            </form>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

function BlackoutForm({
  workspace,
  resourceId,
  blackout,
  close,
  saved,
}: {
  workspace: string;
  resourceId: string;
  blackout?: TResourceBlackout;
  close: () => void;
  saved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Partial<TResourceBlackout>>(
    blackout ?? {
      start_date: format(new Date(), "yyyy-MM-dd"),
      target_date: format(new Date(), "yyyy-MM-dd"),
      reason: "",
    }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await planningService.saveBlackout(workspace, resourceId, draft, blackout?.id);
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
            <DialogTitle>{t("planning.blackouts")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {(["start_date", "target_date"] as const).map((key) => (
                <label key={key} className="flex flex-col gap-2 text-13">
                  {t(key === "start_date" ? "planning.start" : "planning.end")}
                  <input
                    className={planningInputClass}
                    type="date"
                    required
                    min={key === "target_date" ? draft.start_date : undefined}
                    value={draft[key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-2 text-13">
                {t("description")}
                <input
                  className={planningInputClass}
                  value={draft.reason ?? ""}
                  maxLength={255}
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                />
              </label>
              <PlanningError error={error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  stretch="auto"
                  label={t("cancel")}
                  disabled={busy}
                  onClick={close}
                />
                <Button type="submit" variant="primary" size="md" stretch="auto" label={t("save")} disabled={busy} />
              </div>
            </form>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

export const ResourcesRoot = observer(function ResourcesRoot() {
  const { workspaceSlug = "", resourceId } = useParams();
  const [searchParams] = useSearchParams();
  const { mutate: invalidate } = useSWRConfig();
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const canRead = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
  const admin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const {
    data: resources,
    error,
    mutate,
    isValidating,
  } = useSWR(canRead && user ? ["planning-resources", workspaceSlug, user.id] : null, () =>
    planningService.resources(workspaceSlug)
  );
  const [editing, setEditing] = useState<TWorkspaceResource | "new" | null>(null);
  const [maintenance, setMaintenance] = useState<TResourceBlackout | "new" | null>(null);
  const [deleting, setDeleting] = useState<TResourceBlackout | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<unknown>();
  const [from, setFrom] = useState(searchParams.get("from") || format(new Date(), "yyyy-MM-dd"));
  const [to, setTo] = useState(searchParams.get("to") || format(addDays(new Date(), 13), "yyyy-MM-dd"));
  const {
    data: availability,
    error: availabilityError,
    mutate: refreshAvailability,
  } = useSWR(
    canRead && user && resourceId && from && to
      ? ["resource-availability", workspaceSlug, user.id, resourceId, from, to]
      : null,
    () => planningService.availability(workspaceSlug, resourceId!, from, to)
  );
  const resource = resources?.find((item) => item.id === resourceId);
  const removeBlackout = async () => {
    if (!deleting || !resourceId) return;
    setBusy(true);
    setWriteError(undefined);
    try {
      await planningService.removeBlackout(workspaceSlug, resourceId, deleting.id);
      await refreshAvailability();
      setDeleting(null);
    } catch (failure) {
      setWriteError(failure);
    } finally {
      setBusy(false);
    }
  };
  const refreshResources = async () => {
    await mutate();
    await invalidate((key) => Array.isArray(key) && key[0] === "resource-availability" && key[1] === workspaceSlug);
  };
  if (!canRead) return <div className="p-6 text-13 text-secondary">{t("planning.empty")}</div>;
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <PageHead title={resource?.name ?? t("planning.resources")} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-18 font-semibold break-words">
            {resourceId ? (resource?.name ?? t("planning.resources")) : t("planning.resources")}
          </h1>
          {resource && (
            <p className="mt-1 text-13 text-secondary">
              {[resource.category, resource.location].filter(Boolean).join(" / ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid size-8 place-items-center rounded hover:bg-layer-1"
            title={t("refresh")}
            aria-label={t("refresh")}
            disabled={isValidating}
            onClick={() => {
              void refreshResources();
            }}
          >
            <RefreshCw size={16} />
          </button>
          {admin && (
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label={resourceId ? t("edit") : t("planning.new_resource")}
              onClick={() => setEditing(resource ?? "new")}
            />
          )}
        </div>
      </div>
      <PlanningError error={error || availabilityError || writeError} />
      {!resources && !error && (
        <p role="status" className="py-6 text-13 text-secondary">
          {t("loading")}
        </p>
      )}
      {!resourceId ? (
        resources ? (
          <ResourceOverview
            workspace={workspaceSlug}
            resources={resources}
            from={from}
            to={to}
            setFrom={setFrom}
            setTo={setTo}
            edit={admin ? setEditing : undefined}
          />
        ) : null
      ) : resource ? (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Link
              to={`/${workspaceSlug}/resources`}
              className="mr-auto py-2 text-13 text-accent-primary hover:underline"
            >
              {t("planning.resources")}
            </Link>
            {(
              [
                ["from", from, setFrom],
                ["to", to, setTo],
              ] as const
            ).map(([key, value, change]) => (
              <label key={key} className="flex flex-col gap-1 text-11 text-secondary">
                {t(key === "from" ? "planning.start" : "planning.end")}
                <input
                  type="date"
                  className={planningInputClass}
                  value={value}
                  min={key === "to" ? from : undefined}
                  onChange={(event) => change(event.target.value)}
                />
              </label>
            ))}
          </div>
          {resource.description && (
            <p className="mb-5 max-w-3xl text-13 whitespace-pre-wrap text-secondary">{resource.description}</p>
          )}
          {!availability && !availabilityError && (
            <p role="status" className="py-5 text-13">
              {t("loading")}
            </p>
          )}
          {availability && (
            <>
              <section className="mb-8">
                <h2 className="mb-3 text-14 font-medium">{t("planning.allocation")}</h2>
                <div className="overflow-x-auto border-y border-subtle">
                  <div className="flex w-max min-w-full">
                    {availability.days.map((day) => (
                      <div
                        key={day.date}
                        className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-subtle py-3"
                      >
                        <span className="text-11 text-secondary">
                          {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
                            new Date(`${day.date}T12:00:00`)
                          )}
                        </span>
                        <div
                          className="relative h-20 w-6 overflow-hidden rounded bg-layer-1"
                          role="meter"
                          aria-label={dateLabel(day.date)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={day.allocated_percent}
                        >
                          <div
                            className="absolute inset-x-0 bottom-0 bg-accent-primary"
                            style={{ height: `${day.allocated_percent}%` }}
                          />
                        </div>
                        <span className="text-12 tabular-nums">{day.allocated_percent}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
              <section className="mb-8">
                <h2 className="mb-3 text-14 font-medium">{t("planning.reserved")}</h2>
                <ul className="divide-y divide-subtle">
                  {availability.bookings.map((booking) => (
                    <li
                      key={booking.issue_id ?? `private-${booking.start_date}-${booking.target_date}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-13"
                    >
                      {booking.issue_id ? (
                        <Link
                          className="min-w-0 break-words hover:text-accent-primary"
                          to={`/${workspaceSlug}/projects/${booking.project_id}/issues/${booking.issue_id}`}
                        >
                          <span className="mr-2 text-11 text-tertiary">{booking.identifier}</span>
                          {booking.name}
                        </Link>
                      ) : (
                        <span className="text-secondary">{t("planning.occupied")}</span>
                      )}
                      <span className="text-12 text-secondary">
                        {dateLabel(booking.start_date)} - {dateLabel(booking.target_date)} /{" "}
                        {booking.allocation_percent}%
                      </span>
                    </li>
                  ))}
                </ul>
                {!availability.bookings.length && <p className="text-13 text-secondary">{t("planning.empty")}</p>}
              </section>
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-14 font-medium">{t("planning.blackouts")}</h2>
                  {admin && !resource.archived_at && (
                    <button
                      type="button"
                      title={t("planning.new_blackout")}
                      aria-label={t("planning.new_blackout")}
                      className="grid size-8 place-items-center rounded hover:bg-layer-1"
                      onClick={() => setMaintenance("new")}
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-subtle">
                  {availability.blackouts.map((blackout) => (
                    <li key={blackout.id} className="flex flex-wrap items-center gap-3 py-3 text-13">
                      <span className="min-w-0 flex-1 break-words">{blackout.reason || t("planning.blackouts")}</span>
                      <span className="text-12 text-secondary">
                        {dateLabel(blackout.start_date)} - {dateLabel(blackout.target_date)}
                      </span>
                      {admin && (
                        <>
                          <button
                            type="button"
                            aria-label={t("edit")}
                            title={t("edit")}
                            onClick={() => setMaintenance(blackout)}
                            className="grid size-8 place-items-center rounded hover:bg-layer-1"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label={t("remove")}
                            title={t("remove")}
                            onClick={() => setDeleting(blackout)}
                            className="grid size-8 place-items-center rounded hover:bg-layer-1"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {!availability.blackouts.length && <p className="text-13 text-secondary">{t("planning.empty")}</p>}
              </section>
            </>
          )}
        </>
      ) : (
        resources && <p className="py-8 text-13 text-secondary">{t("planning.empty")}</p>
      )}
      {editing && (
        <ResourceForm
          workspace={workspaceSlug}
          resource={editing === "new" ? undefined : editing}
          close={() => setEditing(null)}
          saved={refreshResources}
        />
      )}
      {maintenance && resourceId && (
        <BlackoutForm
          workspace={workspaceSlug}
          resourceId={resourceId}
          blackout={maintenance === "new" ? undefined : maintenance}
          close={() => setMaintenance(null)}
          saved={refreshAvailability}
        />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null);
          }}
        >
          <DialogContent size="md">
            <DialogMain>
              <DialogHeader>
                <DialogTitle>
                  {t("remove")} / {t("planning.blackouts")}
                </DialogTitle>
              </DialogHeader>
              <DialogBody>
                <p className="mb-4 text-13">
                  {deleting.reason || `${dateLabel(deleting.start_date)} - ${dateLabel(deleting.target_date)}`}
                </p>
                <PlanningError error={writeError} />
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
                    onClick={() => void removeBlackout()}
                  />
                </div>
              </DialogBody>
            </DialogMain>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
});
