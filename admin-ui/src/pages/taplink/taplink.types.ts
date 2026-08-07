import type {
  TaplinkAdminPage,
  TaplinkBlock,
  TaplinkDocument,
  TaplinkLocale,
} from '../../lib/api-types';

export type TaplinkSelection = 'page' | string;

export interface TaplinkBuilderState {
  page: TaplinkAdminPage;
  document: TaplinkDocument;
  activeLocale: TaplinkLocale;
  selected: TaplinkSelection;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  conflict: boolean;
}

export interface TaplinkBuilderActions {
  setActiveLocale: (locale: TaplinkLocale) => void;
  select: (selection: TaplinkSelection) => void;
  updateDocument: (updater: (document: TaplinkDocument) => TaplinkDocument) => void;
  addBlock: (type: TaplinkBlock['type']) => void;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  moveBlock: (id: string, direction: -1 | 1) => void;
  reorderBlock: (sourceId: string, targetId: string) => void;
  saveDraft: () => Promise<boolean>;
  publish: () => Promise<void>;
  reload: () => Promise<void>;
}
