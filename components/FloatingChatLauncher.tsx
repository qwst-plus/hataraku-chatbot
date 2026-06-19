"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type Props = {
  embedPath?: string;
  iconSrc?: string;
};

export default function FloatingChatLauncher({
  embedPath = "/embed",
  iconSrc = "/chatbot_icon2.webp",
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {/* パネル（/embed をそのまま表示） */}
      <div
        className={[
          "ban",
          "fixed z-[999999] right-4 bottom-[112px] lg:bottom-[180px]",
          "w-[380px] h-[560px]",
          "max-w-[calc(100vw-32px)] max-h-[calc(100vh-140px)]",
          "overflow-hidden shadow-2xl",
          "bg-white",
          open ? "block" : "hidden",
        ].join(" ")}
      >
        {/* close だけ上に重ねる */}
        <button
          onClick={() => setOpen(false)}
          className="absolute right-2 top-2 z-[2] w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 transition flex items-center justify-center text-black"
          aria-label="close"
          type="button"
        >
          ✕
        </button>

        <iframe
          src={embedPath}
          title="Chat"
          className="w-full h-full border-0"
        />
      </div>

      {/* 右下アイコン */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          "fixed z-[999999] right-4 bottom-4",
          "w-[80px] h-[80px] lg:w-[148px] lg:h-[148px] rounded-full overflow-hidden",
          "bg-white border border-black/5",
          "shadow-2xl active:scale-95 transition",
        ].join(" ")}
        aria-label="open chat"
        type="button"
      >
        <Image
          src={iconSrc}
          alt="Open chat"
          width={148}
          height={148}
          className="w-full h-full object-cover"
          priority
        />
      </button>
    </>
  );
}
