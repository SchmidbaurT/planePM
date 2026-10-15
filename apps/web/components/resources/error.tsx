import { useTranslation } from "@plane/i18n";
import { getResourceConflict } from "@/helpers/planning";

export function PlanningError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const detail = getResourceConflict(error);
  const key =
    detail?.code === "RESOURCE_CAPACITY_EXCEEDED"
      ? "planning.conflict"
      : detail?.code === "RESOURCE_IN_USE"
        ? "planning.in_use"
        : "planning.error";
  return (
    <p role="alert" className="text-13 break-words text-danger-primary">
      {t(key)}
      {typeof detail?.date === "string" &&
        ` (${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${detail.date}T12:00:00`))})`}
    </p>
  );
}
