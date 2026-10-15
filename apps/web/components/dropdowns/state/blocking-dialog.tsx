import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { X } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { APIService } from "@/services/api.service";
import { planningInputClass } from "@/components/project/view-controls";

type Blocker = { id: string; name: string; project_id?: string; project__name?: string; project__identifier?: string; sequence_id?: number; state__name?: string };
type Page = { results: Blocker[]; count: number; next_cursor: number | null };
class BlockingAPIService extends APIService {
  constructor() { super(API_BASE_URL); }
}
const api = new BlockingAPIService();

export function BlockingDialog({ workspace, project, issueId, close, save, allowClear = false }: { workspace: string; project: string; issueId?: string; close: () => void; save: (ids: string[], version?: string) => Promise<void> | void; allowClear?: boolean }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const [chosen, setChosen] = useState<Record<string, Blocker> | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const { data: snapshot, error: originalError, mutate: reload } = useSWR(issueId ? ["blocking-dialog", workspace, project, issueId] : null, async () => {
    const [relations, task] = await Promise.all([api.get(`/api/workspaces/${workspace}/projects/${project}/issues/${issueId}/issue-relation/`), api.get(`/api/workspaces/${workspace}/projects/${project}/issues/${issueId}/`, { params: { fields: "id,updated_at" } })]);
    return { items: relations.data.blocked_by as Blocker[], version: task.data.updated_at as string };
  });
  const original = snapshot?.items;
  const { data, error: searchError, size, setSize, isValidating } = useSWRInfinite<Page>((index, previous: Page | null) => previous?.next_cursor === null ? null : ["blocking-work-items", workspace, issueId, query, index ? previous?.next_cursor : 0], async (key: [string, string, string | undefined, string, number]) => (await api.get(`/api/workspaces/${workspace}/blocking-work-items/`, { params: { search: key[3], cursor: key[4], exclude: issueId } })).data);
  const selection = chosen ?? Object.fromEntries((original ?? []).map((item) => [item.id, item]));
  const items = data?.flatMap((page) => page.results) ?? [];
  const clear = Object.keys(selection).length === 0 && (!!original?.length || allowClear);
  const submit = async () => {
    setBusy(true); setError(undefined);
    try { await save(Object.keys(selection), snapshot?.version); close(); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}><DialogContent size="md"><DialogMain><DialogHeader><DialogTitle>{t("issue.relation.blocked_by")}</DialogTitle></DialogHeader><DialogBody>
    <div className="space-y-3">
      <ul className="divide-y divide-subtle">{Object.values(selection).map((item) => <li key={item.id} className="flex items-start gap-2 py-2 text-13"><span className="min-w-0 flex-1 break-words">{item.name}</span><button type="button" className="size-7 shrink-0 p-1" aria-label={`${t("remove")}: ${item.name}`} disabled={busy} onClick={() => setChosen(Object.fromEntries(Object.entries(selection).filter(([id]) => id !== item.id)))}><X size={16} /></button></li>)}</ul>
      <label className="flex flex-col gap-1 text-13">{t("search")}<input className={planningInputClass} value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} /></label>
      <div className="max-h-56 overflow-auto">{items.filter((item) => !selection[item.id]).map((item) => <label key={item.id} aria-label={`${item.project__identifier}-${item.sequence_id} ${item.name}`} className="flex cursor-pointer items-start gap-2 border-b border-subtle py-2 text-13"><input type="checkbox" checked={false} disabled={busy || search.trim() !== query} onChange={() => setChosen({ ...selection, [item.id]: item })} /><span className="min-w-0"><span className="block break-words">{item.project__identifier}-{item.sequence_id} / {item.name}</span><span className="text-12 text-secondary">{item.project__name} / {item.state__name}</span></span></label>)}</div>
      {isValidating && <p role="status" className="text-12 text-secondary">{t("loading")}</p>}
      {data?.at(-1)?.next_cursor != null && <Button size="sm" variant="secondary" stretch="auto" label={t("load_more")} disabled={isValidating || busy} onClick={() => void setSize(size + 1)} />}
      {clear && <label className="flex items-start gap-2 text-13"><input type="checkbox" checked={confirmClear} onChange={(event) => setConfirmClear(event.target.checked)} />{t("planning.clear_blockers")}</label>}
      {(error || searchError || originalError) && <p role="alert" className="text-13 text-danger-primary">{t("planning.error")}</p>}
      {!!error && issueId && <Button size="sm" variant="secondary" stretch="auto" label={t("refresh")} disabled={busy} onClick={() => { void reload(); setChosen(null); setError(undefined); }} />}
      <div className="flex justify-end gap-2"><Button size="md" variant="secondary" stretch="auto" label={t("cancel")} disabled={busy} onClick={close} /><Button size="md" variant="primary" stretch="auto" label={t("save")} disabled={busy || !!originalError || (!!issueId && !original) || (!Object.keys(selection).length && (!clear || !confirmClear))} onClick={() => void submit()} /></div>
    </div>
  </DialogBody></DialogMain></DialogContent></Dialog>;
}