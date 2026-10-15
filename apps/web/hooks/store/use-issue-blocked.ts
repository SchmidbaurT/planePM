import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectState } from "@/hooks/store/use-project-state";

export function useIssueBlocked(issueId: string) {
  const { issue: { getIssueById } } = useIssueDetail();
  const { getStateById } = useProjectState();
  const issue = getIssueById(issueId);
  return !!(issue?.is_blocked || (issue?.state_id && getStateById(issue.state_id)?.is_blocked));
}