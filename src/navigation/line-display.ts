/** Passenger-facing names only; IDs and imported source records keep their identity. */
export function transitDisplayText(value: string): string {
  return value.replace(/滨海快线\s*[（(][^）)]*[）)]/g, '滨海快线').replace(/\bF1(?:线)?/gi, '滨海快线')
}
export function lineDisplayCode(name: string): string {
  const label = transitDisplayText(name)
  return label.includes('滨海快线') ? 'BE' : label.replace('演示', '').replace('号线', '').slice(0, 2)
}
