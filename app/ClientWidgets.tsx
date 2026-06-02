"use client";
import { usePathname } from "next/navigation";
import FloatingChatLauncher from "@/components/FloatingChatLauncher";

export default function ClientWidgets() {
  const pathname = usePathname();
  // 管理ページでは表示しない（embedページの埋め込みプレビューのみ対象）
  const adminPaths = ["/", "/admin", "/logs", "/ingest", "/websites", "/apikey", "/chat"];
  if (adminPaths.includes(pathname) || pathname === "/embed") return null;

  return (
    <FloatingChatLauncher embedPath="/embed" iconSrc="/chatbot_icon2.webp" />
  );
}
