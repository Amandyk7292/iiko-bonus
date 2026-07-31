export function isEmbeddedAdminPortal(search: string) {
  return new URLSearchParams(search).get('embedded') === 'app';
}
