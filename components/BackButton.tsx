"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="text-sm text-blue-400 hover:underline"
    >
      ← 戻る
    </button>
  );
}
