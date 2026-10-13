import { useEffect, useRef, useState } from 'react';
import { loadFortune, saveCampaign } from './api';
import { mergeCampaign } from './merge-campaign';
import { campaignInput, validationMessage, type Campaign, type Text } from './model';

type Conflict = ReturnType<typeof mergeCampaign>;
const versionConflict = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'FORTUNE_VERSION_CONFLICT';

export function useCampaignEditor(campaign: Campaign, text: Text, onSaved: () => void) {
  const [base, setBase] = useState<Campaign>(() => structuredClone(campaign));
  const [draft, setDraft] = useState<Campaign>(() => structuredClone(campaign));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
    };
  }, []);
  const dirty = JSON.stringify(campaignInput(draft)) !== JSON.stringify(campaignInput(base));

  const latestCampaign = async (id: string, signal: AbortSignal) => {
    const latest = (await loadFortune(signal)).campaigns.find((current) => current.id === id);
    signal.throwIfAborted();
    if (!latest) throw new Error(text('Акция больше недоступна.', 'Акция енді қолжетімсіз.'));
    return latest;
  };
  const refreshDraft = (original: Campaign, edited: Campaign, latest: Campaign) => {
    const merged = mergeCampaign(original, edited, latest, text);
    setBase(latest);
    setDraft(merged.mine);
    if (merged.conflicts.length) setConflict(merged);
    if (merged.issue) {
      setError(merged.issue);
      return null;
    }
    if (merged.conflicts.length) return null;
    return merged.mine;
  };
  const valid = (value: Campaign) => {
    const message = validationMessage(value, text);
    if (message) setError(message);
    return !message;
  };
  const save = async () => {
    if (controllerRef.current || conflict || !valid(draft)) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError('');
    let candidate = draft;
    let original = base;
    try {
      if (draft.id) {
        const latest = await latestCampaign(draft.id, controller.signal);
        const merged = refreshDraft(base, draft, latest);
        if (!merged || !valid(merged)) return;
        candidate = merged;
        original = latest;
      }
      try {
        await saveCampaign(candidate.id, campaignInput(candidate), controller.signal);
      } catch (caught) {
        if (!candidate.id || !versionConflict(caught)) throw caught;
        controller.signal.throwIfAborted();
        const latest = await latestCampaign(candidate.id, controller.signal);
        const merged = refreshDraft(original, candidate, latest);
        if (!merged || !valid(merged)) return;
        // One race may be reconciled. A second race keeps the draft for the
        // next explicit Save; never loop or bypass the server's version check.
        await saveCampaign(merged.id, campaignInput(merged), controller.signal);
      }
      if (!controller.signal.aborted && mounted.current) onSaved();
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(
        versionConflict(caught)
          ? text(
              'Настройки снова изменились. Ваши правки остались в этом окне. Нажмите «Сохранить настройки» ещё раз.',
              'Баптаулар қайта өзгерді. Түзетулеріңіз осы терезеде сақталды. «Баптауларды сақтау» түймесін қайта басыңыз.',
            )
          : caught instanceof Error
            ? caught.message
            : text('Не удалось сохранить акцию.', 'Акция сақталмады.'),
      );
    } finally {
      controllerRef.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const resolve = (choice: 'mine' | 'theirs') => {
    if (!conflict) return;
    setDraft(conflict[choice]);
    setConflict(null);
    setError('');
  };
  return { draft, setDraft, busy, error, dirty, conflict, resolve, save };
}
