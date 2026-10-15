import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Diamond, RefreshCw } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import {
  EUserPermissions,
  EUserPermissionsLevel,
  USER_PROFILE_DATA,
  USER_PROFILE_PROJECT_SEGREGATION,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { StateSelect } from "@/components/dropdowns/state/state-select";
import { IssueService } from "@/services/issue/issue.service";
import type { TWorkPlanIssue } from "@/services/project/milestone.service";
import { milestoneService } from "@/services/project/milestone.service";
import { MilestoneError, MilestoneManager, MilestoneStatus } from "@/components/project/milestones";

const issueService = new IssueService();

export function ProfileWorkPlan({ workspace, userId }: { workspace: string; userId: string }) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { mutate: invalidate } = useSWRConfig();
  const [busyIssue, setBusyIssue] = useState<string>();
  const [writeError, setWriteError] = useState<unknown>();
  const [cursors, setCursors] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<{ project: string; id: string }>();
  const { data, error, isLoading, mutate, isValidating } = useSWR(
    user ? ["work-plan", workspace, userId, user.id, cursors] : null,
    () => milestoneService.workPlan(workspace, userId, cursors)
  );
  const titles = {
    today: "planning.today_work",
    week: "planning.week_work",
    blocked: "planning.blocked_work",
    milestones: "planning.milestones",
  } as const;
  const changeState = async (issue: TWorkPlanIssue, state: string) => {
    setBusyIssue(issue.id);
    setWriteError(undefined);
    try {
      await issueService.patchIssue(workspace, issue.project_id, issue.id, { state });
      await mutate();
      await invalidate(USER_PROFILE_DATA(workspace, userId));
      await invalidate(USER_PROFILE_PROJECT_SEGREGATION(workspace, userId));
    } catch (failure) {
      setWriteError(failure);
    } finally {
      setBusyIssue(undefined);
    }
  };
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-16 font-medium">{t("planning.attention")}</h2>
        <button
          type="button"
          className="size-8 rounded-sm p-2 hover:bg-layer-1"
          title={t("refresh")}
          aria-label={t("refresh")}
          disabled={isValidating}
          onClick={() => void mutate()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <MilestoneError error={error ?? writeError} />
      {isLoading && (
        <p role="status" className="text-13 text-secondary">
          {t("loading")}
        </p>
      )}
      {data && (
        <div className="grid gap-x-6 gap-y-5 xl:grid-cols-2">
          {(["today", "week", "blocked", "milestones"] as const).map((key) => {
            const section = data.sections[key];
            const cursor = cursors[key] ?? 0;
            return (
              <section key={key} className="min-w-0 border-t border-subtle pt-3">
                <h3 className="flex items-center justify-between gap-2 text-14 font-medium">
                  {t(titles[key])}
                  <span className="text-12 text-secondary">{section.count}</span>
                </h3>
                <ul className="mt-2 divide-y divide-subtle">
                  {key === "milestones"
                    ? data.sections.milestones.items.map((milestone) => (
                        <li key={milestone.id} className="py-2">
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-start gap-2 text-left text-13 hover:text-accent-primary"
                            onClick={() => setSelected({ project: milestone.project_id, id: milestone.id })}
                          >
                            <Diamond size={16} className="mt-0.5 shrink-0" />
                            <span className="min-w-0 break-words">{milestone.name}</span>
                          </button>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-12 text-secondary">
                            <time dateTime={milestone.target_date}>
                              {new Date(`${milestone.target_date}T12:00:00`).toLocaleDateString()}
                            </time>
                            <span>{milestone.owner_name}</span>
                            <MilestoneStatus milestone={milestone} />
                          </div>
                        </li>
                      ))
                    : data.sections[key].items.map((issue) => (
                        <li key={issue.id} className={issue.is_blocked ? "rounded-sm bg-danger-subtle px-2 py-2" : "py-2"}>
                          <Link
                            to={`/${workspace}/projects/${issue.project_id}/issues/${issue.id}/`}
                            className="block text-13 break-words hover:text-accent-primary"
                          >
                            {issue.name}
                          </Link>
                          {issue.state_id && (
                            <div className="mt-1">
                              <StateSelect
                                value={issue.state_id}
                                issueId={issue.id}
                                onBlockingChange={async (data) => { await issueService.patchIssue(workspace, issue.project_id, issue.id, data); await mutate(); await invalidate(USER_PROFILE_DATA(workspace, userId)); }}
                                projectId={issue.project_id}
                                onChange={(state) => void changeState(issue, state)}
                                variant="pill-sm"
                                placeholder={issue.state__name}
                                tooltip
                                disabled={
                                  !!busyIssue ||
                                  !allowPermissions(
                                    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
                                    EUserPermissionsLevel.PROJECT,
                                    workspace,
                                    issue.project_id
                                  )
                                }
                              />
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-12 text-secondary">
                            <span>
                              {issue.project__identifier}-{issue.sequence_id} / {issue.project__name}
                            </span>
                            {!issue.state_id && <span>{issue.state__name}</span>}
                            {issue.target_date && (
                              <time
                                className={issue.target_date < data.as_of_date ? "text-danger-primary" : ""}
                                dateTime={issue.target_date}
                              >
                                {new Date(`${issue.target_date}T12:00:00`).toLocaleDateString()}
                              </time>
                            )}
                            {issue.parent_id && (
                              <Link to={`/${workspace}/projects/${issue.project_id}/issues/${issue.parent_id}/`}>
                                {t("common.parent")}
                              </Link>
                            )}
                          </div>
                          {issue.blockers?.length > 0 && (
                            <ul className="mt-1 space-y-1 border-l border-subtle pl-2 text-12 text-secondary">
                              {issue.blockers.map((blocker) => (
                                <li key={blocker.id}>
                                  <Link
                                    className="hover:text-accent-primary"
                                    to={`/${workspace}/projects/${blocker.project_id}/issues/${blocker.id}/`}
                                  >
                                    {blocker.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                </ul>
                {section.count === 0 && <p className="py-3 text-13 text-secondary">{t("planning.empty")}</p>}
                {(cursor > 0 || section.next_cursor !== null) && (
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      title={t("previous")}
                      aria-label={t("previous")}
                      disabled={cursor === 0 || isValidating}
                      className="size-8 rounded-sm p-2 disabled:opacity-40"
                      onClick={() => setCursors({ ...cursors, [key]: Math.max(0, cursor - 25) })}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <span className="text-12 text-secondary">
                      {cursor + 1}-{Math.min(cursor + 25, section.count)} / {section.count}
                    </span>
                    <button
                      type="button"
                      title={t("next")}
                      aria-label={t("next")}
                      disabled={section.next_cursor === null || isValidating}
                      className="size-8 rounded-sm p-2 disabled:opacity-40"
                      onClick={() => setCursors({ ...cursors, [key]: section.next_cursor ?? cursor })}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <Link
        to={`/${workspace}/profile/${userId}/assigned/`}
        className="inline-flex items-center gap-2 text-13 text-accent-primary"
      >
        {t("profile.stats.assigned")}
        <ArrowRight size={14} />
      </Link>
      {selected && (
        <div className="hidden">
          <MilestoneManager
            workspace={workspace}
            project={selected.project}
            selectedId={selected.id}
            onCloseSelection={() => setSelected(undefined)}
          />
        </div>
      )}
    </section>
  );
}
