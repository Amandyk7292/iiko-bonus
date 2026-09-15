type ProductTextCompleteness = {
  descriptions: Array<string | null | undefined>;
  kazakh?: string | null;
  russianName?: string | null;
  kazakhName?: string | null;
};

const hasText = (value?: string | null) =>
  Boolean(
    value
      ?.replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim(),
  );

export function hasIncompleteProductText({
  descriptions,
  kazakh,
  russianName,
  kazakhName,
}: ProductTextCompleteness) {
  return (
    !descriptions.some(hasText) ||
    !hasText(kazakh) ||
    (hasText(russianName) && !hasText(kazakhName))
  );
}

export default function IncompleteDescription(props: ProductTextCompleteness) {
  if (!hasIncompleteProductText(props)) return null;
  return (
    <p
      className="mt-1 text-xs font-semibold text-red-600"
      title="Заполните описание на русском и казахском и название на казахском"
    >
      Неполное описание
    </p>
  );
}
