import { useEffect, useMemo, useRef, useState } from 'react'



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
  { id: 'tax', label: 'Tax & tip' },
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
  tipMode,
  tipPreset,
}) {
  const taxLabel = parseMoney(taxPercent).toFixed(2)
  const surchargeLabel = parseMoney(surchargePercent).toFixed(2)
  const title = String(restaurantTitle ?? '').trim()
  const lines = [title ? `Split the bill — ${title}` : 'Split the bill — totals', '']

  for (const r of totals.rows) {
    const idx = people.findIndex((x) => x.id === r.person.id)
    const name = r.person.name.trim() || `Person ${idx + 1}`
    lines.push(`${name}`)
    lines.push(`  TOTAL: ${formatMoney(r.total)}`)
    lines.push(`  Subtotal: ${formatMoney(r.subtotal)}`)
    lines.push(`  Surcharge (${surchargeLabel}%): ${formatMoney(r.surcharge)}`)
    lines.push(`  Tax (${taxLabel}%): ${formatMoney(r.tax)}`)
    lines.push(
      `  Tip${tipMode === 'preset' ? ` (${tipPreset}%)` : ' (manual share)'}: ${formatMoney(r.tip)}`,
    )

    lines.push('')
    lines.push('')
  }

  lines.push('Receipt (all items)')
  lines.push(`  Total: ${formatMoney(totals.grand.total)}`)
  lines.push(`  Subtotal: ${formatMoney(totals.grand.subtotal)}`)
  lines.push(`  Surcharge: ${formatMoney(totals.grand.surcharge)}`)
  lines.push(`  Tax: ${formatMoney(totals.grand.tax)}`)
  lines.push(`  Tip: ${formatMoney(totals.grand.tip)}`)

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
  const [tipMode, setTipMode] = useState('preset')
  const [tipPreset, setTipPreset] = useState(18)
  const [manualTip, setManualTip] = useState('')
  const [currentStep, setCurrentStep] = useState('people')

  const taxRate = parseMoney(taxPercent) / 100
  const surchargeRate = parseMoney(surchargePercent) / 100

  const totals = useMemo(() => {
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

    const rows = people.map((p) => {
      const sub = personSubtotals[p.id] ?? 0
      const surcharge = round2(sub * surchargeRate)
      const tax = round2(sub * taxRate)
      const tip = round2(sub * tipPercentEffective)
      const total = round2(sub + surcharge + tax + tip)
      return {
        person: p,
        subtotal: sub,
        surcharge,
        tax,
        tip,
        total,
      }
    })

    const grand = {
      subtotal: round2(rows.reduce((s, r) => s + r.subtotal, 0)),
      surcharge: round2(rows.reduce((s, r) => s + r.surcharge, 0)),
      tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
      tip: round2(rows.reduce((s, r) => s + r.tip, 0)),
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
    }

    return {
      personSubtotals,
      rows,
      unassignedItems,
      assignedSubtotalSum,
      tipPercentEffective,
      manualTipPercentDisplay,
      grand,
    }
  }, [people, items, taxRate, surchargeRate, tipMode, tipPreset, manualTip])

  const shareText = useMemo(
    () =>
      buildShareText({
        restaurantTitle,
        people,
        totals,
        taxPercent,
        surchargePercent,
        tipMode,
        tipPreset,
      }),
    [restaurantTitle, people, totals, taxPercent, surchargePercent, tipMode, tipPreset],
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
    setTipMode('preset')
    setTipPreset(18)
    setManualTip('')
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
        <h2 id="tax-tip-heading">Tax &amp; tip</h2>
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
        </div>
        <div className="bill-surcharge-field">
          <label className="bill-label" htmlFor="surcharge-pct">
            Surcharge (%)
          </label>
          <p className="bill-hint">
            Optional fee some venues add (e.g. service or card processing).
            Applied to each person&apos;s food share, like tax.
          </p>
          <input
            id="surcharge-pct"
            className="bill-input bill-input-block"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={surchargePercent}
            onChange={(e) => setSurchargePercent(e.target.value)}
          />
        </div>
      </section>
      <StepNav />
      </>
      ) : null}

      {currentStep === 'summary' ? (
      <>
      <section className="bill-panel bill-summary bill-panel--summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>
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
                  Surcharge ({parseMoney(surchargePercent).toFixed(2)}%)
                </th>
                <th scope="col">Tax ({parseMoney(taxPercent).toFixed(2)}%)</th>
                <th scope="col">
                  Tip
                  {tipMode === 'preset' ? ` (${tipPreset}%)` : ''}
                </th>
                <th scope="col">Total</th>
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
