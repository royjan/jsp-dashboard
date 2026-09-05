'use client'

/**
 * A select-all that says what it selected.
 *
 * `ebay-reco` is one of the tables deliberately kept off <DataTable>, and this
 * is why: DataTable's header checkbox covers every row it holds, and that
 * table's action sends OUTWARD — to the eBay Uploader. Quietly widening the
 * scope of a selection there is not a table bug, it is a wrong shipment.
 *
 * So the two scopes are never the same control. Ticking the box selects THE
 * PAGE. Extending to the whole filtered set is a second, explicit act, and the
 * action button counts what will actually leave: 'שלח 20' and 'שלח 1,284' are
 * different sentences and a person reading either one knows which they pressed.
 */

import { cn } from './cn'

export interface SelectionScopeProps {
  /** Rows selected on the page right now. */
  pageCount: number
  /** Rows the current filter matches in total, across all pages. */
  filterCount: number
  scope: 'page' | 'filter'
  onScopeChange: (scope: 'page' | 'filter') => void
  /** Verb for the outward action, e.g. 'שלח למעלה eBay'. */
  actionLabel: string
  onAction: () => void
  /** Set when the action leaves the system — adds the warning line. */
  outward?: boolean
  className?: string
}

export function SelectionScope({
  pageCount, filterCount, scope, onScopeChange, actionLabel, onAction,
  outward = false, className,
}: SelectionScopeProps) {
  const n = scope === 'page' ? pageCount : filterCount
  const more = filterCount > pageCount

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-[var(--jan-radius)] border',
        'border-[var(--jan-rule)] bg-[var(--jan-steel)] px-3.5 py-3',
        className,
      )}
    >
      <span className="text-[14px]">
        נבחרו <b className="text-[var(--jan-callout)] tabular-nums">{n.toLocaleString('he-IL')}</b>
        {' '}פריטים · {scope === 'page' ? 'העמוד הנוכחי' : `כל ${filterCount.toLocaleString('he-IL')} התוצאות בסינון`}
      </span>

      {/* Extending the scope is a link, not a checkbox: it is a decision, and it
          is reversible in one click by the same control. */}
      {more && (
        <button
          type="button"
          onClick={() => onScopeChange(scope === 'page' ? 'filter' : 'page')}
          className="text-[13px] font-semibold text-[var(--jan-callout)] underline underline-offset-2"
        >
          {scope === 'page'
            ? `בחר את כל ${filterCount.toLocaleString('he-IL')} התוצאות`
            : 'צמצם לעמוד הנוכחי'}
        </button>
      )}

      <button
        type="button"
        onClick={onAction}
        className={cn(
          'ms-auto rounded-[var(--jan-radius)] bg-[var(--jan-callout)] px-4 py-2',
          'text-[13px] font-bold text-[var(--jan-plate)]',
        )}
      >
        {actionLabel} · {n.toLocaleString('he-IL')}
      </button>

      {outward && scope === 'filter' && (
        <span className="basis-full text-[12.5px] text-[var(--jan-callout)]">
          ההיקף הורחב מעבר לעמוד, והפעולה יוצאת מהמערכת.
        </span>
      )}
    </div>
  )
}

export default SelectionScope
