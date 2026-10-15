/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { BlockingOutline, CloseCircleOutline, DuplicateOfOutline, RelatesToOutline } from "@makeplane/propel/icons";
import type { TRelationObject } from "@/components/issues/issue-detail-widgets/relations";
import type { TIssueRelationTypes } from "@plane/types";
import { ArrowRight } from "lucide-react";

export const ISSUE_RELATION_OPTIONS: Record<TIssueRelationTypes, TRelationObject> = {
  finish_to_start: {
    key: "finish_to_start",
    i18n_label: "planning.finish_start_successor",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <ArrowRight size={size} />,
    placeholder: "None",
  },
  start_after_finish: {
    key: "start_after_finish",
    i18n_label: "planning.finish_start_predecessor",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <ArrowRight size={size} />,
    placeholder: "None",
  },
  start_before: {
    key: "start_before",
    i18n_label: "planning.start_start_successor",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <ArrowRight size={size} />,
    placeholder: "None",
  },
  start_after: {
    key: "start_after",
    i18n_label: "planning.start_start_predecessor",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <ArrowRight size={size} />,
    placeholder: "None",
  },
  finish_before: {
    key: "finish_before",
    i18n_label: "planning.finish_finish_successor",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <ArrowRight size={size} />,
    placeholder: "None",
  },
  finish_after: {
    key: "finish_after",
    i18n_label: "planning.finish_finish_predecessor",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <ArrowRight size={size} />,
    placeholder: "None",
  },
  relates_to: {
    key: "relates_to",
    i18n_label: "issue.relation.relates_to",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <RelatesToOutline height={size} width={size} className="text-secondary" />,
    placeholder: "Add related work items",
  },
  duplicate: {
    key: "duplicate",
    i18n_label: "issue.relation.duplicate",
    className: "bg-layer-1 text-secondary",
    icon: (size) => <DuplicateOfOutline width={size} height={size} className="text-secondary" />,
    placeholder: "None",
  },
  blocked_by: {
    key: "blocked_by",
    i18n_label: "issue.relation.blocked_by",
    className: "bg-danger-subtle text-danger-primary",
    icon: (size) => <BlockingOutline width={size} height={size} className="text-secondary" />,
    placeholder: "None",
  },
  blocking: {
    key: "blocking",
    i18n_label: "issue.relation.blocking",
    className: "bg-yellow-500/20 text-yellow-700",
    icon: (size) => <CloseCircleOutline width={size} height={size} className="text-secondary" />,
    placeholder: "None",
  },
};

export const useTimeLineRelationOptions = (): Partial<Record<TIssueRelationTypes, TRelationObject>> => Object.fromEntries(Object.entries(ISSUE_RELATION_OPTIONS).filter(([key]) => !["relates_to", "duplicate", "blocking"].includes(key)));
