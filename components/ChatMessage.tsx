// frontend/components/ChatMessage.tsx
import React from "react";

export type Reference = { source: string; score: number };
export type ChatMessageProps = {
  role: "user" | "assistant";
  content: string;
  refs?: Reference[];
};

export default function ChatMessage({ role, content, refs }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`mb-4 ${isUser ? "text-right" : "text-left"}`}>
      <div
        className={[
          "inline-block max-w-[85%] p-3 rounded-xl",
          isUser
            ? "bg-[#1F6FEB] text-white"
            : "bg-[#0D1117] text-gray-200 border border-[#30363D]",
        ].join(" ")}
      >
        {content}

        {!isUser && refs && refs.length > 0 && (
          <div className="mt-3 text-xs opacity-80">
            参照元:
            <ul className="list-disc ml-5 mt-1 space-y-1">
              {refs.map((r, i) => (
                <li key={i}>
                  {r.source}（{r.score.toFixed(3)}）
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
