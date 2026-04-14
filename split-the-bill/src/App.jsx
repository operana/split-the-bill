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
  const [bulkPricesText, setBulkPricesText] = useState('')
  const [bulkAddError, setBulkAddError] = useState('')
  const [celebrateReady, setCelebrateReady] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
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

  function parseBulkPrices(text) {
    const tokens = String(text)
      .replace(/\r\n/g, '\n')
      .split(/[\s,]+/g)
      .map((t) => t.trim())
      .filter(Boolean)

    const prices = []
    for (const tok of tokens) {
      const n = round2(parseMoney(tok))
      if (!Number.isFinite(n)) continue
      // Keep even 0.00 if user explicitly entered it.
      if (n === 0 && !/0/.test(tok)) continue
      prices.push(n.toFixed(2))
    }
    return prices
  }

  const bulkParsedPrices = useMemo(() => parseBulkPrices(bulkPricesText), [bulkPricesText])

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

  function addItemsFromBulk() {
    const prices = parseBulkPrices(bulkPricesText)

    if (prices.length === 0) {
      setBulkAddError('Enter at least one price.')
      return
    }

    setBulkAddError('')
    const next = prices.map((p) => ({
      id: uid(),
      label: '',
      price: p,
      assigneeIds: [],
    }))
    setItems((prev) => [...prev, ...next])
    setBulkPricesText('')
  }

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
            <strong className="bill-check-number">{checkNumber}</strong>
          </span>
        </div>
        <div className="bill-header-top">
          <h1 className="bill-title-diner">Split the bill</h1>
          <button type="button" className="bill-btn bill-btn-ghost" onClick={withSparkle(resetAll)}>
            Reset
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
            placeholder="Restaurant title (optional)"
            value={restaurantTitle}
            onChange={(e) => setRestaurantTitle(e.target.value)}
          />
        </div>
        <p className="bill-lede">
          Add people and line items, assign who ate or shared each item, then review
          tax, optional surcharge, and tip per person. ☺︎ 
        </p>
      </header>

      <div className="bill-category-rail" aria-hidden="true">
        People — Items — Tax &amp; tip — Total
      </div>

      <section className="bill-panel" aria-labelledby="people-heading">
        <div className="bill-panel-heading-row">
          <h2 id="people-heading">People</h2>
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

      <section
        className="bill-panel bill-panel--items"
        aria-labelledby="items-heading"
      >
        <h2 id="items-heading">
          Items <span className="bill-count-pill">{items.length}</span>
        </h2>
        <p className="bill-muted bill-items-lede">
          Add prices to create items, then assign who ate or shared each one.
        </p>
        <div className="bill-row" style={{ marginTop: 10, marginBottom: 12 }}>
          <input
            className="bill-input bill-input-grow"
            type="text"
            placeholder="Type all prices (space/comma to separate). Example: 12.50, 8, 3.25"
            value={bulkPricesText}
            onChange={(e) => {
              setBulkPricesText(e.target.value)
              if (bulkAddError) setBulkAddError('')
            }}
          />
          <button
            type="button"
            className="bill-btn bill-btn-primary"
            onClick={withSparkle(addItemsFromBulk)}
            disabled={bulkParsedPrices.length === 0}
          >
            Create {bulkParsedPrices.length || ''} item{bulkParsedPrices.length === 1 ? '' : 's'}
          </button>
        </div>
        <p className="bill-muted bill-bulk-hint">
          Detected <strong>{bulkParsedPrices.length}</strong> price
          {bulkParsedPrices.length === 1 ? '' : 's'}.
        </p>
        {bulkAddError ? (
          <p className="bill-warn" role="status" style={{ marginTop: -6 }}>
            {bulkAddError}
          </p>
        ) : null}
        {items.length === 0 ? (
          <p className="bill-muted">No items yet. Add a price to get started.</p>
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

      <section className="bill-panel" aria-labelledby="tax-tip-heading">
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

      <section className="bill-panel bill-summary" aria-labelledby="summary-heading">
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

      <footer className="bill-receipt-footer">
        <p>
          Thank you · Please come again{' '}
          <span className="bill-receipt-smile" aria-hidden="true">
            ☺
          </span>
          - Leah
        </p>
      </footer>
    </div>
  )
}
