/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// plane imports
import { EIssueLayoutTypes } from "@plane/types";
// components
import { LayoutErrorBoundary } from "@/components/common/layout-error-boundary";
import { CalendarLayoutLoader } from "@/components/ui/loader/layouts/calendar-layout-loader";
import { GanttLayoutLoader } from "@/components/ui/loader/layouts/gantt-layout-loader";
import { KanbanLayoutLoader } from "@/components/ui/loader/layouts/kanban-layout-loader";
import { ListLayoutLoader } from "@/components/ui/loader/layouts/list-layout-loader";
import { SpreadsheetLayoutLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// local imports
import { IssueLayoutEmptyState } from "./empty-states";

function ActiveLoader(props: { layout: EIssueLayoutTypes }) {
  const { layout } = props;
  switch (layout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayoutLoader />;
    case EIssueLayoutTypes.KANBAN:
      return <KanbanLayoutLoader />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <SpreadsheetLayoutLoader />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayoutLoader />;
    case EIssueLayoutTypes.GANTT:
      return <GanttLayoutLoader />;
    default:
      return null;
  }
}

interface Props {
  children: string | React.ReactNode | React.ReactNode[];
  layout: EIssueLayoutTypes;
}

export const IssueLayoutHOC = observer(function IssueLayoutHOC(props: Props) {
  const { layout } = props;

  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const { fetchIssues } = useIssuesActions(storeType);
  const { workspaceSlug, viewId, profileViewId } = useParams();
  useEffect(() => {
    const refresh = (event: Event) => { if (event.type === "focus" || (event as CustomEvent<{ workspace: string }>).detail.workspace === workspaceSlug) void fetchIssues("mutation", { canGroup: layout !== EIssueLayoutTypes.GANTT, perPageCount: 100 }, (viewId ?? profileViewId)?.toString()).catch(() => undefined); };
    window.addEventListener("plane:issues-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("plane:issues-changed", refresh); window.removeEventListener("focus", refresh); };
  }, [fetchIssues, workspaceSlug, viewId, profileViewId, layout]);

  const issueCount = issues.getGroupIssueCount(undefined, undefined, false);

  if (issues?.getIssueLoader() === "init-loader" || issueCount === undefined) {
    return <ActiveLoader layout={layout} />;
  }

  if (
    issues.getGroupIssueCount(undefined, undefined, false) === 0 &&
    layout !== EIssueLayoutTypes.CALENDAR &&
    layout !== EIssueLayoutTypes.GANTT
  ) {
    return <IssueLayoutEmptyState storeType={storeType} />;
  }

  return <LayoutErrorBoundary key={layout}>{props.children}</LayoutErrorBoundary>;
});
