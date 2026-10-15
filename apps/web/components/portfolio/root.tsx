import { startTransition, useContext, useDeferredValue, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Link, useParams, useSearchParams } from "react-router";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { ChevronDown, ChevronRight, RefreshCw, Save, TriangleAlert } from "lucide-react";
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
import { GANTT_TIMELINE_TYPE } from "@plane/types";
import type {
  TPortfolioProject,
  TPortfolioResponse,
  TPlanningWidget,
  TPortfolioDetail,
  TPortfolioTimelineRow,
} from "@plane/types";
import { GanttChartRoot } from "@/components/gantt-chart";
import { TimelineDependencies } from "@/components/gantt-chart/dependencies";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { PageHead } from "@/components/core/page-title";
import {
  ProjectViewControls,
  planningColumns,
  planningInputClass,
  planningWidgets,
} from "@/components/project/view-controls";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useProjectOverviewPreferences } from "@/hooks/use-project-overview-preferences";
import { StoreContext } from "@/lib/store-context";
import { planningService } from "@/services/planning.service";
import { getHierarchyRows, getPlanningFilters } from "@/helpers/planning";
import { ResourceCapacitySummary } from "@/components/resources/overview";
import { MilestoneManager, MilestoneTimelineMarker } from "@/components/project/milestones";

function formattedDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`))
    : "-";
}

const ProjectTimeline = observer(function ProjectTimeline({
  projects,
  select,
  zoom,
  workspace,
}: {
  projects: TPortfolioProject[];
  select: (project: TPortfolioProject) => void;
  zoom: "week" | "month" | "quarter";
  workspace: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, TPortfolioDetail>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [failedProjects, setFailedProjects] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [milestoneSelection, setMilestoneSelection] = useState<{ project: string; id: string }>();
  const context = useContext(StoreContext);
  const store = context?.timelineStore.projectTimeLineStore;
  const issueMap = Object.fromEntries(
    Object.values(details)
      .flatMap((detail) => detail.results)
      .map((issue) => [issue.id, issue])
  );
  const rows = useMemo(() => {
    const result: (TPortfolioTimelineRow & {
      depth: number;
      kind: "project" | "issue" | "more";
      source: TPortfolioProject;
    })[] = [];
    for (const project of projects) {
      result.push({ ...project, depth: 0, kind: "project", source: project });
      if (!expanded.has(project.id)) continue;
      const issues = details[project.id]?.results ?? [];
      const hierarchy = getHierarchyRows(
        issues.map((issue) => issue.id),
        Object.fromEntries(issues.map((issue) => [issue.id, issue])),
        expanded
      );
      for (const row of hierarchy) {
        const issue = issues.find((item) => item.id === row.id);
        if (issue)
          result.push({ ...issue, project_id: project.id, depth: row.depth + 1, kind: "issue", source: project });
      }
      if (details[project.id]?.next_cursor || loading.has(project.id) || failedProjects.has(project.id))
        result.push({
          id: `more:${project.id}`,
          project_id: project.id,
          name: t(loading.has(project.id) ? "loading" : "load_more"),
          start_date: null,
          target_date: null,
          depth: 1,
          kind: "more",
          source: project,
        });
    }
    return result;
  }, [projects, details, expanded, loading, failedProjects, t]);
  const load = async (projectId: string, cursor = "0") => {
    setLoading((previous) => new Set([...previous, projectId]));
    setError(false);
    setFailedProjects((previous) => new Set([...previous].filter((id) => id !== projectId)));
    try {
      const page = await planningService.detail(workspace, projectId, cursor);
      setDetails((previous) => ({
        ...previous,
        [projectId]: {
          ...page,
          results: cursor === "0" ? page.results : [...(previous[projectId]?.results ?? []), ...page.results],
        },
      }));
    } catch {
      setError(true);
      setFailedProjects((previous) => new Set([...previous, projectId]));
    } finally {
      setLoading((previous) => new Set([...previous].filter((id) => id !== projectId)));
    }
  };
  const toggle = (id: string, projectRow = false) => {
    setExpanded(
      (previous) => new Set(previous.has(id) ? [...previous].filter((value) => value !== id) : [...previous, id])
    );
    if (projectRow && !expanded.has(id) && !details[id]) void load(id);
  };
  useEffect(() => {
    store?.setProjects(rows);
  }, [rows, store]);
  useEffect(
    () => () => {
      store?.setProjects([]);
    },
    [store]
  );
  return (
    <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.PROJECT}>
      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {t("planning.error")}
        </p>
      )}
      <GanttChartRoot
        initialView={zoom}
        title={t("sidebar.projects")}
        loaderTitle={t("sidebar.projects")}
        itemCount={projects.length}
        blockIds={rows.map((row) => row.id)}
        dependencyOverlay={
          <TimelineDependencies
            workspace={workspace}
            projectIds={projects.map((project) => project.id)}
            issueIds={Object.keys(issueMap)}
            rowIds={rows.map((row) => row.id)}
            getIssue={(id) => issueMap[id]}
          />
        }
        blockUpdateHandler={() => undefined}
        showAllBlocks
        sidebarToRender={() => (
          <div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex w-full items-center justify-between gap-2 border-b border-subtle px-3 text-left text-13 hover:bg-layer-1"
                style={{ height: BLOCK_HEIGHT, paddingLeft: 8 + row.depth * 16 }}
              >
                {row.kind === "project" ||
                (row.kind === "issue" &&
                  details[row.source.id]?.results.some((issue) => issue.parent_id === row.id)) ? (
                  <button
                    type="button"
                    className="flex size-6 shrink-0 items-center justify-center"
                    aria-expanded={expanded.has(row.id)}
                    aria-label={`${t("common.sub_work_items")}: ${row.name}`}
                    title={t("common.sub_work_items")}
                    disabled={loading.has(row.id)}
                    onClick={() => toggle(row.id, row.kind === "project")}
                  >
                    {expanded.has(row.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className="size-6 shrink-0" />
                )}
                {row.kind === "issue" ? (
                  <Link
                    className="min-w-0 flex-1 truncate"
                    to={`/${workspace}/projects/${row.source.id}/issues/${row.id}/`}
                  >
                    {row.name}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    disabled={row.kind === "more" && loading.has(row.source.id)}
                    onClick={() =>
                      row.kind === "more"
                        ? void load(row.source.id, details[row.source.id]?.next_cursor ?? "0")
                        : select(row.source)
                    }
                  >
                    {row.name}
                  </button>
                )}
                <span className="shrink-0 text-11 text-tertiary">
                  {row.kind === "project" ? (row.progress === null ? "-" : `${row.progress}%`) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        blockToRender={(project: TPortfolioTimelineRow) => {
          const className =
            `relative flex h-full w-full min-w-0 items-center overflow-hidden rounded border px-2 text-left text-12 ${project.is_blocked ? "border-danger-strong bg-danger-subtle text-danger-primary" : "border-accent-primary bg-accent-primary/10 text-primary"}`;
          const title = `${project.name}: ${formattedDate(project.start_date)} - ${formattedDate(project.target_date)}`;
          const content = (
            <>
              <span
                className="absolute inset-y-0 left-0 bg-accent-primary/20"
                style={{ width: `${project.progress ?? 0}%` }}
              />
              <span className="relative truncate">{project.name}</span>
            </>
          );
          if (project.project_id && project.id !== project.project_id)
            return (
              <Link
                className={className}
                title={title}
                to={`/${workspace}/projects/${project.project_id}/issues/${project.id}/`}
              >
                {content}
              </Link>
            );
          return (
            <button
              type="button"
              className={className}
              title={title}
              onClick={() => {
                const source = projects.find((item) => item.id === project.id);
                if (source) select(source);
              }}
            >
              {content}
            </button>
          );
        }}
        extraRows={projects.flatMap((project) =>
          (project.milestones ?? []).map((milestone) => ({
            id: milestone.id,
            sidebar: (
              <button
                type="button"
                className="min-w-0 text-left text-12"
                title={`${project.name} / ${milestone.name} / ${milestone.owner_name}`}
                onClick={() => setMilestoneSelection({ project: project.id, id: milestone.id })}
              >
                <span className="block truncate font-medium">{milestone.name}</span>
                <span className="block truncate text-10 text-secondary">
                  {project.identifier} / {milestone.owner_name}
                </span>
              </button>
            ),
            chart: (
              <MilestoneTimelineMarker
                milestone={milestone}
                onOpen={() => setMilestoneSelection({ project: project.id, id: milestone.id })}
              />
            ),
          }))
        )}
      />
      {milestoneSelection && (
        <div className="hidden">
          <MilestoneManager
            workspace={workspace}
            project={milestoneSelection.project}
            selectedId={milestoneSelection.id}
            onCloseSelection={() => setMilestoneSelection(undefined)}
          />
        </div>
      )}
    </TimeLineTypeContext.Provider>
  );
});

function ProjectDetail({
  workspace,
  userId,
  project,
  close,
}: {
  workspace: string;
  userId: string;
  project: TPortfolioProject;
  close: () => void;
}) {
  const { t } = useTranslation();
  const { data, error, size, setSize } = useSWRInfinite(
    (index, previous) =>
      previous && !previous.next_cursor
        ? null
        : ["portfolio-detail", workspace, userId, project.id, index ? previous.next_cursor : "0"],
    (key: string[]) => planningService.detail(workspace, project.id, key[4])
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent size="lg">
        <DialogMain>
          <DialogHeader>
            <DialogTitle>{project.name}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-4 text-13">
              <span>
                {t("planning.period")}:{" "}
                {project.start_date
                  ? `${formattedDate(project.start_date)} - ${formattedDate(project.target_date)}`
                  : t("planning.undated")}
              </span>
              <Link className="text-accent-primary hover:underline" to={`/${workspace}/projects/${project.id}/issues`}>
                {t("sidebar.projects")} / {project.identifier}
              </Link>
            </div>
            {!data && !error && (
              <p role="status" className="py-6 text-13">
                {t("loading")}
              </p>
            )}
            {error && (
              <p role="alert" className="py-4 text-13 text-danger-primary">
                {t("planning.error")}
              </p>
            )}
            <ul className="divide-y divide-subtle">
              {data
                ?.flatMap((page) => page.results)
                .map((issue) => (
                  <li key={issue.id} className="flex items-center gap-3 py-3 text-13">
                    <Link
                      className="min-w-0 flex-1 truncate hover:text-accent-primary"
                      to={`/${workspace}/projects/${project.id}/issues/${issue.id}`}
                    >
                      <span className="mr-2 text-tertiary">
                        {project.identifier}-{issue.sequence_id}
                      </span>
                      {issue.name}
                    </Link>
                    <span className="shrink-0 text-11 text-tertiary">{formattedDate(issue.target_date)}</span>
                  </li>
                ))}
            </ul>
            {data && !data[0]?.results.length && <p className="py-6 text-13 text-secondary">{t("planning.empty")}</p>}
            {data?.at(-1)?.next_cursor && (
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                label={t("load_more")}
                onClick={() => void setSize(size + 1)}
              />
            )}
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

export const PortfolioRoot = observer(function PortfolioRoot({ timeline = false }: { timeline?: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { preferences, save, isLoading: preferencesLoading } = useProjectOverviewPreferences(workspaceSlug);
  const { fetchProjects, totalProjectIds, getProjectById } = useProject();
  useSWR(workspaceSlug ? `WORKSPACE_PROJECTS_${workspaceSlug}` : null, () => fetchProjects(workspaceSlug));
  const [selected, setSelected] = useState<TPortfolioProject | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const filters = getPlanningFilters(preferences.filters ?? {}, search);
  const deferredSearch = useDeferredValue(filters.search ?? "");
  const query = {
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")),
    search: deferredSearch,
    sort: filters.sort ?? preferences.sort ?? "name",
  };
  const canReadResources = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );
  const { data: resources } = useSWR(
    canReadResources && user ? ["planning-resources", workspaceSlug, user.id] : null,
    () => planningService.resources(workspaceSlug)
  );
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite<TPortfolioResponse>(
    (index, previous) =>
      !user || preferencesLoading || (previous && !previous.next_cursor)
        ? null
        : ["portfolio", workspaceSlug, user.id, JSON.stringify(query), index ? previous.next_cursor : "0"],
    (key: string[]) => planningService.portfolio(workspaceSlug, { ...query, cursor: key[4] }),
    { revalidateOnFocus: true, persistSize: false }
  );
  const overview = data?.[0];
  const projects = data?.flatMap((page) => page.results) ?? [];
  const enabled = preferences.enabled_widgets ?? planningWidgets;
  const order = preferences.widget_order ?? planningWidgets;
  const columns = preferences.columns ?? planningColumns;
  const selectedIds = (filters.project_ids ?? "").split(",").filter(Boolean);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams({ ...filters, layout: timeline ? "timeline" : "dashboard" });
    next.delete("cursor");
    next.set(key, value);
    startTransition(() => setSearch(next));
  };
  const saveFilters = async () => {
    setSaving(true);
    setSettingsError(false);
    try {
      const { sort, ...savedFilters } = query;
      await save({ filters: savedFilters, sort: sort as typeof preferences.sort });
    } catch {
      setSettingsError(true);
    } finally {
      setSaving(false);
    }
  };
  const projectName = (id: string) =>
    getProjectById(id)?.name ?? projects.find((project) => project.id === id)?.name ?? id;
  const sections: Record<TPlanningWidget, React.ReactNode> = {
    metrics: overview && (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-subtle pb-5 md:grid-cols-4">
        {[
          [t("sidebar.projects"), overview.metrics.projects],
          [
            t("planning.progress"),
            overview.metrics.total
              ? `${Math.round((100 * overview.metrics.completed) / overview.metrics.total)}%`
              : "-",
          ],
          [t("planning.overdue"), overview.metrics.overdue_projects],
          [t("planning.pending_demand"), overview.metrics.pending_resources],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="mb-1 text-12 break-words text-secondary">{label}</div>
            <div className="text-22 font-semibold tabular-nums">{value}</div>
            {label === t("planning.progress") && (
              <div className="mt-2 flex items-center gap-2">
                <progress
                  max={Math.max(1, overview.metrics.total)}
                  value={overview.metrics.completed}
                  aria-label={t("planning.progress")}
                  className="accent-accent-primary h-2 min-w-0 flex-1"
                />
                <span className="shrink-0 text-11 text-secondary">
                  {overview.metrics.completed}/{overview.metrics.total}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    ),
    timeline: (
      <section className="min-w-0">
        <h2 className="mb-3 text-14 font-medium">{t("planning.timeline")}</h2>
        <div className="h-64 min-w-0">
          <ProjectTimeline
            key={workspaceSlug}
            workspace={workspaceSlug}
            projects={projects}
            select={setSelected}
            zoom={preferences.gantt_zoom ?? "month"}
          />
        </div>
      </section>
    ),
    projects: (
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-14 font-medium">{t("sidebar.projects")}</h2>
          <span className="flex items-center gap-1.5 text-12 text-secondary">
            <TriangleAlert size={13} />
            {t("planning.attention")}:{" "}
            {
              projects.filter(
                (project) =>
                  project.overdue || project.dependencies || project.pending_resources || project.people_overlap
              ).length
            }
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-13">
            <thead className="border-b border-subtle text-12 text-secondary">
              <tr>
                <th className="min-w-48 py-3 pr-4 font-medium">{t("name")}</th>
                {columns.map((column) => (
                  <th key={column} className="px-3 py-3 font-medium whitespace-nowrap">
                    {t(`planning.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {projects.map((project) => (
                <tr key={project.id} className="hover:bg-layer-1">
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      className="text-left hover:text-accent-primary"
                      onClick={() => setSelected(project)}
                    >
                      <span className="mr-2 text-11 text-tertiary">{project.identifier}</span>
                      {project.name}
                    </button>
                  </td>
                  {columns.map((column) => (
                    <td key={column} className="px-3 py-3 tabular-nums">
                      {column === "period" ? (
                        <span className="text-12 whitespace-nowrap">
                          {project.start_date
                            ? `${formattedDate(project.start_date)} - ${formattedDate(project.target_date)}`
                            : t("planning.undated")}
                        </span>
                      ) : column === "progress" ? (
                        <div className="flex min-w-24 items-center gap-2">
                          <progress
                            aria-label={t("planning.progress")}
                            className="accent-accent-primary h-1.5 w-16"
                            value={project.progress ?? 0}
                            max={100}
                          />
                          <span>{project.progress === null ? "-" : `${project.progress}%`}</span>
                        </div>
                      ) : column === "overdue" ? (
                        <span className={project.overdue ? "text-danger-primary" : "text-tertiary"}>
                          {project.overdue}
                        </span>
                      ) : column === "dependencies" ? (
                        project.dependencies
                      ) : column === "resources" ? (
                        <div className="flex flex-wrap gap-1">
                          {project.resource_ids.map((id) => (
                            <Link
                              key={id}
                              className="text-12 text-accent-primary hover:underline"
                              to={`/${workspaceSlug}/resources/${id}`}
                            >
                              {resources?.find((resource) => resource.id === id)?.name ?? t("planning.resources")}
                            </Link>
                          ))}
                        </div>
                      ) : column === "quality" ? (
                        <span className="text-12 whitespace-nowrap">
                          {project.undated_issue_count + project.partial_dates_count + project.invalid_dates_count >
                          0 ? (
                            <span className="inline-flex items-center gap-1">
                              <TriangleAlert size={13} />
                              {project.undated_issue_count + project.partial_dates_count + project.invalid_dates_count}
                            </span>
                          ) : (
                            "-"
                          )}
                        </span>
                      ) : project.project_lead_id ? (
                        <Link
                          to={`/${workspaceSlug}/profile/${project.project_lead_id}`}
                          className="text-accent-primary hover:underline"
                        >
                          {t("planning.lead")}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ),
    dependencies: (
      <section>
        <h2 className="mb-3 text-14 font-medium">{t("planning.dependencies")}</h2>
        <ul className="divide-y divide-subtle">
          {overview?.dependencies.map((edge) => (
            <li
              key={`${edge.source_issue_id}-${edge.target_issue_id}`}
              className="flex flex-wrap items-center gap-2 py-3 text-13"
            >
              <Link
                className="hover:text-accent-primary"
                to={`/${workspaceSlug}/projects/${edge.source_project_id}/issues/${edge.source_issue_id}`}
              >
                {projectName(edge.source_project_id)}: {edge.source_name}
              </Link>
              <span aria-hidden="true">&gt;</span>
              <Link
                className="hover:text-accent-primary"
                to={`/${workspaceSlug}/projects/${edge.target_project_id}/issues/${edge.target_issue_id}`}
              >
                {projectName(edge.target_project_id)}: {edge.target_name}
              </Link>
              {edge.date_conflict && (
                <TriangleAlert size={14} className="text-danger-primary" aria-label={t("planning.quality")} />
              )}
            </li>
          ))}
        </ul>
        {!overview?.dependencies.length && <p className="text-13 text-secondary">{t("planning.empty")}</p>}
      </section>
    ),
    people: (
      <section>
        <h2 className="mb-3 text-14 font-medium">{t("planning.people")}</h2>
        <ul className="divide-y divide-subtle">
          {overview?.people_overlaps.map((overlap) => (
            <li
              key={`${overlap.person_id}-${overlap.start_date}`}
              className="flex flex-wrap items-center gap-3 py-3 text-13"
            >
              <Link
                to={`/${workspaceSlug}/profile/${overlap.person_id}`}
                className="font-medium hover:text-accent-primary"
              >
                {overlap.name || t("unknown_user")}
              </Link>
              <span className="text-secondary">
                {formattedDate(overlap.start_date)} - {formattedDate(overlap.target_date)}
              </span>
              <span>{overlap.project_ids.map(projectName).join(", ")}</span>
            </li>
          ))}
        </ul>
        {!overview?.people_overlaps.length && <p className="text-13 text-secondary">{t("planning.empty")}</p>}
      </section>
    ),
    resources: canReadResources && (
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-14 font-medium">{t("planning.resource_schedule")}</h2>
          <Link to={`/${workspaceSlug}/resources`} className="text-12 text-accent-primary hover:underline">
            {t("planning.resources")}
          </Link>
        </div>
        <ResourceCapacitySummary
          workspace={workspaceSlug}
          from={filters.from || overview?.from}
          to={filters.to || overview?.to}
        />
      </section>
    ),
  };
  return (
    <div
      className={`flex h-full min-w-0 flex-col ${timeline ? "overflow-y-auto md:overflow-hidden" : "overflow-hidden"}`}
    >
      <PageHead title={`${t("sidebar.projects")} - ${t(timeline ? "planning.timeline" : "planning.dashboard")}`} />
      <div className="border-b border-subtle p-3 md:hidden">
        <ProjectViewControls />
      </div>
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-subtle p-4">
        <input
          className={`${planningInputClass} max-w-52`}
          aria-label={t("search")}
          placeholder={t("search")}
          value={filters.search ?? ""}
          onChange={(event) => update("search", event.target.value)}
        />
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-subtle px-3 py-2 text-13">
            {t("sidebar.projects")}
            {selectedIds.length ? ` (${selectedIds.length})` : ""}
            <ChevronDown size={14} />
          </summary>
          <div className="shadow-lg absolute top-full left-0 z-20 mt-1 max-h-72 w-72 overflow-auto rounded border border-subtle bg-surface-1 p-3">
            {totalProjectIds?.map((id) => (
              <label key={id} className="flex items-center gap-2 py-2 text-13">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(id)}
                  onChange={(event) =>
                    update(
                      "project_ids",
                      (event.target.checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id)).join(
                        ","
                      )
                    )
                  }
                />
                {getProjectById(id)?.name}
              </label>
            ))}
          </div>
        </details>
        <select
          aria-label={t("planning.quality")}
          className={`${planningInputClass} max-w-44`}
          value={filters.risk ?? ""}
          onChange={(event) => update("risk", event.target.value)}
        >
          <option value="">{t("planning.quality")}</option>
          {(["overdue", "dependencies", "people", "quality", "resources"] as const).map((risk) => (
            <option key={risk} value={risk}>
              {t(`planning.${risk}`)}
            </option>
          ))}
        </select>
        {canReadResources && (
          <select
            aria-label={t("planning.resources")}
            className={`${planningInputClass} max-w-44`}
            value={filters.resource_id ?? ""}
            onChange={(event) => update("resource_id", event.target.value)}
          >
            <option value="">{t("planning.resources")}</option>
            {resources?.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        )}
        {(["from", "to"] as const).map((key) => (
          <label key={key} className="flex min-w-0 flex-col gap-1 text-11 text-secondary">
            {t(key === "from" ? "planning.start" : "planning.end")}
            <input
              type="date"
              className={`${planningInputClass} w-40`}
              value={filters[key] ?? overview?.[key] ?? ""}
              onChange={(event) => update(key, event.target.value)}
            />
          </label>
        ))}
        <select
          aria-label={t("planning.sort")}
          className={`${planningInputClass} max-w-36`}
          value={query.sort}
          onChange={(event) => update("sort", event.target.value)}
        >
          {(["name", "overdue", "progress"] as const).map((sort) => (
            <option key={sort} value={sort}>
              {sort === "name" ? t("name") : t(`planning.${sort}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={saving}
          aria-label={t("save")}
          title={t("save")}
          onClick={() => void saveFilters()}
          className="grid size-9 shrink-0 place-items-center rounded hover:bg-layer-1 disabled:opacity-40"
        >
          <Save size={16} />
        </button>
        <button
          type="button"
          disabled={isValidating}
          aria-label={t("refresh")}
          title={t("refresh")}
          onClick={() => void mutate()}
          className="grid size-9 shrink-0 place-items-center rounded hover:bg-layer-1 disabled:opacity-40"
        >
          <RefreshCw size={16} />
        </button>
        {settingsError && (
          <p role="alert" className="w-full text-13 text-danger-primary">
            {t("planning.error")}
          </p>
        )}
      </div>
      {error && (
        <div role="alert" className="flex items-center gap-3 p-4 text-13 text-danger-primary">
          {t("planning.error")}
          <Button
            variant="secondary"
            size="sm"
            stretch="auto"
            label={t("common.retry")}
            onClick={() => void mutate()}
          />
        </div>
      )}
      {!overview && !error && (
        <div role="status" className="p-8 text-13 text-secondary">
          {t("loading")}
        </div>
      )}
      {overview && (
        <div
          className={`min-w-0 ${timeline ? "flex min-h-[600px] shrink-0 flex-col gap-4 overflow-hidden p-4 md:min-h-0 md:flex-1" : "min-h-0 flex-1 space-y-7 overflow-y-auto p-4 md:p-6"}`}
        >
          <div className={`flex shrink-0 flex-wrap items-center justify-between gap-2 ${timeline ? "" : "mb-5"}`}>
            <h1 className="text-18 font-semibold">{t(timeline ? "planning.timeline" : "planning.dashboard")}</h1>
            <span className="text-12 text-secondary">{formattedDate(overview.as_of_date)}</span>
          </div>
          {!projects.length && timeline ? (
            <p className="py-8 text-13 text-secondary">{t("planning.empty")}</p>
          ) : timeline ? (
            <>
              <div className="shrink-0">{sections.metrics}</div>
              <div className="min-h-0 flex-1">
                <ProjectTimeline
                  key={workspaceSlug}
                  workspace={workspaceSlug}
                  projects={projects}
                  select={setSelected}
                  zoom={preferences.gantt_zoom ?? "month"}
                />
              </div>
            </>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-7 xl:grid-cols-2">
              {order
                .filter((widget) => enabled.includes(widget) && (widget !== "resources" || canReadResources))
                .map((widget) => (
                  <div
                    key={widget}
                    className={
                      widget === "metrics" || widget === "projects" || widget === "timeline"
                        ? "min-w-0 xl:col-span-2"
                        : "min-w-0"
                    }
                  >
                    {sections[widget]}
                  </div>
                ))}
            </div>
          )}
          {data?.at(-1)?.next_cursor && (
            <div className="shrink-0">
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                label={`${t("load_more")} (${projects.length}/${overview.selected_project_count})`}
                disabled={isValidating}
                onClick={() => void setSize(size + 1)}
              />
            </div>
          )}
        </div>
      )}
      {selected && user && (
        <ProjectDetail
          key={`${workspaceSlug}-${selected.id}`}
          workspace={workspaceSlug}
          userId={user.id}
          project={selected}
          close={() => setSelected(null)}
        />
      )}
    </div>
  );
});
