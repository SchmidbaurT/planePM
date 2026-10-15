import { useState } from "react";
import { Link } from "react-router";
import useSWR from "swr";
import { CalendarDays, Pencil, Wrench } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TWorkspaceResource } from "@plane/types";
import { cn } from "@plane/utils";
import { planningInputClass } from "@/components/project/view-controls";
import { useUser } from "@/hooks/store/user";
import { planningService } from "@/services/planning.service";
import { PlanningError } from "./error";

function dayLabel(value: string, short = false) {
  return new Intl.DateTimeFormat(
    undefined,
    short ? { day: "numeric", month: "short" } : { dateStyle: "medium" }
  ).format(new Date(`${value}T12:00:00`));
}

function useResourceOverview(workspace: string, from?: string, to?: string) {
  const { data: user } = useUser();
  return useSWR(user ? ["resource-availability", workspace, user.id, "overview", from, to] : null, () =>
    planningService.resourceOverview(workspace, from, to)
  );
}

export function ResourceCapacitySummary({ workspace, from, to }: { workspace: string; from?: string; to?: string }) {
  const { t } = useTranslation();
  const { data, error } = useResourceOverview(workspace, from, to);
  return (
    <div>
      <PlanningError error={error} />
      {!data && !error && (
        <p role="status" className="text-13 text-secondary">
          {t("loading")}
        </p>
      )}
      <ul className="divide-y divide-subtle">
        {data?.resources
          .filter((resource) => !resource.archived_at)
          .map((resource) => (
            <li key={resource.id} className="flex flex-wrap items-center gap-3 py-3 text-13">
              <Link
                to={`/${workspace}/resources/${resource.id}`}
                className="min-w-0 flex-1 break-words hover:text-accent-primary"
              >
                {resource.name}
              </Link>
              <div className="flex items-center gap-2" title={t("planning.average_allocation")}>
                <progress
                  aria-label={`${resource.name}: ${t("planning.average_allocation")}`}
                  className="accent-accent-primary h-2 w-20"
                  value={resource.average_percent}
                  max={100}
                />
                <span className="w-10 text-right tabular-nums">{resource.average_percent}%</span>
              </div>
              {resource.pending_count > 0 && (
                <span className="text-12 text-secondary">
                  {t("planning.pending_demand")}: {resource.pending_count}
                </span>
              )}
            </li>
          ))}
      </ul>
      {data && !data.resources.some((resource) => !resource.archived_at) && (
        <p className="text-13 text-secondary">{t("planning.empty")}</p>
      )}
    </div>
  );
}

