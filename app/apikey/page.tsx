// frontend/app/apikey/page.tsx
"use client";
import { useState } from "react";
import BackButton from "@/components/BackButton";

export default function ApiKey() {
  const [key, setKey] = useState("");
  return (
    <div className="max-w-lg">
      <BackButton />
      <h1 className="text-2xl font-bold mb-6">API設定</h1>
      <label className="block mb-2">OpenAI API Key</label>
      <input
        type="password"
        className="w-full bg-[#161B22] p-3 rounded"
        value={key}
        onChange={e=>setKey(e.target.value)}
        placeholder="sk-..." />
      <p className="mt-3 text-sm opacity-70">
        ※サンプルでは保存せず見た目だけ。後で Supabase に暗号化保存します。
      </p>
    </div>
  );
}
