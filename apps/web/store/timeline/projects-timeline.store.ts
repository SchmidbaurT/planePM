import { action, autorun, makeObservable, observable } from "mobx";
import type { TPortfolioTimelineRow } from "@plane/types";
import type { RootStore } from "@/store/root.store";
import { BaseTimeLineStore } from "./base-timeline.store";
import type { IBaseTimelineStore } from "./base-timeline.store";

export interface IProjectsTimeLineStore extends IBaseTimelineStore {
  setProjects: (projects: TPortfolioTimelineRow[]) => void;
}

export class ProjectsTimeLineStore extends BaseTimeLineStore implements IProjectsTimeLineStore {
  projects: Record<string, TPortfolioTimelineRow> = {};

  constructor(rootStore: RootStore) {
    super(rootStore);
    makeObservable(this, { projects: observable, setProjects: action.bound });
    autorun(() => {
      this.updateBlocks((id) => {
        const project = this.projects[id];
        return project ? { ...project, project_id: project.project_id ?? id, sort_order: null } : undefined;
      });
    });
  }

  setProjects(projects: TPortfolioTimelineRow[]) {
    this.projects = Object.fromEntries(projects.map((project) => [project.id, project]));
    this.setBlockIds(projects.map((project) => project.id));
  }
}
