/**
 * AI Agent API client — conversations, streaming chat, documents.
 */

const BASE = "/api/ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Conversation {
  id: string;
  player_name: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface AIDocument {
  id: string;
  player_name: string;
  filename: string;
  content_type: "pdf" | "text";
  chunk_count: number;
  created_at: string;
}

export interface HandFilter {
  position?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface ContextConfig {
  include_stats?: boolean;
  include_ranges?: boolean;
  hand_ids?: string[];
  hand_filter?: HandFilter | null;
  gto_spot_keys?: string[];
  document_ids?: string[];
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function createConversation(playerName: string, title = "New conversation"): Promise<Conversation> {
  const res = await fetch(`${BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_name: playerName, title }),
  });
  if (!res.ok) throw new Error(`Create conversation failed: ${res.status}`);
  return res.json();
}

export async function listConversations(playerName: string): Promise<Conversation[]> {
  const res = await fetch(`${BASE}/conversations?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error(`List conversations failed: ${res.status}`);
  return res.json();
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const res = await fetch(`${BASE}/conversations/${id}`);
  if (!res.ok) throw new Error(`Get conversation failed: ${res.status}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BASE}/conversations/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(`Delete conversation failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Streaming chat
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * Send a message to a conversation and stream the assistant response.
 * Uses fetch + ReadableStream (works with POST, unlike EventSource).
 */
export async function sendMessage(
  conversationId: string,
  playerName: string,
  content: string,
  context: ContextConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${BASE}/conversations/${conversationId}/messages?player_name=${encodeURIComponent(playerName)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, context }),
      signal,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    callbacks.onError(`Server error ${res.status}: ${text}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const data = JSON.parse(payload);
          if (data.error) {
            callbacks.onError(data.error);
            return;
          }
          if (data.chunk) {
            callbacks.onChunk(data.chunk);
          }
          if (data.done) {
            callbacks.onDone();
            return;
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
    callbacks.onDone();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return;
    callbacks.onError(err instanceof Error ? err.message : "Stream error");
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function uploadDocument(playerName: string, file: File): Promise<AIDocument> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/documents?player_name=${encodeURIComponent(playerName)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export async function listDocuments(playerName: string): Promise<AIDocument[]> {
  const res = await fetch(`${BASE}/documents?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error(`List documents failed: ${res.status}`);
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${BASE}/documents/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(`Delete document failed: ${res.status}`);
}
