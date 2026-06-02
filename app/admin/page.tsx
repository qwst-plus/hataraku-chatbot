// app/admin/page.tsx
"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import BackButton from "@/components/BackButton";

type Row = {
  id: string;
  content: string | null;
  created_at: string | null;
};

export default function AdminPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function load() {
    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = getSupabaseClient();

      const base = supabase
        .from("rag_chunks")
        .select("id, content, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      const { data, error } = q
        ? await base.ilike("content", `%${q}%`)
        : await base;

      if (error) {
        console.error(error);
        setRows([]);
        setErrorMsg(error.message ?? "読み込みに失敗しました。");
        return;
      }

      setRows(data || []);
    } catch (e: any) {
      console.error(e);
      setRows([]);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-40 left-10 h-96 w-96 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <div className="text-xs text-zinc-400">Admin</div>
              <h1 className="text-xl font-semibold tracking-tight">管理（RAGデータ）</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              rows: {rows.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              table: rag_chunks
            </span>
          </div>
        </div>

        {/* Search card */}
        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 text-sm font-semibold">検索</div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                placeholder="テキスト検索（content）"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load();
                }}
              />
              <div className="mt-2 text-xs text-zinc-400">
                Enterで検索 / 50件まで表示
              </div>
            </div>

            <button
              onClick={load}
              disabled={loading}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "読み込み中…" : "検索 / 更新"}
            </button>
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              {errorMsg}
            </div>
          )}
        </section>

        {/* List card */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">最新データ</div>
            <div className="text-xs text-zinc-400">
              {loading ? "更新中…" : "最新順"}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
            {rows.length === 0 ? (
              <div className="p-6 text-sm text-zinc-400">
                データがありません。
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {rows.map((r) => (
                  <div key={r.id} className="p-4 hover:bg-black/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-zinc-400">
                        <span className="font-mono">{r.id}</span>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {r.created_at ?? "—"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-zinc-200">
                      {r.content ?? "（content が空です）"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
