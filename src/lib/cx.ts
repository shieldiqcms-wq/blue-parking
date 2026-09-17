/** دمج أصناف CSS مع تجاهل القيم الفارغة */
export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ')
}
