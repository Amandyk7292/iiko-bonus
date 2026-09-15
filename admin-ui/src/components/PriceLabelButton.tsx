import { useState } from 'react';
import { Printer } from 'lucide-react';
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
  const open = () => {
    let background = LABEL_BACKGROUND;
    try {
      background = labelHex(localStorage.getItem(LABEL_BACKGROUND_KEY) || '') || background;
    } catch {
      /* Printing also works when storage is unavailable. */
    }
    setDraft({
      nameRu: name,
      nameKk: details?.name_translations?.kk || '',
      price: String(price),
      ingredientsRu: details?.ingredients || details?.ingredients_translations?.ru || '',
      ingredientsKk: details?.ingredients_translations?.kk || '',
      background,
    });
  };
  return (
    <>
      <button
        type="button"
        className="btn-outline compact-button gap-1 text-xs"
        aria-label={`Ценник: ${name}`}
        onClick={open}
      >
        <Printer aria-hidden="true" size={16} /> Ценник
      </button>
      {draft && <PriceLabelModal productId={id} initial={draft} onClose={() => setDraft(null)} />}
    </>
  );
}
