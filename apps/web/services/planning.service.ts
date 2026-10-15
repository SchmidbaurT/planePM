import { API_BASE_URL } from "@plane/constants";
import { sortBy } from "lodash-es";
import type {
  TPortfolioDetail,
  TPortfolioResponse,
  TProjectOverviewPreferences,
  TResourceAvailability,
  TResourceBlackout,
  TResourceRequirement,
  TResourceOverview,
  TWorkspaceResource,
  TTimelineRelation,
} from "@plane/types";
import { APIService } from "@/services/api.service";

class PlanningService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private root(workspace: string) {
    return `/api/workspaces/${encodeURIComponent(workspace)}`;
  }

  async resources(workspace: string): Promise<TWorkspaceResource[]> {
    return (await this.get(`${this.root(workspace)}/resources/`)).data;
  }
  async resourceOverview(workspace: string, from?: string, to?: string): Promise<TResourceOverview> {
    return (await this.get(`${this.root(workspace)}/resource-overview/`, { params: { from, to } })).data;
  }
  async saveResource(workspace: string, data: Partial<TWorkspaceResource>, id?: string): Promise<TWorkspaceResource> {
    return (
      id
        ? await this.patch(`${this.root(workspace)}/resources/${id}/`, data)
        : await this.post(`${this.root(workspace)}/resources/`, data)
    ).data;
  }
  async availability(workspace: string, id: string, from: string, to: string): Promise<TResourceAvailability> {
    return (await this.get(`${this.root(workspace)}/resources/${id}/availability/`, { params: { from, to } })).data;
  }
  async saveBlackout(
    workspace: string,
    resourceId: string,
    data: Partial<TResourceBlackout>,
    id?: string
  ): Promise<TResourceBlackout> {
    const root = `${this.root(workspace)}/resources/${resourceId}/blackouts/`;
    return (id ? await this.patch(`${root}${id}/`, data) : await this.post(root, data)).data;
  }
  async removeBlackout(workspace: string, resourceId: string, id: string): Promise<void> {
    await this.delete(`${this.root(workspace)}/resources/${resourceId}/blackouts/${id}/`);
  }
  async requirements(workspace: string, projectId: string, issueId: string): Promise<TResourceRequirement[]> {
    return (await this.get(`${this.root(workspace)}/projects/${projectId}/issues/${issueId}/resources/`)).data;
  }
  async saveRequirements(
    workspace: string,
    projectId: string,
    issueId: string,
    resource_requirements: TResourceRequirement[]
  ): Promise<TResourceRequirement[]> {
    return (
      await this.patch(`${this.root(workspace)}/projects/${projectId}/issues/${issueId}/resources/`, {
        resource_requirements,
      })
    ).data;
  }
  async portfolio(workspace: string, filters: Record<string, string>): Promise<TPortfolioResponse> {
    return (await this.get(`${this.root(workspace)}/portfolio/`, { params: filters })).data;
  }
  async detail(workspace: string, projectId: string, cursor = "0"): Promise<TPortfolioDetail> {
    return (await this.get(`${this.root(workspace)}/portfolio/projects/${projectId}/`, { params: { cursor } })).data;
  }
  async relations(workspace: string, issueIds: string[], projectIds: string[] = []): Promise<TTimelineRelation[]> {
    const ids = sortBy([...new Set(projectIds.length ? projectIds : issueIds)]);
    const result = new Map<string, TTimelineRelation>();
    for (let index = 0; index < ids.length; index += 100) {
      let cursor: number | null = 0;
      do {
        const response: { results: TTimelineRelation[]; next_cursor: number | null } = (
          await this.get(`${this.root(workspace)}/timeline-relations/`, {
            params: {
              [projectIds.length ? "project_ids" : "issue_ids"]: ids.slice(index, index + 100).join(","),
              cursor,
            },
          })
        ).data;
        for (const edge of response.results) result.set(edge.id, edge);
        cursor = response.next_cursor;
      } while (cursor !== null);
    }
    return [...result.values()];
  }
  async preferences(workspace: string): Promise<TProjectOverviewPreferences> {
    return (await this.get(`${this.root(workspace)}/project-overview-preferences/`)).data;
  }
  async savePreferences(workspace: string, data: TProjectOverviewPreferences): Promise<TProjectOverviewPreferences> {
    return (await this.patch(`${this.root(workspace)}/project-overview-preferences/`, data)).data;
  }
}

export const planningService = new PlanningService();