export function ResourceOverview({
  workspace,
  resources,
  from,
  to,
  setFrom,
  setTo,
  edit,
}: {
  workspace: string;
  resources: TWorkspaceResource[];
  from: string;
  to: string;
  setFrom: (date: string) => void;
  setTo: (date: string) => void;
  edit?: (resource: TWorkspaceResource) => void;
}) {
  const { t } = useTranslation();
  const { data, error } = useResourceOverview(workspace, from, to);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const rows = data?.resources.filter(
    (row) =>
      (archived || !row.archived_at) &&
      (!category || row.category === category) &&
      `${row.name} ${row.location}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (status !== "available" || (row.days[0]?.allocated_percent ?? 0) < 100) &&
      (status !== "fully_booked" || row.days[0]?.allocated_percent === 100) &&
      (status !== "pending" || row.pending_count > 0)
  );
  const active = rows?.filter((row) => !row.archived_at);
  const dates = data?.resources[0]?.days ?? [];
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-subtle py-4 md:grid-cols-4">
        {[
          [t("planning.active"), active?.length],
          [t("planning.available"), active?.filter((row) => (row.days[0]?.allocated_percent ?? 0) < 100).length],
          [t("planning.fully_booked"), active?.filter((row) => row.days[0]?.allocated_percent === 100).length],
          [t("planning.pending_demand"), active?.reduce((sum, row) => sum + row.pending_count, 0)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-12 text-secondary">{label}</p>
            <p className="text-22 mt-1 font-semibold tabular-nums">{value ?? "-"}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <input
          className={`${planningInputClass} max-w-64`}
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={`${planningInputClass} max-w-44`}
          aria-label={t("planning.category")}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">{t("planning.category")}</option>
          {[...new Set(resources.map((resource) => resource.category).filter(Boolean))].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          className={`${planningInputClass} max-w-44`}
          aria-label={t("planning.allocation")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t("planning.allocation")}</option>
          {(["available", "fully_booked", "pending"] as const).map((value) => (
            <option key={value} value={value}>
              {t(value === "pending" ? "planning.pending_demand" : `planning.${value}`)}
            </option>
          ))}
        </select>
        <div className="flex max-w-full flex-wrap gap-3 sm:ml-auto">
          {(
            [
              [from, setFrom, "start"],
              [to, setTo, "end"],
            ] as const
          ).map(([value, change, key]) => (
            <label key={key} className="flex min-w-0 flex-col gap-1 text-11 text-secondary">
              {t(`planning.${key}`)}
              <input
                type="date"
                className={`${planningInputClass} w-40`}
                value={value}
                min={key === "end" ? from : undefined}
                onChange={(event) => change(event.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 py-2 text-12 text-secondary">
          <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
          {t("archives")}
        </label>
      </div>
      <PlanningError error={error} />
      {!data && !error && (
        <p role="status" className="py-8 text-13 text-secondary">
          {t("loading")}
        </p>
      )}
      {data && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-14 font-medium">
              <CalendarDays size={16} />
              {t("planning.resource_schedule")}
            </h2>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-11 text-secondary">
              {[
                ["bg-success-subtle", "available"],
                ["bg-warning-subtle", "fully_booked"],
                ["bg-layer-2", "blackouts"],
              ].map(([color, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`size-2.5 rounded-sm ${color}`} />
                  {t(`planning.${label}`)}
                </span>
              ))}
            </div>
          </div>
          <div className="max-w-full overflow-x-auto border-y border-subtle">
            <table className="w-full border-separate border-spacing-0 text-left text-12">
              <thead className="text-secondary">
                <tr>
                  <th className="sticky left-0 z-10 min-w-52 border-b border-subtle bg-surface-1 px-3 py-3 font-medium">
                    {t("planning.resources")}
                  </th>
                  {dates.map((day) => (
                    <th
                      key={day.date}
                      className="min-w-14 border-b border-subtle px-1 py-3 text-center font-medium"
                      scope="col"
                    >
                      <span className="block whitespace-nowrap">{dayLabel(day.date, true)}</span>
                      <span className="mt-1 block text-10">
                        {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
                          new Date(`${day.date}T12:00:00`)
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="min-w-32 border-b border-subtle px-3 font-medium">
                    {t("planning.average_allocation")}
                  </th>
                  <th className="min-w-32 border-b border-subtle px-3 font-medium">{t("planning.pending_demand")}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((resource) => (
                  <tr key={resource.id} className="group">
                    <th
                      scope="row"
                      className="font-normal sticky left-0 z-10 max-w-64 border-b border-subtle bg-surface-1 px-3 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <Wrench size={14} className="shrink-0 text-tertiary" />
                        <Link
                          to={`/${workspace}/resources/${resource.id}`}
                          className="min-w-0 flex-1 text-13 font-medium break-words hover:text-accent-primary"
                        >
                          {resource.name}
                        </Link>
                        {edit && (
                          <button
                            type="button"
                            className="grid size-7 shrink-0 place-items-center rounded hover:bg-layer-1"
                            title={t("edit")}
                            aria-label={`${t("edit")} ${resource.name}`}
                            onClick={() => edit(resources.find((item) => item.id === resource.id) ?? resource)}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                      <p className="mt-1 pl-6 text-11 text-tertiary">
                        {resource.archived_at
                          ? t("archives")
                          : [resource.category, resource.location].filter(Boolean).join(" / ")}
                      </p>
                    </th>
                    {resource.days.map((day) => {
                      const label = `${resource.name}: ${dayLabel(day.date)} / ${t(day.maintenance ? "planning.blackouts" : "planning.allocation")}: ${day.allocated_percent}% / ${t("planning.available")}: ${100 - day.allocated_percent}%`;
                      return (
                        <td key={day.date} className="border-b border-subtle px-1 py-3">
                          <Link
                            to={`/${workspace}/resources/${resource.id}?from=${day.date}&to=${day.date}`}
                            title={label}
                            aria-label={label}
                            className={cn(
                              "focus:ring-accent-primary relative flex h-11 min-w-12 items-center justify-center overflow-hidden rounded text-11 tabular-nums focus:ring-2 focus:outline-none",
                              day.maintenance
                                ? "bg-layer-2 text-secondary"
                                : day.allocated_percent === 100
                                  ? "bg-warning-subtle text-warning-primary"
                                  : day.allocated_percent
                                    ? "bg-accent-subtle text-accent-primary"
                                    : "bg-success-subtle text-success-primary"
                            )}
                          >
                            <span
                              className="absolute inset-x-0 bottom-0 h-1 bg-current opacity-30"
                              style={{ width: `${day.allocated_percent}%` }}
                            />
                            {day.maintenance ? <Wrench size={13} /> : `${day.allocated_percent}%`}
                          </Link>
                        </td>
                      );
                    })}
                    <td className="border-b border-subtle px-3">
                      <div className="flex items-center gap-2">
                        <progress
                          aria-label={`${resource.name}: ${t("planning.average_allocation")}`}
                          max={100}
                          value={resource.average_percent}
                          className="accent-accent-primary h-1.5 w-14"
                        />
                        <span>{resource.average_percent}%</span>
                      </div>
                    </td>
                    <td className="border-b border-subtle px-3 tabular-nums">{resource.pending_count || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows?.length && <p className="py-8 text-13 text-secondary">{t("planning.empty")}</p>}
        </section>
      )}
    </div>
  );
}
