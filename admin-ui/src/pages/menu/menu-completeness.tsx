import IncompleteDescription, {
  hasIncompleteProductText,
} from '../../components/IncompleteDescription';
import {
  compareMenuNames,
  resolvedProductName,
  type IikoProduct,
  type ProductOverride,
} from './menu-page.shared';

const completenessProps = (product: IikoProduct, override?: ProductOverride) => ({
  descriptions: [
    product.descriptionRu,
    override?.custom_description,
    override?.description_translations?.ru,
    product.description,
  ],
  kazakh: product.descriptionKk || override?.description_translations?.kk,
  russianName: resolvedProductName(product, override),
  kazakhName: product.nameKk || override?.name_translations?.kk,
});

export function MenuIncompleteDescription({
  product,
  override,
}: {
  product: IikoProduct;
  override?: ProductOverride;
}) {
  return <IncompleteDescription {...completenessProps(product, override)} />;
}

export function sortMenuProductsByCompleteness(
  products: IikoProduct[],
  overrides: Record<string, ProductOverride>,
) {
  const incompleteById = new Map(
    products.map((product) => [
      product.id,
      hasIncompleteProductText(completenessProps(product, overrides[product.id])),
    ]),
  );
  return [...products].sort((left, right) => {
    const hiddenComparison =
      Number(Boolean(overrides[left.id]?.is_hidden)) -
      Number(Boolean(overrides[right.id]?.is_hidden));
    const incompleteComparison =
      Number(incompleteById.get(right.id)) - Number(incompleteById.get(left.id));
    return (
      hiddenComparison ||
      incompleteComparison ||
      compareMenuNames(
        resolvedProductName(left, overrides[left.id]),
        resolvedProductName(right, overrides[right.id]),
      )
    );
  });
}
