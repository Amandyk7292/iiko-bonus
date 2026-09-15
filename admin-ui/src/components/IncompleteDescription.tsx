export default function IncompleteDescription({
  descriptions,
  kazakh,
}: {
  descriptions: Array<string | null | undefined>;
  kazakh?: string | null;
}) {
  const filled = descriptions.some((value) =>
    value
      ?.replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim(),
  );
  const kazakhFilled = kazakh
    ?.replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
  if (filled && kazakhFilled) return null;
  return (
    <p
      className="mt-1 text-xs font-semibold text-red-600"
      title="Заполните описание товара на русском и казахском"
    >
      Неполное описание
    </p>
  );
}
