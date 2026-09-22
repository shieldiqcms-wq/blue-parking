/**
 * تجميع المبالغ حسب طريقة الدفع (نقدي / تحويل / أخرى).
 *
 * تُجمع كل القيود كما هي — بما فيها قيود التصحيح السالبة — فيكون الناتج
 * صافي ما قُبض فعلاً بكل طريقة.
 */

export interface MethodTotals {
  cash: number
  transfer: number
  other: number
}

export const EMPTY_METHODS: MethodTotals = { cash: 0, transfer: 0, other: 0 }

const round2 = (n: number) => Math.round(n * 100) / 100

export function addToMethods(
  totals: MethodTotals,
  amount: number | string,
  method: string | null | undefined,
): MethodTotals {
  const value = Number(amount) || 0
  const key: keyof MethodTotals =
    method === 'cash' ? 'cash' : method === 'transfer' ? 'transfer' : 'other'
  return { ...totals, [key]: round2(totals[key] + value) }
}

export function sumByMethod(
  rows: Array<{ amount: number | string; payment_method: string | null }>,
): MethodTotals {
  return rows.reduce((t, r) => addToMethods(t, r.amount, r.payment_method), EMPTY_METHODS)
}

export function mergeMethods(a: MethodTotals, b: MethodTotals): MethodTotals {
  return {
    cash: round2(a.cash + b.cash),
    transfer: round2(a.transfer + b.transfer),
    other: round2(a.other + b.other),
  }
}

export function methodsTotal(t: MethodTotals): number {
  return round2(t.cash + t.transfer + t.other)
}

/** الطرق التي عليها مبلغ فعلي (يُتجاهل الصفر الناتج عن قيود التصحيح) */
export function activeMethods(t: MethodTotals): Array<keyof MethodTotals> {
  return (['cash', 'transfer', 'other'] as const).filter((k) => Math.abs(t[k]) >= 0.005)
}
