import { Fragment, useEffect, useMemo, useRef, useState } from 'react'



const RECEIPT_DATE = new Date().toLocaleDateString('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
import './App.css'

const TIP_PRESETS = [15, 18, 20]
const DEFAULT_TAX = 11.75
const DEFAULT_SURCHARGE = 0

const STEPS = [
  { id: 'people', label: 'People' },
  { id: 'items', label: 'Items' },
  { id: 'tax', label: 'Tax & extras' },
  { id: 'summary', label: 'Summary' },
]

function uid() {
  return crypto.randomUUID()
}

function parseMoney(value) {
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatMoney(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n)
}

function buildShareText({
  restaurantTitle,
  people,
  totals,
  taxPercent,
  surchargePercent,
  surchargeBasis,
  surchargeMode,
  tipMode,
  tipPreset,
  receiptTotalsMode,
}) {
  const taxLabel = parseMoney(taxPercent).toFixed(2)
  const surchargeLabel = parseMoney(surchargePercent).toFixed(2)
  const surchargeBasisNote =
    surchargeBasis === 'subtotal_plus_tax' ? 'subtotal+tax' : 'food subtotal'
  const title = String(restaurantTitle ?? '').trim()
  const lines = [title ? `Split the bill — ${title}` : 'Split the bill — totals', '']

  for (const r of totals.rows) {
    const idx = people.findIndex((x) => x.id === r.person.id)
    const name = r.person.name.trim() || `Person ${idx + 1}`
    lines.push(`${name}`)
    lines.push(`  TOTAL DUE: ${formatMoney(r.total)}`)
    lines.push(`  Subtotal: ${formatMoney(r.subtotal)}`)
    lines.push(
      surchargeMode === 'dollars'
        ? `  Surcharge (manual, ≈ ${totals.manualSurchargePercentDisplay.toFixed(2)}% of food subtotals): ${formatMoney(r.surcharge)}`
        : `  Surcharge (${surchargeLabel}% of ${surchargeBasisNote}): ${formatMoney(r.surcharge)}`,
    )
    lines.push(
      receiptTotalsMode === 'manual'
        ? `  Tax (from receipt split): ${formatMoney(r.tax)}`
        : `  Tax (${taxLabel}%): ${formatMoney(r.tax)}`,
    )
    lines.push(
      receiptTotalsMode === 'manual'
        ? `  Tip (from receipt split): ${formatMoney(r.tip)}`
        : `  Tip${
            tipMode === 'preset'
              ? ` (${tipPreset}%)`
              : receiptTotalsMode === 'tip_on_subtotal_plus_tax'
                ? ' (manual, weighted by subtotal+tax)'
                : ' (manual share)'
          }: ${formatMoney(r.tip)}`,
    )
    if ((r.adjustment ?? 0) > 0) lines.push(`  Extras (discount/gift): -${formatMoney(r.adjustment)}`)

    lines.push('')
    lines.push('')
  }

  lines.push('Receipt (all items)')
  lines.push(`  Total due: ${formatMoney(totals.grand.total)}`)
  lines.push(`  Subtotal: ${formatMoney(totals.grand.subtotal)}`)
  lines.push(
    surchargeMode === 'dollars'
      ? `  Surcharge: ${formatMoney(totals.grand.surcharge)} (total $; ≈ ${totals.manualSurchargePercentDisplay.toFixed(2)}% of assigned food subtotals)`
      : `  Surcharge: ${formatMoney(totals.grand.surcharge)} (${surchargeLabel}% of ${surchargeBasisNote})`,
  )
  lines.push(`  Tax: ${formatMoney(totals.grand.tax)}`)
  lines.push(`  Tip: ${formatMoney(totals.grand.tip)}`)
  if ((totals.grand.discountAmount ?? 0) > 0)
    lines.push(`  Discount: -${formatMoney(totals.grand.discountAmount)}`)
  if ((totals.grand.giftCard ?? 0) > 0) lines.push(`  Gift card: -${formatMoney(totals.grand.giftCard)}`)

  if (receiptTotalsMode === 'tip_on_subtotal_plus_tax') {
    lines.push('')
    lines.push(
      'Note: Tip was matched to a receipt that applies the tip percentage to subtotal plus tax (per person).',
    )
  } else if (receiptTotalsMode === 'manual') {
    lines.push('')
    lines.push(
      `Note: Tax and tip totals were taken from the receipt (${formatMoney(totals.grand.tax)} tax, ${formatMoney(totals.grand.tip)} tip) and split across people by food subtotal.`,
    )
  }

  return lines.join('\n')
}

function smsHrefForBody(body) {
  const q = encodeURIComponent(body)
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return `sms:&body=${q}`
  return `sms:?body=${q}`
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function allocateCents(totalDollars, weights) {
  const totalCents = Math.round(round2(totalDollars) * 100)
  if (!Number.isFinite(totalCents) || totalCents <= 0) return weights.map(() => 0)
  const wsum = weights.reduce((s, w) => s + (Number.isFinite(w) && w > 0 ? w : 0), 0)
  if (wsum <= 0) return weights.map(() => 0)

  const raw = weights.map((w) => (Number.isFinite(w) && w > 0 ? (totalCents * w) / wsum : 0))
  const base = raw.map((x) => Math.floor(x))
  let remainder = totalCents - base.reduce((s, c) => s + c, 0)

  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac)

  for (let k = 0; k < order.length && remainder > 0; k++) {
    base[order[k].i] += 1
    remainder -= 1
  }

  return base.map((c) => c / 100)
}

/** @typedef {'default' | 'tip_on_subtotal_plus_tax' | 'manual'} ReceiptTotalsMode */
/** @typedef {'food_subtotal' | 'subtotal_plus_tax'} SurchargeBasis */
/** @typedef {'percent' | 'dollars'} SurchargeMode */

function computeSplitTotals({
  people,
  items,
  taxRate,
  surchargeRate,
  surchargeBasis,
  surchargeMode,
  manualSurchargeStr,
  tipMode,
  tipPreset,
  manualTip,
  discountRate,
  giftCardAmount,
  receiptTotalsMode,
  manualReceiptTaxStr,
  manualReceiptTipStr,
}) {
  const personSubtotals = Object.fromEntries(people.map((p) => [p.id, 0]))
  const unassignedItems = []

  for (const item of items) {
    const price = round2(parseMoney(item.price))
    const assignees = item.assigneeIds.filter((id) => personSubtotals[id] !== undefined)
    if (assignees.length === 0) {
      unassignedItems.push(item.id)
      continue
    }
    const share = round2(price / assignees.length)
    for (const id of assignees) {
      personSubtotals[id] = round2(personSubtotals[id] + share)
    }
  }

  const assignedSubtotalSum = Object.values(personSubtotals).reduce((a, b) => a + b, 0)

  let tipPercentEffective = 0
  if (tipMode === 'preset') {
    tipPercentEffective = tipPreset / 100
  } else {
    const tipDollars = round2(parseMoney(manualTip))
    tipPercentEffective =
      assignedSubtotalSum > 0 ? tipDollars / assignedSubtotalSum : 0
  }

  const manualTipPercentDisplay =
    assignedSubtotalSum > 0
      ? round2((round2(parseMoney(manualTip)) / assignedSubtotalSum) * 100)
      : 0

  const manualSurchargePercentDisplay =
    surchargeMode === 'dollars' && assignedSubtotalSum > 0
      ? round2((round2(parseMoney(manualSurchargeStr)) / assignedSubtotalSum) * 100)
      : 0

  const subs = people.map((p) => round2(personSubtotals[p.id] ?? 0))
  const surchargeDollarsTotal = round2(Math.max(0, parseMoney(manualSurchargeStr)))
  const surchargeAllocDollars =
    surchargeMode === 'dollars' ? allocateCents(surchargeDollarsTotal, subs) : null
  const manualReceiptTaxTotal = round2(Math.max(0, parseMoney(manualReceiptTaxStr)))
  const manualReceiptTipTotal = round2(Math.max(0, parseMoney(manualReceiptTipStr)))
  const taxAllocManual =
    receiptTotalsMode === 'manual' ? allocateCents(manualReceiptTaxTotal, subs) : null
  const tipAllocManual =
    receiptTotalsMode === 'manual' ? allocateCents(manualReceiptTipTotal, subs) : null

  const rowsBase = people.map((p, i) => {
    const sub = subs[i] ?? 0
    const taxRateBased = round2(sub * taxRate)
    let tax = taxRateBased
    let tip = 0

    if (receiptTotalsMode === 'manual') {
      tax = round2(taxAllocManual[i] ?? 0)
      tip = round2(tipAllocManual[i] ?? 0)
    } else if (receiptTotalsMode === 'tip_on_subtotal_plus_tax') {
      tax = taxRateBased
      if (tipMode === 'preset') {
        tip = round2((sub + tax) * tipPercentEffective)
      } else {
        const tipDollars = round2(parseMoney(manualTip))
        const weights = people.map((pp, j) => {
          const s = subs[j] ?? 0
          const t = round2(s * taxRate)
          return round2(s + t)
        })
        const tipAlloc = allocateCents(tipDollars, weights)
        tip = round2(tipAlloc[i] ?? 0)
      }
    } else {
      tax = taxRateBased
      tip = round2(sub * tipPercentEffective)
    }

    let surcharge = 0
    if (surchargeMode === 'dollars') {
      surcharge = round2(surchargeAllocDollars[i] ?? 0)
    } else {
      const surchargeBase =
        surchargeBasis === 'subtotal_plus_tax' ? round2(sub + tax) : sub
      surcharge = round2(surchargeBase * surchargeRate)
    }

    const totalBeforeAdjustments = round2(sub + surcharge + tax + tip)
    return {
      person: p,
      subtotal: sub,
      surcharge,
      tax,
      tip,
      totalBeforeAdjustments,
    }
  })

  const subtotal = round2(rowsBase.reduce((s, r) => s + r.subtotal, 0))
  const surcharge = round2(rowsBase.reduce((s, r) => s + r.surcharge, 0))
  const tax = round2(rowsBase.reduce((s, r) => s + r.tax, 0))
  const tip = round2(rowsBase.reduce((s, r) => s + r.tip, 0))
  const totalBeforeAdjustments = round2(
    rowsBase.reduce((s, r) => s + r.totalBeforeAdjustments, 0),
  )

  const discountAmount = round2(Math.max(0, Math.min(1, discountRate)) * totalBeforeAdjustments)
  const giftCard = round2(Math.max(0, parseMoney(giftCardAmount)))
  const totalAdjustmentsRaw = round2(discountAmount + giftCard)
  const totalAdjustments = round2(Math.min(totalBeforeAdjustments, totalAdjustmentsRaw))

  const total = round2(Math.max(0, totalBeforeAdjustments - totalAdjustments))

  const weights = rowsBase.map((r) => r.totalBeforeAdjustments)
  const allocatedAdjustments = allocateCents(
    totalAdjustments,
    totalBeforeAdjustments > 0 ? weights : rowsBase.map(() => 0),
  )

  const rowsWithAdjustments = rowsBase.map((r, i) => {
    const adjustment = round2(allocatedAdjustments[i] ?? 0)
    const totalDue = round2(Math.max(0, r.totalBeforeAdjustments - adjustment))
    return { ...r, adjustment, total: totalDue }
  })

  const grand = {
    subtotal,
    surcharge,
    tax,
    tip,
    discountAmount,
    giftCard,
    totalBeforeAdjustments,
    total,
  }

  return {
    personSubtotals,
    rows: rowsWithAdjustments,
    unassignedItems,
    assignedSubtotalSum,
    tipPercentEffective,
    manualTipPercentDisplay,
    manualSurchargePercentDisplay,
    grand,
  }
}

export default function App() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [restaurantTitle, setRestaurantTitle] = useState('')
  const [celebrateReady, setCelebrateReady] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [checkAnimKey, setCheckAnimKey] = useState(0)
  const [receiptFooterLine, setReceiptFooterLine] = useState(() => 'Thank you · Please come again ☺ - Leah')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [newItemAssigneeIds, setNewItemAssigneeIds] = useState(() => [])
  const [newItemError, setNewItemError] = useState('')
  const [people, setPeople] = useState(() => [
    { id: uid(), name: '' },
    { id: uid(), name: '' },
  ])
  const [items, setItems] = useState(() => [])
  const [taxPercent, setTaxPercent] = useState(String(DEFAULT_TAX))
  const [surchargePercent, setSurchargePercent] = useState(String(DEFAULT_SURCHARGE))
  const [surchargeBasis, setSurchargeBasis] = useState(
    /** @type {SurchargeBasis} */ ('food_subtotal'),
  )
  const [surchargeMode, setSurchargeMode] = useState(
    /** @type {SurchargeMode} */ ('percent'),
  )
  const [manualSurcharge, setManualSurcharge] = useState('')
  const [tipMode, setTipMode] = useState('preset')
  const [tipPreset, setTipPreset] = useState(18)
  const [manualTip, setManualTip] = useState('')
  const [discountPercent, setDiscountPercent] = useState('0')
  const [giftCardAmount, setGiftCardAmount] = useState('')
  const [currentStep, setCurrentStep] = useState('people')
  const [receiptTotalsMode, setReceiptTotalsMode] = useState(
    /** @type {ReceiptTotalsMode} */ ('default'),
  )
  const [receiptVerifyStep, setReceiptVerifyStep] = useState(
    /** @type {'ask' | 'try_alt' | 'manual' | 'done'} */ ('ask'),
  )
  const [manualReceiptTax, setManualReceiptTax] = useState('')
  const [manualReceiptTip, setManualReceiptTip] = useState('')

  const taxRate = parseMoney(taxPercent) / 100
  const surchargeRate = parseMoney(surchargePercent) / 100
  const discountRate = parseMoney(discountPercent) / 100

  const totals = useMemo(
    () =>
      computeSplitTotals({
        people,
        items,
        taxRate,
        surchargeRate,
        surchargeBasis,
        surchargeMode,
        manualSurchargeStr: manualSurcharge,
        tipMode,
        tipPreset,
        manualTip,
        discountRate,
        giftCardAmount,
        receiptTotalsMode,
        manualReceiptTaxStr: manualReceiptTax,
        manualReceiptTipStr: manualReceiptTip,
      }),
    [
      people,
      items,
      taxRate,
      surchargeRate,
      surchargeBasis,
      surchargeMode,
      manualSurcharge,
      tipMode,
      tipPreset,
      manualTip,
      discountRate,
      giftCardAmount,
      receiptTotalsMode,
      manualReceiptTax,
      manualReceiptTip,
    ],
  )

  const alternateTipBaseTotals = useMemo(
    () =>
      computeSplitTotals({
        people,
        items,
        taxRate,
        surchargeRate,
        surchargeBasis,
        surchargeMode,
        manualSurchargeStr: manualSurcharge,
        tipMode,
        tipPreset,
        manualTip,
        discountRate,
        giftCardAmount,
        receiptTotalsMode: 'tip_on_subtotal_plus_tax',
        manualReceiptTaxStr: '',
        manualReceiptTipStr: '',
      }),
    [
      people,
      items,
      taxRate,
      surchargeRate,
      surchargeBasis,
      surchargeMode,
      manualSurcharge,
      tipMode,
      tipPreset,
      manualTip,
      discountRate,
      giftCardAmount,
    ],
  )

  const receiptCheckMeterSegments = useMemo(() => {
    const labels = ['Tip on food', 'Tip on food+tax', 'Enter tax & tip']
    /** @type {('upcoming' | 'current' | 'complete')[]} */
    let states = ['upcoming', 'upcoming', 'upcoming']
    if (receiptTotalsMode === 'manual') {
      states = ['complete', 'complete', 'complete']
    } else if (receiptTotalsMode === 'tip_on_subtotal_plus_tax') {
      states = ['complete', 'complete', 'upcoming']
    } else if (receiptTotalsMode === 'default') {
      if (receiptVerifyStep === 'ask') states = ['current', 'upcoming', 'upcoming']
      else if (receiptVerifyStep === 'try_alt') states = ['complete', 'current', 'upcoming']
      else if (receiptVerifyStep === 'manual') states = ['complete', 'complete', 'current']
      else if (receiptVerifyStep === 'done') states = ['complete', 'upcoming', 'upcoming']
    }
    return labels.map((label, i) => ({ label, state: states[i] }))
  }, [receiptTotalsMode, receiptVerifyStep])

  const shareText = useMemo(
    () =>
      buildShareText({
        restaurantTitle,
        people,
        totals,
        taxPercent,
        surchargePercent,
        surchargeBasis,
        surchargeMode,
        tipMode,
        tipPreset,
        receiptTotalsMode,
      }),
    [restaurantTitle, people, totals, taxPercent, surchargePercent, surchargeBasis, surchargeMode, tipMode, tipPreset, receiptTotalsMode],
  )

  const mailtoHref = useMemo(
    () =>
      `mailto:?subject=${encodeURIComponent(
        restaurantTitle.trim() ? `Split the bill — ${restaurantTitle.trim()}` : 'Split the bill — totals',
      )}&body=${encodeURIComponent(
        // Many mail clients expect CRLF in mailto bodies for line breaks.
        shareText.replace(/\n/g, '\r\n'),
      )}`,
    [shareText, restaurantTitle],
  )

  const smsHref = useMemo(() => smsHrefForBody(shareText), [shareText])

  const checkNumber = useMemo(
    () => String(Math.floor(100000 + Math.random() * 900000)),
    [],
  )

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const apply = () => setPrefersReducedMotion(Boolean(mq.matches))
    apply()
    if (mq.addEventListener) mq.addEventListener('change', apply)
    else mq.addListener(apply)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply)
      else mq.removeListener(apply)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/one-liners.txt', { cache: 'no-store' })
        if (!res.ok) return
        const text = await res.text()
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))

        if (!lines.length) return
        const idx = Math.floor(Math.random() * lines.length)
        if (!cancelled) setReceiptFooterLine(lines[idx])
      } catch {
        // ignore (keep default footer line)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function sparkleBurst(targetEl) {
    if (!targetEl || prefersReducedMotion) return

    const colors = ['#ff4d7d', '#ff8a00', '#ffd400', '#2ee59d', '#2d9cff', '#7f6bff']
    const count = 14
    const rect = targetEl.getBoundingClientRect()

    if (getComputedStyle(targetEl).position === 'static') {
      targetEl.style.position = 'relative'
    }

    for (let i = 0; i < count; i++) {
      const p = document.createElement('span')
      const isStar = i % 4 === 0
      const isConfetti = !isStar && i % 2 === 0
      p.className = isStar ? 'bill-sparkle bill-sparkle--star' : 'bill-sparkle'
      if (isConfetti) p.className += ' bill-sparkle--confetti'

      const c = colors[Math.floor(Math.random() * colors.length)]
      p.style.setProperty('--c', c)

      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.35 - 0.175)
      const dist = 14 + Math.random() * 18
      const dx = Math.cos(angle) * dist
      const dy = Math.sin(angle) * dist - 10
      const rot = (Math.random() * 240 - 120).toFixed(1)

      p.style.setProperty('--dx', `${dx.toFixed(2)}px`)
      p.style.setProperty('--dy', `${dy.toFixed(2)}px`)
      p.style.setProperty('--rot', `${rot}deg`)

      const size = isStar ? 8 + Math.random() * 4 : 5 + Math.random() * 5
      p.style.width = `${Math.round(size)}px`
      p.style.height = `${Math.round(size)}px`
      p.style.left = `${rect.width / 2}px`
      p.style.top = `${rect.height / 2}px`

      p.addEventListener(
        'animationend',
        () => {
          p.remove()
        },
        { once: true },
      )

      targetEl.appendChild(p)
    }
  }

  function withSparkle(onClick) {
    return (e) => {
      sparkleBurst(e.currentTarget)
      onClick(e)
    }
  }

  const shareReadyPrevRef = useRef(false)
  const celebrateTimerRef = useRef(null)
  const newItemPriceRef = useRef(null)

  function addPerson() {
    setPeople((prev) => [...prev, { id: uid(), name: '' }])
  }

  function removePerson(id) {
    setPeople((prev) => prev.filter((p) => p.id !== id))
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        assigneeIds: it.assigneeIds.filter((aid) => aid !== id),
      })),
    )
  }

  function updatePersonName(id, name) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  function toggleNewItemAssignee(personId) {
    setNewItemAssigneeIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    )
  }

  function createNewItem() {
    const raw = String(newItemPrice ?? '').trim()
    const n = round2(parseMoney(raw))

    if (!Number.isFinite(n) || (n === 0 && !/0/.test(raw))) {
      setNewItemError('Enter a valid price.')
      return
    }
    if (newItemAssigneeIds.length === 0) {
      setNewItemError('Select at least one person.')
      return
    }

    setNewItemError('')
    setItems((prev) => [
      ...prev,
      {
        id: uid(),
        label: '',
        price: n.toFixed(2),
        assigneeIds: newItemAssigneeIds,
      },
    ])

    setNewItemPrice('')
    setNewItemAssigneeIds([])
    requestAnimationFrame(() => newItemPriceRef.current?.focus())
  }

  const billProgress = useMemo(() => {
    const peopleAdded = people.length > 0
    const itemsAdded = items.length > 0
    const pricesEntered =
      items.length > 0 && items.every((it) => String(it.price ?? '').trim().length > 0)
    const itemsAssigned = items.length > 0 && totals.unassignedItems.length === 0
    const readyToShare = peopleAdded && itemsAdded && pricesEntered && itemsAssigned

    const steps = [
      { id: 'people', label: 'People', done: peopleAdded },
      { id: 'items', label: 'Items', done: itemsAdded },
      { id: 'prices', label: 'Prices', done: pricesEntered },
      { id: 'assigned', label: 'Assigned', done: itemsAssigned },
      { id: 'share', label: 'Ready', done: readyToShare },
    ]

    const doneCount = steps.filter((s) => s.done).length
    const pct = Math.round((doneCount / steps.length) * 100)

    const missingPricesCount = items.filter((it) => String(it.price ?? '').trim().length === 0)
      .length
    const unassignedCount = totals.unassignedItems.length

    let hint = ''
    if (!itemsAdded) hint = 'Add some item prices to get started.'
    else if (missingPricesCount > 0)
      hint = `${missingPricesCount} item${missingPricesCount === 1 ? '' : 's'} missing a price.`
    else if (unassignedCount > 0)
      hint = `${unassignedCount} item${unassignedCount === 1 ? '' : 's'} still need people selected.`
    else hint = 'Nice! Everything is assigned.'

    return { steps, doneCount, pct, readyToShare, hint }
  }, [people.length, items, totals.unassignedItems])

  const stepStatus = useMemo(() => {
    const hasNamedPerson = people.some((p) => String(p.name ?? '').trim().length > 0)
    const peopleDone = people.length > 0 && hasNamedPerson

    const itemsDone =
      items.length > 0 &&
      items.every((it) => String(it.price ?? '').trim().length > 0) &&
      totals.unassignedItems.length === 0

    const taxDone = true
    const summaryDone = billProgress.readyToShare

    return { peopleDone, itemsDone, taxDone, summaryDone }
  }, [people, items, totals.unassignedItems.length, billProgress.readyToShare])

  const stepIndex = useMemo(() => STEPS.findIndex((s) => s.id === currentStep), [currentStep])
  const canGoPrev = stepIndex > 0

  const canGoNext = useMemo(() => {
    if (currentStep === 'people') return stepStatus.peopleDone
    if (currentStep === 'items') return stepStatus.itemsDone
    if (currentStep === 'tax') return stepStatus.taxDone
    return false
  }, [currentStep, stepStatus.peopleDone, stepStatus.itemsDone, stepStatus.taxDone])

  function goToStep(stepId) {
    if (!STEPS.some((s) => s.id === stepId)) return
    setCurrentStep(stepId)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  function goPrev() {
    if (!canGoPrev) return
    goToStep(STEPS[stepIndex - 1].id)
  }

  function goNext() {
    if (!canGoNext) return
    goToStep(STEPS[stepIndex + 1].id)
  }

  useEffect(() => {
    const prev = shareReadyPrevRef.current
    const now = billProgress.readyToShare
    shareReadyPrevRef.current = now

    if (!prev && now) {
      setCelebrateReady(true)
      if (celebrateTimerRef.current) window.clearTimeout(celebrateTimerRef.current)
      celebrateTimerRef.current = window.setTimeout(() => setCelebrateReady(false), 2200)
    }

    return () => {
      if (celebrateTimerRef.current) window.clearTimeout(celebrateTimerRef.current)
    }
  }, [billProgress.readyToShare])

  async function copyShareToClipboard() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText)
      } else {
        const ta = document.createElement('textarea')
        ta.value = shareText
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '-1000px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopyStatus('Copied!')
      window.setTimeout(() => setCopyStatus(''), 1600)
    } catch {
      setCopyStatus('Could not copy.')
      window.setTimeout(() => setCopyStatus(''), 2000)
    }
  }

  function updateItem(id, patch) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    )
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  function toggleAssignee(itemId, personId) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it
        const has = it.assigneeIds.includes(personId)
        return {
          ...it,
          assigneeIds: has
            ? it.assigneeIds.filter((x) => x !== personId)
            : [...it.assigneeIds, personId],
        }
      }),
    )
  }

  function resetReceiptCheck() {
    setReceiptTotalsMode('default')
    setReceiptVerifyStep('ask')
    setManualReceiptTax('')
    setManualReceiptTip('')
  }

  function applyManualReceiptAmounts() {
    setReceiptTotalsMode('manual')
    setReceiptVerifyStep('done')
  }

  function resetAll() {
    if (!window.confirm('Are you sure you want to reset?')) return
    setRestaurantTitle('')
    setCheckAnimKey((k) => k + 1)
    setPeople([
      { id: uid(), name: '' },
      { id: uid(), name: '' },
    ])
    setItems([])
    setTaxPercent(String(DEFAULT_TAX))
    setSurchargePercent(String(DEFAULT_SURCHARGE))
    setSurchargeBasis('food_subtotal')
    setSurchargeMode('percent')
    setManualSurcharge('')
    setTipMode('preset')
    setTipPreset(18)
    setManualTip('')
    setDiscountPercent('0')
    setGiftCardAmount('')
    setCurrentStep('people')
    setReceiptTotalsMode('default')
    setReceiptVerifyStep('ask')
    setManualReceiptTax('')
    setManualReceiptTip('')
  }

  function StepNav({ showNext = true }) {
    return (
      <div className="bill-step-nav" aria-label="Step navigation">
        <button
          type="button"
          className="bill-btn bill-btn-ghost"
          onClick={goPrev}
          disabled={!canGoPrev}
        >
          Back
        </button>

        <div className="bill-step-nav-spacer" />

        {showNext ? (
          <button
            type="button"
            className="bill-btn bill-btn-primary"
            onClick={goNext}
            disabled={!canGoNext}
          >
            Next
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="bill-app bill-receipt">
      <header className="bill-header bill-receipt-header">
        <p className="bill-receipt-kicker">Guest check</p>
        <div className="bill-receipt-meta">
          <span>
            Date <strong>{RECEIPT_DATE}</strong>
          </span>
          <span>
            Table <strong>VIP</strong>
          </span>
          <span>
            Guests <strong>{people.length}</strong>
          </span>
          <span>
            Check #{' '}
            <strong key={checkAnimKey} className="bill-check-number bill-check-number-animate">
              {checkNumber}
            </strong>
          </span>
        </div>
        <div className="bill-header-top">
          <h1 className="bill-title-diner">Split the bill</h1>
          <button type="button" className="bill-btn bill-btn-ghost" onClick={withSparkle(resetAll)}>
            Start Over
          </button>
        </div>
        <div className="bill-row" style={{ marginTop: 12 }}>
          <label className="sr-only" htmlFor="restaurant-title">
            Restaurant title
          </label>
          <input
            id="restaurant-title"
            className="bill-input bill-input-grow"
            type="text"
            placeholder="Restaurant or occasion (optional)"
            value={restaurantTitle}
            onChange={(e) => setRestaurantTitle(e.target.value)}
          />
        </div>

        <nav className="bill-stepper" aria-label="Steps">
          {STEPS.map((s) => {
            const isCurrent = s.id === currentStep
            const done =
              s.id === 'people'
                ? stepStatus.peopleDone
                : s.id === 'items'
                  ? stepStatus.itemsDone
                  : s.id === 'tax'
                    ? stepStatus.taxDone
                    : stepStatus.summaryDone

            const cls = isCurrent
              ? 'bill-step bill-step--current'
              : done
                ? 'bill-step bill-step--done'
                : 'bill-step'

            return (
              <button
                key={s.id}
                type="button"
                className={cls}
                onClick={() => goToStep(s.id)}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {s.label}
              </button>
            )
          })}
        </nav>
        <p className="bill-lede" aria-hidden="true" />
      </header>

      {currentStep === 'people' ? (
      <>
      <section className="bill-panel bill-panel--people" aria-labelledby="people-heading">
        <div className="bill-panel-heading-row">
          <h2 id="people-heading">
            People{' '}
            <span className="bill-items-heading__count">
              {people.length} {people.length === 1 ? 'person' : 'people'}
            </span>
          </h2>
          <button type="button" className="bill-btn bill-btn-primary" onClick={withSparkle(addPerson)}>
            Add Another Person
          </button>
        </div>
        <ul className="bill-list">
          {people.map((p) => (
            <li key={p.id} className="bill-row">
              <label className="sr-only" htmlFor={`person-${p.id}`}>
                Name
              </label>
              <input
                id={`person-${p.id}`}
                className="bill-input bill-input-grow"
                type="text"
                placeholder="Name"
                value={p.name}
                onChange={(e) => updatePersonName(p.id, e.target.value)}
              />
              <button
                type="button"
                className="bill-btn bill-btn-ghost"
                onClick={() => removePerson(p.id)}
                disabled={people.length <= 1}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      <StepNav />
      </>
      ) : null}

      {currentStep === 'items' ? (
      <>
      <section
        className="bill-panel bill-panel--items"
        aria-labelledby="items-heading"
      >
        <h2 id="items-heading" className="bill-items-heading">
          <span className="bill-items-heading__title">Items</span>
          <span className="bill-items-heading__count">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </h2>
        <p className="bill-muted bill-items-lede">
          Add prices to create items, then assign who ate or shared each one.
        </p>
        <div className="bill-new-item" style={{ marginTop: 10 }}>
          <div className="bill-row bill-new-item__top">
            <label className="sr-only" htmlFor="new-item-price">
              New item price
            </label>
            <input
              id="new-item-price"
              ref={newItemPriceRef}
              className="bill-input bill-input-money"
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoCapitalize="none"
              placeholder="0.00"
              value={newItemPrice}
              onChange={(e) => {
                setNewItemPrice(e.target.value)
                if (newItemError) setNewItemError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  createNewItem()
                }
              }}
            />

            <button
              type="button"
              className="bill-btn bill-btn-primary"
              onPointerDown={(e) => {
                // Keep the price input focused so iOS doesn't dismiss the decimal keypad.
                e.preventDefault()
              }}
              onClick={withSparkle(() => {
                createNewItem()
                requestAnimationFrame(() => newItemPriceRef.current?.focus())
              })}
              disabled={String(newItemPrice).trim().length === 0 || newItemAssigneeIds.length === 0}
            >
              Create item
            </button>
          </div>

          <fieldset className="bill-assign bill-assign--new">
            <legend>Who had this item?</legend>
            <div className="bill-chips">
              {people.map((p, i) => {
                const checked = newItemAssigneeIds.includes(p.id)
                const label = p.name.trim() || `Person ${i + 1}`
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="bill-chip"
                    role="checkbox"
                    aria-checked={checked}
                    onMouseDown={(e) => {
                      // Avoid moving focus off the price input on desktop.
                      e.preventDefault()
                    }}
                    onClick={() => {
                      toggleNewItemAssignee(p.id)
                      requestAnimationFrame(() => newItemPriceRef.current?.focus())
                    }}
                  >
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {newItemError ? (
            <p className="bill-warn" role="status" style={{ marginTop: 8 }}>
              {newItemError}
            </p>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="bill-muted bill-items-empty-callout">
            No items yet. Add a price to get started.
          </p>
        ) : null}
        <ul className="bill-items">
          {items.map((it) => (
            <li key={it.id} className="bill-item-card">
              <div className="bill-item-top">
                <label className="sr-only" htmlFor={`item-price-${it.id}`}>
                  Price
                </label>
                <input
                  id={`item-price-${it.id}`}
                  className="bill-input bill-input-money"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={it.price}
                  onChange={(e) => updateItem(it.id, { price: e.target.value })}
                />
                <label className="sr-only" htmlFor={`item-label-${it.id}`}>
                  Item name (optional)
                </label>
                <input
                  id={`item-label-${it.id}`}
                  className="bill-input bill-input-grow"
                  type="text"
                  placeholder="Item (optional)"
                  value={it.label}
                  onChange={(e) => updateItem(it.id, { label: e.target.value })}
                />
                <button
                  type="button"
                  className="bill-btn bill-btn-ghost"
                  onClick={() => removeItem(it.id)}
                >
                  Remove
                </button>
              </div>
              <fieldset className="bill-assign">
                <legend>Split between (select all who share this item)</legend>
                <div className="bill-chips">
                  {people.map((p, i) => {
                    const checked = it.assigneeIds.includes(p.id)
                    const label = p.name.trim() || `Person ${i + 1}`
                    return (
                      <label key={p.id} className="bill-chip">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAssignee(it.id, p.id)}
                        />
                        <span>{label}</span>
                      </label>
                    )
                  })}
                </div>
                {totals.unassignedItems.includes(it.id) ? (
                  <p className="bill-warn" role="status">
                    Select at least one person.
                  </p>
                ) : null}
              </fieldset>
            </li>
          ))}
        </ul>
      </section>
      <StepNav />
      </>
      ) : null}

      {currentStep === 'tax' ? (
      <>
      <section className="bill-panel bill-panel--tax" aria-labelledby="tax-tip-heading">
        <h2 id="tax-tip-heading">Tax &amp; extras</h2>
        <div className="bill-grid-2">
          <div>
            <label className="bill-label" htmlFor="sales-tax">
              Sales tax (%)
            </label>
            <p className="bill-hint">
              Default is Chicago combined rate (~11.75%). Edit if your receipt
              differs.
            </p>
            <input
              id="sales-tax"
              className="bill-input bill-input-block"
              type="text"
              inputMode="decimal"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
            />
          </div>
          <div>
            <span className="bill-label">Tip</span>
            <div className="bill-tip-modes">
              <label className="bill-radio">
                <input
                  type="radio"
                  name="tip-mode"
                  checked={tipMode === 'preset'}
                  onChange={() => setTipMode('preset')}
                />
                Presets
              </label>
              <label className="bill-radio">
                <input
                  type="radio"
                  name="tip-mode"
                  checked={tipMode === 'manual'}
                  onChange={() => setTipMode('manual')}
                />
                Manual total
              </label>
            </div>
            {tipMode === 'preset' ? (
              <div className="bill-presets" role="group" aria-label="Tip percentage">
                {TIP_PRESETS.map((pct) => {
                  const tipTotal = round2(totals.assignedSubtotalSum * (pct / 100))
                  const amtId = `tip-preset-amt-${pct}`
                  return (
                    <div key={pct} className="bill-preset-group">
                      <button
                        type="button"
                        className={
                          tipPreset === pct ? 'bill-pill bill-pill-active' : 'bill-pill'
                        }
                        onClick={() => setTipPreset(pct)}
                        aria-describedby={amtId}
                        aria-pressed={tipPreset === pct}
                      >
                        {pct}%
                      </button>
                      <span id={amtId} className="bill-preset-amt">
                        {formatMoney(tipTotal)}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bill-manual-tip">
                <label className="bill-label" htmlFor="manual-tip">
                  Total tip ($)
                </label>
                <input
                  id="manual-tip"
                  className="bill-input bill-input-block"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={manualTip}
                  onChange={(e) => setManualTip(e.target.value)}
                />
                <p className="bill-tip-pct">
                  {totals.assignedSubtotalSum > 0 ? (
                    <>
                      ≈{' '}
                      <strong>{totals.manualTipPercentDisplay.toFixed(2)}%</strong> of
                      assigned subtotals (distributed by each person&apos;s share)
                    </>
                  ) : (
                    <span className="bill-muted">
                      Add assigned items to compute tip percentage.
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        <div className="bill-surcharge-field bill-surcharge-field--span">
          <span className="bill-label">Surcharge</span>
          <p className="bill-hint bill-hint--tight">
            Optional venue fee (e.g. service charge). Use a % or the dollar total from your receipt.
          </p>
          <div className="bill-tip-modes" role="group" aria-label="Surcharge entry mode">
            <label className="bill-radio">
              <input
                type="radio"
                name="surcharge-mode"
                checked={surchargeMode === 'percent'}
                onChange={() => setSurchargeMode('percent')}
              />
              Percentage
            </label>
            <label className="bill-radio">
              <input
                type="radio"
                name="surcharge-mode"
                checked={surchargeMode === 'dollars'}
                onChange={() => setSurchargeMode('dollars')}
              />
              Manual total
            </label>
          </div>
          {surchargeMode === 'percent' ? (
            <div className="bill-surcharge-percent">
              <label className="bill-label" htmlFor="surcharge-pct">
                Surcharge (%)
              </label>
              <input
                id="surcharge-pct"
                className="bill-input bill-input-block"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={surchargePercent}
                onChange={(e) => setSurchargePercent(e.target.value)}
              />
              <span id="surcharge-basis-label" className="bill-label bill-label--inline-follow">
                Apply % to
              </span>
              <div
                className="bill-tip-modes bill-tip-modes--surcharge-basis"
                role="group"
                aria-labelledby="surcharge-basis-label"
              >
                <label className="bill-radio">
                  <input
                    type="radio"
                    name="surcharge-basis"
                    checked={surchargeBasis === 'food_subtotal'}
                    onChange={() => setSurchargeBasis('food_subtotal')}
                  />
                  Subtotal
                </label>
                <label className="bill-radio">
                  <input
                    type="radio"
                    name="surcharge-basis"
                    checked={surchargeBasis === 'subtotal_plus_tax'}
                    onChange={() => setSurchargeBasis('subtotal_plus_tax')}
                  />
                  Subtotal + tax
                </label>
              </div>
            </div>
          ) : (
            <div className="bill-manual-tip bill-manual-surcharge">
              <label className="bill-label" htmlFor="manual-surcharge">
                Total surcharge ($)
              </label>
              <input
                id="manual-surcharge"
                className="bill-input bill-input-block"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={manualSurcharge}
                onChange={(e) => setManualSurcharge(e.target.value)}
              />
              <p className="bill-tip-pct">
                {totals.assignedSubtotalSum > 0 ? (
                  <>
                    ≈{' '}
                    <strong>{totals.manualSurchargePercentDisplay.toFixed(2)}%</strong> of assigned
                    subtotals (distributed by each person&apos;s share)
                  </>
                ) : (
                  <span className="bill-muted">
                    Add assigned items to compute surcharge percentage.
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
        </div>
        <div className="bill-grid-2 bill-grid-2--subtract">
          <div>
            <label className="bill-label" htmlFor="discount-pct">
              Discount (% off total)
            </label>
            <p className="bill-hint">Optional percent discount applied to total.</p>
            <input
              id="discount-pct"
              className="bill-input bill-input-block"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
            />
          </div>
          <div>
            <label className="bill-label" htmlFor="gift-card">
              Gift card / credit ($ off)
            </label>
            <p className="bill-hint">Optional dollar amount subtracted from total.</p>
            <input
              id="gift-card"
              className="bill-input bill-input-block"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={giftCardAmount}
              onChange={(e) => setGiftCardAmount(e.target.value)}
            />
          </div>
        </div>
      </section>
      <StepNav />
      </>
      ) : null}

      {currentStep === 'summary' ? (
      <>
      <section className="bill-panel bill-summary bill-panel--summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>

        <div className="bill-receipt-check" aria-labelledby="receipt-check-heading">
          <h3 id="receipt-check-heading" className="bill-receipt-check__title">
            Receipt Check
          </h3>
          <nav
            className="bill-receipt-meter"
            aria-label="Receipt check path: standard food tip, tip on food plus tax, or manual tax and tip"
          >
            <ol className="bill-receipt-meter__list">
              {receiptCheckMeterSegments.map((seg, i) => (
                <Fragment key={seg.label}>
                  <li className="bill-receipt-meter__stepItem">
                    <button
                      type="button"
                      className={`bill-receipt-meter__step bill-receipt-meter__step--${seg.state}`}
                      aria-current={seg.state === 'current' ? 'step' : undefined}
                      onClick={() => {
                        setReceiptTotalsMode('default')
                        if (i === 0) setReceiptVerifyStep('ask')
                        else if (i === 1) setReceiptVerifyStep('try_alt')
                        else setReceiptVerifyStep('manual')
                      }}
                    >
                      <span className="bill-receipt-meter__badge">{i + 1}</span>
                      <span className="bill-receipt-meter__step-label">{seg.label}</span>
                    </button>
                  </li>
                  {i < receiptCheckMeterSegments.length - 1 ? (
                    <li className="bill-receipt-meter__dot" aria-hidden="true">
                      ·
                    </li>
                  ) : null}
                </Fragment>
              ))}
            </ol>
          </nav>

          {receiptTotalsMode !== 'default' || (receiptVerifyStep === 'done' && receiptTotalsMode === 'default') ? (
            <div className="bill-receipt-check__utility">
              {receiptTotalsMode !== 'default' ? (
                <button type="button" className="bill-link-button" onClick={resetReceiptCheck}>
                  Review Again
                </button>
              ) : null}
              {receiptVerifyStep === 'done' && receiptTotalsMode === 'default' ? (
                <button type="button" className="bill-link-button" onClick={() => setReceiptVerifyStep('ask')}>
                  Review again
                </button>
              ) : null}
            </div>
          ) : null}


          {receiptTotalsMode !== 'default' ? (
            <p className="bill-receipt-check__status">
              {receiptTotalsMode === 'tip_on_subtotal_plus_tax'
                ? 'Using tip calculated on each person’s subtotal plus tax.'
                : 'Using tax and tip dollar amounts from your receipt, split by food subtotal.'}
            </p>
          ) : null}

          {receiptVerifyStep === 'ask' && receiptTotalsMode === 'default' ? (
            <div className="bill-receipt-check__block">
              <p className="bill-receipt-check__total-line">
                <span className="bill-receipt-check__total-word">Total</span>
                <span className="bill-receipt-check__total-figure">
                  <strong className="bill-receipt-check__amount">{formatMoney(totals.grand.total)}</strong>
                  <span className="bill-receipt-check__amount-caption">
                    {tipMode === 'preset'
                      ? `${tipPreset}% tip on food subtotal only`
                      : 'Tip split by food subtotal (manual)'}
                  </span>
                </span>
              </p>
              <p className="bill-muted bill-receipt-check__question">Is this the correct amount on your receipt?</p>
              <div className="bill-receipt-check__actions">
                <button
                  type="button"
                  className="bill-btn bill-btn-primary"
                  onClick={() => setReceiptVerifyStep('done')}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="bill-btn bill-btn-ghost"
                  onClick={() => setReceiptVerifyStep('try_alt')}
                >
                  No
                </button>
              </div>
            </div>
          ) : null}

          {receiptVerifyStep === 'try_alt' && receiptTotalsMode === 'default' ? (
            <div className="bill-receipt-check__block">
              <p className="bill-receipt-check__total-line">
                <span className="bill-receipt-check__total-word">Total</span>
                <span className="bill-receipt-check__total-figure">
                  <strong className="bill-receipt-check__amount">
                    {formatMoney(alternateTipBaseTotals.grand.total)}
                  </strong>
                  <span className="bill-receipt-check__amount-caption">
                    {tipMode === 'preset'
                      ? `${tipPreset}% tip on food + sales tax`
                      : 'Manual tip split by food + tax'}
                  </span>
                </span>
              </p>
           
              <p className="bill-muted bill-receipt-check__question">How about now?</p>
              <div className="bill-receipt-check__actions">
                <button
                  type="button"
                  className="bill-btn bill-btn-primary"
                  onClick={() => {
                    setReceiptTotalsMode('tip_on_subtotal_plus_tax')
                    setReceiptVerifyStep('done')
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="bill-btn bill-btn-ghost"
                  onClick={() => setReceiptVerifyStep('manual')}
                >
                  No
                </button>
                <button
                  type="button"
                  className="bill-btn bill-btn-ghost"
                  onClick={() => setReceiptVerifyStep('ask')}
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {receiptVerifyStep === 'manual' && receiptTotalsMode === 'default' ? (
            <div className="bill-receipt-check__block">
              <p className="bill-muted">
                Enter the <strong>total tax</strong> and <strong>total tip</strong> from your receipt to be proportionately split across people's subtotals.
              </p>
              <div className="bill-receipt-check__manual-grid">
                <div>
                  <label className="bill-label" htmlFor="manual-receipt-tax">
                    Tax from receipt ($)
                  </label>
                  <input
                    id="manual-receipt-tax"
                    className="bill-input bill-input-block"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={manualReceiptTax}
                    onChange={(e) => setManualReceiptTax(e.target.value)}
                  />
                </div>
                <div>
                  <label className="bill-label" htmlFor="manual-receipt-tip">
                    Tip from receipt ($)
                  </label>
                  <input
                    id="manual-receipt-tip"
                    className="bill-input bill-input-block"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={manualReceiptTip}
                    onChange={(e) => setManualReceiptTip(e.target.value)}
                  />
                </div>
              </div>
              <div className="bill-receipt-check__actions">
                <button type="button" className="bill-btn bill-btn-primary" onClick={applyManualReceiptAmounts}>
                  Apply
                </button>
                <button
                  type="button"
                  className="bill-btn bill-btn-ghost"
                  onClick={() => setReceiptVerifyStep('try_alt')}
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {receiptVerifyStep === 'done' && receiptTotalsMode === 'default' ? (
            <p className="bill-muted bill-receipt-check__done">
              You confirmed this total matches your receipt.
            </p>
          ) : null}
        </div>

        <p className="bill-muted bill-summary-meta">
          
          {tipMode === 'preset' ? (
            <>
              {' '}
              
            </>
          ) : (
            <>
              {' '}
              Manual tip is spread proportionally: each person pays{' '}
              <strong>subtotal × (total tip ÷ assigned subtotals)</strong>, same as
              applying one effective % to each subtotal.
            </>
          )}
        </p>

        <div className="bill-table-wrap">
        <p className="scroll-hint">
            ← scroll to see full summary →
          </p>
          <table className="bill-table">
            <caption className="sr-only">Per-person amounts</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Subtotal</th>
                <th scope="col">
                  {surchargeMode === 'dollars'
                    ? `Surcharge (≈${totals.manualSurchargePercentDisplay.toFixed(2)}% of food)`
                    : `Surcharge (${parseMoney(surchargePercent).toFixed(2)}% of ${surchargeBasis === 'subtotal_plus_tax' ? 'subtotal+tax' : 'food'})`}
                </th>
                <th scope="col">
                  {receiptTotalsMode === 'manual'
                    ? 'Tax (from receipt)'
                    : `Tax (${parseMoney(taxPercent).toFixed(2)}%)`}
                </th>
                <th scope="col">
                  {receiptTotalsMode === 'manual'
                    ? 'Tip (from receipt)'
                    : `Tip${tipMode === 'preset' ? ` (${tipPreset}%)` : ''}`}
                </th>
                <th scope="col">Extras</th>
                <th scope="col">Total due</th>
              </tr>
            </thead>
            <tbody>
              {totals.rows.map((r) => (
                <tr key={r.person.id}>
                  <th scope="row">
                    {r.person.name.trim() ||
                      `Person ${people.findIndex((x) => x.id === r.person.id) + 1}`}
                  </th>
                  <td>{formatMoney(r.subtotal)}</td>
                  <td>{formatMoney(r.surcharge)}</td>
                  <td>{formatMoney(r.tax)}</td>
                  <td>{formatMoney(r.tip)}</td>
                  <td>
                    {r.adjustment > 0 ? `-${formatMoney(r.adjustment)}` : formatMoney(0)}
                  </td>
                  <td>
                    <strong>{formatMoney(r.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Receipt Totals</th>
                <td>{formatMoney(totals.grand.subtotal)}</td>
                <td>{formatMoney(totals.grand.surcharge)}</td>
                <td>{formatMoney(totals.grand.tax)}</td>
                <td>{formatMoney(totals.grand.tip)}</td>
                <td>
                  {(totals.grand.discountAmount ?? 0) + (totals.grand.giftCard ?? 0) > 0
                    ? `-${formatMoney((totals.grand.discountAmount ?? 0) + (totals.grand.giftCard ?? 0))}`
                    : formatMoney(0)}
                </td>
                <td>
                  <strong>{formatMoney(totals.grand.total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div
          className={billProgress.readyToShare ? 'bill-share bill-share--ready' : 'bill-share'}
          aria-labelledby="share-heading"
        >
          <h3 id="share-heading" className="bill-share-heading">
            Share Summary
          </h3>
          
          <div className="bill-share-actions">
            <a
              className="bill-btn bill-btn-primary bill-share-link"
              href={mailtoHref}
              onClick={(e) => sparkleBurst(e.currentTarget)}
            >
              Email
            </a>
            <a
              className="bill-btn bill-btn-primary bill-share-link"
              href={smsHref}
              onClick={(e) => sparkleBurst(e.currentTarget)}
            >
              Text
            </a>
            <button
              type="button"
              className="bill-btn bill-btn-primary"
              onClick={withSparkle(copyShareToClipboard)}
            >
              Copy
            </button>
          </div>
          {copyStatus ? <p className="bill-muted bill-copy-status">{copyStatus}</p> : null}
        </div>
      </section>
      <StepNav showNext={false} />
      </>
      ) : null}

      <footer className="bill-receipt-footer">
        <p>{receiptFooterLine}</p>
      </footer>
    </div>
  )
}
