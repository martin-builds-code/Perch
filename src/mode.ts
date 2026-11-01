export function displayMode(search: string, enabled: boolean) {
  return enabled && new URLSearchParams(search).get('mode') === 'live'
    ? 'live'
    : 'simulation';
}
