import { CornerDownRight } from "lucide-react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

export const WorkItemParentLabel = observer(function WorkItemParentLabel({
  parentId,
}: {
  parentId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  if (!parentId) return null;
  const parent = getIssueById(parentId);
  const label = parent?.name ? `${t("common.parent")}: ${parent.name}` : t("common.parent");
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-11 text-secondary" title={label}>
      <CornerDownRight size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
});
