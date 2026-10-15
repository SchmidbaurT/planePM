/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// types
import type { TIssue } from "@plane/types";
// components
import { StateSelect } from "@/components/dropdowns/state/state-select";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";

type Props = {
  issue: TIssue;
  onClose: () => void;
  onChange: (issue: TIssue, data: Partial<TIssue>, updates: any) => void;
  disabled: boolean;
};

export const SpreadsheetStateColumn = observer(function SpreadsheetStateColumn(props: Props) {
  const { issue, onChange, disabled, onClose } = props;
  const { updateIssue } = useIssuesActions(useIssueStoreType());

  return (
    <div className="h-11 border-b-[0.5px] border-subtle">
      <StateSelect
        testId="spreadsheet-state-select"
        issueId={issue.id}
        onBlockingChange={(data) => updateIssue?.(issue.project_id, issue.id, data)}
        projectId={issue.project_id ?? undefined}
        value={issue.state_id}
        onChange={(data) => onChange(issue, { state_id: data }, { changed_property: "state", change_details: data })}
        disabled={disabled}
        // `.clickable` is what the table's keyboard navigation clicks on Enter / Space in a focused cell.
        className="clickable"
        variant="table-cell"
        onClose={onClose}
        tooltip
      />
    </div>
  );
});
