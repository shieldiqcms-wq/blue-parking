/**
 * تصدير CSV يفتح مباشرة في Excel بأعمدة منفصلة وترميز عربي سليم.
 *
 * ثلاث نقاط تقنية تحلّ المشاكل الشائعة:
 *
 *  1) BOM في بداية الملف — بدونه يقرأ Excel الترميز خطأً فيظهر العربي رموزاً.
 *
 *  2) سطر التوجيه `sep=;` في أول الملف — هذا هو الحل لمشكلة «كل البيانات في
 *     عمود واحد». Excel يستخدم فاصل القائمة المضبوط في نظام ويندوز، وهو
 *     يختلف بين الأجهزة (فاصلة أو فاصلة منقوطة). سطر `sep=` يفرض على Excel
 *     استخدام الفاصل الصحيح بغض النظر عن إعدادات الجهاز.
 *
 *  3) نهايات أسطر CRLF — المتوقعة في Excel على ويندوز.
 *
 * ملاحظة: `sep=;` خاص بـ Excel. البرامج الأخرى (Google Sheets, LibreOffice)
 * قد تعرضه كصف أول — وهذا مقبول مقابل ضمان عمل Excel، وهو المستخدم فعلياً.
 */

const BOM = '﻿'
const SEPARATOR = ';'
const SEP_DIRECTIVE = `sep=${SEPARATOR}`
const EOL = '\r\n'

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
  return BOM + [SEP_DIRECTIVE, head, ...body].join(EOL) + EOL
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
