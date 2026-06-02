"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";

type Turn = {
  id: string;
  turn_order: number;
  role: "user" | "assistant";
  content: string;
  created_at: string | null;
};

type SessionRow = {
  id: string;
  started_at: string | null;
  turns: Turn[];
  expanded: boolean;
};

type DailyCount = { date: string; count: number };

export default function LogsPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);
  const [monthTotal, setMonthTotal] = useState(0);
  const [monthTurns, setMonthTurns] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(month?: string) {
    const m = month ?? selectedMonth;
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      const [year, mon] = m.split("-").map(Number);
      const start = new Date(year, mon - 1, 1).toISOString();
      const end = new Date(year, mon, 1).toISOString();

      const { data: sessionData, error: sessionErr } = await supabase
        .from("sessions")
        .select("id, started_at")
        .gte("started_at", start)
        .lt("started_at", end)
        .order("started_at", { ascending: false });

      if (sessionErr) { setError(sessionErr.message); return; }

      const rows = sessionData ?? [];

      // 日別集計
      const dayMap: Record<string, number> = {};
      for (const s of rows) {
        const day = s.started_at?.slice(0, 10) ?? "unknown";
        dayMap[day] = (dayMap[day] ?? 0) + 1;
      }
      const daily: DailyCount[] = Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));
      setDailyCounts(daily);
      setMonthTotal(rows.length);

      // ターン取得
      const sessionIds = rows.map((s) => s.id);
      const { data: turnData, error: turnErr } = sessionIds.length
        ? await supabase
            .from("turns")
            .select("id, session_id, turn_order, role, content, created_at")
            .in("session_id", sessionIds)
            .order("turn_order", { ascending: true })
        : { data: [], error: null };

      if (turnErr) { setError(turnErr.message); return; }

      const turnMap: Record<string, Turn[]> = {};
      for (const t of turnData ?? []) {
        if (!turnMap[t.session_id]) turnMap[t.session_id] = [];
        turnMap[t.session_id].push(t as Turn);
      }

      setMonthTurns((turnData ?? []).length);

      setSessions(
        rows.map((s) => ({
          id: s.id,
          started_at: s.started_at,
          turns: turnMap[s.id] ?? [],
          expanded: false,
        }))
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleSession(id: string) {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, expanded: !s.expanded } : s))
    );
  }

  useEffect(() => { load(); }, []);

  const maxCount = Math.max(...dailyCounts.map((d) => d.count), 1);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-40 left-10 h-96 w-96 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-blue-400 hover:underline">← 戻る</Link>
            <div>
              <div className="text-xs text-zinc-400">Admin</div>
              <h1 className="text-xl font-semibold tracking-tight">会話ログ</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                load(e.target.value);
              }}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-white/20"
            />
            <button
              onClick={() => load()}
              disabled={loading}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "読み込み中…" : "更新"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* 月別サマリー */}
        <section className="mb-5 grid grid-cols-3 gap-3">
          {[
            { label: `${selectedMonth} 総セッション数`, value: monthTotal },
            { label: "総ターン数（会話回数）", value: monthTurns },
            { label: "利用日数", value: dailyCounts.length },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center"
            >
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="mt-1 text-xs text-zinc-400">{s.label}</div>
            </div>
          ))}
        </section>

        {/* 日別件数 */}
        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-4 text-sm font-semibold">日別セッション数</div>

          {dailyCounts.length === 0 ? (
            <div className="text-sm text-zinc-400">
              {loading ? "読み込み中…" : "データがありません。"}
            </div>
          ) : (
            <div className="space-y-2">
              {dailyCounts.map((d) => (
                <div key={d.date} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-right text-xs text-zinc-400">
                    {d.date.slice(5)}
                  </div>
                  <div className="flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-5 rounded-full bg-fuchsia-500/60 transition-all"
                      style={{ width: `${(d.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <div className="w-8 shrink-0 text-right text-sm font-semibold">
                    {d.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* セッション一覧 */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 text-sm font-semibold">
            セッション一覧（{sessions.length} 件 / クリックで展開）
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
            {sessions.length === 0 ? (
              <div className="p-6 text-sm text-zinc-400">
                {loading ? "読み込み中…" : "セッションデータがありません。"}
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {sessions.map((s) => (
                  <div key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggleSession(s.id)}
                      className="flex w-full items-center justify-between p-4 text-left hover:bg-black/40"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500">
                          {s.expanded ? "▾" : "▸"}
                        </span>
                        <div>
                          <div className="text-sm text-zinc-200">
                            {s.started_at
                              ? new Date(s.started_at).toLocaleString("ja-JP")
                              : "—"}
                          </div>
                          <div className="text-xs font-mono text-zinc-500">
                            {s.id}
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-400">
                        {s.turns.length} ターン
                      </span>
                    </button>

                    {s.expanded && (
                      <div className="space-y-3 border-t border-white/10 bg-black/20 px-4 py-3">
                        {s.turns.length === 0 ? (
                          <div className="text-xs text-zinc-500">ターンなし</div>
                        ) : (
                          s.turns.map((t) => (
                            <div
                              key={t.id}
                              className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                                  t.role === "user"
                                    ? "bg-white/10 text-zinc-100"
                                    : "bg-fuchsia-500/20 text-zinc-100"
                                }`}
                              >
                                <div className="mb-1 text-xs text-zinc-400">
                                  {t.role === "user" ? "ユーザー" : "AI"} #{t.turn_order}
                                </div>
                                <div className="whitespace-pre-wrap">{t.content}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
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
