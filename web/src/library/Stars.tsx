export function Stars({ value, onChange, size = 'normal' }: { value: number; onChange?: (v: number) => void; size?: 'small' | 'normal' }) {
  return (
    <span className={`stars ${size}`} role={onChange ? 'radiogroup' : undefined} aria-label={`${value} stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            className={n <= value ? 'on' : ''}
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onChange(n === value ? 0 : n)
            }}
          >★</button>
        ) : (
          <span key={n} className={n <= value ? 'on' : ''}>★</span>
        ),
      )}
    </span>
  )
}
