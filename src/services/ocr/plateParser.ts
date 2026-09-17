/**
 * استخراج رقم اللوحة الأردنية من النص الخام الذي يقرأه محرك OCR.
 *
 * شكل اللوحة الأردنية (كما في الصور المرجعية):
 *
 *   ┌────────────┬─────────────┐
 *   │  الأردن    │     15      │   ← سطران: رمز المنطقة فوق والرقم تحت
 *   │  JORDAN    │   11000     │
 *   └────────────┴─────────────┘
 *
 *   ┌────────────┬─────────────┐
 *   │ الأردن     │ 15 - 11000  │   ← سطر واحد: رمز - رقم
 *   │ JORDAN     │             │
 *   └────────────┴─────────────┘
 *
 * في الحالتين: المربع الأيسر يحمل «الأردن / JORDAN» وهو ثابت ولا يُعدّ
 * جزءاً من الرقم، والرقم نفسه = رمز المنطقة (خانة أو خانتان) + الرقم
 * (4 إلى 6 خانات).
 *
 * الصيغة المعتمدة للإخراج: `رمز-رقم` مثل `15-11000`.
 */

/** أطوال رمز المنطقة والرقم في اللوحات الأردنية */
const REGION_MIN = 1
const REGION_MAX = 2
const NUMBER_MIN = 4
const NUMBER_MAX = 6

export interface ParsedPlate {
  /** الرقم المنسّق `رمز-رقم`، أو سلسلة فارغة إن تعذّر الاستخراج */
  plate: string
  /** مدى الثقة في التحليل نفسه (منفصل عن ثقة المحرك) */
  structureConfidence: number
}

/**
 * يُزيل الكلمات الثابتة على اللوحة حتى لا تختلط بالأرقام.
 * تُكتب أحياناً بأخطاء (JORDAM, J0RDAN) فنستخدم مطابقة متساهلة.
 */
function stripCountryMarks(text: string): string {
  return text
    .replace(/[jJ][o0O][rR][dD][aA4][nNmM]/g, ' ')
    .replace(/الاردن|الأردن|اﻷردن/g, ' ')
}

/** يحوّل الأرقام العربية-الهندية والفارسية إلى لاتينية */
function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0)
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660
    return String(code - base)
  })
}

/**
 * يبني الرقم من مجموعتَي أرقام: رمز المنطقة والرقم.
 * يقبل الترتيبين لأن OCR قد يقرأ السطرين بترتيب مقلوب.
 */
function combine(a: string, b: string): string | null {
  const isRegion = (s: string) => s.length >= REGION_MIN && s.length <= REGION_MAX
  const isNumber = (s: string) => s.length >= NUMBER_MIN && s.length <= NUMBER_MAX

  if (isRegion(a) && isNumber(b)) return `${a}-${b}`
  if (isRegion(b) && isNumber(a)) return `${b}-${a}`
  return null
}

/**
 * يفصل سلسلة رقمية واحدة طويلة إلى رمز + رقم.
 * مثال: `1511000` (7 خانات) → `15-11000`
 *
 * الترتيب مقصود: نُجرّب رقماً من 5 خانات أولاً لأنه الأشيع في اللوحات
 * الأردنية، ثم 6 ثم 4. بدون هذا الترتيب تُقسَّم `511000` إلى `51-1000`
 * بدل `5-11000` الأرجح.
 */
function splitSingleRun(run: string): string | null {
  const total = run.length

  for (const numberLength of [5, 6, 4]) {
    const regionLength = total - numberLength
    if (regionLength >= REGION_MIN && regionLength <= REGION_MAX) {
      return `${run.slice(0, regionLength)}-${run.slice(regionLength)}`
    }
  }
  return null
}

export function parseJordanianPlate(rawText: string): ParsedPlate {
  const cleaned = stripCountryMarks(toLatinDigits(rawText))
  const runs = cleaned.match(/\d+/g) ?? []

  if (runs.length === 0) {
    return { plate: '', structureConfidence: 0 }
  }

  // 1) مجموعتان متجاورتان بأطوال منطقية → الحالة المثالية (لوحة السطرين)
  for (let i = 0; i < runs.length - 1; i++) {
    const combined = combine(runs[i], runs[i + 1])
    if (combined) {
      return { plate: combined, structureConfidence: 0.9 }
    }
  }

  // أطول سلسلة رقمية — المرشّح الأقوى لأن يكون هو اللوحة
  const longest = runs.reduce(
    (best, current) => (current.length > best.length ? current : best),
    '',
  )

  // 2) سلسلة متصلة طويلة → لوحة السطر الواحد قُرئت بلا فاصل
  //
  // الحد الأدنى للقسمة ست خانات: رمز من خانة + رقم من خمس خانات.
  // سلسلة من خمس خانات لا تُقسَّم لأن الأرجح أنها الرقم وحده ولم يُقرأ
  // رمز المنطقة — وقسمتها تُنتج `1-1000` بدل `11000` الصحيح.
  const MIN_SPLITTABLE = REGION_MIN + 5

  if (longest.length >= MIN_SPLITTABLE) {
    const split = splitSingleRun(longest)
    if (split) return { plate: split, structureConfidence: 0.7 }
  }

  // 3) رقم وحده بلا رمز منطقة (لم يُقرأ الرمز) → يعرضه المشغّل ويكمله
  if (longest.length >= NUMBER_MIN) {
    return { plate: longest, structureConfidence: 0.45 }
  }

  // 4) لم نصل إلى شكل معقول
  return { plate: '', structureConfidence: 0 }
}
