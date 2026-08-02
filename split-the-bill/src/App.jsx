import { useEffect, useMemo, useRef, useState } from 'react'



const RECEIPT_DATE = new Date().toLocaleDateString('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
import './App.css'

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

function personDisplayName(person, people) {
  const idx = people.findIndex((x) => x.id === person.id)
  return person.name.trim() || `Person ${idx + 1}`
}

function summaryBreakdownParts(row) {
  const parts = [`Subtotal ${formatMoney(row.subtotal)}`]
  if (row.surcharge > 0) parts.push(`Surcharge ${formatMoney(row.surcharge)}`)
  parts.push(`Tax ${formatMoney(row.tax)}`)
  parts.push(`Tip ${formatMoney(row.tip)}`)
  if (row.adjustment > 0) parts.push(`Credits −${formatMoney(row.adjustment)}`)
  return parts
}

function sumCreditAmounts(credits) {
  return round2(
    credits.reduce((sum, c) => sum + Math.max(0, parseMoney(c.amount)), 0),
  )
}

function buildShareText({ restaurantTitle, people, totals, credits }) {
  const title = String(restaurantTitle ?? '').trim()
  const lines = [title ? `Split the bill — ${title}` : 'Split the bill — totals', '']

  for (const r of totals.rows) {
    const idx = people.findIndex((x) => x.id === r.person.id)
    const name = r.person.name.trim() || `Person ${idx + 1}`
    lines.push(`${name}`)
    lines.push(`  TOTAL DUE: ${formatMoney(r.total)}`)
    lines.push(`  Subtotal: ${formatMoney(r.subtotal)}`)
    if (r.surcharge > 0) lines.push(`  Surcharge: ${formatMoney(r.surcharge)}`)
    lines.push(`  Tax: ${formatMoney(r.tax)}`)
    lines.push(`  Tip: ${formatMoney(r.tip)}`)
    if ((r.adjustment ?? 0) > 0) lines.push(`  Credits: -${formatMoney(r.adjustment)}`)

    lines.push('')
    lines.push('')
  }

  lines.push('Receipt (all items)')
  lines.push(`  Total due: ${formatMoney(totals.grand.total)}`)
  lines.push(`  Subtotal: ${formatMoney(totals.grand.subtotal)}`)
  if (totals.grand.surcharge > 0)
    lines.push(`  Surcharge: ${formatMoney(totals.grand.surcharge)}`)
  lines.push(`  Tax: ${formatMoney(totals.grand.tax)}`)
  lines.push(`  Tip: ${formatMoney(totals.grand.tip)}`)
  const creditEntries = credits.filter((c) => parseMoney(c.amount) > 0)
  if (creditEntries.length === 1) {
    const label = creditEntries[0].label.trim() || 'Credits'
    lines.push(`  ${label}: -${formatMoney(parseMoney(creditEntries[0].amount))}`)
  } else if (creditEntries.length > 1) {
    for (const c of creditEntries) {
      const label = c.label.trim() || 'Credit'
      lines.push(`  ${label}: -${formatMoney(parseMoney(c.amount))}`)
    }
    lines.push(`  Credits (total): -${formatMoney(totals.grand.credits)}`)
  } else if ((totals.grand.credits ?? 0) > 0) {
    lines.push(`  Credits: -${formatMoney(totals.grand.credits)}`)
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

function computeSplitTotals({
  people,
  items,
  taxAmountStr,
  tipAmountStr,
  surchargeAmountStr,
  credits,
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
    const shares = allocateCents(price, assignees.map(() => 1))
    assignees.forEach((id, i) => {
      personSubtotals[id] = round2(personSubtotals[id] + shares[i])
    })
  }

  const itemsTotal = round2(items.reduce((s, it) => s + round2(parseMoney(it.price)), 0))
  const assignedSubtotalSum = round2(
    Object.values(personSubtotals).reduce((a, b) => a + b, 0),
  )

  const subs = people.map((p) => round2(personSubtotals[p.id] ?? 0))
  const taxAmount = round2(Math.max(0, parseMoney(taxAmountStr)))
  const tipAmount = round2(Math.max(0, parseMoney(tipAmountStr)))
  const surchargeAmount = round2(Math.max(0, parseMoney(surchargeAmountStr)))

  const taxAlloc = allocateCents(taxAmount, subs)
  const tipAlloc = allocateCents(tipAmount, subs)
  const surchargeAlloc = allocateCents(surchargeAmount, subs)

  const rowsBase = people.map((p, i) => {
    const sub = subs[i] ?? 0
    const tax = round2(taxAlloc[i] ?? 0)
    const tip = round2(tipAlloc[i] ?? 0)
    const surcharge = round2(surchargeAlloc[i] ?? 0)

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

  const creditsTotal = sumCreditAmounts(credits)
  const totalBeforeAdjustments = round2(itemsTotal + surchargeAmount + taxAmount + tipAmount)
  const totalAdjustments = round2(Math.min(totalBeforeAdjustments, creditsTotal))

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
    subtotal: itemsTotal,
    surcharge: surchargeAmount,
    tax: taxAmount,
    tip: tipAmount,
    credits: creditsTotal,
    totalBeforeAdjustments,
    total,
  }

  return {
    personSubtotals,
    rows: rowsWithAdjustments,
    unassignedItems,
    assignedSubtotalSum,
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
  const [taxAmount, setTaxAmount] = useState('')
  const [tipAmount, setTipAmount] = useState('')
  const [surchargeAmount, setSurchargeAmount] = useState('')
  const [credits, setCredits] = useState(() => [{ id: uid(), amount: '', label: '' }])
  const [currentStep, setCurrentStep] = useState('people')
  const [stepDirection, setStepDirection] = useState(
    /** @type {'forward' | 'back'} */ ('forward'),
  )
  const [taxOptionalOpen, setTaxOptionalOpen] = useState(false)

  const hasOptionalTaxData = useMemo(
    () =>
      String(surchargeAmount).trim().length > 0 ||
      credits.some(
        (c) =>
          String(c.amount ?? '').trim().length > 0 || String(c.label ?? '').trim().length > 0,
      ),
    [surchargeAmount, credits],
  )

  const totals = useMemo(
    () =>
      computeSplitTotals({
        people,
        items,
        taxAmountStr: taxAmount,
        tipAmountStr: tipAmount,
        surchargeAmountStr: surchargeAmount,
        credits,
      }),
    [people, items, taxAmount, tipAmount, surchargeAmount, credits],
  )

  const shareText = useMemo(
    () =>
      buildShareText({
        restaurantTitle,
        people,
        totals,
        credits,
      }),
    [restaurantTitle, people, totals, credits],
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
    if (hasOptionalTaxData) setTaxOptionalOpen(true)
  }, [hasOptionalTaxData])

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
  const mainRef = useRef(null)
  const pendingCreditFocusRef = useRef(null)

  function lightTap() {
    navigator.vibrate?.(10)
  }

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

  function goToStep(stepId, direction) {
    const newIndex = STEPS.findIndex((s) => s.id === stepId)
    if (newIndex === -1) return
    const dir =
      direction ??
      (newIndex > stepIndex ? 'forward' : newIndex < stepIndex ? 'back' : stepDirection)
    setStepDirection(dir)
    setCurrentStep(stepId)
    requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  function goPrev() {
    if (!canGoPrev) return
    goToStep(STEPS[stepIndex - 1].id, 'back')
  }

  function goNext() {
    if (!canGoNext) return
    lightTap()
    goToStep(STEPS[stepIndex + 1].id, 'forward')
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

  useEffect(() => {
    const id = pendingCreditFocusRef.current
    if (!id) return
    pendingCreditFocusRef.current = null
    requestAnimationFrame(() => {
      document.getElementById(`credit-amount-${id}`)?.focus()
    })
  }, [credits])

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

  function addCredit() {
    const id = uid()
    pendingCreditFocusRef.current = id
    setCredits((prev) => [...prev, { id, amount: '', label: '' }])
  }

  function removeCredit(id) {
    setCredits((prev) => {
      const next = prev.filter((c) => c.id !== id)
      return next.length ? next : [{ id: uid(), amount: '', label: '' }]
    })
  }

  function updateCredit(id, patch) {
    setCredits((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
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
    setTaxAmount('')
    setTipAmount('')
    setSurchargeAmount('')
    setCredits([{ id: uid(), amount: '', label: '' }])
    setTaxOptionalOpen(false)
    setCurrentStep('people')
  }

  function StepNav({ showNext = true }) {
    return (
      <div className="bill-step-nav bill-step-nav--sticky" aria-label="Step navigation">
        <div className="bill-step-nav-buttons">
          <button
            type="button"
            className="bill-btn bill-btn-ghost bill-step-nav-back"
            onClick={goPrev}
            disabled={!canGoPrev}
          >
            ← Back
          </button>

          <div className="bill-step-nav-spacer bill-desktop-only" />

          {showNext ? (
            <button
              type="button"
              className="bill-btn bill-btn-primary bill-step-nav-next"
              onClick={goNext}
              disabled={!canGoNext}
            >
              Next →
            </button>
          ) : (
            <div className="bill-step-nav-spacer bill-mobile-only" />
          )}
        </div>
      </div>
    )
  }

  function renderTaxOptionalFields() {
    return (
      <>
        <div className="bill-tax-adjust bill-tax-adjust--add">
          <div className="bill-tax-adjust__header">
            <span className="bill-tax-adjust__badge" aria-hidden="true">
              +
            </span>
            <div className="bill-tax-adjust__intro">
              <div className="bill-tax-adjust__title-row">
                <h4 className="bill-tax-adjust__title">Surcharge</h4>
                <span className="bill-tax-adjust__tag">Adds to total</span>
              </div>
              <p className="bill-hint bill-hint--tight bill-tax-adjust__hint">
                Venue fee or service charge.
              </p>
            </div>
          </div>
          <label className="bill-label bill-label--optional" htmlFor="surcharge-amount">
            Amount ($)
          </label>
          <input
            id="surcharge-amount"
            className="bill-input bill-input-block bill-input--add"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={surchargeAmount}
            onChange={(e) => setSurchargeAmount(e.target.value)}
          />
        </div>

        <div className="bill-tax-adjust bill-tax-adjust--off" aria-labelledby="credits-heading">
          <div className="bill-tax-adjust__header bill-tax-adjust__header--split">
            <span className="bill-tax-adjust__badge" aria-hidden="true">
              −
            </span>
            <div className="bill-tax-adjust__intro">
              <div className="bill-tax-adjust__title-row">
                <h4 className="bill-tax-adjust__title" id="credits-heading">
                  Credits
                </h4>
                <span className="bill-tax-adjust__tag">Comes off total</span>
              </div>
              <p className="bill-hint bill-hint--tight bill-tax-adjust__hint">
                Discounts, gift cards, or other credits.
              </p>
            </div>
            <button
              type="button"
              className="bill-btn bill-btn-ghost bill-tax-adjust__add-btn"
              onClick={withSparkle(addCredit)}
            >
              Add another
            </button>
          </div>
          <ul className="bill-list bill-credits-list">
            {credits.map((c, i) => (
              <li key={c.id} className="bill-row bill-credit-row">
                <label className="sr-only" htmlFor={`credit-amount-${c.id}`}>
                  Credit amount
                </label>
                <span className="bill-input-prefix bill-input-prefix--off" aria-hidden="true">
                  −$
                </span>
                <input
                  id={`credit-amount-${c.id}`}
                  className="bill-input bill-input-money bill-input--off"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={c.amount}
                  onChange={(e) => updateCredit(c.id, { amount: e.target.value })}
                />
                <label className="sr-only" htmlFor={`credit-label-${c.id}`}>
                  Credit label (optional)
                </label>
                <input
                  id={`credit-label-${c.id}`}
                  className="bill-input bill-input-grow bill-input--off"
                  type="text"
                  placeholder={i === 0 ? 'e.g. Gift card (optional)' : 'Label (optional)'}
                  value={c.label}
                  onChange={(e) => updateCredit(c.id, { label: e.target.value })}
                />
                <button
                  type="button"
                  className="bill-btn bill-btn-ghost"
                  onClick={() => removeCredit(c.id)}
                  disabled={credits.length <= 1 && !c.amount && !c.label}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {sumCreditAmounts(credits) > 0 ? (
            <p className="bill-credits-total">
              Total coming off: <strong>−{formatMoney(sumCreditAmounts(credits))}</strong>
            </p>
          ) : null}
        </div>
      </>
    )
  }

  return (
    <div className="bill-app bill-receipt">
      <header className="bill-header bill-receipt-header">
        <div className="bill-mobile-bar bill-mobile-only">
          <div className="bill-mobile-bar__top">
            <h1 className="bill-mobile-title">
              {restaurantTitle.trim() || 'Split the bill'}
            </h1>
            {currentStep === 'summary' ? (
              <button
                type="button"
                className="bill-btn bill-btn-ghost bill-btn-compact"
                onClick={withSparkle(resetAll)}
              >
                Reset
              </button>
            ) : null}
          </div>
          {currentStep === 'people' ? (
            <>
              <label className="sr-only" htmlFor="restaurant-title-mobile">
                Restaurant or occasion
              </label>
              <input
                id="restaurant-title-mobile"
                className="bill-input bill-mobile-title-input"
                type="text"
                placeholder="Restaurant or occasion (optional)"
                value={restaurantTitle}
                onChange={(e) => setRestaurantTitle(e.target.value)}
              />
            </>
          ) : null}
          <ol className="bill-progress-dots" aria-label="Steps">
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
                ? 'bill-progress-dot bill-progress-dot--current'
                : done
                  ? 'bill-progress-dot bill-progress-dot--done'
                  : 'bill-progress-dot'
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={cls}
                    onClick={() => goToStep(s.id)}
                    aria-label={s.label}
                    aria-current={isCurrent ? 'step' : undefined}
                  />
                </li>
              )
            })}
          </ol>
        </div>

        <p className="bill-receipt-kicker bill-desktop-only">Guest check</p>
        <div className="bill-receipt-meta bill-desktop-only">
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
        <div className="bill-header-top bill-desktop-only">
          <h1 className="bill-title-diner">Split the bill</h1>
          <button type="button" className="bill-btn bill-btn-ghost" onClick={withSparkle(resetAll)}>
            Start Over
          </button>
        </div>
        <div className="bill-row bill-desktop-only" style={{ marginTop: 12 }}>
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

        <nav className="bill-stepper bill-desktop-only" aria-label="Steps">
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

      <main className="bill-main" ref={mainRef}>
      <div className={`bill-step-stage bill-step-stage--${stepDirection}`} key={currentStep}>
      {currentStep === 'people' ? (
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
      ) : null}

      {currentStep === 'items' ? (
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
        <div className="bill-new-item">
          <div className="bill-new-item-step">
            <span className="bill-new-item-step__num" aria-hidden="true">
              1
            </span>
            <div className="bill-new-item-step__body">
              <label className="bill-new-item-step__label" htmlFor="new-item-price">
                Enter the price
              </label>
              <input
                id="new-item-price"
                ref={newItemPriceRef}
                className="bill-input bill-input-money bill-input-block"
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
            </div>
          </div>

          <div className="bill-new-item-step">
            <span className="bill-new-item-step__num" aria-hidden="true">
              2
            </span>
            <fieldset className="bill-assign bill-assign--new">
              <legend className="bill-new-item-step__label">Select who had it</legend>
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
          </div>

          <div className="bill-new-item-step bill-new-item-step--action">
            <span className="bill-new-item-step__num" aria-hidden="true">
              3
            </span>
            <button
              type="button"
              className="bill-btn bill-btn-primary bill-new-item-create"
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

          {newItemError ? (
            <p className="bill-warn" role="status">
              {newItemError}
            </p>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="bill-muted bill-items-empty-callout">
            No items yet. Follow the steps above to add your first one.
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
      ) : null}

      {currentStep === 'tax' ? (
      <section className="bill-panel bill-panel--tax" aria-labelledby="tax-tip-heading">
        <h2 id="tax-tip-heading">Tax &amp; extras</h2>

        <div className="bill-tax-required" aria-labelledby="tax-required-heading">
          <h3 id="tax-required-heading" className="bill-tax-section-title">
            Tax &amp; tip
          </h3>
          <p className="bill-hint bill-tax-section-lede">
            Enter the totals from your receipt. Use 0.00 if either is $0.
          </p>
          <div className="bill-grid-2">
            <div className="bill-tax-field bill-tax-field--required">
              <label className="bill-label" htmlFor="sales-tax">
                Sales tax ($)
              </label>
              <input
                id="sales-tax"
                className="bill-input bill-input-block"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
              />
            </div>
            <div className="bill-tax-field bill-tax-field--required">
              <label className="bill-label" htmlFor="tip-amount">
                Tip ($)
              </label>
              <input
                id="tip-amount"
                className="bill-input bill-input-block"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bill-tax-optional bill-desktop-only" aria-labelledby="tax-optional-heading">
          <h3 id="tax-optional-heading" className="bill-tax-section-title">
            Surcharge &amp; credits
          </h3>
          <p className="bill-hint bill-tax-section-lede">
            Leave blank unless your receipt includes these.
          </p>
          {renderTaxOptionalFields()}
        </div>

        <div className="bill-tax-accordion bill-mobile-only">
          <button
            type="button"
            className="bill-tax-accordion-trigger"
            aria-expanded={taxOptionalOpen}
            aria-controls="tax-optional-panel"
            onClick={() => setTaxOptionalOpen((open) => !open)}
          >
            <span className="bill-tax-accordion-trigger__label">
              More charges &amp; credits
              {!taxOptionalOpen && hasOptionalTaxData ? (
                <span className="bill-tax-accordion-trigger__note">Added</span>
              ) : null}
            </span>
            <span className="bill-tax-accordion-chevron" aria-hidden="true">
              {taxOptionalOpen ? '▾' : '▸'}
            </span>
          </button>
          {taxOptionalOpen ? (
            <div id="tax-optional-panel" className="bill-tax-accordion-panel">
              <p className="bill-hint bill-tax-accordion-lede">
                Leave blank unless your receipt includes these.
              </p>
              {renderTaxOptionalFields()}
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {currentStep === 'summary' ? (
      <section className="bill-panel bill-summary bill-panel--summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>

        <div className="bill-receipt-check bill-receipt-check--compact" role="note">
          <div className="bill-receipt-check__row">
            <span className="bill-receipt-check__label">Receipt total</span>
            <strong className="bill-receipt-check__amount">{formatMoney(totals.grand.total)}</strong>
          </div>
          <p className="bill-receipt-check__note">
            Match your receipt. If not, recheck items and tax &amp; extras.
          </p>
        </div>

        <p className="bill-muted bill-summary-meta bill-desktop-only">
          Tax, tip, and surcharge are split proportionally by each person&apos;s food subtotal.
        </p>

        <ul className="bill-summary-cards bill-mobile-only" aria-label="Per-person totals">
          {totals.rows.map((r) => (
            <li key={r.person.id} className="bill-summary-card">
              <div className="bill-summary-card__top">
                <span className="bill-summary-card__name">
                  {personDisplayName(r.person, people)}
                </span>
                <strong className="bill-summary-card__total">{formatMoney(r.total)}</strong>
              </div>
              <p className="bill-summary-card__breakdown">
                {summaryBreakdownParts(r).join(' · ')}
              </p>
            </li>
          ))}
        </ul>

        <div className="bill-table-wrap bill-desktop-only">
          <table className="bill-table">
            <caption className="sr-only">Per-person amounts</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Subtotal</th>
                <th scope="col">Surcharge</th>
                <th scope="col">Tax</th>
                <th scope="col">Tip</th>
                <th scope="col">Credits</th>
                <th scope="col">Total due</th>
              </tr>
            </thead>
            <tbody>
              {totals.rows.map((r) => (
                <tr key={r.person.id}>
                  <th scope="row">{personDisplayName(r.person, people)}</th>
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
                  {(totals.grand.credits ?? 0) > 0
                    ? `-${formatMoney(totals.grand.credits)}`
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
      ) : null}
      </div>

      <footer className="bill-receipt-footer">
        <p>{receiptFooterLine}</p>
      </footer>
      </main>

      <StepNav showNext={currentStep !== 'summary'} />
    </div>
  )
}
