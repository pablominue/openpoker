/**
 * AIPage — Poker AI Agent chat interface with flexible context injection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent, ChangeEvent as ReactChangeEvent } from "react";
import { usePlayer } from "../contexts/PlayerContext";
import {
  createConversation,
  deleteConversation,
  deleteDocument,
  getConversation,
  listConversations,
  listDocuments,
  sendMessage,
  uploadDocument,
  type AIDocument,
  type Conversation,
  type ContextConfig,
  type Message,
} from "../api/ai";
import { getHands } from "../api/hands";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderMarkdown(text: string): ReactNode[] {
  // Very minimal markdown: bold, inline code, code blocks, bullet lists
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={i} style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "10px 12px",
          overflowX: "auto",
          fontSize: 12,
          margin: "6px 0",
        }}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
    } else {
      nodes.push(<MdLine key={i} text={line} />);
    }
    i++;
  }
  return nodes;
}

function MdLine({ text }: { text: string }) {
  if (!text.trim()) return <br />;

  const isH2 = text.startsWith("## ");
  const isH3 = text.startsWith("### ");
  const isBullet = text.startsWith("- ") || text.startsWith("* ");

  const content = isH2 ? text.slice(3) : isH3 ? text.slice(4) : isBullet ? text.slice(2) : text;

  const rendered = renderInline(content);

  if (isH2) return <p style={{ fontWeight: 700, fontSize: 14, margin: "10px 0 4px", color: "var(--accent-text)" }}>{rendered}</p>;
  if (isH3) return <p style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 2px" }}>{rendered}</p>;
  if (isBullet) return <p style={{ margin: "2px 0", paddingLeft: 14, position: "relative" }}>
    <span style={{ position: "absolute", left: 0 }}>•</span>{rendered}
  </p>;
  return <p style={{ margin: "3px 0" }}>{rendered}</p>;
}

function renderInline(text: string): ReactNode {
  // Bold (**text**) and inline code (`code`)
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} style={{
        background: "var(--bg-base)",
        border: "1px solid var(--border)",
        borderRadius: 3,
        padding: "1px 4px",
        fontSize: "0.9em",
        fontFamily: "monospace",
      }}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// GTO Spots quick-fetch
// ---------------------------------------------------------------------------

async function fetchSolvedSpots(): Promise<Array<{ key: string; label: string }>> {
  try {
    const res = await fetch("/api/trainer/spots");
    if (!res.ok) return [];
    const data = await res.json();
    return (data as Array<{ spot_key: string; label: string; solve_status: string }>)
      .filter(s => s.solve_status === "ready")
      .map(s => ({ key: s.spot_key, label: s.label }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConversationItem({
  conv,
  active,
  onSelect,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: active ? "var(--accent-dim)" : hovering ? "var(--bg-elevated)" : "transparent",
        border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: active ? 700 : 500,
          color: active ? "var(--accent-text)" : "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {conv.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {formatDate(conv.updated_at)} · {conv.message_count} msg{conv.message_count !== 1 ? "s" : ""}
        </div>
      </div>
      {hovering && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 13,
            padding: "0 2px",
            flexShrink: 0,
          }}
          title="Delete"
        >
          ×
        </button>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message | { role: string; content: string; id: string; streaming?: boolean } }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 12,
    }}>
      {!isUser && (
        <div style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          color: "#fff",
          flexShrink: 0,
          marginRight: 8,
          marginTop: 2,
        }}>
          ♠
        </div>
      )}
      <div style={{
        maxWidth: "74%",
        padding: "10px 13px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
        background: isUser ? "var(--accent)" : "var(--bg-elevated)",
        color: isUser ? "#fff" : "var(--text-primary)",
        border: isUser ? "none" : "1px solid var(--border-subtle)",
        fontSize: 13,
        lineHeight: 1.55,
      }}>
        {isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
        ) : (
          <div>{renderMarkdown(msg.content)}</div>
        )}
        {"streaming" in msg && msg.streaming && (
          <span style={{ display: "inline-block", marginLeft: 4 }}>
            <span style={{ animation: "blink 1s infinite", opacity: 0.7 }}>▍</span>
          </span>
        )}
      </div>
    </div>
  );
}

function HandPickerModal({
  playerName,
  selectedIds,
  onClose,
  onApply,
}: {
  playerName: string;
  selectedIds: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [hands, setHands] = useState<Array<{
    id: string; hero_position: string; hero_hole_cards: string;
    board: string; hero_result: number; stakes_bb: number; played_at: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [posFilter, setPosFilter] = useState("");

  useEffect(() => {
    if (!playerName) { setLoading(false); return; }
    getHands(playerName, 1, 100, posFilter ? { position: posFilter } : undefined)
      .then((data: { hands: typeof hands }) => setHands(data.hands || []))
      .catch(() => setHands([]))
      .finally(() => setLoading(false));
  }, [playerName, posFilter]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        width: 600,
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, flex: 1, fontSize: 14 }}>Select Hands for Context</span>
          <div style={{ display: "flex", gap: 4 }}>
            {POSITIONS.map(p => (
              <button key={p} onClick={() => setPosFilter(posFilter === p ? "" : p)} style={{
                padding: "3px 8px", borderRadius: 5, border: "1px solid var(--border)",
                background: posFilter === p ? "var(--accent-dim)" : "var(--bg-elevated)",
                color: posFilter === p ? "var(--accent-text)" : "var(--text-secondary)",
                fontSize: 11, cursor: "pointer",
              }}>{p}</button>
            ))}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>Loading...</div>
          ) : hands.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>No hands found{posFilter ? ` in ${posFilter}` : ""}.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px", width: 28 }}></th>
                  <th style={{ padding: "4px 8px" }}>Date</th>
                  <th style={{ padding: "4px 8px" }}>Pos</th>
                  <th style={{ padding: "4px 8px" }}>Cards</th>
                  <th style={{ padding: "4px 8px" }}>Board</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {hands.map(h => {
                  const bb = h.hero_result / Math.max(h.stakes_bb, 1) / 100;
                  const isSelected = selected.has(h.id);
                  return (
                    <tr
                      key={h.id}
                      onClick={() => toggle(h.id)}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "var(--accent-dim)" : "transparent",
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <td style={{ padding: "5px 8px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          readOnly
                          checked={isSelected}
                          style={{ accentColor: "var(--accent)" }}
                        />
                      </td>
                      <td style={{ padding: "5px 8px", color: "var(--text-muted)" }}>
                        {new Date(h.played_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </td>
                      <td style={{ padding: "5px 8px" }}>{h.hero_position || "?"}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{h.hero_hole_cards || "??"}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", color: "var(--text-secondary)" }}>
                        {h.board || "-"}
                      </td>
                      <td style={{
                        padding: "5px 8px", textAlign: "right", fontWeight: 600,
                        color: bb >= 0 ? "var(--color-green, #22c55e)" : "var(--color-red, #ef4444)",
                      }}>
                        {bb >= 0 ? "+" : ""}{bb.toFixed(1)}bb
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {selected.size} hand{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setSelected(new Set())} style={{
              padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)",
              background: "var(--bg-elevated)", color: "var(--text-secondary)",
              cursor: "pointer", fontSize: 12,
            }}>Clear</button>
            <button onClick={() => onApply([...selected])} style={{
              padding: "5px 14px", borderRadius: 6, border: "none",
              background: "var(--accent)", color: "#fff",
              cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}>Apply ({selected.size})</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AIPage() {
  const { selectedPlayer } = usePlayer();
  const playerName = selectedPlayer || "";

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Array<Message | { id: string; role: string; content: string; streaming?: boolean }>>([]);
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Context config
  const [includeStats, setIncludeStats] = useState(false);
  const [includeRanges, setIncludeRanges] = useState(false);
  const [includeRecentHands, setIncludeRecentHands] = useState(false);
  const [selectedHandIds, setSelectedHandIds] = useState<string[]>([]);
  const [showHandPicker, setShowHandPicker] = useState(false);
  const [selectedSpotKeys, setSelectedSpotKeys] = useState<string[]>([]);
  const [solvedSpots, setSolvedSpots] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [documents, setDocuments] = useState<AIDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sidebar state
  const [showContextPanel, setShowContextPanel] = useState(false);

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  const loadConversations = useCallback(async () => {
    if (!playerName) return;
    setLoadingConvs(true);
    try {
      const convs = await listConversations(playerName);
      setConversations(convs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingConvs(false);
    }
  }, [playerName]);

  const loadDocuments = useCallback(async () => {
    if (!playerName) return;
    try {
      const docs = await listDocuments(playerName);
      setDocuments(docs);
    } catch (e) {
      console.error(e);
    }
  }, [playerName]);

  useEffect(() => {
    if (playerName) {
      loadConversations();
      loadDocuments();
      fetchSolvedSpots().then(setSolvedSpots);
    }
  }, [playerName, loadConversations, loadDocuments]);

  // Load conversation messages when switching
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    getConversation(activeConvId)
      .then(conv => {
        setMessages(conv.messages);
      })
      .catch(console.error);
  }, [activeConvId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleNewConversation = async () => {
    if (!playerName) return;
    try {
      const conv = await createConversation(playerName);
      setConversations(prev => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || streaming || !playerName) return;

    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await createConversation(playerName);
        setConversations(prev => [conv, ...prev]);
        setActiveConvId(conv.id);
        convId = conv.id;
      } catch (e) {
        console.error(e);
        return;
      }
    }

    const userMsg = { id: `tmp-${Date.now()}`, role: "user", content: inputValue.trim() };
    const assistantMsg = { id: `tmp-${Date.now()}-ai`, role: "assistant", content: "", streaming: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputValue("");
    setStreaming(true);

    const context: ContextConfig = {
      include_stats: includeStats,
      include_ranges: includeRanges,
      hand_ids: selectedHandIds.length > 0 ? selectedHandIds : undefined,
      hand_filter: includeRecentHands && selectedHandIds.length === 0 ? { limit: 30 } : undefined,
      gto_spot_keys: selectedSpotKeys.length > 0 ? selectedSpotKeys : undefined,
      document_ids: selectedDocIds.length > 0 ? selectedDocIds : undefined,
    };

    const abort = new AbortController();
    abortRef.current = abort;

    let accum = "";
    await sendMessage(convId, playerName, userMsg.content, context, {
      onChunk: chunk => {
        accum += chunk;
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id ? { ...m, content: accum } : m
        ));
      },
      onDone: () => {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id ? { ...m, streaming: false } : m
        ));
        setStreaming(false);
        // Refresh conversation list for updated title/timestamp
        loadConversations();
      },
      onError: err => {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${err}`, streaming: false }
            : m
        ));
        setStreaming(false);
      },
    }, abort.signal);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStopStreaming = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages(prev => prev.map(m =>
      "streaming" in m && m.streaming ? { ...m, streaming: false } : m
    ));
  };

  const handleDocUpload = async (e: ReactChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !playerName) return;
    setUploadingDoc(true);
    try {
      const doc = await uploadDocument(playerName, file);
      setDocuments(prev => [doc, ...prev]);
      setSelectedDocIds(prev => [...prev, doc.id]);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await deleteDocument(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      setSelectedDocIds(prev => prev.filter(x => x !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSpot = (key: string) => {
    setSelectedSpotKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // ---------------------------------------------------------------------------
  // Count active context items
  // ---------------------------------------------------------------------------
  const activeContextCount = [
    includeStats,
    includeRanges,
    includeRecentHands || selectedHandIds.length > 0,
    selectedSpotKeys.length > 0,
    selectedDocIds.length > 0,
  ].filter(Boolean).length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!playerName) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "60vh",
        flexDirection: "column",
        gap: 12,
        color: "var(--text-muted)",
      }}>
        <span style={{ fontSize: 36 }}>♠</span>
        <p style={{ fontSize: 15, fontWeight: 600 }}>Select a player to start chatting with the AI</p>
        <p style={{ fontSize: 13 }}>Use the player selector in the top-right corner.</p>
      </div>
    );
  }

  return (
    <>
      {/* Blink animation */}
      <style>{`@keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }`}</style>

      <div style={{ display: "flex", gap: 0, height: "calc(100vh - 56px - 48px)", minHeight: 500 }}>

        {/* LEFT SIDEBAR */}
        <div style={{
          width: 260,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          overflow: "hidden",
          marginLeft: -24,
          paddingLeft: 0,
        }}>
          {/* New conversation button */}
          <div style={{ padding: "12px 10px 8px" }}>
            <button
              onClick={handleNewConversation}
              style={{
                width: "100%",
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px dashed var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New conversation
            </button>
          </div>

          {/* Conversation list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
            {loadingConvs ? (
              <div style={{ padding: "12px 10px", fontSize: 12, color: "var(--text-muted)" }}>Loading...</div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: "12px 10px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                No conversations yet. Send a message to start one.
              </div>
            ) : (
              conversations.map(conv => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeConvId}
                  onSelect={() => setActiveConvId(conv.id)}
                  onDelete={() => handleDeleteConversation(conv.id)}
                />
              ))
            )}
          </div>

          {/* Context Panel Toggle */}
          <div style={{ borderTop: "1px solid var(--border)", padding: "8px 10px" }}>
            <button
              onClick={() => setShowContextPanel(v => !v)}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: activeContextCount > 0 ? "var(--accent-dim)" : "var(--bg-elevated)",
                color: activeContextCount > 0 ? "var(--accent-text)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>Context</span>
              <span style={{
                background: activeContextCount > 0 ? "var(--accent)" : "var(--border)",
                color: activeContextCount > 0 ? "#fff" : "var(--text-muted)",
                borderRadius: "50%",
                width: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
              }}>
                {activeContextCount}
              </span>
            </button>
          </div>
        </div>

        {/* CONTEXT PANEL (slides in over chat) */}
        {showContextPanel && (
          <div style={{
            position: "absolute",
            left: 260,
            top: 56,
            bottom: 0,
            width: 280,
            background: "var(--bg-surface)",
            borderRight: "1px solid var(--border)",
            borderLeft: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            zIndex: 50,
            boxShadow: "4px 0 12px rgba(0,0,0,0.12)",
          }}>
            <div style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Context Sources</span>
              <button onClick={() => setShowContextPanel(false)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 16, color: "var(--text-muted)",
              }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Stats & Ranges */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 6 }}>
                  Player Data
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, padding: "4px 0" }}>
                  <input
                    type="checkbox"
                    checked={includeStats}
                    onChange={e => setIncludeStats(e.target.checked)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Stats (VPIP, PFR, 3-bet, win rate)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, padding: "4px 0" }}>
                  <input
                    type="checkbox"
                    checked={includeRanges}
                    onChange={e => setIncludeRanges(e.target.checked)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Preflop ranges ({">"}open, 3-bet, call)
                </label>
              </div>

              {/* Hand picker */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 6 }}>
                  Hand History
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, padding: "4px 0" }}>
                  <input
                    type="checkbox"
                    checked={includeRecentHands}
                    onChange={e => setIncludeRecentHands(e.target.checked)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Recent hands (last 30, auto)
                </label>
                <button
                  onClick={() => setShowHandPicker(true)}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: selectedHandIds.length > 0 ? "var(--accent-dim)" : "var(--bg-elevated)",
                    color: selectedHandIds.length > 0 ? "var(--accent-text)" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                  }}
                >
                  {selectedHandIds.length > 0
                    ? `${selectedHandIds.length} hand${selectedHandIds.length !== 1 ? "s" : ""} selected`
                    : "Pick hands to analyse..."}
                </button>
                {selectedHandIds.length > 0 && (
                  <button
                    onClick={() => setSelectedHandIds([])}
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: "var(--text-muted)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {/* GTO Spots */}
              {solvedSpots.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 6 }}>
                    GTO Solver Spots
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 120, overflowY: "auto" }}>
                    {solvedSpots.map(spot => (
                      <label key={spot.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={selectedSpotKeys.includes(spot.key)}
                          onChange={() => toggleSpot(spot.key)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spot.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Documents */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 6 }}>
                  Documents
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  style={{ display: "none" }}
                  onChange={handleDocUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingDoc}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px dashed var(--border)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    cursor: uploadingDoc ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: uploadingDoc ? 0.6 : 1,
                  }}
                >
                  {uploadingDoc ? "Uploading..." : "+ Upload PDF / TXT / MD"}
                </button>

                {documents.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {documents.map(doc => (
                      <div key={doc.id} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 6px",
                        borderRadius: 5,
                        border: `1px solid ${selectedDocIds.includes(doc.id) ? "var(--accent)" : "var(--border-subtle)"}`,
                        background: selectedDocIds.includes(doc.id) ? "var(--accent-dim)" : "var(--bg-elevated)",
                      }}>
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(doc.id)}
                          onChange={e => {
                            if (e.target.checked) setSelectedDocIds(prev => [...prev, doc.id]);
                            else setSelectedDocIds(prev => prev.filter(x => x !== doc.id));
                          }}
                          style={{ accentColor: "var(--accent)", flexShrink: 0 }}
                        />
                        <span style={{
                          flex: 1,
                          fontSize: 11,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: selectedDocIds.includes(doc.id) ? "var(--accent-text)" : "var(--text-primary)",
                        }} title={doc.filename}>
                          {doc.filename}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
                          {doc.chunk_count}ch
                        </span>
                        <button
                          onClick={() => handleDeleteDoc(doc.id)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 12, color: "var(--text-muted)", padding: 0, flexShrink: 0,
                          }}
                          title="Delete document"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Context summary */}
            {activeContextCount > 0 && (
              <div style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--border)",
                fontSize: 11,
                color: "var(--accent-text)",
                background: "var(--accent-dim)",
              }}>
                {activeContextCount} source{activeContextCount !== 1 ? "s" : ""} active — will be included in next message
              </div>
            )}
          </div>
        )}

        {/* MAIN CHAT AREA */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          marginLeft: showContextPanel ? 280 : 0,
          transition: "margin-left 0.15s ease",
        }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {messages.length === 0 ? (
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 12,
                color: "var(--text-muted)",
                textAlign: "center",
              }}>
                <span style={{ fontSize: 40, opacity: 0.4 }}>♠</span>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
                  Your poker AI coach is ready
                </p>
                <p style={{ fontSize: 12, maxWidth: 380, lineHeight: 1.6 }}>
                  Ask about hand analysis, GTO strategy, leaks in your game, or
                  preflop ranges. Use the <strong>Context</strong> panel to inject
                  your hand history, stats, and documents.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 440, marginTop: 8 }}>
                  {[
                    "What are my biggest leaks?",
                    "Analyse my BTN open range",
                    "Why is check-raising good on wet boards?",
                    "How should I play AKo from UTG?",
                  ].map(suggestion => (
                    <button
                      key={suggestion}
                      onClick={() => setInputValue(suggestion)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 20,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elevated)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        fontSize: 11,
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div style={{
            borderTop: "1px solid var(--border)",
            padding: "12px 16px",
            background: "var(--bg-surface)",
          }}>
            {/* Context badge strip */}
            {activeContextCount > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {includeStats && <ContextBadge label="Stats" onRemove={() => setIncludeStats(false)} />}
                {includeRanges && <ContextBadge label="Ranges" onRemove={() => setIncludeRanges(false)} />}
                {includeRecentHands && selectedHandIds.length === 0 && (
                  <ContextBadge label="Recent 30 hands" onRemove={() => setIncludeRecentHands(false)} />
                )}
                {selectedHandIds.length > 0 && (
                  <ContextBadge
                    label={`${selectedHandIds.length} hand${selectedHandIds.length !== 1 ? "s" : ""}`}
                    onRemove={() => setSelectedHandIds([])}
                  />
                )}
                {selectedSpotKeys.map(key => (
                  <ContextBadge key={key} label={`Spot: ${key.slice(0, 12)}`} onRemove={() => toggleSpot(key)} />
                ))}
                {selectedDocIds.map(id => {
                  const doc = documents.find(d => d.id === id);
                  return doc ? (
                    <ContextBadge
                      key={id}
                      label={doc.filename.length > 14 ? doc.filename.slice(0, 14) + "…" : doc.filename}
                      onRemove={() => setSelectedDocIds(prev => prev.filter(x => x !== id))}
                    />
                  ) : null;
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask your poker coach... (Enter to send, Shift+Enter for newline)"
                disabled={streaming}
                rows={inputValue.split("\n").length > 3 ? 4 : 2}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  resize: "none",
                  outline: "none",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                }}
              />
              {streaming ? (
                <button
                  onClick={handleStopStreaming}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  style={{
                    padding: "9px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: inputValue.trim() ? "var(--accent)" : "var(--bg-elevated)",
                    color: inputValue.trim() ? "#fff" : "var(--text-muted)",
                    cursor: inputValue.trim() ? "pointer" : "not-allowed",
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  Send
                </button>
              )}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 5 }}>
              Using {OLLAMA_MODEL_DISPLAY} · <a
                href="https://ollama.com"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--text-muted)" }}
              >Ollama</a> must be running locally
            </div>
          </div>
        </div>
      </div>

      {showHandPicker && (
        <HandPickerModal
          playerName={playerName}
          selectedIds={selectedHandIds}
          onClose={() => setShowHandPicker(false)}
          onApply={ids => {
            setSelectedHandIds(ids);
            setShowHandPicker(false);
          }}
        />
      )}
    </>
  );
}

const OLLAMA_MODEL_DISPLAY = "qwen2.5:14b";

function ContextBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 7px",
      borderRadius: 12,
      background: "var(--accent-dim)",
      border: "1px solid var(--accent)",
      color: "var(--accent-text)",
      fontSize: 11,
      fontWeight: 600,
    }}>
      {label}
      <button
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--accent-text)",
          padding: 0,
          lineHeight: 1,
          opacity: 0.7,
        }}
      >
        ×
      </button>
    </span>
  );
}
