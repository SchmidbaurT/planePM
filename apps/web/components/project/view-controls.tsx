import { useState } from "react";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { NavLink, useParams, useSearchParams } from "react-router";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { useTranslation } from "@plane/i18n";
import type { TProjectOverviewPreferences, TProjectOverviewLayout } from "@plane/types";
import { cn } from "@plane/utils";
import { useProjectOverviewPreferences } from "@/hooks/use-project-overview-preferences";
import { defaultDashboardWidgets, planningColumns, planningWidgets } from "@/helpers/planning";

export { planningColumns, planningWidgets } from "@/helpers/planning";
export const planningInputClass =
  "w-full min-w-0 rounded border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary";

function ProjectViewSettings({
  preferences,
  save,
  close,
}: {
  preferences: TProjectOverviewPreferences;
  save: (data: TProjectOverviewPreferences) => Promise<void>;
  close: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const order = draft.widget_order ?? planningWidgets;
  const enabled = draft.enabled_widgets ?? planningWidgets;
  const columns = draft.columns ?? planningColumns;
  const submit = async () => {
    setBusy(true);
    setError(false);
    try {
      await save(draft);
      close();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogTitle>{t("planning.configure")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-5">
              <label className="flex flex-col gap-2 text-13">
                {t("planning.default_view")}
                <select
                  className={planningInputClass}
                  value={draft.default_layout ?? "list"}
                  onChange={(event) =>
                    setDraft({ ...draft, default_layout: event.target.value as TProjectOverviewLayout })
                  }
                >
                  {(["list", "dashboard", "timeline"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`planning.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="mb-2 text-13 font-medium">{t("planning.sections")}</legend>
                {order.map((widget, index) => (
                  <div key={widget} className="flex min-h-10 items-center gap-3 border-b border-subtle py-1">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-13">
                      <input
                        type="checkbox"
                        checked={enabled.includes(widget)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            enabled_widgets: event.target.checked
                              ? [...enabled, widget]
                              : enabled.filter((value) => value !== widget),
                          })
                        }
                      />
                      {widget === "projects" ? t("sidebar.projects") : t(`planning.${widget}`)}
                    </label>
                    {(["up", "down"] as const).map((direction) => {
                      const next = index + (direction === "up" ? -1 : 1);
                      const label = `${t("planning.sort")}: ${index + 1} > ${next + 1}`;
                      return (
                        <button
                          key={direction}
                          type="button"
                          disabled={next < 0 || next >= order.length}
                          title={label}
                          aria-label={label}
                          className="grid size-8 shrink-0 place-items-center rounded hover:bg-layer-1 disabled:opacity-30"
                          onClick={() => {
                            const changed = [...order];
                            [changed[index], changed[next]] = [changed[next], changed[index]];
                            setDraft({ ...draft, widget_order: changed });
                          }}
                        >
                          {direction === "up" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-13 font-medium">{t("planning.columns")}</legend>
                <div className="grid grid-cols-2 gap-3">
                  {planningColumns.map((column) => (
                    <label key={column} className="flex items-center gap-2 text-13">
                      <input
                        type="checkbox"
                        checked={columns.includes(column)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            columns: event.target.checked
                              ? [...columns, column]
                              : columns.filter((value) => value !== column),
                          })
                        }
                      />
                      {t(`planning.${column}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && (
                <p role="alert" className="text-13 text-danger-primary">
                  {t("planning.error")}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  stretch="auto"
                  label={t("planning.reset")}
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      schema_version: 1,
                      default_layout: "list",
                      enabled_widgets: defaultDashboardWidgets,
                      widget_order: planningWidgets,
                      columns: planningColumns,
                      filters: {},
                      sort: "name",
                      gantt_zoom: "month",
                    })
                  }
                />
                <Button
                  variant="secondary"
                  size="md"
                  stretch="auto"
                  label={t("cancel")}
                  disabled={busy}
                  onClick={close}
                />
                <Button
                  variant="primary"
                  size="md"
                  stretch="auto"
                  label={t("save")}
                  disabled={busy}
                  onClick={() => void submit()}
                />
              </div>
            </div>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectViewControls() {
  const { workspaceSlug = "" } = useParams();
  const [search] = useSearchParams();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { preferences, save, error, isLoading } = useProjectOverviewPreferences(workspaceSlug);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <nav aria-label={t("planning.default_view")} className="flex rounded border border-subtle p-0.5 text-13">
        {(["list", "dashboard", "timeline"] as const).map((view) => (
          <NavLink
            key={view}
            end
            to={`/${workspaceSlug}/projects${view === "list" ? "" : `/${view}`}?${new URLSearchParams({ ...Object.fromEntries(search), layout: view })}`}
            className={({ isActive }) =>
              cn(
                "focus:ring-accent-primary rounded px-2 py-1 whitespace-nowrap focus:ring-2 focus:outline-none",
                isActive ? "bg-layer-1 font-medium text-primary" : "text-secondary hover:bg-layer-1"
              )
            }
          >
            {t(`planning.${view}`)}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        title={t("planning.configure")}
        aria-label={t("planning.configure")}
        disabled={isLoading || !!error}
        onClick={() => setOpen(true)}
        className="grid size-8 shrink-0 place-items-center rounded hover:bg-layer-1 disabled:opacity-40"
      >
        <Settings2 size={16} />
      </button>
      {open && <ProjectViewSettings preferences={preferences} save={save} close={() => setOpen(false)} />}
    </div>
  );
}
