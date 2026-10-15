import { useDeferredValue, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { Check, ChevronDown, Diamond, History, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { useTranslation } from "@plane/i18n";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { milestoneService } from "@/services/project/milestone.service";
import type {
  TProjectMilestone,
  TMilestoneWorkItemOption,
  TMilestoneWorkItemPage,
} from "@/services/project/milestone.service";
import { planningInputClass } from "./view-controls";

export function useMilestones(workspace: string, project: string | undefined) {
  const { data: user } = useUser();
  return useSWR(project && user ? ["milestones", workspace, project, user.id] : null, () =>
    milestoneService.list(workspace, project!)
  );
}

export function MilestoneStatus({ milestone }: { milestone: TProjectMilestone }) {
  const { t } = useTranslation();
  return (
    <span
      className={
        milestone.status === "overdue" || milestone.is_late
          ? "text-danger-primary"
          : milestone.status === "reached"
            ? "text-success-primary"
            : "text-secondary"
      }
    >
      {t(
        milestone.status === "reached"
          ? "planning.reached"
          : milestone.status === "overdue"
            ? "planning.overdue"
            : "planning.open"
      )}
      {milestone.is_late && ` (${t("planning.late")})`}
    </span>
  );
}

export function MilestoneError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const data =
    typeof error === "object" && error !== null ? (error as { response?: { data?: unknown }; data?: unknown }) : {};
  const payload = data.response?.data ?? data.data ?? error;
  const fields = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const message =
    fields.code === "MILESTONE_CHANGED"
      ? t("planning.changed_reload")
      : fields.reason
        ? t("planning.change_reason")
        : fields.owner_id
          ? t("planning.milestone_owner")
          : fields.target_date
            ? t("planning.milestone_due")
            : t("planning.error");
  return (
    <p role="alert" className="text-13 break-words text-danger-primary">
      {message}
    </p>
  );
}

function MilestoneWorkItemPicker({
  workspace,
  project,
  value,
  initialItems,
  onChange,
  disabled,
}: {
  workspace: string;
  project: string;
  value: string[];
  initialItems: TMilestoneWorkItemOption[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const query = useDeferredValue(search.trim());
  const [known, setKnown] = useState<Record<string, TMilestoneWorkItemOption>>(() =>
    Object.fromEntries(initialItems.map((item) => [item.id, item]))
  );
  const { data, error, size, setSize, isValidating } = useSWRInfinite<TMilestoneWorkItemPage>(
    (index, previous: TMilestoneWorkItemPage | null) =>
      !open || !user || (previous && previous.next_cursor === null)
        ? null
        : ["milestone-work-items", workspace, project, user.id, query, index ? previous?.next_cursor : 0],
    (key: [string, string, string, string, string, number]) =>
      milestoneService.searchIssues(key[1], key[2], key[4], key[5]),
    { persistSize: false }
  );
  const matches = data?.flatMap((page) => page.results) ?? [];
  const resultMap = new Map(matches.map((item) => [item.id, item]));
  const select = (item: TMilestoneWorkItemOption) => {
    setKnown((previous) => ({ ...previous, [item.id]: item }));
    onChange([...value, item.id]);
    searchRef.current?.focus();
  };
  return (
    <section className="space-y-2 border-t border-subtle pt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-13"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          {t("planning.optional_work_items")} ({value.length})
        </span>
        <ChevronDown size={16} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="space-y-3">
          {value.length > 0 && (
            <ul className="divide-y divide-subtle">
              {value.map((id) => {
                const item = resultMap.get(id) ?? known[id];
                return (
                  <li key={id} className="flex items-start gap-2 py-2 text-13">
                    <Check size={14} className="mt-1 shrink-0 text-success-primary" />
                    <span className="min-w-0 flex-1 break-words">
                      {item?.identifier && <span className="mr-2 text-12 text-secondary">{item.identifier}</span>}
                      {item?.name ?? t("planning.template_unavailable")}
                    </span>
                    <button
                      type="button"
                      className="size-7 shrink-0 rounded-sm p-1 hover:bg-layer-1"
                      title={t("remove")}
                      aria-label={`${t("remove")}: ${item?.name ?? id}`}
                      disabled={disabled}
                      onClick={() => onChange(value.filter((selected) => selected !== id))}
                    >
                      <X size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="flex flex-col gap-1 text-13">
            {t("search")}
            <input
              className={planningInputClass}
              value={search}
              ref={searchRef}
              onChange={(event) => setSearch(event.target.value)}
              disabled={disabled}
            />
          </label>
          <MilestoneError error={error} />
          <div className="max-h-52 overflow-auto">
            {matches
              .filter((item) => !value.includes(item.id))
              .map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-start gap-2 border-b border-subtle py-2 text-13"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={disabled || search.trim() !== query}
                    onChange={() => select(item)}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">
                      <span className="mr-2 text-12 text-secondary">{item.identifier}</span>
                      {item.name}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-2 text-12 text-secondary">
                      {item.state__name}
                      {item.target_date && (
                        <time dateTime={item.target_date}>
                          {new Date(`${item.target_date}T12:00:00`).toLocaleDateString()}
                        </time>
                      )}
                    </span>
                  </span>
                </label>
              ))}
            {isValidating && (
              <p role="status" className="py-2 text-12 text-secondary">
                {t("loading")}
              </p>
            )}
            {data && data[0].count === 0 && !isValidating && (
              <p className="py-2 text-12 text-secondary">{t("planning.empty")}</p>
            )}
          </div>
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-12 text-secondary">
              <span>
                {matches.length} / {data[0].count}
              </span>
              {data.at(-1)?.next_cursor !== null && (
                <Button
                  variant="secondary"
                  size="sm"
                  stretch="auto"
                  label={t("load_more")}
                  disabled={disabled || isValidating}
                  onClick={() => void setSize(size + 1)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const MilestoneEditor = observer(function MilestoneEditor({
  workspace,
  project,
  milestone,
  close,
  saved,
}: {
  workspace: string;
  project: string;
  milestone?: TProjectMilestone;
  close: () => void;
  saved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { project: members, getUserDetails } = useMember();
  const { error: memberError } = useSWR(["milestone-members", workspace, project], () =>
    members.fetchProjectMembers(workspace, project)
  );
  const [name, setName] = useState(milestone?.name ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [date, setDate] = useState(milestone?.target_date ?? "");
  const [owner, setOwner] = useState(milestone?.owner_id ?? user?.id ?? "");
  const [reason, setReason] = useState("");
  const [issueIds, setIssueIds] = useState<string[]>(milestone?.issue_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const changedDate = milestone && milestone.target_date !== date;
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const payload = { name, description, target_date: date, owner_id: owner, reason, issue_ids: issueIds };
      if (milestone)
        await milestoneService.update(workspace, project, milestone.id, {
          ...payload,
          expected_updated_at: milestone.updated_at,
        });
      else await milestoneService.create(workspace, project, payload);
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
            <DialogTitle>{t(milestone ? "planning.milestones" : "planning.new_milestone")}</DialogTitle>
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
              <label className="flex flex-col gap-1 text-13">
                {t("name")}
                <input
                  className={planningInputClass}
                  required
                  maxLength={255}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-13">
                {t("description")}
                <textarea
                  className={planningInputClass}
                  rows={3}
                  maxLength={20000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-13">
                  {t("planning.milestone_due")}
                  <input
                    type="date"
                    className={planningInputClass}
                    required
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-13">
                  {t("planning.milestone_owner")}
                  <select
                    required
                    className={planningInputClass}
                    value={owner}
                    onChange={(event) => setOwner(event.target.value)}
                  >
                    <option value="">{t("select")}</option>
                    {(members.getProjectMemberIds(project, false) ?? []).map((id) => (
                      <option key={id} value={id}>
                        {getUserDetails(id)?.display_name ?? id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {changedDate && (
                <label className="flex flex-col gap-1 text-13">
                  {t("planning.change_reason")}
                  <textarea
                    className={planningInputClass}
                    required
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}
              <MilestoneWorkItemPicker
                workspace={workspace}
                project={project}
                value={issueIds}
                initialItems={milestone?.issues ?? []}
                onChange={setIssueIds}
                disabled={busy}
              />
              <MilestoneError error={error ?? memberError} />
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
                  disabled={
                    busy || !owner || !date || !name.trim() || !!memberError || (!!changedDate && !reason.trim())
                  }
                />
              </div>
            </form>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
});

export const MilestoneManager = observer(function MilestoneManager({
  workspace,
  project,
  selectedId,
  onCloseSelection,
}: {
  workspace: string;
  project: string;
  selectedId?: string;
  onCloseSelection?: () => void;
}) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { getProjectById } = useProject();
  const { data, error, mutate, isLoading } = useMilestones(workspace, project);
  const { mutate: invalidate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TProjectMilestone | "new">();
  const [historyId, setHistoryId] = useState<string>();
  const [action, setAction] = useState<{ kind: "reached" | "reopen" | "delete"; milestone: TProjectMilestone }>();
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const manager =
    allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspace, project) ||
    getProjectById(project)?.project_lead === user?.id;
  const member = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspace,
    project
  );
  const saved = async () => {
    await mutate();
    await invalidate((key) => Array.isArray(key) && ["work-plan", "milestones", "portfolio"].includes(String(key[0])));
  };
  const runAction = async (milestone: TProjectMilestone, kind: "reached" | "reopen" | "delete") => {
    setBusy(true);
    setFailure(undefined);
    try {
      if (kind === "delete") await milestoneService.remove(workspace, project, milestone.id);
      else
        await milestoneService.update(workspace, project, milestone.id, {
          reached: kind === "reached",
          reason,
          expected_updated_at: milestone.updated_at,
        });
      await saved();
      setAction(undefined);
      setReason("");
    } catch (value) {
      setFailure(value);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setOpen(false);
    onCloseSelection?.();
  };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        stretch="auto"
        label={t("planning.milestones")}
        onClick={() => setOpen(true)}
      />
      {(open || selectedId) && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value && !busy) close();
          }}
        >
          <DialogContent size="lg">
            <DialogMain>
              <DialogHeader>
                <DialogTitle>{t("planning.milestones")}</DialogTitle>
              </DialogHeader>
              <DialogBody>
                {member && (
                  <Button
                    variant="primary"
                    size="sm"
                    stretch="auto"
                    label={t("planning.new_milestone")}
                    onClick={() => setEditing("new")}
                  />
                )}
                <MilestoneError error={error ?? failure} />
                {isLoading && <p role="status">{t("loading")}</p>}
                {data?.length === 0 && <p className="py-4 text-13 text-secondary">{t("planning.empty")}</p>}
                <div className="mt-3 divide-y divide-subtle">
                  {data?.map((milestone) => {
                    const canEdit = member && (manager || user?.id === milestone.owner_id);
                    return (
                      <section key={milestone.id} className="space-y-2 py-3" id={`milestone-${milestone.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="flex items-center gap-2 text-14 font-medium break-words">
                              <Diamond size={16} className="shrink-0" />
                              {milestone.name}
                            </h3>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-12 text-secondary">
                              <time dateTime={milestone.target_date}>
                                {new Date(`${milestone.target_date}T12:00:00`).toLocaleDateString()}
                              </time>
                              <span>{milestone.owner_name}</span>
                              <MilestoneStatus milestone={milestone} />
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {canEdit && !milestone.completed_at && (
                              <button
                                type="button"
                                className="size-8 rounded-sm p-2 hover:bg-layer-1"
                                title={t("planning.confirm_milestone")}
                                aria-label={t("planning.confirm_milestone")}
                                disabled={busy}
                                onClick={() => setAction({ kind: "reached", milestone })}
                              >
                                <Check size={16} />
                              </button>
                            )}
                            {canEdit && !milestone.completed_at && (
                              <button
                                type="button"
                                className="size-8 rounded-sm p-2 hover:bg-layer-1"
                                title={t("edit")}
                                aria-label={t("edit")}
                                onClick={() => setEditing(milestone)}
                              >
                                <Pencil size={16} />
                              </button>
                            )}
                            {canEdit && milestone.completed_at && (
                              <button
                                type="button"
                                className="size-8 rounded-sm p-2 hover:bg-layer-1"
                                title={t("planning.reopen_milestone")}
                                aria-label={t("planning.reopen_milestone")}
                                onClick={() => setAction({ kind: "reopen", milestone })}
                              >
                                <RotateCcw size={16} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="size-8 rounded-sm p-2 hover:bg-layer-1"
                              title={t("planning.history")}
                              aria-label={t("planning.history")}
                              aria-expanded={historyId === milestone.id}
                              onClick={() => setHistoryId(historyId === milestone.id ? undefined : milestone.id)}
                            >
                              <History size={16} />
                            </button>
                            {manager && (
                              <button
                                type="button"
                                className="size-8 rounded-sm p-2 hover:bg-layer-1"
                                title={t("delete")}
                                aria-label={t("delete")}
                                onClick={() => setAction({ kind: "delete", milestone })}
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                        {milestone.description && (
                          <p className="text-13 break-words whitespace-pre-wrap">{milestone.description}</p>
                        )}
                        {milestone.issues.length > 0 && (
                          <div className="flex flex-wrap gap-2 text-12">
                            {milestone.issues.map((issue) => (
                              <a
                                key={issue.id}
                                className="text-accent-primary underline"
                                href={`/${workspace}/projects/${project}/issues/${issue.id}/`}
                              >
                                {issue.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {milestone.target_date !== milestone.original_target_date && (
                          <p className="text-12 text-secondary">
                            {t("planning.original_due")}:{" "}
                            {new Date(`${milestone.original_target_date}T12:00:00`).toLocaleDateString()}
                          </p>
                        )}
                        {milestone.completed_at && (
                          <p className="text-12 text-secondary">
                            {t("planning.reached")}: {new Date(milestone.completed_at).toLocaleString()}
                          </p>
                        )}
                        {(historyId === milestone.id || selectedId === milestone.id) && (
                          <ol className="space-y-2 border-l border-subtle pl-3 text-12">
                            {milestone.history.map((entry) => (
                              <li key={`${entry.at}:${entry.actor_id}:${entry.action}`}>
                                <time>{new Date(entry.at).toLocaleString()}</time>
                                <span className="ml-2">
                                  {entry.actor_name ??
                                    (entry.actor_id === user?.id ? user.display_name : entry.actor_id)}
                                </span>
                                {entry.reason && <p>{entry.reason}</p>}
                                {entry.changes && (
                                  <dl>
                                    {Object.entries(entry.changes).map(([key, change]) => (
                                      <div key={key} className="break-words">
                                        <dt className="inline">
                                          {t(
                                            key === "target_date"
                                              ? "planning.milestone_due"
                                              : key === "owner_id"
                                                ? "planning.milestone_owner"
                                                : key === "issue_ids"
                                                  ? "work_items"
                                                  : key === "status"
                                                    ? "state"
                                                    : key === "name"
                                                      ? "name"
                                                      : "description"
                                          )}
                                          :{" "}
                                        </dt>
                                        <dd className="inline">
                                          {String(change.from)} / {String(change.to)}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                    );
                  })}
                </div>
              </DialogBody>
            </DialogMain>
          </DialogContent>
        </Dialog>
      )}
      {editing && (
        <MilestoneEditor
          workspace={workspace}
          project={project}
          milestone={editing === "new" ? undefined : editing}
          close={() => setEditing(undefined)}
          saved={saved}
        />
      )}
      {action && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value && !busy) {
              setAction(undefined);
              setReason("");
            }
          }}
        >
          <DialogContent size="md">
            <DialogMain>
              <DialogHeader>
                <DialogTitle>
                  {t(
                    action.kind === "delete"
                      ? "delete"
                      : action.kind === "reached"
                        ? "planning.confirm_milestone"
                        : "planning.reopen_milestone"
                  )}
                  : {action.milestone.name}
                </DialogTitle>
              </DialogHeader>
              <DialogBody>
                {action.kind === "reached" && (
                  <div className="mb-4 space-y-2 text-13">
                    <p>{action.milestone.description}</p>
                    <time dateTime={action.milestone.target_date}>
                      {new Date(`${action.milestone.target_date}T12:00:00`).toLocaleDateString()}
                    </time>
                    <p className="text-secondary">{action.milestone.owner_name}</p>
                  </div>
                )}
                {action.kind === "reopen" && (
                  <label className="flex flex-col gap-2 text-13">
                    {t("planning.change_reason")}
                    <textarea
                      className={planningInputClass}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={2000}
                    />
                  </label>
                )}
                <MilestoneError error={failure} />
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    stretch="auto"
                    label={t("cancel")}
                    disabled={busy}
                    onClick={() => setAction(undefined)}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    stretch="auto"
                    label={t(
                      action.kind === "delete"
                        ? "delete"
                        : action.kind === "reached"
                          ? "planning.confirm_milestone"
                          : "planning.reopen_milestone"
                    )}
                    disabled={busy || (action.kind === "reopen" && !reason.trim())}
                    onClick={() => void runAction(action.milestone, action.kind)}
                  />
                </div>
              </DialogBody>
            </DialogMain>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
});

export function MilestoneTimelineToolbar({
  workspace,
  project,
  selectedId,
  onCloseSelection,
  disabled,
  headerHasMilestones,
}: {
  workspace: string;
  project?: string;
  selectedId?: string;
  onCloseSelection: () => void;
  disabled: boolean;
  headerHasMilestones: boolean;
}) {
  if (disabled || !project) return null;
  return (
    <div className={headerHasMilestones ? "hidden" : "flex shrink-0 justify-end border-b border-subtle px-3 py-2"}>
      <MilestoneManager
        workspace={workspace}
        project={project}
        selectedId={selectedId}
        onCloseSelection={onCloseSelection}
      />
    </div>
  );
}

export const MilestoneTimelineMarker = observer(function MilestoneTimelineMarker({
  milestone,
  onOpen,
}: {
  milestone: Pick<TProjectMilestone, "name" | "target_date" | "owner_name" | "status" | "is_late">;
  onOpen: () => void;
}) {
  const { getPositionFromDateOnGantt, currentViewData } = useTimeLineChartStore();
  const left = getPositionFromDateOnGantt(`${milestone.target_date}T00:00:00`, 0);
  if (left === undefined || left < 0) return null;
  return (
    <button
      type="button"
      className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: left + (currentViewData?.data.dayWidth ?? 0) / 2 }}
      onClick={onOpen}
      title={`${milestone.name} · ${milestone.target_date} · ${milestone.owner_name}`}
      aria-label={`${milestone.name}, ${milestone.target_date}, ${milestone.owner_name}`}
    >
      <Diamond
        size={18}
        className={
          milestone.status === "overdue" || milestone.is_late
            ? "fill-danger-subtle text-danger-primary"
            : milestone.status === "reached"
              ? "fill-success-subtle text-success-primary"
              : "fill-accent-subtle text-accent-primary"
        }
      />
    </button>
  );
});
