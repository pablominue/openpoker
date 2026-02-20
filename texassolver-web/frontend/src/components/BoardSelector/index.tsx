import { RANKS, SUITS, SUIT_SYMBOLS, SUIT_COLORS, type Card, type Suit } from '../../lib/poker';

interface Props {
  value: Card[];
  onChange: (cards: Card[]) => void;
  maxCards?: number;
}

const STREET_LABELS = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River'];

export default function BoardSelector({ value, onChange, maxCards = 5 }: Props) {
  const selected = new Set(value);

  const toggle = (card: Card) => {
    if (selected.has(card)) {
      onChange(value.filter(c => c !== card));
    } else if (value.length < maxCards) {
      onChange([...value, card]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Selected board display */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {STREET_LABELS.slice(0, maxCards).map((label, i) => {
          const card = value[i];
          const suit = card ? (card[1] as Suit) : null;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div
                style={{
                  width: 44,
                  height: 62,
                  borderRadius: '8px',
                  border: card ? '1.5px solid var(--accent)' : '1.5px dashed var(--border)',
                  background: card ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: card ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                  boxShadow: card ? 'var(--shadow-sm)' : 'none',
                  position: 'relative',
                }}
                onClick={() => card && toggle(card)}
                title={card ? `Remove ${card}` : `Select ${label}`}
              >
                {card ? (
                  <>
                    <span style={{
                      fontSize: '18px', fontWeight: 800, color: suit ? SUIT_COLORS[suit] : 'var(--text-primary)',
                      lineHeight: 1,
                    }}>{card[0]}</span>
                    <span style={{
                      fontSize: '16px', color: suit ? SUIT_COLORS[suit] : 'var(--text-primary)', lineHeight: 1,
                    }}>{suit ? SUIT_SYMBOLS[suit] : ''}</span>
                    {/* Remove × */}
                    <div style={{
                      position: 'absolute', top: 2, right: 4, fontSize: '10px', color: 'var(--text-muted)',
                      opacity: 0.7, lineHeight: 1,
                    }}>×</div>
                  </>
                ) : (
                  <span style={{ fontSize: '20px', color: 'var(--text-muted)', opacity: 0.4 }}>+</span>
                )}
              </div>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}
              </span>
            </div>
          );
        })}

        {value.length > 0 && (
          <button
            onClick={() => onChange([])}
            style={{
              alignSelf: 'flex-start',
              marginTop: '2px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'var(--border-subtle)' }} />

      {/* Card picker grid — by suit */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {SUITS.map(suit => (
          <div key={suit} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Suit label */}
            <div style={{
              width: 22,
              textAlign: 'center',
              fontSize: '16px',
              color: SUIT_COLORS[suit],
              flexShrink: 0,
            }}>
              {SUIT_SYMBOLS[suit]}
            </div>

            {/* Rank buttons */}
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {RANKS.map(rank => {
                const card = `${rank}${suit}` as Card;
                const isSelected = selected.has(card);
                const isDisabled = !isSelected && value.length >= maxCards;
                return (
                  <button
                    key={rank}
                    onClick={() => toggle(card)}
                    disabled={isDisabled}
                    title={`${rank}${SUIT_SYMBOLS[suit]}`}
                    style={{
                      width: 28,
                      height: 32,
                      borderRadius: '5px',
                      border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: isSelected ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      color: isSelected ? SUIT_COLORS[suit] : (isDisabled ? 'var(--text-muted)' : SUIT_COLORS[suit]),
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.35 : 1,
                      transition: 'all 0.1s',
                      boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onMouseEnter={e => { if (!isDisabled && !isSelected) e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    {rank}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {value.length > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          Solver notation: <strong style={{ color: 'var(--accent-text)' }}>{value.join(',')}</strong>
        </div>
      )}
    </div>
  );
}
