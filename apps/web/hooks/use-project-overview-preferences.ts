import useSWR from "swr";
import type { TProjectOverviewPreferences } from "@plane/types";
import { useUser } from "@/hooks/store/user";
import { planningService } from "@/services/planning.service";
import { normalizePlanningPreferences } from "@/helpers/planning";

export function useProjectOverviewPreferences(workspace: string) {
  const { data: user } = useUser();
  const { data, error, isLoading, mutate } = useSWR(
    workspace && user ? ["project-overview-preferences", workspace, user.id] : null,
    () => planningService.preferences(workspace)
  );
  return {
    preferences: normalizePlanningPreferences(data ?? {}),
    error,
    isLoading,
    save: async (preferences: TProjectOverviewPreferences) => {
      const saved = await planningService.savePreferences(workspace, preferences);
      await mutate(saved, { revalidate: false });
    },
  };
}
