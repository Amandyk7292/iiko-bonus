import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useMenuPhotoUploads } from '../../components/MenuPhotoUploads';
import { useAdminRealtimeEvents } from '../../lib/admin-realtime';
import type { CategoryOverride, IikoGroup, IikoProduct, ProductOverride } from './menu-page.shared';

type Options = {
  activeProfileKey?: string;
  selectedBranchId: string;
  rawProducts: IikoProduct[];
  rawGroups: IikoGroup[];
  productOverrides: Record<string, ProductOverride>;
  categoryOverrides: Record<string, CategoryOverride>;
  setProductOverrides: Dispatch<SetStateAction<Record<string, ProductOverride>>>;
  setCategoryOverrides: Dispatch<SetStateAction<Record<string, CategoryOverride>>>;
  fetchMenu: (silent?: boolean) => Promise<void>;
  toast: (message: string, tone: 'error') => void;
};
export function useMenuPhotos({
  activeProfileKey,
  selectedBranchId,
  rawProducts,
  rawGroups,
  productOverrides,
  categoryOverrides,
  setProductOverrides,
  setCategoryOverrides,
  fetchMenu,
  toast,
}: Options) {
  const uploads = useMenuPhotoUploads();
  const seenUploads = useRef(
    new Set(uploads.jobs.filter((job) => job.status === 'done').map((job) => job.id)),
  );
  const liveRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useAdminRealtimeEvents(['menu.updated', 'connected'], (event) => {
    if (event.data?.inventory === true) return;
    if (activeProfileKey && event.data?.profileKey && event.data.profileKey !== activeProfileKey)
      return;
    clearTimeout(liveRefreshTimer.current);
    liveRefreshTimer.current = setTimeout(() => void fetchMenu(true), 250);
  });
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void fetchMenu(true);
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(liveRefreshTimer.current);
      window.clearInterval(interval);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fetchMenu]);

  useEffect(() => {
    let changed = false;
    for (const job of uploads.jobs) {
      if (job.status !== 'done' || seenUploads.current.has(job.id)) continue;
      seenUploads.current.add(job.id);
      if (job.profileKey !== activeProfileKey && job.branchId !== selectedBranchId) continue;
      changed = true;
      if (job.targetType === 'product') {
        setProductOverrides((previous) => ({
          ...previous,
          [job.targetId]: {
            ...previous[job.targetId],
            iiko_product_id: job.targetId,
            custom_image_url: job.imageUrl,
          },
        }));
      } else {
        setCategoryOverrides((previous) => ({
          ...previous,
          [job.targetId]: {
            ...previous[job.targetId],
            iiko_category_id: job.targetId,
            custom_image_url: job.imageUrl,
          },
        }));
      }
    }
    if (changed) void fetchMenu(true);
  }, [uploads.jobs, activeProfileKey, selectedBranchId, fetchMenu]);

  const queuePhoto = (
    targetType: 'product' | 'category',
    targetId: string,
    file: File,
    name: string,
  ) => {
    if (!activeProfileKey || !selectedBranchId) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      toast('Выберите JPEG, PNG или WebP размером до 5 МБ', 'error');
      return;
    }
    uploads.enqueue(
      { targetType, targetId, profileKey: activeProfileKey, branchId: selectedBranchId },
      file,
      name,
    );
  };
  const handleUploadPhoto = (id: string, file: File) =>
    queuePhoto(
      'product',
      id,
      file,
      productOverrides[id]?.custom_name ||
        rawProducts.find((product) => product.id === id)?.name ||
        'Фото товара',
    );
  const handleUploadCategoryPhoto = (id: string, file: File) =>
    queuePhoto(
      'category',
      id,
      file,
      categoryOverrides[id]?.custom_name ||
        rawGroups.find((group) => group.id === id)?.name ||
        'Фото категории',
    );
  const photoUpload = (type: 'product' | 'category', id: string) =>
    uploads.jobs.find(
      (job) =>
        job.targetType === type &&
        job.targetId === id &&
        job.profileKey === activeProfileKey &&
        job.status === 'uploading',
    );

  return { handleUploadPhoto, handleUploadCategoryPhoto, photoUpload };
}
