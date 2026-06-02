// app/chat/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ChatContainer from "@/components/ChatContainer";
import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import TypingDots from "@/components/TypingDots";
import BackButton from "@/components/BackButton";

type Msg = { role: "user" | "assistant"; content: string };

// ====== 会話履歴保持（localStorage） ======
const LS_KEY = "rag_chat_messages_v1";

// コスト気にしない前提でも、無限に増えると遅くなるので安全上限だけ入れます（必要なら増やしてOK）
const MAX_STORE_TURNS = 200; // 保存するメッセージ数上限
const MAX_SEND_TURNS = 60; // APIに送る履歴数（/api/chat が履歴対応なら活きる）

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  // UI表示用：API疎通状態
  const [apiStatus, setApiStatus] = useState<"idle" | "connected" | "error">(
    "idle"
  );

  // 自動スクロール
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 送信する履歴（/api/chat が messages 対応していれば会話継続に使える）
  const outboundMessages = useMemo(() => {
    return messages.slice(-MAX_SEND_TURNS);
  }, [messages]);

  // 初回：localStorage から復元
  useEffect(() => {
    const saved = safeJsonParse<Msg[]>(localStorage.getItem(LS_KEY));
    if (Array.isArray(saved) && saved.length) {
      setMessages(saved);
    }
  }, []);

  // messages が変わるたびに保存
  useEffect(() => {
    if (!messages.length) {
      localStorage.removeItem(LS_KEY);
      return;
    }
    const trimmed = messages.slice(-MAX_STORE_TURNS);
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  }, [messages]);

  // messages / thinking が変わったら最下部へ
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  const clearChat = () => {
    if (thinking) return;
    setMessages([]);
    setInput("");
    setApiStatus("idle");
    localStorage.removeItem(LS_KEY);
  };

  async function sendMessage() {
    const userMessage = input.trim();
    if (!userMessage || thinking) return;

    setInput("");
    setThinking(true);

    // setState の非同期ズレ対策：ここで「確定した履歴」を作る
    const nextMessages: Msg[] = [...messages, { role: "user", content: userMessage }];

    // UIに反映
    setMessages(nextMessages);

    try {
      let sid = sessionStorage.getItem("chat_session_id");
      if (!sid) {
        sid = crypto.randomUUID();
        sessionStorage.setItem("chat_session_id", sid);
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          top_k: 8,
          messages: nextMessages.slice(-MAX_SEND_TURNS),
          session_id: sid,
        }),
      });

      const data: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.error ?? `API error: ${res.status} ${res.statusText}`;
        setApiStatus("error");
        throw new Error(msg);
      }

      setApiStatus("connected");

      const botReply = data?.answer ?? "回答に失敗しました。";

      // 返答を追加（functional updateで確実に）
      setMessages((m) => [
        ...m,
        { role: "assistant", content: botReply },
      ]);
    } catch (e: any) {
      console.error(e);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `エラー: ${e?.message ?? String(e)}` },
      ]);
    } finally {
      setThinking(false);
    }
  }

  const apiBadge =
    apiStatus === "connected"
      ? "connected"
      : apiStatus === "error"
      ? "error"
      : "ready";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* 背景の薄いグラデ（単調さ解消） */}
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-40 left-10 h-96 w-96 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <ChatContainer>
        {/* 既存コンテナの上に “カード枠” を置く */}
        <div className="relative mx-auto w-full max-w-4xl px-4 py-8">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BackButton />
              <div>
                <div className="text-xs text-zinc-400">RAG Chat</div>
                <h1 className="text-xl font-semibold tracking-tight">チャット</h1>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
                top_k: 8
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
                API: {apiBadge}
              </span>

              <button
                type="button"
                onClick={clearChat}
                disabled={thinking || messages.length === 0}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300 disabled:opacity-50"
                title="会話を消去"
              >
                クリア
              </button>
            </div>
          </div>

          {/* Chat panel */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Conversation</div>
              <div className="text-xs text-zinc-400">
                サイトの情報を根拠に回答します
              </div>
            </div>

            <div className="min-h-[380px] max-h-[60vh] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4">
              {messages.length === 0 ? (
                <div className="text-sm text-zinc-400">
                  例：
                  <span className="text-zinc-200">
                    「はたらくあさひかわとは？」
                  </span>
                </div>
              ) : null}

              <div className="space-y-3">
                {messages.map((m, i) => (
                  <ChatBubble key={i} role={m.role}>
                    {m.content}
                  </ChatBubble>
                ))}

                {thinking && (
                  <ChatBubble role="assistant">
                    <TypingDots />
                  </ChatBubble>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3">
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={sendMessage}
                disabled={thinking}
              />

              <div className="mt-2 text-xs text-zinc-400">
                Enterで送信／Shift+Enterで改行（実装がある場合）
              </div>

              {/* デバッグ表示（必要なら有効化）
              <div className="mt-1 text-[10px] text-zinc-500">
                保存: {messages.length} / 送信履歴: {outboundMessages.length}
              </div>
              */}
            </div>
          </div>
        </div>
      </ChatContainer>
    </div>
  );
}
