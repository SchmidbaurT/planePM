import { useContext, useEffect, useId, useRef, useState } from "react";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
import { sortBy } from "lodash-es";
import { Link } from "react-router";
import useSWR from "swr";
import { ArrowRight, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TTimelineRelation } from "@plane/types";
import { useUser } from "@/hooks/store/user";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { planningService } from "@/services/planning.service";
import { getTimelineConnectionPath } from "@/helpers/planning";
import { BLOCK_HEIGHT } from "./constants";
import { TimelineDependencyViewContext } from "./contexts";

export const TimelineDependencies = observer(function TimelineDependencies({
  workspace,
  issueIds,
  rowIds,
  getIssue,
  projectIds = [],
}: {
  workspace: string;
  issueIds: string[];
  rowIds: string[];
  getIssue: (id: string) => { parent_id?: string | null } | undefined;
  projectIds?: string[];
}) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const markerId = useId().replaceAll(":", "");
  const [selected, setSelected] = useState<TTimelineRelation>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const view = useContext(TimelineDependencyViewContext);
  const { getBlockById } = useTimeLineChartStore();
  const ids = sortBy([...new Set(issueIds)]).join(",");
  const projects = sortBy([...new Set(projectIds)]).join(",");
  const { data, error, isLoading } = useSWR(
    user && (ids || projects) ? ["timeline-relations", workspace, user.id, ids, projects] : null,
    () => planningService.relations(workspace, issueIds, projectIds)
  );
  const rowIndex = new Map(rowIds.map((id, index) => [id, index]));
  useEffect(() => {
    if (!selected) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(undefined);
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previousFocus?.focus?.();
    };
  }, [selected]);
  const visibleAncestor = (id: string) => {
    const visited = new Set<string>();
    let current: string | null | undefined = id;
    while (current && !visited.has(current)) {
      if (rowIndex.has(current)) return current;
      visited.add(current);
      current = getIssue(current)?.parent_id;
    }
    return undefined;
  };
  const relationLabel = (edge: TTimelineRelation) =>
    t(
      edge.relation_type === "blocked_by"
        ? "issue.relation.blocking"
        : edge.relation_type === "finish_to_start"
          ? "planning.finish_start"
          : edge.relation_type === "start_before"
            ? "planning.start_start"
            : edge.relation_type === "finish_before"
              ? "planning.finish_finish"
              : edge.relation_type === "duplicate"
                ? "issue.relation.duplicate"
                : edge.relation_type === "implemented_by"
                  ? "issue.relation.implemented_by"
                  : "issue.relation.relates_to"
    );
  const collapsedRows = new Set<string>();
  const displayEdges = sortBy(data ?? [], (edge) => (edge.date_conflict ? 0 : edge.is_blocking ? 1 : 2));
  const scoped = (data ?? []).filter(
    (edge) =>
      ["blocked_by", "finish_to_start", "start_before", "finish_before"].includes(edge.relation_type) &&
      (visibleAncestor(edge.source_id) || rowIndex.has(edge.source_project_id)) &&
      (visibleAncestor(edge.target_id) || rowIndex.has(edge.target_project_id))
  );
  const summaryTarget = typeof document === "undefined" ? null : document.getElementById("timeline-dependency-summary");
  const summary = data && (
    <div className="flex flex-wrap gap-2 text-11" aria-label={t("planning.connection_status")}>
      {[
        {
          label: "planning.date_conflict",
          items: scoped.filter((edge) => edge.date_conflict),
          color: "text-danger-primary",
        },
        {
          label: "issue.relation.blocked_by",
          items: scoped.filter((edge) => edge.is_blocking),
          color: "text-warning-primary",
        },
        {
          label: "planning.planned_dependencies",
          items: scoped.filter((edge) => !edge.date_conflict && !edge.is_blocking),
          color: "text-secondary",
        },
      ].map((bucket) => (
        <button
          key={bucket.label}
          type="button"
          className={`${bucket.color} hover:underline disabled:no-underline`}
          disabled={!bucket.items.length}
          onClick={() => setSelected(bucket.items[0])}
        >
          {t(bucket.label)}: {bucket.items.length}
        </button>
      ))}
    </div>
  );
  return (
    <>
      {summaryTarget ? createPortal(summary, summaryTarget) : summary}
      {isLoading && (
        <p role="status" className="sticky top-0 left-2 z-10 w-fit bg-surface-1 p-1 text-12 text-secondary">
          {t("planning.dependencies")}: {t("loading")}
        </p>
      )}
      {error && (
        <p role="alert" className="sticky top-0 left-2 z-10 w-fit bg-surface-1 p-1 text-12 text-danger-primary">
          {t("planning.error")}
        </p>
      )}
      <svg
        className="pointer-events-none absolute top-0 left-0 z-[8] w-full overflow-visible"
        height={rowIds.length * BLOCK_HEIGHT}
        aria-label={t("planning.dependencies")}
        role="group"
        data-testid="timeline-dependencies"
      >
        <defs>
          {[
            { id: "danger", color: "text-danger-primary" },
            { id: "blocked", color: "text-warning-primary" },
            { id: "normal", color: "text-secondary" },
          ].map((marker) => (
            <marker
              key={marker.id}
              id={`${markerId}-${marker.id}`}
              className={marker.color}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          ))}
        </defs>
        {displayEdges.map((edge) => {
          if (!["blocked_by", "finish_to_start", "start_before", "finish_before"].includes(edge.relation_type))
            return null;
          if (view.mode === "conflicts" && !edge.date_conflict && !edge.is_blocking) return null;
          const sourceId =
            visibleAncestor(edge.source_id) ??
            (rowIndex.has(edge.source_project_id) ? edge.source_project_id : undefined);
          const targetId =
            visibleAncestor(edge.target_id) ??
            (rowIndex.has(edge.target_project_id) ? edge.target_project_id : undefined);
          if (!sourceId || !targetId) return null;
          if (
            view.mode === "focus" &&
            (!view.focusId || ![edge.source_id, edge.target_id, sourceId, targetId].includes(view.focusId))
          )
            return null;
          const source = getBlockById(sourceId);
          const target = getBlockById(targetId);
          if (!(source?.start_date || source?.target_date) || !(target?.start_date || target?.target_date)) return null;
          const start = source.position?.marginLeft;
          const end = target.position?.marginLeft;
          if (start === undefined || end === undefined) return null;
          const sourceX = edge.relation_type === "start_before" ? start : start + (source.position?.width ?? 0);
          const targetX = edge.relation_type === "finish_before" ? end + (target.position?.width ?? 0) : end;
          const sourceRow = rowIndex.get(sourceId)!;
          const targetRow = rowIndex.get(targetId)!;
          let laneX = sourceX + 14;
          for (let index = Math.min(sourceRow, targetRow) + 1; index < Math.max(sourceRow, targetRow); index++) {
            const obstacle = getBlockById(rowIds[index]);
            if (obstacle?.position)
              laneX = Math.max(laneX, (obstacle.position.marginLeft ?? 0) + (obstacle.position.width ?? 0) + 14);
          }
          const path =
            sourceId === targetId
              ? undefined
              : getTimelineConnectionPath(
                  { x: sourceX, y: (sourceRow + 0.5) * BLOCK_HEIGHT },
                  { x: targetX, y: (targetRow + 0.5) * BLOCK_HEIGHT },
                  { laneX, rowHeight: BLOCK_HEIGHT }
                );
          const directional = true;
          const title = `${edge.source_name} / ${relationLabel(edge)} / ${edge.target_name}${edge.date_conflict ? ` / ${t("planning.date_conflict")}` : ""}`;
          if (!path) {
            if (collapsedRows.has(sourceId)) return null;
            collapsedRows.add(sourceId);
            return (
              <g
                key={edge.id}
                role="button"
                tabIndex={0}
                aria-label={title}
                onClick={() => setSelected(edge)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(edge);
                  }
                }}
                className={
                  edge.date_conflict
                    ? "pointer-events-auto cursor-pointer text-danger-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
                    : edge.is_blocking
                      ? "pointer-events-auto cursor-pointer text-warning-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
                      : "pointer-events-auto cursor-pointer text-tertiary hover:text-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
                }
              >
                <title>{title}</title>
                <rect
                  x={start + (source.position?.width ?? 0) + 5}
                  y={rowIndex.get(sourceId)! * BLOCK_HEIGHT + 12}
                  width={18}
                  height={18}
                  rx={2}
                  fill="transparent"
                  stroke="none"
                />
                <text
                  x={start + (source.position?.width ?? 0) + 14}
                  y={rowIndex.get(sourceId)! * BLOCK_HEIGHT + 24}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize={10}
                  fontWeight={500}
                >
                  {
                    (data ?? []).filter(
                      (candidate) =>
                        ["blocked_by", "finish_to_start", "start_before", "finish_before"].includes(
                          candidate.relation_type
                        ) &&
                        (visibleAncestor(candidate.source_id) ?? candidate.source_project_id) === sourceId &&
                        (visibleAncestor(candidate.target_id) ?? candidate.target_project_id) === targetId
                    ).length
                  }
                </text>
              </g>
            );
          }
          return (
            <g
              key={edge.id}
              role="button"
              tabIndex={0}
              aria-label={title}
              className={
                edge.date_conflict
                  ? "text-danger-primary"
                  : edge.is_blocking
                    ? "text-warning-primary"
                    : "text-secondary"
              }
              onClick={() => setSelected(edge)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(edge);
                }
              }}
            >
              <title>{title}</title>
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={edge.date_conflict || view.mode === "focus" ? 2.5 : 1.2}
                strokeDasharray={directional ? undefined : "5 4"}
                markerEnd={
                  directional
                    ? `url(#${markerId}-${edge.date_conflict ? "danger" : edge.is_blocking ? "blocked" : "normal"})`
                    : undefined
                }
                data-relation-id={edge.id}
                data-conflict={edge.date_conflict}
              />
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                className="pointer-events-auto cursor-pointer"
              />
            </g>
          );
        })}
      </svg>
      {selected && createPortal(
        <aside
          aria-label={t("planning.dependencies")}
          className="shadow-lg pointer-events-auto fixed top-0 right-0 z-[30] h-dvh w-full max-w-96 overflow-y-auto border-l border-subtle bg-surface-1 p-5"
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 className="text-16 font-medium">{t("planning.dependencies")}</h2>
            <button
              type="button"
              className="size-8 rounded-sm p-2 hover:bg-layer-1"
              aria-label={t("close")}
              ref={closeRef}
              title={t("close")}
              onClick={() => setSelected(undefined)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3 text-13">
            <Link
              className="block break-words text-accent-primary underline"
              to={`/${workspace}/projects/${selected.source_project_id}/issues/${selected.source_id}/`}
            >
              {selected.source_name}
            </Link>
            <p className="flex items-center gap-2">
              <ArrowRight size={16} />
              {relationLabel(selected)}
            </p>
            <Link
              className="block break-words text-accent-primary underline"
              to={`/${workspace}/projects/${selected.target_project_id}/issues/${selected.target_id}/`}
            >
              {selected.target_name}
            </Link>
            {selected.date_conflict && (
              <p className="flex items-center gap-2 text-danger-primary">
                <TriangleAlert size={16} />
                {t("planning.date_conflict")}
              </p>
            )}
            {selected.is_blocking && (
              <p className="text-warning-primary">
                {t("issue.relation.blocked_by")}: {selected.source_name}
              </p>
            )}
            {!selected.is_assessable && <p className="text-secondary">{t("planning.undated")}</p>}
            <div className="flex flex-wrap gap-3 text-12 text-secondary">
              {Array.from(new Set([selected.source_date, selected.target_date])).map(
                (date) =>
                  date && (
                    <time key={date} dateTime={date}>
                      {new Date(`${date}T12:00:00`).toLocaleDateString()}
                    </time>
                  )
              )}
            </div>
          </div>
          <ul className="mt-5 divide-y divide-subtle border-t border-subtle text-12">
            {scoped.map((edge) => (
              <li key={edge.id}>
                <button
                  type="button"
                  className="w-full px-1 py-3 text-left break-words hover:bg-layer-1"
                  onClick={() => setSelected(edge)}
                >
                  {edge.source_name} / {relationLabel(edge)} / {edge.target_name}
                </button>
              </li>
            ))}
          </ul>
        </aside>, document.body
      )}
    </>
  );
});
