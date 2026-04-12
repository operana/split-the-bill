import { useMemo, useState } from 'react'
import './App.css'

const TIP_PRESETS = [15, 18, 20]
const DEFAULT_TAX = 11.75

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

function round2(n) {
  return Math.round(n * 100) / 100
}

export default function App() {
  const [people, setPeople] = useState(() => [{ id: uid(), name: '' }])
  const [items, setItems] = useState(() => [])
  const [taxPercent, setTaxPercent] = useState(String(DEFAULT_TAX))
  const [tipMode, setTipMode] = useState('preset')
  const [tipPreset, setTipPreset] = useState(18)
  const [manualTip, setManualTip] = useState('')

  const taxRate = parseMoney(taxPercent) / 100

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
      const tax = round2(sub * taxRate)
      const tip = round2(sub * tipPercentEffective)
      const total = round2(sub + tax + tip)
      return {
        person: p,
        subtotal: sub,
        tax,
        tip,
        total,
      }
    })

    const grand = {
      subtotal: round2(rows.reduce((s, r) => s + r.subtotal, 0)),
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
  }, [people, items, taxRate, tipMode, tipPreset, manualTip])

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

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: uid(),
        label: '',
        price: '',
        assigneeIds: [],
      },
    ])
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

  return (
    <div className="bill-app">
      <header className="bill-header">
        <h1>Split the bill</h1>
        <p className="bill-lede">
          Add people and line items, assign who shared each item, then review
          tax and tip per person.
        </p>
      </header>

      <section className="bill-panel" aria-labelledby="people-heading">
        <h2 id="people-heading">People</h2>
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
        <button type="button" className="bill-btn bill-btn-primary" onClick={addPerson}>
          Add person
        </button>
      </section>

      <section className="bill-panel" aria-labelledby="items-heading">
        <h2 id="items-heading">Items</h2>
        {items.length === 0 ? (
          <p className="bill-muted">No items yet. Add a line item to get started.</p>
        ) : null}
        <ul className="bill-items">
          {items.map((it) => (
            <li key={it.id} className="bill-item-card">
              <div className="bill-item-top">
                <label className="sr-only" htmlFor={`item-label-${it.id}`}>
                  Item description
                </label>
                <input
                  id={`item-label-${it.id}`}
                  className="bill-input bill-input-grow"
                  type="text"
                  placeholder="Item (e.g. Pizza)"
                  value={it.label}
                  onChange={(e) => updateItem(it.id, { label: e.target.value })}
                />
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
                    Select at least one person so this item counts toward a share.
                  </p>
                ) : null}
              </fieldset>
            </li>
          ))}
        </ul>
        <button type="button" className="bill-btn bill-btn-primary" onClick={addItem}>
          Add item
        </button>
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
                {TIP_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className={
                      tipPreset === pct ? 'bill-pill bill-pill-active' : 'bill-pill'
                    }
                    onClick={() => setTipPreset(pct)}
                  >
                    {pct}%
                  </button>
                ))}
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
      </section>

      <section className="bill-panel bill-summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>
        <p className="bill-muted bill-summary-meta">
          Tax and tip use each person&apos;s food subtotal (before tax), not an
          even split across the table.
          {tipMode === 'preset' ? (
            <>
              {' '}
              Tip rate: <strong>{tipPreset}%</strong> of each subtotal.
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
          <table className="bill-table">
            <caption className="sr-only">Per-person amounts</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Subtotal</th>
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
                <th scope="row">Bill (assigned shares)</th>
                <td>{formatMoney(totals.grand.subtotal)}</td>
                <td>{formatMoney(totals.grand.tax)}</td>
                <td>{formatMoney(totals.grand.tip)}</td>
                <td>
                  <strong>{formatMoney(totals.grand.total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  )
}
