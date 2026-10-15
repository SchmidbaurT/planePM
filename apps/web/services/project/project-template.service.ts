import { API_BASE_URL } from "@plane/constants";
import type { TProjectTemplate, TProjectTemplateInput } from "@plane/types";
import { APIService } from "@/services/api.service";

class ProjectTemplateService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private root(workspace: string) {
    return `/api/workspaces/${encodeURIComponent(workspace)}/project-templates/`;
  }

  async list(workspace: string): Promise<TProjectTemplate[]> {
    return (await this.get(this.root(workspace))).data;
  }

  async create(workspace: string, data: TProjectTemplateInput): Promise<TProjectTemplate> {
    return (await this.post(this.root(workspace), data)).data;
  }

  async update(
    workspace: string,
    id: string,
    data: Partial<Pick<TProjectTemplateInput, "name" | "description" | "is_shared">>
  ): Promise<TProjectTemplate> {
    return (await this.patch(`${this.root(workspace)}${id}/`, data)).data;
  }

  async remove(workspace: string, id: string): Promise<void> {
    await this.delete(`${this.root(workspace)}${id}/`);
  }
}

export const projectTemplateService = new ProjectTemplateService();
