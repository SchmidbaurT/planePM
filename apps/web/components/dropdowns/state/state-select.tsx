/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { StateSelect as StateSelectBlock } from "@plane/blocks/property-select";
import type { StateOption } from "@plane/blocks/property-select";
import type { SelectPaginationParams, SelectTooltip, SelectTooltipOverride, SelectVariant } from "@plane/blocks/select";
import { useTranslation } from "@plane/i18n";
import type { IState, TIssue, TPaginatedResponse } from "@plane/types";
import { setToast } from "@plane/blocks/toast";
import { BlockingDialog } from "./blocking-dialog";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";

type StateSelectWebProps = {
  /** Project whose states are offered. */
  projectId: string | undefined;
    issueId?: string;
    onBlockingChange?: (data: Partial<TIssue>) => Promise<void> | void;
  /** Current state id (`null` / `undefined` when none). */
  value: string | null | undefined;
  /** Emits the next state id. */
  onChange: (stateId: string) => void;
  variant: SelectVariant;
  disabled?: boolean;
  placeholder?: string;
  onClose?: () => void;
  className?: string;
  tooltip?: SelectTooltip;
  appendElement?: ReactNode;
  /** Forwarded to the block's trigger — see `StateSelectProps["testId"]` doc comment. */
  testId?: string;
  /** Tab order of the trigger, for forms that sequence focus explicitly (`ETabIndices`). */
  tabIndex?: number;
};

const toOption = (state: IState): StateOption => ({
  id: state.id,
  name: state.name,
  color: state.color,
  group: state.group,
  order: state.order,
});

/**
 * Web binding for the presentational `StateSelect` block. Resolves the project's states from the
 * project-state store (fetched on first open when the project has not been loaded yet), filters them
 * by the search query and maps the selected id to a `StateOption`.
 *
 * CE change: EE reads a paginated state "lite" resource with workflow gating (`typeId`,
 * `isForWorkItemCreation`, `scopedProjectIds`); CE has neither, so the whole project list is served
 * as one page and `allowedStateIds` stays unset.
 */
export const StateSelect = observer(function StateSelect(props: StateSelectWebProps) {
  const {
    projectId,
    value,
    onChange,
    variant,
    disabled,
    placeholder,
    onClose,
    className,
    tooltip,
    appendElement,
    testId,
    tabIndex,
    issueId,
    onBlockingChange,
  } = props;
  const [blockingOpen, setBlockingOpen] = useState(false);
  // router params
  const { workspaceSlug } = useParams();
  // store hooks
  const { getProjectStateIds, getStateById, fetchProjectStates } = useProjectState();
  // translation
  const { t } = useTranslation();
  const resolvedTooltip = useMemo<SelectTooltipOverride | undefined>(() => {
    if (!tooltip) return undefined;
    const override = typeof tooltip === "object" ? tooltip : undefined;
    return {
      heading: override?.heading ?? t("common.state"),
      emptyContent: override?.emptyContent ?? t("common.none"),
    };
  }, [tooltip, t]);

  const getValues = useCallback(
    async ({ search }: SelectPaginationParams): Promise<TPaginatedResponse<StateOption[]>> => {
      if (!workspaceSlug || !projectId) return { results: [] };
      let stateIds = getProjectStateIds(projectId);
      if (!stateIds) {
        await fetchProjectStates(workspaceSlug.toString(), projectId);
        stateIds = getProjectStateIds(projectId);
      }
      const query = search?.trim().toLowerCase();
      const results = (stateIds ?? [])
        .map((stateId) => getStateById(stateId))
        .filter((state): state is IState => !!state && (!state.is_blocked || !!onBlockingChange || state.id === value))
        .filter((state) => !query || state.name.toLowerCase().includes(query))
        .map((state) => ({ ...toOption(state), name: state.is_blocked ? t("planning.blocked_state") : state.name }));
      return { results, next_page_results: false };
    },
    [workspaceSlug, projectId, getProjectStateIds, fetchProjectStates, getStateById, onBlockingChange, value, t]
  );

  // Resolved in the observer render (not in a memo) so MobX re-renders when the state loads.
  const selectedState = value ? getStateById(value) : undefined;
  const selected = selectedState ? { ...toOption(selectedState), name: selectedState.is_blocked ? t("planning.blocked_state") : selectedState.name } : null;

  return (
    <>
    <StateSelectBlock
            onChange={(id) => {
              const next = getStateById(id);
              if (next?.is_blocked && onBlockingChange) { setBlockingOpen(true); return; }
              if (selectedState?.is_blocked && next?.group !== "cancelled") { setToast({ type: "error", title: t("toast.error"), message: t("planning.blocking_active") }); return; }
              onChange(id);
            }}
      getValues={getValues}
      value={selected}
      variant={variant}
      disabled={disabled}
      placeholder={placeholder ?? t("state")}
      onClose={onClose}
      className={[className, selectedState?.is_blocked ? "bg-danger-subtle text-danger-primary" : ""].filter(Boolean).join(" ")}
      tooltip={resolvedTooltip}
      appendElement={appendElement}
      testId={testId}
      tabIndex={tabIndex}
    />
    {blockingOpen && projectId && workspaceSlug && onBlockingChange && <BlockingDialog workspace={workspaceSlug.toString()} project={projectId} issueId={issueId} allowClear={!!selectedState?.is_blocked} close={() => setBlockingOpen(false)} save={async (ids, version) => { const blocked = (getProjectStateIds(projectId) ?? []).map((id) => getStateById(id)).find((state) => state?.is_blocked); await onBlockingChange({ blocker_issue_ids: ids, state_id: blocked?.id, expected_updated_at: version }); }} />}
    </>
  );
});
