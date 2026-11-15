export function displayMode(search: string, enabled: boolean, defaultLive = false) {
  const requested = new URLSearchParams(search).get('mode');
  return enabled && (requested === 'live' || (defaultLive && requested !== 'simulation'))
    ? 'live'
    : 'simulation';
}
