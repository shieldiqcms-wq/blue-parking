/**
 * كاتب ملفات Excel (.xlsx) — بلا أي مكتبة خارجية.
 *
 * لماذا لا CSV؟
 *   CSV في بيئة عربية على ويندوز يقع بين مشكلتين لا حل وسط بينهما:
 *     • بلا سطر `sep=` : Excel يستخدم فاصل النظام، وقد يضع كل البيانات
 *       في عمود واحد حسب إعدادات الجهاز.
 *     • مع سطر `sep=` : Excel يتجاهل علامة الترميز (BOM) ويقرأ الملف
 *       بترميز ويندوز، فيظهر العربي رموزاً مثل «Ø§Ù„ØªØ§Ø±ÙŠØ®».
 *   ملف xlsx حقيقي يتجاوز الاثنين: الترميز UTF-8 داخل XML، والأعمدة
 *   مُعرّفة في بنية الملف لا بفاصل نصي.
 *
 * كيف يعمل؟
 *   ملف xlsx هو أرشيف ZIP يحتوي ملفات XML. نبنيه هنا بطريقة STORED
 *   (بلا ضغط) فلا نحتاج مكتبة ضغط إطلاقاً — نحتاج فقط CRC32 وبنية ZIP.
 *   حجم التقارير صغير، فغياب الضغط لا يُلاحَظ.
 *
 * المزايا مقابل CSV:
 *   • العربي يظهر صحيحاً دائماً
 *   • الأعمدة منفصلة دائماً
 *   • الأرقام أرقام (تُجمع وتُفرز) والتواريخ تواريخ
 *   • اتجاه الورقة من اليمين لليسار
 *   • عرض الأعمدة مضبوط، وصف العناوين مجمّد
 */

/* ------------------------------ أنواع الأعمدة ------------------------------ */

export type CellValue = string | number | Date | null | undefined

export interface SheetColumn<T> {
  /** العنوان العربي في الصف الأول */
  header: string
  /** استخراج القيمة من الصف */
  value: (row: T) => CellValue
  /** نوع الخلية — يحدد التنسيق في Excel */
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime'
  /** عرض العمود بالأحرف */
  width?: number
}

/* --------------------------------- CRC32 --------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/* ---------------------------------- ZIP ---------------------------------- */

interface ZipEntry {
  name: string
  data: Uint8Array
  crc: number
}

const encoder = new TextEncoder()

function buildZip(files: Array<{ name: string; content: string }>): Blob {
  const entries: ZipEntry[] = files.map((f) => {
    const data = encoder.encode(f.content)
    return { name: f.name, data, crc: crc32(data) }
  })

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let offset = 0

  // ---- السجلات المحلية ----
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const header = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(header.buffer)

    view.setUint32(0, 0x04034b50, true) // توقيع
    view.setUint16(4, 20, true) // النسخة المطلوبة
    view.setUint16(6, 0x0800, true) // علم UTF-8 لأسماء الملفات
    view.setUint16(8, 0, true) // الطريقة: 0 = مخزّن بلا ضغط
    view.setUint16(10, 0, true) // وقت التعديل
    view.setUint16(12, 0, true) // تاريخ التعديل
    view.setUint32(14, entry.crc, true)
    view.setUint32(18, entry.data.length, true) // الحجم المضغوط
    view.setUint32(22, entry.data.length, true) // الحجم الأصلي
    view.setUint16(26, nameBytes.length, true)
    view.setUint16(28, 0, true) // حقل إضافي
    header.set(nameBytes, 30)

    offsets.push(offset)
    chunks.push(header, entry.data)
    offset += header.length + entry.data.length
  }

  // ---- الفهرس المركزي ----
  const centralStart = offset
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const nameBytes = encoder.encode(entry.name)
    const header = new Uint8Array(46 + nameBytes.length)
    const view = new DataView(header.buffer)

    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true) // نسخة المُنشئ
    view.setUint16(6, 20, true) // النسخة المطلوبة
    view.setUint16(8, 0x0800, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.data.length, true)
    view.setUint32(24, entry.data.length, true)
    view.setUint16(28, nameBytes.length, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 0, true)
    view.setUint32(38, 0, true)
    view.setUint32(42, offsets[i], true)
    header.set(nameBytes, 46)

    chunks.push(header)
    offset += header.length
  }

  // ---- نهاية الفهرس ----
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, offset - centralStart, true)
  endView.setUint32(16, centralStart, true)
  endView.setUint16(20, 0, true)
  chunks.push(end)

  return new Blob(chunks as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/* ---------------------------------- XML ---------------------------------- */

// محارف التحكم غير مسموحة في XML وترفضها Excel — نبني التعبير من نص
// حتى لا تبقى هذه المحارف مكتوبة حرفياً داخل الملف المصدري.
// الاستثناء أدناه مقصود: وجود محارف التحكم في هذا التعبير هو الغرض منه.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F]', 'g')

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(CONTROL_CHARS, '')
}

