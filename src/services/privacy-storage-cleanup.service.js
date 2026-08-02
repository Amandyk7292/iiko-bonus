const { supabase } = require('../config/supabase');

const MAX_CLEANUP_ITEMS = 500;
const MAX_PATH_LENGTH = 1000;

const normalizeCleanupItems = (items) => {
  const unique = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const bucket = String(item?.bucket || '')
      .trim()
      .slice(0, 100);
    const path = String(item?.path || '')
      .trim()
      .slice(0, MAX_PATH_LENGTH);
    if (!bucket || !path) continue;
    unique.set(`${bucket}\u0000${path}`, { bucket, path });
    if (unique.size >= MAX_CLEANUP_ITEMS) break;
  }
  return [...unique.values()];
};

async function enqueuePrivacyStorageCleanup(requestId, items, { db = supabase } = {}) {
  const normalized = normalizeCleanupItems(items);
  if (!normalized.length) return null;
  const { data, error } = await db
    .from('privacy_storage_cleanup_jobs')
    .insert({
      request_id: requestId,
      items: normalized,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    })
    .select('id,status')
    .single();
  if (error) throw error;
  return data;
}

async function removeCleanupItems(db, items) {
  const byBucket = new Map();
  for (const item of normalizeCleanupItems(items)) {
    if (!byBucket.has(item.bucket)) byBucket.set(item.bucket, []);
    byBucket.get(item.bucket).push(item.path);
  }
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await db.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) throw error;
    }
  }
}

const retryAtFor = (attempts, now = new Date()) => {
  const delayMinutes = Math.min(24 * 60, 2 ** Math.min(10, Math.max(0, attempts - 1)));
  return new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString();
};

async function processPrivacyStorageCleanupJobs(
  { limit = 10, jobId = null } = {},
  { db = supabase, now = () => new Date() } = {},
) {
  const { data, error } = await db.rpc('claim_privacy_storage_cleanup_jobs', {
    p_limit: Math.min(50, Math.max(1, Number(limit) || 10)),
    p_job_id: jobId,
  });
  if (error) throw error;
  const jobs = Array.isArray(data) ? data : data ? [data] : [];
  const summary = { claimed: jobs.length, completed: 0, failed: 0 };

  for (const job of jobs) {
    try {
      await removeCleanupItems(db, job.items);
      const { error: completeError } = await db
        .from('privacy_storage_cleanup_jobs')
        .update({
          status: 'completed',
          completed_at: now().toISOString(),
          processing_started_at: null,
          last_error: null,
          updated_at: now().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (completeError) throw completeError;
      summary.completed += 1;
    } catch (cleanupError) {
      const currentTime = now();
      const { error: failureError } = await db
        .from('privacy_storage_cleanup_jobs')
        .update({
          status: 'failed',
          next_attempt_at: retryAtFor(Number(job.attempts || 1), currentTime),
          processing_started_at: null,
          last_error: String(cleanupError.message || cleanupError).slice(0, 1000),
          updated_at: currentTime.toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (failureError) {
        console.error(
          'Не удалось сохранить ошибку очистки приватных файлов:',
          failureError.message,
        );
      }
      summary.failed += 1;
    }
  }
  return summary;
}

module.exports = {
  enqueuePrivacyStorageCleanup,
  normalizeCleanupItems,
  processPrivacyStorageCleanupJobs,
  removeCleanupItems,
  retryAtFor,
};
