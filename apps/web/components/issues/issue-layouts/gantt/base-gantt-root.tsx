/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { setToast } from "@plane/blocks/toast";
import type { IBlockUpdateData, TIssue } from "@plane/types";
import { EIssuesStoreType, EIssueLayoutTypes, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { TimelineDependencies } from "@/components/gantt-chart/dependencies";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { getExpandedHierarchyIds, getHierarchyRows } from "@/helpers/planning";
import { MilestoneTimelineToolbar, MilestoneTimelineMarker, useMilestones } from "@/components/project/milestones";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
import { useBulkOperationStatus } from "@/hooks/use-bulk-operation-status";
// local imports
import { IssueLayoutHOC } from "../issue-layout-HOC";
import { GanttQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import { IssueGanttBlock, IssueTimelineHierarchyContext } from "./blocks";

interface IBaseGanttRoot {
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}

export type GanttStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC;

export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter } = useIssues(storeType);
  const {
    issue: { getIssueById },
    subIssues,
  } = useIssueDetail();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedMilestone, setSelectedMilestone] = useState<string>();
  const { data: milestones } = useMilestones(workspaceSlug.toString(), isEpic ? undefined : projectId?.toString());
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const appliedDisplayFilters = issuesFilter.issueFilters?.displayFilters;
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();
  // derived values
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);

  const reportFetchError = useEffectEvent((error: unknown) => {
    if (error) setToast({ type: "error", title: t("toast.error"), message: t("planning.error") });
  });
  useEffect(() => {
    void fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId).catch(reportFetchError);
  }, [fetchIssues, storeType, viewId]);

  useEffect(() => {
    initGantt();
  }, []);

  const loadedIds = (issues.groupedIssueIds?.[ALL_ISSUES] as string[]) ?? [];
  const ids = getExpandedHierarchyIds(loadedIds, expanded, subIssues.subIssuesByIssueId);
  const hierarchyRows = getHierarchyRows(ids, Object.fromEntries(ids.map((id) => [id, getIssueById(id)])), expanded);
  const issuesIds = isEpic ? loadedIds : hierarchyRows.map((row) => row.id);
  const toggleHierarchy = useCallback(
    async (id: string) => {
      if (expanded.has(id)) {
        setExpanded((previous) => new Set([...previous].filter((value) => value !== id)));
        return;
      }
      const issue = getIssueById(id);
      if (!issue?.project_id || !workspaceSlug) return;
      try {
        await subIssues.fetchSubIssues(workspaceSlug.toString(), issue.project_id, id);
        setExpanded((previous) => new Set([...previous, id]));
      } catch {
        setToast({ type: "error", title: t("toast.error"), message: t("planning.error") });
      }
    },
    [expanded, getIssueById, subIssues, workspaceSlug, t]
  );
  const hierarchyContext = useMemo(
    () => ({
      expanded,
      depths: Object.fromEntries(hierarchyRows.map((row) => [row.id, row.depth])),
      toggle: toggleHierarchy,
    }),
    [expanded, hierarchyRows, toggleHierarchy]
  );
  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  const { enableIssueCreation } = issues?.viewFlags || {};

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

  const updateIssueBlockStructure = async (issue: TIssue, data: IBlockUpdateData) => {
    if (!workspaceSlug) return;

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    updateIssue && (await updateIssue(issue.project_id, issue.id, payload));
  };

  const isAllowed = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const updateBlockDates = useCallback(
    (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) =>
      issues.updateIssueDates(workspaceSlug.toString(), updates, projectId.toString()).catch(() => {
        setToast({
          type: "error",
          title: t("toast.error"),
          message: "Error while updating work item dates, Please try again Later",
        });
      }),
    [issues, projectId, workspaceSlug]
  );

  const quickAdd =
    enableIssueCreation && isAllowed && !isCompletedCycle ? (
      <QuickAddIssueRoot
        layout={EIssueLayoutTypes.GANTT}
        QuickAddButton={GanttQuickAddIssueButton}
        containerClassName="sticky bottom-0 z-[1]"
        prePopulatedData={{
          start_date: renderFormattedPayloadDate(new Date()),
          target_date: renderFormattedPayloadDate(targetDate),
        }}
        quickAddCallback={quickAddIssue}
        isEpic={isEpic}
      />
    ) : undefined;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <IssueTimelineHierarchyContext.Provider value={hierarchyContext}>
        <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
          <div className="flex h-full w-full flex-col">
            <MilestoneTimelineToolbar
              workspace={workspaceSlug.toString()}
              project={projectId?.toString()}
              selectedId={selectedMilestone}
              onCloseSelection={() => setSelectedMilestone(undefined)}
              disabled={isEpic}
              headerHasMilestones={storeType === EIssuesStoreType.PROJECT}
            />
            <div className="min-h-0 flex-1">
              <GanttChartRoot
                border={false}
                title={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
                loaderTitle={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
                blockIds={issuesIds}
                dependencyOverlay={
                  !isEpic && (
                    <TimelineDependencies
                      workspace={workspaceSlug.toString()}
                      issueIds={ids}
                      rowIds={issuesIds}
                      getIssue={getIssueById}
                    />
                  )
                }
                blockUpdateHandler={updateIssueBlockStructure}
                blockToRender={(data: TIssue) => <IssueGanttBlock issueId={data.id} isEpic={isEpic} />}
                sidebarToRender={(props) => <IssueGanttSidebar {...props} showAllBlocks isEpic={isEpic} />}
                enableBlockLeftResize={isAllowed}
                enableBlockRightResize={isAllowed}
                enableBlockMove={isAllowed}
                enableReorder={expanded.size === 0 && appliedDisplayFilters?.order_by === "sort_order" && isAllowed}
                enableAddBlock={isAllowed}
                enableSelection={isBulkOperationsEnabled && isAllowed}
                quickAdd={quickAdd}
                loadMoreBlocks={loadMoreIssues}
                canLoadMoreBlocks={nextPageResults}
                updateBlockDates={updateBlockDates}
                showAllBlocks
                enableDependency
                isEpic={isEpic}
                extraRows={milestones?.map((milestone) => ({
                  id: milestone.id,
                  sidebar: (
                    <button
                      type="button"
                      className="min-w-0 text-left text-12"
                      onClick={() => setSelectedMilestone(milestone.id)}
                      title={`${milestone.name} · ${milestone.owner_name} · ${milestone.target_date}`}
                    >
                      <span className="block truncate font-medium">{milestone.name}</span>
                      <span className="block truncate text-10 text-secondary">
                        {milestone.owner_name} · {milestone.target_date}
                      </span>
                    </button>
                  ),
                  chart: (
                    <MilestoneTimelineMarker milestone={milestone} onOpen={() => setSelectedMilestone(milestone.id)} />
                  ),
                }))}
              />
            </div>
          </div>
        </TimeLineTypeContext.Provider>
      </IssueTimelineHierarchyContext.Provider>
    </IssueLayoutHOC>
  );
});
