import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import { uploadMenuPhoto, type MenuPhotoTarget } from '../lib/menu-photo-api';

export type MenuPhotoJob = MenuPhotoTarget & {
  id: number;
  name: string;
  file: File;
  preview: string;
  status: 'uploading' | 'done' | 'error';
  imageUrl?: string;
  error?: string;
};
type Uploads = {
  jobs: MenuPhotoJob[];
  enqueue: (target: MenuPhotoTarget, file: File, name: string) => void;
};
const Context = createContext<Uploads | null>(null);

// The provider lives above routes: changing a page never owns/cancels a transfer.
export function MenuPhotoUploadsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<MenuPhotoJob[]>([]);
  const current = useRef<MenuPhotoJob[]>([]);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.current.forEach((job) => URL.revokeObjectURL(job.preview));
    };
  }, []);
  const update = (next: MenuPhotoJob[]) => {
    current.current = next;
    if (mounted.current) setJobs(next);
  };
  const run = async (job: MenuPhotoJob) => {
    update(
      current.current.map((item) =>
        item.id === job.id ? { ...item, status: 'uploading', error: undefined } : item,
      ),
    );
    try {
      const result = await uploadMenuPhoto(job.file, job);
      if (!result.success || !result.imageUrl)
        throw new Error('Фото не сохранено. Повторите загрузку.');
      if (!mounted.current) return;
      update(
        current.current.map((item) =>
          item.id === job.id ? { ...item, status: 'done', imageUrl: result.imageUrl } : item,
        ),
      );
    } catch (error) {
      if (!mounted.current) return;
      update(
        current.current.map((item) =>
          item.id === job.id
            ? {
                ...item,
                status: 'error',
                error: error instanceof Error ? error.message : 'Не удалось загрузить фото',
              }
            : item,
        ),
      );
    }
  };
  const enqueue: Uploads['enqueue'] = (target, file, name) => {
    const same = (job: MenuPhotoJob) =>
      job.profileKey === target.profileKey &&
      job.targetType === target.targetType &&
      job.targetId === target.targetId;
    if (current.current.some((job) => same(job) && job.status === 'uploading')) return;
    current.current.filter(same).forEach((job) => URL.revokeObjectURL(job.preview));
    const job: MenuPhotoJob = {
      ...target,
      file,
      name,
      id: ++sequence.current,
      preview: URL.createObjectURL(file),
      status: 'uploading',
    };
    update([...current.current.filter((item) => !same(item)), job]);
    void run(job);
  };
  const dismiss = (job: MenuPhotoJob) => {
    URL.revokeObjectURL(job.preview);
    update(current.current.filter((item) => item.id !== job.id));
  };

  return (
    <Context.Provider value={{ jobs, enqueue }}>
      {children}
      {jobs.length > 0 && (
        <aside
          aria-label="Загрузки фото"
          className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-amber-200 bg-white p-4 shadow-xl"
        >
          <h2 className="mb-2 text-sm font-semibold">Загрузки фото</h2>
          <p className="mb-3 text-xs text-gray-600">
            Можно переходить между разделами — загрузка продолжится.
          </p>
          <div className="max-h-64 space-y-3 overflow-auto">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-start gap-2">
                <img src={job.preview} alt="" className="h-10 w-10 rounded-lg object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{job.name}</p>
                  <p
                    role="status"
                    className={job.status === 'error' ? 'text-red-700' : 'text-gray-600'}
                  >
                    {job.status === 'uploading'
                      ? 'Загрузка и сохранение…'
                      : job.status === 'done'
                        ? 'Фото сохранено'
                        : job.error}
                  </p>
                  {job.status === 'error' && (
                    <button
                      type="button"
                      className="min-h-11 underline"
                      onClick={() => void run(job)}
                    >
                      Повторить
                    </button>
                  )}
                </div>
                {job.status === 'uploading' ? (
                  <LoaderCircle aria-hidden="true" className="spin mt-1 shrink-0" size={18} />
                ) : (
                  <>
                    {job.status === 'done' && (
                      <Check
                        aria-hidden="true"
                        className="mt-1 shrink-0 text-green-700"
                        size={18}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={`Убрать загрузку ${job.name}`}
                      onClick={() => dismiss(job)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-gray-100"
                    >
                      <X size={18} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
    </Context.Provider>
  );
}

export function useMenuPhotoUploads() {
  const value = useContext(Context);
  if (!value) throw new Error('MenuPhotoUploadsProvider is required');
  return value;
}
