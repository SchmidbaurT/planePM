import type { TPlanningColumn, TPlanningWidget, TProjectOverviewPreferences } from "@plane/types";

export function getHierarchyRootIds(
  issueIds: string[],
  issues: Record<string, { parent_id?: string | null } | undefined>
): string[] {
  const visibleIds = new Set(issueIds);
  return [...visibleIds].filter((issueId) => {
    const visited = new Set([issueId]);
    let parentId = issues[issueId]?.parent_id;
    if (!parentId || !visibleIds.has(parentId)) return true;
    while (parentId && visibleIds.has(parentId)) {
      if (visited.has(parentId)) return true;
      visited.add(parentId);
      parentId = issues[parentId]?.parent_id;
    }
    return false;
  });
}

export function getHierarchyRows(
  issueIds: string[],
  issues: Record<string, { parent_id?: string | null } | undefined>,
  expanded: Set<string>
): { id: string; depth: number }[] {
  const rows: { id: string; depth: number }[] = [];
  const seen = new Set<string>();
  const children = new Map<string, string[]>();
  for (const id of new Set(issueIds)) {
    const parent = issues[id]?.parent_id;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, depth });
    if (expanded.has(id)) for (const child of children.get(id) ?? []) visit(child, depth + 1);
  };
  for (const id of getHierarchyRootIds(issueIds, issues)) visit(id, 0);
  return rows;
}

export function getExpandedHierarchyIds(
  issueIds: string[],
  expanded: Set<string>,
  getChildren: (id: string) => string[] | undefined
): string[] {
  const visible = new Set(issueIds);
  const queue = [...visible];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (!expanded.has(id)) continue;
    for (const child of getChildren(id) ?? []) {
      if (!visible.has(child)) {
        visible.add(child);
        queue.push(child);
      }
    }
  }
  return queue;
}

export function getTimelineConnectionPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  options: { laneX?: number; rowHeight?: number } = {}
): string | undefined {
  if (![source.x, source.y, target.x, target.y].every(Number.isFinite)) return undefined;
  if (source.x === target.x && source.y === target.y) return undefined;
  const sourceExit = Math.max(source.x + 14, options.laneX ?? 0);
  const targetEntry = target.x - 14;
  if (targetEntry >= sourceExit) {
    const middle = (sourceExit + targetEntry) / 2;
    return `M ${source.x} ${source.y} H ${middle} V ${target.y} H ${target.x}`;
  }
  const corridor = options.rowHeight
    ? target.y + ((source.y > target.y ? 1 : -1) * options.rowHeight) / 2
    : source.y === target.y
      ? source.y + 18
      : (source.y + target.y) / 2;
  return `M ${source.x} ${source.y} H ${sourceExit} V ${corridor} H ${targetEntry} V ${target.y} H ${target.x}`;
}

export function getResourceConflict(error: unknown): { code: string; date?: string; resource_id?: string } | undefined {
  if (!error || typeof error !== "object") return undefined;
  const outer = error as Record<string, unknown>;
  const response =
    outer.response && typeof outer.response === "object" ? (outer.response as Record<string, unknown>) : undefined;
  const value = response?.data ?? outer.data ?? outer;
  if (!value || typeof value !== "object") return undefined;
  const payload = value as Record<string, unknown>;
  if (payload.code !== "RESOURCE_CAPACITY_EXCEEDED" && payload.code !== "RESOURCE_IN_USE") return undefined;
  return {
    code: payload.code,
    date:
      typeof payload.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(payload.date) &&
      !Number.isNaN(new Date(payload.date).getTime())
        ? payload.date
        : undefined,
    resource_id: typeof payload.resource_id === "string" ? payload.resource_id : undefined,
  };
}

export const planningWidgets: TPlanningWidget[] = [
  "metrics",
  "timeline",
  "projects",
  "dependencies",
  "people",
  "resources",
];
export const planningColumns: TPlanningColumn[] = [
  "period",
  "progress",
  "overdue",
  "dependencies",
  "resources",
  "quality",
  "lead",
];
export const defaultDashboardWidgets = planningWidgets.filter((widget) => widget !== "timeline");

function validList<Value extends string>(value: unknown, allowed: Value[], fallback: Value[]): Value[] {
  return Array.isArray(value) ? allowed.filter((item) => value.includes(item)) : [...fallback];
}

export function normalizePlanningPreferences(data: TProjectOverviewPreferences): TProjectOverviewPreferences {
  const source = data.schema_version && data.schema_version !== 1 ? {} : data;
  const validOrder = Array.isArray(source.widget_order)
    ? [...new Set(source.widget_order.filter((value) => planningWidgets.includes(value)))]
    : [];
  return {
    schema_version: 1,
    default_layout: ["list", "dashboard", "timeline"].includes(source.default_layout ?? "")
      ? source.default_layout
      : "list",
    enabled_widgets: validList(source.enabled_widgets, planningWidgets, defaultDashboardWidgets),
    widget_order: [...validOrder, ...planningWidgets.filter((value) => !validOrder.includes(value))],
    columns: validList(source.columns, planningColumns, planningColumns),
    sort: ["name", "-name", "overdue", "progress"].includes(source.sort ?? "") ? source.sort : "name",
    gantt_zoom: ["week", "month", "quarter"].includes(source.gantt_zoom ?? "") ? source.gantt_zoom : "month",
    filters: getPlanningFilters(source.filters ?? {}, new URLSearchParams()),
  };
}

export function getPlanningFilters(saved: Record<string, string>, search: URLSearchParams): Record<string, string> {
  const allowed = new Set(["search", "project_ids", "lead_id", "resource_id", "risk", "from", "to", "sort"]);
  const merged = { ...saved, ...Object.fromEntries(search) };
  return Object.fromEntries(
    Object.entries(merged).filter(
      ([key, value]) =>
        allowed.has(key) && typeof value === "string" && value.length <= (key === "project_ids" ? 20000 : 8000)
    )
  );
}
