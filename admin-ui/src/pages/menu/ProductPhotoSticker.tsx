import type { ProductBadge } from './menu-page.shared';

export function ProductStickerThumbnail({
  imageUrl,
  name,
  badges,
}: {
  imageUrl: string;
  name: string;
  badges?: ProductBadge[];
}) {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
      <img
        src={imageUrl}
        alt={name}
        width="64"
        height="64"
        className="h-full w-full object-cover"
        loading="lazy"
      />
      <div className="absolute left-0 top-0">
        <ProductPhotoSticker badges={badges} size={32} />
      </div>
    </div>
  );
}

export default function ProductPhotoSticker({
  badges = [],
  size = 80,
}: {
  badges?: ProductBadge[];
  size?: number;
}) {
  const sticker = badges.find((badge) => badge.imageUrl);
  if (!sticker) return null;
  return (
    <img
      key={sticker.imageUrl}
      src={sticker.imageUrl}
      alt={sticker.label}
      width={size}
      height={size}
      className="pointer-events-none block max-w-full object-contain"
      loading="lazy"
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}
