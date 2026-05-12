/** Format calendar `YYYY-MM-DD` as dd/mm/yyyy for display. */
export function formatIsoDateDdMmYyyy(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
