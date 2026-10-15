export type TProjectOverviewLayout = "list" | "dashboard" | "timeline";
export type TPlanningWidget = "metrics" | "timeline" | "projects" | "dependencies" | "people" | "resources";
export type TPlanningColumn = "period" | "progress" | "overdue" | "dependencies" | "resources" | "quality" | "lead";
export type TProjectOverviewPreferences = {
  schema_version?: number;
  default_layout?: TProjectOverviewLayout;
  enabled_widgets?: TPlanningWidget[];
  widget_order?: TPlanningWidget[];
  columns?: TPlanningColumn[];
  sort?: "name" | "-name" | "overdue" | "progress";
  gantt_zoom?: "week" | "month" | "quarter";
  filters?: Record<string, string>;
};
export type TWorkspaceResource = {
  id: string;
  name: string;
  description: string;
  category: string;
  location: string;
  archived_at: string | null;
};
export type TResourceRequirement = { resource_id: string; allocation_percent: number };
export type TResourceOverview = {
  from: string;
  to: string;
  as_of_date: string;
  resources: (TWorkspaceResource & {
    days: { date: string; allocated_percent: number; maintenance: boolean }[];
    today_percent: number | null;
    average_percent: number;
    pending_count: number;
  })[];
};
export type TResourceBlackout = { id: string; start_date: string; target_date: string; reason: string };
export type TResourceAvailability = {
  days: { date: string; allocated_percent: number }[];
  bookings: {
    issue_id?: string;
    project_id?: string;
    name?: string;
    identifier?: string;
    start_date: string;
    target_date: string;
    allocation_percent: number;
  }[];
  blackouts: TResourceBlackout[];
};
export type TPortfolioProject = {
  id: string;
  name: string;
  identifier: string;
  logo_props: Record<string, unknown>;
  project_lead_id: string | null;
  start_date: string | null;
  target_date: string | null;
  total: number;
  completed: number;
  progress: number | null;
  overdue: number;
  dependencies: number;
  dated_issue_count: number;
  undated_issue_count: number;
  partial_dates_count: number;
  invalid_dates_count: number;
  people_overlap: boolean;
  pending_resources: number;
  resource_ids: string[];
  period_source: "none" | "issues" | "modules" | "mixed";
  milestones?: {
    id: string;
    name: string;
    target_date: string;
    owner_name: string;
    status: "open" | "overdue" | "reached";
    is_late: boolean;
  }[];
};
export type TTimelineRelation = {
  id: string;
  relation_type: string;
  source_id: string;
  source_name: string;
  source_project_id: string;
  target_id: string;
  target_name: string;
  target_project_id: string;
  source_date: string | null;
  target_date: string | null;
  date_conflict: boolean;
  is_assessable: boolean;
  is_blocking: boolean;
};

export type TPortfolioTimelineRow = Pick<TPortfolioProject, "id" | "name" | "start_date" | "target_date"> & {
  is_blocked?: boolean;
  project_id?: string;
  parent_id?: string | null;
  progress?: number | null;
};
export type TPortfolioResponse = {
  results: TPortfolioProject[];
  next_cursor: string | null;
  selected_project_count: number;
  generated_at: string;
  as_of_date: string;
  timezone: string;
  from: string;
  to: string;
  metrics: {
    projects: number;
    total: number;
    completed: number;
    overdue_projects: number;
    dependencies: number;
    pending_resources: number;
  };
  dependencies: {
    source_project_id: string;
    target_project_id: string;
    source_issue_id: string;
    target_issue_id: string;
    source_name: string;
    target_name: string;
    source_end: string | null;
    target_start: string | null;
    date_conflict: boolean;
  }[];
  people_overlaps: {
    person_id: string;
    name: string;
    project_ids: string[];
    start_date: string;
    target_date: string;
  }[];
};
export type TPortfolioDetail = {
  results: {
    id: string;
    name: string;
    sequence_id: number;
    start_date: string | null;
    target_date: string | null;
    state__group: string;
    parent_id?: string | null;
    sub_issues_count?: number;
    is_blocked?: boolean;
  }[];
  next_cursor: string | null;
};
