export function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

export function roundPercent(value: number): number {
  return Number(value.toFixed(2));
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
