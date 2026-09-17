/**
 * تصدير CSV يفتح مباشرة في Excel بترميز عربي سليم.
 *
 * ملاحظتان تقنيتان:
 *  1) BOM في بداية الملف حتى يقرأ Excel الترميز UTF-8 بشكل صحيح.
 *  2) الفاصلة المنقوطة ( ; ) كفاصل حقول لأنها الفاصل الافتراضي
 *     في نسخ Excel العربية/الأوروبية.
 */

const BOM = '﻿'
const SEPARATOR = ';'

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''

  let text = String(value)

  // منع حقن الصيغ في Excel (CSV injection)
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }

  if (
    text.includes(SEPARATOR) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}

export interface CsvColumn<T> {
  /** العنوان العربي الظاهر في Excel */
  header: string
  /** استخراج قيمة الخلية من الصف */
  value: (row: T) => unknown
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(SEPARATOR)
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(c.value(row))).join(SEPARATOR),
  )
  return BOM + [head, ...body].join('\r\n')
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // إعطاء المتصفح مهلة قبل تحرير الرابط
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  downloadCsv(filename, buildCsv(rows, columns))
}
