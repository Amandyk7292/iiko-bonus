import { ApiError, adminApiErrorMessage, applyAdminScopeHeaders } from './api';

export type MenuPhotoTarget = {
  targetType: 'product' | 'category';
  targetId: string;
  profileKey: string;
  branchId: string;
};

export async function uploadMenuPhoto(
  file: File,
  target: MenuPhotoTarget,
): Promise<{ success: boolean; imageUrl?: string }> {
  const endpoint = '/menu/upload-photo';
  const body = new FormData();
  body.append('image', file);
  body.append('targetType', target.targetType);
  body.append('targetId', target.targetId);
  body.append('profileKey', target.profileKey);
  const headers = new Headers();
  applyAdminScopeHeaders(headers, endpoint, target.branchId);
  const response = await fetch(`/admin/api${endpoint}`, {
    method: 'POST',
    headers,
    body,
    credentials: 'same-origin',
  }).catch(() => {
    throw new ApiError(
      'Нет связи с сервером. Проверьте интернет и повторите загрузку.',
      0,
      'NETWORK_ERROR',
    );
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = data.requestId || response.headers.get('x-request-id') || undefined;
    throw new ApiError(
      adminApiErrorMessage({ ...data, requestId }, response.status),
      response.status,
      data.code,
      data.details,
      requestId,
    );
  }
  return data;
}
