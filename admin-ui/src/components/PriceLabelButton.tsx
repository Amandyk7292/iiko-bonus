import { useState } from 'react';
import { Printer } from 'lucide-react';
import { loadPriceLabelSettings } from '../lib/price-label-settings';
import PriceLabelModal from './PriceLabelModal';
import {
  labelHex,
  LABEL_BACKGROUND,
  LABEL_BACKGROUND_KEY,
  type PriceLabelDraft,
} from '../lib/price-label';

interface Props {
  id?: string;
  name: string;
  price: number;
  details?: {
    name_translations?: Record<string, string>;
    ingredients?: string | null;
    ingredients_translations?: Record<string, string>;
  };
}

export default function PriceLabelButton({ id, name, price, details }: Props) {
  const [draft, setDraft] = useState<PriceLabelDraft | null>(null);
  const [includeQr, setIncludeQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      const saved = await loadPriceLabelSettings();
      setIncludeQr(saved.includeQr);
      let background = LABEL_BACKGROUND;
      try {
        background = labelHex(localStorage.getItem(LABEL_BACKGROUND_KEY) || '') || background;
      } catch {
        /* Printing also works when storage is unavailable. */
      }
      background = labelHex(saved.background) || background;
      setDraft({
        nameRu: name,
        nameKk: details?.name_translations?.kk || '',
        price: String(price),
        ingredientsRu: details?.ingredients || details?.ingredients_translations?.ru || '',
        ingredientsKk: details?.ingredients_translations?.kk || '',
        background,
      });
    } catch {
      setError('Не удалось загрузить настройки ценника. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn-outline compact-button gap-1 text-xs"
        aria-label={`Ценник: ${name}`}
        disabled={busy}
        onClick={() => void open()}
      >
        <Printer aria-hidden="true" size={16} /> Ценник
      </button>
      {error && <span role="alert">{error}</span>}
      {draft && (
        <PriceLabelModal
          initialIncludeQr={includeQr}
          productId={id}
          initial={draft}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
