import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { ApiError, api } from '../../lib/api';
import type {
  TaplinkAdminPage,
  TaplinkBlock,
  TaplinkDocument,
  TaplinkLocale,
} from '../../lib/api-types';
import { useI18n } from '../../lib/i18n';
import { useNavigationBlocker } from '../../lib/router';
import {
  createTaplinkBlock,
  duplicateTaplinkBlock,
  moveTaplinkBlock,
  reorderTaplinkBlock,
  taplinkFingerprint,
  withTaplinkBlocks,
} from './taplink.helpers';
import type { TaplinkBuilderActions, TaplinkBuilderState, TaplinkSelection } from './taplink.types';

const isConflict = (error: unknown) =>
  error instanceof ApiError && (error.status === 409 || error.code === 'TAPLINK_VERSION_CONFLICT');

export function useTaplinkBuilder(): {
  loading: boolean;
  error: string;
  state: TaplinkBuilderState | null;
  actions: TaplinkBuilderActions;
} {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<TaplinkAdminPage | null>(null);
  const [document, setDocument] = useState<TaplinkDocument | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [activeLocale, setActiveLocale] = useState<TaplinkLocale>('kk');
  const [selected, setSelected] = useState<TaplinkSelection>('page');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const pageRef = useRef<TaplinkAdminPage | null>(null);
  const documentRef = useRef<TaplinkDocument | null>(null);
  const dirtyRef = useRef(false);

  const applyPage = useCallback((nextPage: TaplinkAdminPage, replaceDocument = true) => {
    pageRef.current = nextPage;
    setPage(nextPage);
    if (replaceDocument) {
      documentRef.current = nextPage.draft;
      setDocument(nextPage.draft);
    }
    setSavedFingerprint(taplinkFingerprint(nextPage.draft));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.getTaplink();
      applyPage(response.page);
      setActiveLocale(response.page.draft.defaultLocale);
      setSelected('page');
      setConflict(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [applyPage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => Boolean(document && taplinkFingerprint(document) !== savedFingerprint),
    [document, savedFingerprint],
  );
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  useNavigationBlocker(dirty, (nextLocation) => {
    if (
      !dirtyRef.current ||
      nextLocation.pathname === window.location.pathname.replace('/admin', '')
    )
      return true;
    return window.confirm(t('common.unsavedBody'));
  });

  const updateDocument = useCallback((updater: (current: TaplinkDocument) => TaplinkDocument) => {
    setDocument((current) => {
      if (!current) return current;
      const next = updater(current);
      documentRef.current = next;
      return next;
    });
  }, []);

  const persistDraft = useCallback(
    async (showToast = true) => {
      const currentPage = pageRef.current;
      const currentDocument = documentRef.current;
      if (!currentPage || !currentDocument) return false;
      const snapshotFingerprint = taplinkFingerprint(currentDocument);
      if (snapshotFingerprint === savedFingerprint) return true;

      setSaving(true);
      try {
        const response = await api.saveTaplinkDraft(currentDocument, currentPage.draftRevision);
        const unchangedDuringRequest =
          taplinkFingerprint(documentRef.current ?? currentDocument) === snapshotFingerprint;
        applyPage(response.page, unchangedDuringRequest);
        if (showToast) toast(t('taplink.saved'));
        setConflict(false);
        return true;
      } catch (caught) {
        if (isConflict(caught)) {
          setConflict(true);
          toast(t('taplink.conflictTitle'), 'error');
        } else {
          toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [applyPage, savedFingerprint, t, toast],
  );

  const publish = useCallback(async () => {
    if (!pageRef.current || !documentRef.current) return;
    setPublishing(true);
    try {
      if (dirtyRef.current && !(await persistDraft(false))) return;
      const currentPage = pageRef.current;
      if (!currentPage) return;
      const response = await api.publishTaplink(currentPage.draftRevision);
      applyPage(response.page);
      setConflict(false);
      toast(t('taplink.publishedSuccess'));
    } catch (caught) {
      if (isConflict(caught)) {
        setConflict(true);
        toast(t('taplink.conflictTitle'), 'error');
      } else {
        toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
      }
    } finally {
      setPublishing(false);
    }
  }, [applyPage, persistDraft, t, toast]);

  const addBlock = useCallback(
    (type: TaplinkBlock['type']) => {
      const block = createTaplinkBlock(type);
      updateDocument((current) => withTaplinkBlocks(current, [...current.blocks, block]));
      setSelected(block.id);
    },
    [updateDocument],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      updateDocument((current) => {
        const index = current.blocks.findIndex((block) => block.id === id);
        if (index < 0) return current;
        const copy = duplicateTaplinkBlock(current.blocks[index]);
        const blocks = [...current.blocks];
        blocks.splice(index + 1, 0, copy);
        setSelected(copy.id);
        return withTaplinkBlocks(current, blocks);
      });
    },
    [updateDocument],
  );

  const removeBlock = useCallback(
    (id: string) => {
      updateDocument((current) =>
        withTaplinkBlocks(
          current,
          current.blocks.filter((block) => block.id !== id),
        ),
      );
      setSelected((current) => (current === id ? 'page' : current));
    },
    [updateDocument],
  );

  const moveBlock = useCallback(
    (id: string, direction: -1 | 1) =>
      updateDocument((current) =>
        withTaplinkBlocks(current, moveTaplinkBlock(current.blocks, id, direction)),
      ),
    [updateDocument],
  );

  const reorderBlock = useCallback(
    (sourceId: string, targetId: string) =>
      updateDocument((current) =>
        withTaplinkBlocks(current, reorderTaplinkBlock(current.blocks, sourceId, targetId)),
      ),
    [updateDocument],
  );

  const actions = useMemo<TaplinkBuilderActions>(
    () => ({
      setActiveLocale,
      select: setSelected,
      updateDocument,
      addBlock,
      duplicateBlock,
      removeBlock,
      moveBlock,
      reorderBlock,
      saveDraft: () => persistDraft(true),
      publish,
      reload: load,
    }),
    [
      addBlock,
      duplicateBlock,
      load,
      moveBlock,
      persistDraft,
      publish,
      removeBlock,
      reorderBlock,
      updateDocument,
    ],
  );

  return {
    loading,
    error,
    state:
      page && document
        ? {
            page,
            document,
            activeLocale,
            selected,
            dirty,
            saving,
            publishing,
            conflict,
          }
        : null,
    actions,
  };
}
