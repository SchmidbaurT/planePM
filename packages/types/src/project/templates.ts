import type { IProject } from "./projects";

export type TProjectTemplate = {
  id: string;
  name: string;
  description: string;
  source_project_id: string | null;
  source_project_name: string;
  is_shared: boolean;
  created_by: string | null;
  created_at: string;
  base_date: string | null;
  counts: {
    issues: number;
    modules: number;
    cycles: number;
    pages: number;
    requirements: number;
    relations: number;
    milestones?: number;
  };
  project_defaults: Partial<IProject>;
};

export type TProjectTemplateInput = {
  name: string;
  description: string;
  source_project_id: string;
  is_shared: boolean;
};
