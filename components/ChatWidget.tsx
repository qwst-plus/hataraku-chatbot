"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type Msg = { role: "user" | "assistant"; content: string };

type Props = {
  defaultOpen?: boolean;
  title?: string;
};

export default function ChatWidget({
  defaultOpen = false,
  title = "はたらくちゃぼうず",
}: Props) {
  const THEME = {
    brand1: "#2EC5F4",
    brand2: "#38BDF8",
    ink: "#1F2933",
    bg: "#FFFFFF",
    line: "rgba(0,0,0,0.10)",
    shadow: "0 18px 40px rgba(0,0,0,0.22)",
    userGrad: "linear-gradient(135deg, #2EC5F4, #38BDF8)",
    botBg: "rgba(46,197,244,0.08)",
    botBorder: "rgba(46,197,244,0.25)",
  } as const;

  const BOT_ICON_SRC = "/chatbot_icon2.webp";

  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(window.screen.width > 1024);
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);

  const notifyParent = (isOpen: boolean) => {
    try {
      window.parent?.postMessage({ type: "QWEST_CHAT_WIDGET", open: isOpen }, "*");
    } catch {}
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [open, messages, thinking]);

  const scrollToBottom = () => {
    setTimeout(() => {
      listRef.current?.scrollTo(0, listRef.current.scrollHeight);
    }, 0);
  };

  const onAccept = () => {
    if (accepted) return;
    setAccepted(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: "質問します" },
      { role: "assistant", content: "ご質問をお聞かせください。" },
    ]);
    scrollToBottom();
  };

  const send = async () => {
    if (!accepted) return;
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    const nextMessages: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setThinking(true);
    try {
      let sid = sessionStorage.getItem("chat_session_id");
      if (!sid) {
        sid = crypto.randomUUID();
        sessionStorage.setItem("chat_session_id", sid);
      }
      const res = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ top_k: 20, messages: nextMessages, session_id: sid }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API error: ${res.status} ${res.statusText}\n${text}`);
      }
      const data = await res.json();
      const answer = data?.answer ?? data?.message ?? data?.text ?? "（応答がありません）";
      setMessages([...nextMessages, { role: "assistant", content: String(answer) }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((m) => [...m, { role: "assistant", content: `エラー：${msg}` }]);
    } finally {
      setThinking(false);
    }
  };

  const chatPanel: React.CSSProperties = {
    position: "fixed", right: 0, bottom: 0, width: 366, height: 520,
    border: "1px solid rgba(0,0,0,0.1)", background: "#fff",
    overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: THEME.shadow,
  };
  const header: React.CSSProperties = {
    height: 54, padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
    color: "#fff", background: `linear-gradient(135deg, ${THEME.brand1}, ${THEME.brand2})`,
  };
  const closeBtn: React.CSSProperties = {
    marginLeft: "auto", appearance: "none", border: "1px solid rgba(255,255,255,.45)",
    background: "rgba(255,255,255,.12)", color: "#fff", borderRadius: 999,
    padding: "6px 10px", fontSize: 12, cursor: "pointer",
  };
  const body: React.CSSProperties = {
    flex: 1, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8,
  };
  const inputBar: React.CSSProperties = {
    padding: 10, borderTop: `1px solid ${THEME.line}`, display: "flex", gap: 8, background: "#fff",
  };
  const inputStyle: React.CSSProperties = {
    flex: 1, borderRadius: 999, border: `1px solid ${THEME.line}`,
    padding: "10px 12px", fontSize: 13, outline: "none",
  };
  const bubbleBase: React.CSSProperties = {
    maxWidth: "88%", padding: "10px 12px", borderRadius: 16, fontSize: 13,
    whiteSpace: "pre-wrap", lineHeight: 1.5, wordBreak: "break-word",
  };
  const userBubble: React.CSSProperties = {
    ...bubbleBase, alignSelf: "flex-end", color: "#fff",
    background: THEME.userGrad, borderBottomRightRadius: 6,
  };
  const botBubble: React.CSSProperties = {
    ...bubbleBase, color: THEME.ink, background: THEME.botBg,
    border: `1px solid ${THEME.botBorder}`, maxWidth: 260, borderBottomLeftRadius: 6,
  };

  const fabSize = isDesktop ? 72 : 64;
  const fabImgSize = isDesktop ? 72 : 64;
  const fabBubble: React.CSSProperties = {
    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
    background: "#2EC5F4", color: "#fff",
    fontSize: 10, fontWeight: 700,
    padding: "3px 8px", borderRadius: 999,
    whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
    pointerEvents: "none",
  };
  const fabBtn: React.CSSProperties = {
    position: "fixed", right: 16, bottom: 16,
    width: fabSize, height: fabSize,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", background: "transparent", border: "none", padding: 0,
    boxShadow: "0 4px 8px rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.18)", borderRadius: "50%",
    animation: "fabPulse 2.5s infinite",
  };

  return (
    <>
      <style jsx>{`
        .notice { background: #fffbe6; border: 1px solid #f1e3a4; border-radius: 12px; padding: 12px 14px; font-size: 12px; line-height: 1.65; color: #333; margin-bottom: 12px; }
        .noticeTitle { font-weight: 800; margin: 0 0 6px; }
        .notice ul { margin: 0; padding-left: 18px; }
        .notice li { margin: 0 0 6px; }
        .acceptArea { display: flex; justify-content: center; margin-top: 10px; }
        .acceptBtn { appearance: none; border: none; cursor: pointer; font-weight: 800; font-size: 14px; padding: 12px 16px; border-radius: 999px; color: #fff; background: ${THEME.brand1}; box-shadow: 0 10px 18px rgba(0,0,0,0.18); transition: transform 0.05s ease; }
        .acceptBtn:active { transform: translateY(1px); }
        .acceptBtn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
        .botRow { display: flex; align-items: flex-end; justify-content: flex-start; gap: 8px; }
        .botRow.noAvatar { padding-left: 36px; }
        .botAvatar { width: 28px; height: 28px; border-radius: 999px; overflow: hidden; border: 2px solid rgba(46,197,244,0.35); flex: 0 0 auto; background: #fff; }
        .botBubbleTail { position: relative; }
        .botBubbleTail::before { content: ""; position: absolute; left: -8px; bottom: 10px; width: 0; height: 0; border-style: solid; border-width: 8px 8px 0 0; border-color: ${THEME.botBorder} transparent transparent transparent; }
        .botBubbleTail::after { content: ""; position: absolute; left: -7px; bottom: 10px; width: 0; height: 0; border-style: solid; border-width: 7px 7px 0 0; border-color: ${THEME.botBg} transparent transparent transparent; }
        .typing { display: inline-flex; align-items: center; gap: 6px; padding: 2px 0; }
        .typing span { width: 6px; height: 6px; border-radius: 50%; background: ${THEME.brand1}; opacity: 0.35; transform: translateY(0); animation: typingBounce 1.2s infinite ease-in-out; }
        .typing span:nth-child(1) { animation-delay: 0s; }
        .typing span:nth-child(2) { animation-delay: 0.15s; }
        .typing span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes typingBounce { 0%, 80%, 100% { opacity: 0.35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-4px); } }
        .srOnly { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0; }
        .sendIconBtn { width: 44px; height: 44px; appearance: none; border: none; background: transparent; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 999px; }
        .sendIconBtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .sendIconBtn:active { transform: translateY(1px); }
        .sendIconImg { width: 21px !important; height: 18px !important; display: block; object-fit: contain; }
        @keyframes fabPulse {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        button[aria-label="チャットを開く"]:hover {
          transform: scale(1.1);
        }
      `}</style>

      {open && (
        <div style={chatPanel}>
          <div style={header}>
            <Image src={BOT_ICON_SRC} alt="robot" width={26} height={26} />
            <strong>{title}</strong>
            <button style={closeBtn} onClick={() => { setOpen(false); notifyParent(false); }}>閉じる</button>
          </div>

          <div ref={listRef} style={body} aria-live="polite" aria-busy={thinking}>
            {!accepted && (
              <div className="notice">
                <p className="noticeTitle">【ご利用上の注意事項】</p>
                <p style={{ margin: "0 0 8px" }}>ご利用の前に、以下の注意事項を必ずお読みください。</p>
                <ul>
                  <li>本サービスは、生成AIを活用しており、旭川市が用意した情報に基づき、生成AIが自動で質問にお答えするサービスです。旭川でのお仕事や生活に関する情報の確認や調べ物のサポートとして、適切にご利用ください。</li>
                  <li>質問によっては誤った回答が表示される場合がございます。回答の際に参考情報のリンク先が表示される場合は、あわせてご確認いただき、正確な情報かどうかをご判断ください。</li>
                  <li>本サービスはChatGPTの生成AIを活用した機能のため、13歳未満のご利用はお控えください。また、18歳未満の方は保護者の許可を得てご利用ください。</li>
                  <li>本サービスにおいて入力されたデータの内容は回答用の学習データとしては利用いたしません。入力した情報が他の利用者への回答に利用されることはありませんのでご安心ください。ただし、個人情報（氏名、住所、電話番号など）は入力しないでください。</li>
                  <li>サービスの改善や回答精度の向上のため、Cookieを利用しています。お使いのブラウザの設定によっては、正常に表示・利用できない場合があります。</li>
                  <li>入力された質問や回答に関するフィードバックは、適宜分析を行い、回答精度の向上を図っていきますので、ご理解とご協力をお願いします。</li>
                </ul>
                <div className="acceptArea">
                  <button className="acceptBtn" onClick={onAccept}>上記に同意して質問する</button>
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const isUser = m.role === "user";
              const isBot = m.role === "assistant";
              const compact = (isUser && prev?.role === "user") || (isBot && prev?.role === "assistant");

              if (isUser) {
                return <div key={i} style={{ ...userBubble, marginTop: compact ? -2 : 0 }}>{m.content}</div>;
              }

              const showAvatar = prev?.role !== "assistant";
              const rowClass = showAvatar ? "botRow" : "botRow noAvatar";
              return (
                <div key={i} className={rowClass} style={{ marginTop: compact ? -2 : 0 }}>
                  {showAvatar && (
                    <div className="botAvatar">
                      <Image src={BOT_ICON_SRC} alt="" width={28} height={28} style={{ objectFit: "cover" }} />
                    </div>
                  )}
                  <div className={showAvatar ? "botBubbleTail" : undefined} style={botBubble}>{m.content}</div>
                </div>
              );
            })}

            {thinking && (() => {
              const prev = messages[messages.length - 1];
              const showAvatar = prev?.role !== "assistant";
              const rowClass = showAvatar ? "botRow" : "botRow noAvatar";
              return (
                <div className={rowClass}>
                  {showAvatar && (
                    <div className="botAvatar">
                      <Image src={BOT_ICON_SRC} alt="" width={28} height={28} style={{ objectFit: "cover" }} />
                    </div>
                  )}
                  <div className={showAvatar ? "botBubbleTail" : undefined} style={{ ...botBubble, padding: "10px 14px" }}>
                    <span className="srOnly">返信中</span>
                    <span className="typing" aria-hidden="true"><span /><span /><span /></span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div style={inputBar}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              style={inputStyle}
              placeholder={accepted ? "メッセージを入力…" : "まずは上記に同意してください"}
              disabled={!accepted || thinking}
            />
            <button type="button" onClick={send} className="sendIconBtn" aria-label="送信" disabled={!accepted || thinking}>
              <Image src="/ei-send.png" alt="" width={21} height={18} className="sendIconImg" />
            </button>
          </div>
        </div>
      )}

      {!open && (
        <button style={fabBtn} onClick={() => { setOpen(true); notifyParent(true); }} aria-label="チャットを開く">
          <div style={fabBubble}>チャットはこちら！</div>
          <Image src={BOT_ICON_SRC} alt="robot" width={fabImgSize} height={fabImgSize} style={{ objectFit: "cover" }} />
        </button>
      )}
    </>
  );
}