/** رقم العمود إلى حرفه — مثال: 1 يعطي A و 27 يعطي AA */
function columnLetter(index: number): string {
  let result = ''
  let n = index
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/**
 * تحويل التاريخ إلى الرقم التسلسلي الذي يفهمه Excel.
 *
 * المرجع 1899-12-30 (وليس 12-31) لأن Excel يعامل 1900 كسنة كبيسة خطأً
 * ويجب محاكاة هذا الخطأ ليتطابق الحساب.
 *
 * `dateOnly` يقطع جزء الوقت: خلية بتنسيق تاريخ يجب ألا تحمل كسراً، وإلا
 * ظهر وقت غير مقصود عند تغيير تنسيق الخلية في Excel.
 *
 * ملاحظة على المناطق الزمنية: Excel لا يعرف المناطق الزمنية إطلاقاً —
 * يخزّن ساعة حائط مجرّدة. لذلك يجب أن تصل التواريخ إلى هنا وقد حُوّلت
 * مسبقاً إلى توقيت الأردن (انظر toExcelDate في lib/format.ts).
 */
function excelSerial(date: Date, dateOnly: boolean): number {
  const serial = (date.getTime() - EXCEL_EPOCH) / 86400000
  return dateOnly ? Math.floor(serial) : serial
}

/* --------------------------------- الأنماط --------------------------------- */
// 0 = عادي · 1 = عنوان · 2 = مبلغ · 3 = تاريخ · 4 = تاريخ ووقت
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="0.00"/>
<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/>
<numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function styleFor(type: SheetColumn<unknown>['type']): number {
  switch (type) {
    case 'money':
      return 2
    case 'date':
      return 3
    case 'datetime':
      return 4
    default:
      return 0
  }
}

/* ------------------------------ بناء الورقة ------------------------------ */

function buildSheet<T>(rows: T[], columns: SheetColumn<T>[]): string {
  const cols = columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`,
    )
    .join('')

  // صف العناوين
  const headerCells = columns
    .map(
      (c, i) =>
        `<c r="${columnLetter(i + 1)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(c.header)}</t></is></c>`,
    )
    .join('')

  const bodyRows = rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2
      const cells = columns
        .map((col, colIndex) => {
          const ref = `${columnLetter(colIndex + 1)}${r}`
          const style = styleFor(col.type)
          const raw = col.value(row)

          if (raw === null || raw === undefined || raw === '') {
            return `<c r="${ref}" s="${style}"/>`
          }

          if (raw instanceof Date) {
            const serial = excelSerial(raw, col.type === 'date')
            return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`
          }

          if (
            typeof raw === 'number' ||
            col.type === 'number' ||
            col.type === 'money'
          ) {
            const num = typeof raw === 'number' ? raw : Number(raw)
            if (Number.isFinite(num)) {
              return `<c r="${ref}" s="${style}"><v>${num}</v></c>`
            }
          }

          return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(raw))}</t></is></c>`
        })
        .join('')
      return `<row r="${r}">${cells}</row>`
    })
    .join('')

  const lastCol = columnLetter(columns.length)
  const lastRow = rows.length + 1

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView rightToLeft="1" tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData><row r="1" ht="22" customHeight="1">${headerCells}</row>${bodyRows}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`
}

/* -------------------------------- التصدير -------------------------------- */

export interface SheetSpec<T> {
  /** اسم التبويب داخل الملف */
  name: string
  rows: T[]
  columns: SheetColumn<T>[]
}

/**
 * ينشئ ملف xlsx ويحمّله. يدعم أكثر من ورقة في نفس الملف.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exportXlsx(filename: string, sheets: SheetSpec<any>[]): void {
  if (sheets.length === 0) throw new Error('لا توجد بيانات للتصدير')

  const sheetFiles = sheets.map((sheet, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    content: buildSheet(sheet.rows, sheet.columns),
  }))

  const sheetEntries = sheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')

  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')

  const styleRelId = sheets.length + 1

  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<sheets>${sheetEntries}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRels}
<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheetFiles,
  ]

  const blob = buildZip(files)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
