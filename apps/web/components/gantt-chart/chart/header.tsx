/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ArrowCollapseOutline, FullScreenOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// plane
import type { TGanttViews } from "@plane/types";
import { Row } from "@plane/blocks/layout";
// components
import { cn } from "@plane/utils";
import { VIEWS_LIST } from "@/components/gantt-chart/data";
// helpers
// hooks
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
//
import { GANTT_BREADCRUMBS_HEIGHT } from "../constants";

type Props = {
  blockIds: string[];
  fullScreenMode: boolean;
  handleChartView: (view: TGanttViews) => void;
  handleToday: () => void;
  loaderTitle: string;
  toggleFullScreenMode: () => void;
  showToday: boolean;
  itemCount?: number;
  dependencyControl?: {
    enabled: boolean;
    toggle: () => void;
    mode: "all" | "focus" | "conflicts";
    setMode: (mode: "all" | "focus" | "conflicts") => void;
    focusId: string;
    setFocusId: (id: string) => void;
    options: { id: string; name: string }[];
  };
};

export const GanttChartHeader = observer(function GanttChartHeader(props: Props) {
  const { t } = useTranslation();
  const {
    blockIds,
    fullScreenMode,
    handleChartView,
    handleToday,
    loaderTitle,
    toggleFullScreenMode,
    showToday,
    itemCount,
  } = props;
  // chart hook
  const { currentView } = useTimeLineChartStore();

  return (
    <Row
      className="relative flex h-auto w-full flex-shrink-0 flex-wrap items-center gap-2 bg-surface-1 py-2 whitespace-nowrap"
      style={{ minHeight: `${GANTT_BREADCRUMBS_HEIGHT}px` }}
    >
      {props.dependencyControl && (
        <label className="flex items-center gap-1 text-11">
          <input type="checkbox" checked={props.dependencyControl.enabled} onChange={props.dependencyControl.toggle} />
          {t("planning.dependencies")}
        </label>
      )}
      {props.dependencyControl?.enabled && (
        <>
          <select
            className="max-w-40 rounded-sm border border-subtle bg-surface-1 p-1 text-11"
            aria-label={t("planning.connection_view")}
            value={props.dependencyControl.mode}
            onChange={(event) => props.dependencyControl?.setMode(event.target.value as "all" | "focus" | "conflicts")}
          >
            <option value="all">{t("planning.all_dependencies")}</option>
            <option value="focus">{t("planning.focus_task")}</option>
            <option value="conflicts">{t("planning.conflicts_only")}</option>
          </select>
          {props.dependencyControl.mode === "focus" && (
            <select
              className="max-w-52 rounded-sm border border-subtle bg-surface-1 p-1 text-11"
              aria-label={t("planning.focus_task")}
              value={props.dependencyControl.focusId}
              onChange={(event) => props.dependencyControl?.setFocusId(event.target.value)}
            >
              <option value="">{t("select")}</option>
              {props.dependencyControl.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <div className="ml-auto">
        <div id="timeline-dependency-summary" className="mb-1 flex flex-wrap gap-2 text-11" />
        <div className="ml-auto text-11 font-medium text-tertiary">
          {blockIds ? `${itemCount ?? blockIds.length} ${loaderTitle}` : t("common.loading")}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS_LIST.map((chartView: any) => (
          <button
            type="button"
            key={chartView?.key}
            className={cn(
              "cursor-pointer rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover",
              {
                "bg-layer-transparent-selected": currentView === chartView?.key,
              }
            )}
            aria-pressed={currentView === chartView?.key}
            onClick={() => handleChartView(chartView?.key)}
          >
            {t(chartView?.i18n_title)}
          </button>
        ))}
      </div>

      {showToday && (
        <button
          type="button"
          className="rounded-md bg-layer-transparent p-1 px-2 text-11 hover:bg-layer-transparent-hover"
          onClick={handleToday}
        >
          {t("common.today")}
        </button>
      )}

      <button
        type="button"
        className="flex items-center justify-center rounded-md border border-subtle bg-layer-transparent p-1 transition-all hover:bg-layer-transparent-hover"
        aria-label={t("common.full_screen")}
        aria-pressed={fullScreenMode}
        onClick={toggleFullScreenMode}
      >
        {fullScreenMode ? <ArrowCollapseOutline className="h-4 w-4" /> : <FullScreenOutline className="h-4 w-4" />}
      </button>
    </Row>
  );
});
