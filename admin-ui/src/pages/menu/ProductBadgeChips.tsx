import type { ProductBadge } from './menu-page.shared';

export default function ProductBadgeChips({ badges = [] }: { badges?: ProductBadge[] }) {
  if (!badges.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-1" aria-label="Метки товара">
      {badges.slice(0, 3).map((badge) => (
        <span
          key={badge.id}
          title={badge.label}
          className="max-w-full truncate rounded-lg px-2 py-1 text-xs font-semibold"
          style={{ backgroundColor: badge.background, color: badge.foreground }}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
