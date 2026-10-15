/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ProjectPageRoot } from "@/components/projects/page";
import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useProjectOverviewPreferences } from "@/hooks/use-project-overview-preferences";
import { ProjectViewControls } from "@/components/project/view-controls";

function ProjectsPage() {
  const { workspaceSlug = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { preferences } = useProjectOverviewPreferences(workspaceSlug);
  useEffect(() => {
    const view = search.get("layout") || preferences.default_layout;
    if (view === "dashboard" || view === "timeline") navigate(`/${workspaceSlug}/projects/${view}?${search}`, { replace: true });
  }, [preferences.default_layout, search, navigate, workspaceSlug]);
  return <div className="flex h-full flex-col"><div className="border-b border-subtle p-3 md:hidden"><ProjectViewControls /></div><div className="min-h-0 flex-1"><ProjectPageRoot /></div></div>;
}

export default ProjectsPage;
