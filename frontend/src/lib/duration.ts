export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const remainder = total % 60
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`
}
