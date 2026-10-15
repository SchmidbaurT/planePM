import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TProjectMilestone = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  target_date: string;
  original_target_date: string;
  owner_id: string;
  owner_name: string;
  completed_at: string | null;
  completed_by: string | null;
  status: "open" | "overdue" | "reached";
  is_late: boolean;
  issue_ids: string[];
  issues: { id: string; name: string }[];
  updated_at: string;
  history: {
    action: string;
    actor_id: string;
    actor_name?: string;
    at: string;
    reason?: string;
    changes?: Record<string, { from: string | string[]; to: string | string[] }>;
  }[];
};
export type TMilestoneInput = Partial<
  Pick<TProjectMilestone, "name" | "description" | "target_date" | "owner_id" | "issue_ids">
> & {
  reason?: string;
  reached?: boolean;
  expected_updated_at?: string;
};
export type TMilestoneWorkItemOption = {
  id: string;
  name: string;
  identifier?: string;
  sequence_id?: number;
  state__name?: string;
  target_date?: string | null;
};
export type TMilestoneWorkItemPage = { results: TMilestoneWorkItemOption[]; count: number; next_cursor: number | null };
export type TWorkPlanIssue = {
  is_blocked?: boolean;
  id: string;
  name: string;
  project_id: string;
  project__name: string;
  project__identifier: string;
  sequence_id: number;
  target_date: string | null;
  priority: string;
  parent_id: string | null;
  state__name: string;
  state_id?: string;
  blockers: { id: string; name: string; project_id: string }[];
};
export type TWorkPlan = {
  as_of_date: string;
  week_end: string;
  sections: Record<
    "today" | "week" | "blocked",
    { count: number; next_cursor: number | null; items: TWorkPlanIssue[] }
  > & {
    milestones: { count: number; next_cursor: number | null; items: TProjectMilestone[] };
  };
};

class MilestoneService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  private root(workspace: string, project: string) {
    return `/api/workspaces/${encodeURIComponent(workspace)}/projects/${project}/milestones/`;
  }
  async list(workspace: string, project: string): Promise<TProjectMilestone[]> {
    return (await this.get(this.root(workspace, project))).data;
  }
  async create(workspace: string, project: string, data: TMilestoneInput): Promise<TProjectMilestone> {
    return (await this.post(this.root(workspace, project), data)).data;
  }
  async update(workspace: string, project: string, id: string, data: TMilestoneInput): Promise<TProjectMilestone> {
    return (await this.patch(`${this.root(workspace, project)}${id}/`, data)).data;
  }
  async remove(workspace: string, project: string, id: string): Promise<void> {
    await this.delete(`${this.root(workspace, project)}${id}/`);
  }
  async workPlan(workspace: string, user: string, cursors: Record<string, number>): Promise<TWorkPlan> {
    return (
      await this.get(`/api/workspaces/${encodeURIComponent(workspace)}/users/${user}/work-plan/`, {
        params: Object.fromEntries(Object.entries(cursors).map(([key, value]) => [`${key}_cursor`, value])),
      })
    ).data;
  }
  async searchIssues(workspace: string, project: string, search: string, cursor = 0): Promise<TMilestoneWorkItemPage> {
    const response = await this.get(
      `/api/workspaces/${encodeURIComponent(workspace)}/projects/${project}/milestone-work-items/`,
      {
        params: { search, cursor },
      }
    );
    return response.data;
  }
}
export const milestoneService = new MilestoneService();
