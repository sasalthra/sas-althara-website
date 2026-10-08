/** Lowest listed price. Several prices are shown as «يبدأ من». */
export function formatListedPrice(value: number | null, priceFrom = false): string {
  if (value == null) return 'عند الطلب';
  const formatted = value.toLocaleString('ar-SA');
  return priceFrom ? `يبدأ من ${formatted}` : formatted;
}
