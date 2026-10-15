/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TIssueRelation, TIssue, TIssueRelationTypes } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { mutate } from "swr";
import type { AxiosRequestConfig } from "axios";

export class IssueRelationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  override async post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    const response = await super.post(url, data, config);
    const workspace = url.match(/^\/api\/workspaces\/([^/]+)\//)?.[1];
    if (workspace && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plane:issues-changed", { detail: { workspace } }));
    if (workspace)
      void mutate(
        (key) =>
          Array.isArray(key) &&
          key[1] === workspace &&
          ["timeline-relations", "work-plan", "portfolio", "portfolio-detail"].includes(String(key[0]))
      ).catch((error: unknown) => console.error("Unable to refresh relation data", error));
    return response;
  }

  async listIssueRelations(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueRelation> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/issue-relation/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createIssueRelations(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: { relation_type: TIssueRelationTypes; issues: string[] }
  ): Promise<TIssue[]> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/issue-relation/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteIssueRelation(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: { relation_type: TIssueRelationTypes; related_issue: string }
  ): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/remove-relation/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
