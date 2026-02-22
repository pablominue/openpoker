import { useState, useRef } from 'react';
import { uploadHands, getHands, deleteHand } from '../api/hands';
import { usePlayer } from '../contexts/PlayerContext';

interface Hand {
  id: string; hand_id_raw: string; played_at: string; stakes_bb: number;
  table_name: string; hero_position: string | null; hero_hole_cards: string | null;
  board: string | null; hero_result: number; hero_won: boolean; vpip: boolean; pfr: boolean;
}

interface UploadStats { parsed: number; skipped: number; duplicate: number; }

function bbDisplay(cents: number, bb: number): string {
  if (bb === 0) return `${(cents / 100).toFixed(2)}€`;
  const bbs = cents / bb;
  return `${bbs >= 0 ? '+' : ''}${bbs.toFixed(1)}bb`;
}

export default function HandsPage() {
  const { selectedPlayer, refreshPlayers } = usePlayer();
  const [hands, setHands] = useState<Hand[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const PER_PAGE = 50;

  const load = async (p = page) => {
    if (!selectedPlayer) return;
    setLoading(true);
    try {
      const data = await getHands(selectedPlayer, p, PER_PAGE);
      setHands(data.hands);
      setTotal(data.total);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleFiles = async (files: File[]) => {
    const txtFiles = files.filter(f => f.name.endsWith('.txt'));
    if (txtFiles.length === 0 || !selectedPlayer) return;

    setUploading(true);
    setUploadMsg(null);
    setUploadProgress({ done: 0, total: txtFiles.length });

    const totals: UploadStats = { parsed: 0, skipped: 0, duplicate: 0 };
    const errors: string[] = [];

    for (let i = 0; i < txtFiles.length; i++) {
      try {
        const res = await uploadHands(txtFiles[i], selectedPlayer);
        totals.parsed += res.parsed;
        totals.skipped += res.skipped;
        totals.duplicate += res.duplicate;
      } catch (err: unknown) {
        errors.push(`${txtFiles[i].name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      setUploadProgress({ done: i + 1, total: txtFiles.length });
    }

    await refreshPlayers();
    load(1);
    setUploadProgress(null);
    setUploading(false);

    if (errors.length > 0) {
      setUploadMsg(`Errors in ${errors.length} file(s): ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`);
    } else {
      const label = txtFiles.length > 1 ? `${txtFiles.length} files` : txtFiles[0].name;
      setUploadMsg(`${label} → ${totals.parsed} imported · ${totals.duplicate} duplicates · ${totals.skipped} skipped`);
    }

    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    handleFiles(files);
  };

  const handleDelete = async (id: string) => {
    if (!selectedPlayer) return;
    await deleteHand(id, selectedPlayer);
    setHands(prev => prev.filter(h => h.id !== id));
    setTotal(prev => prev - 1);
  };

  if (!selectedPlayer) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>♠</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
          Select a player to view hands
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Use the player selector in the top-right to choose a player,
          or enter your PokerStars username to get started.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '24px' }}>
        Hand History — <span style={{ color: 'var(--accent)' }}>{selectedPlayer}</span>
      </h1>

      {/* Upload area */}
      <div style={{
        marginBottom: '24px', padding: '20px', borderRadius: '12px',
        border: '2px dashed var(--border)', background: 'var(--bg-surface)',
      }}>
        {/* Hidden inputs */}
        <input
          ref={fileRef}
          type="file"
          accept=".txt"
          multiple
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
        <input
          ref={folderRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard
          webkitdirectory=""
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={btnStyle(uploading)}
          >
            {uploading ? `Importing… (${uploadProgress?.done ?? 0}/${uploadProgress?.total ?? '?'})` : '↑ Upload .txt files'}
          </button>
          <button
            onClick={() => folderRef.current?.click()}
            disabled={uploading}
            style={{ ...btnStyle(uploading), background: 'var(--bg-elevated)' }}
          >
            📁 Upload folder
          </button>
          {!loaded && (
            <button
              onClick={() => load(1)}
              disabled={loading}
              style={{ padding: '9px 18px', borderRadius: '9px', border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
            >
              {loading ? 'Loading…' : 'Load hands'}
            </button>
          )}
          {total > 0 && <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{total} hands total</span>}
        </div>

        {uploadProgress && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '2px', background: 'var(--accent)',
                width: `${Math.round(uploadProgress.done / uploadProgress.total * 100)}%`,
                transition: 'width 0.2s',
              }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {uploadProgress.done} / {uploadProgress.total} files processed
            </div>
          </div>
        )}

        {uploadMsg && (
          <div style={{ marginTop: '10px', fontSize: '12px', color: uploadMsg.startsWith('Error') ? 'var(--danger)' : 'var(--info)' }}>
            {uploadMsg}
          </div>
        )}
      </div>

      {/* Hands table */}
      {loaded && (
        <>
          <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Position', 'Hand', 'Board', 'Result', 'VPIP', 'PFR', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hands.map((hand, i) => (
                  <tr key={hand.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'var(--bg-base)' : 'var(--bg-surface)' }}>
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(hand.played_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {hand.hero_position || '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontFamily: 'monospace', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>
                      {hand.hero_hole_cards ? formatCards(hand.hero_hole_cards) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {hand.board ? formatCards(hand.board) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, fontFamily: 'monospace', color: hand.hero_result >= 0 ? 'var(--info)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                      {bbDisplay(hand.hero_result, hand.stakes_bb)}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}><Badge on={hand.vpip} /></td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}><Badge on={hand.pfr} /></td>
                    <td style={{ padding: '9px 12px' }}>
                      <button onClick={() => handleDelete(hand.id)} style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid var(--danger)', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                    </td>
                  </tr>
                ))}
                {hands.length === 0 && !loading && (
                  <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>No hands yet. Upload a PokerStars hand history file.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {total > PER_PAGE && (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
              <PagBtn label="← Prev" disabled={page === 1} onClick={() => { setPage(p => p - 1); load(page - 1); }} />
              <span style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {page} / {Math.ceil(total / PER_PAGE)}
              </span>
              <PagBtn label="Next →" disabled={page >= Math.ceil(total / PER_PAGE)} onClick={() => { setPage(p => p + 1); load(page + 1); }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '9px 18px', borderRadius: '9px', border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600,
    opacity: disabled ? 0.5 : 1,
  };
}

function formatCards(s: string): string {
  return s.match(/.{2}/g)?.join(' ') ?? s;
}

function Badge({ on }: { on: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: on ? 'var(--info)' : 'var(--bg-hover)',
    }} />
  );
}

function PagBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: '6px 14px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: disabled ? 'var(--text-muted)' : 'var(--text-primary)', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '12px' }}>
      {label}
    </button>
  );
}
