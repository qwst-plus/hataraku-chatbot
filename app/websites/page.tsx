"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import BackButton from "@/components/BackButton";

type SiteStatus = "pending" | "crawling" | "done" | "error";

type Site = {
  id: number;
  url: string;
  scope: "single" | "all";
  type: string;
  status: SiteStatus | string;
  ingested_urls?: number | null;
  error_message?: string | null;
  created_at?: string;
};

type BulkResult = {
  total: number;
  ok: { url: string; id?: number | null }[];
  ng: { url: string; reason: string }[];
};

const LS_KEY = "sites_v1";

function loadSites(): Site[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Site[];
  } catch {
    return [];
  }
}

function saveSites(sites: Site[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(sites));
}

/** URLっぽい形に軽く正規化（末尾スラッシュを揃える等） */
function normalizeUrl(u: string) {
  let x = u.trim();
  // 全角スペース除去など
  x = x.replace(/\s+/g, "");
  // 末尾スラッシュは「あり」に揃える（好みでなしでもOK）
  // ただし "https://example.com" → "https://example.com/"
  if (/^https?:\/\/[^/]+$/i.test(x)) x = x + "/";
  return x;
}

/** ✅ URL抽出（改行 / スペース / タブ / カンマ区切りOK） */
function parseUrls(text: string) {
  const tokens = text
    .split(/[\n\r\t ,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeUrl);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  return unique;
}

/** ✅ 疑似 ingest/crawl（少し待って done + ページ数を適当に付与） */
async function fakeCrawl(): Promise<{ ingested_urls: number }> {
  const ms = 900 + Math.floor(Math.random() * 1200);
  await new Promise((r) => setTimeout(r, ms));
  return { ingested_urls: 10 + Math.floor(Math.random() * 90) };
}

export default function WebSiteManagePage() {
  // ✅ APIは使わない（フロントのみ）
  // const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);

  // 追加用 state（単一）
  const [url, setUrl] = useState("");

  // scope は2択
  const [scope, setScope] = useState<"single" | "all">("single");

  // type は固定
  const FIXED_TYPE = "静的HTML";

  const [submitting, setSubmitting] = useState(false);

  // 追加後に取り込み開始するか
  const [autoIngest, setAutoIngest] = useState(false);

  // 一括追加
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  /** 一覧取得（ローカル） */
  const fetchSites = async () => {
    const list = loadSites().sort((a, b) => b.id - a.id);
    setSites(list);
  };

  /** 取り込み開始（ローカルで擬似） */
  const startIngest = async (id: number) => {
    setLoading(true);
    try {
      // crawling にする
      const before = loadSites().map((s) =>
        s.id === id ? { ...s, status: "crawling", error_message: null } : s
      );
      saveSites(before);
      setSites(before);

      // 疑似 crawl
      const r = await fakeCrawl();

      // done にして反映
      const after = loadSites().map((s) =>
        s.id === id
          ? { ...s, status: "done", ingested_urls: r.ingested_urls }
          : s
      );
      saveSites(after);
      setSites(after);
    } catch (e) {
      console.error(e);
      const after = loadSites().map((s) =>
        s.id === id
          ? { ...s, status: "error", error_message: "擬似取り込みに失敗しました" }
          : s
      );
      saveSites(after);
      setSites(after);
      alert("取り込み開始に失敗しました（Console を確認してください）");
    } finally {
      setLoading(false);
    }
  };

  /** 追加（単一） */
  const addSite = async () => {
    const u = normalizeUrl(url);
    if (!u) return;

    setSubmitting(true);
    setBulkResult(null);

    try {
      // 重複チェック
      const current = loadSites();
      if (current.some((s) => normalizeUrl(s.url) === u)) {
        alert("同じURLが既に登録されています。");
        return;
      }

      const newId = Date.now(); // 簡易ID
      const site: Site = {
        id: newId,
        url: u,
        scope,
        type: FIXED_TYPE,
        status: autoIngest ? "crawling" : "pending",
        ingested_urls: null,
        created_at: new Date().toISOString(),
      };

      const next = [site, ...current];
      saveSites(next);
      setSites(next);
      setUrl("");

      if (autoIngest) {
        await startIngest(newId);
      } else {
        await fetchSites();
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** 追加（一括） */
  const addSitesBulk = async () => {
    const urls = parseUrls(bulkText);
    if (urls.length === 0) return;

    setSubmitting(true);
    setBulkResult(null);

    try {
      const current = loadSites();
      const currentSet = new Set(current.map((s) => normalizeUrl(s.url)));

      const ok: BulkResult["ok"] = [];
      const ng: BulkResult["ng"] = [];

      // まず登録
      const now = Date.now();
      let seq = 0;

      const added: Site[] = [];

      for (const u0 of urls) {
        const u = normalizeUrl(u0);
        if (!/^https?:\/\//i.test(u)) {
          ng.push({ url: u0, reason: "URLが http(s) ではありません" });
          continue;
        }
        if (currentSet.has(u)) {
          ng.push({ url: u, reason: "既に登録済み" });
          continue;
        }

        const id = now + seq++;
        currentSet.add(u);

        added.push({
          id,
          url: u,
          scope,
          type: FIXED_TYPE,
          status: autoIngest ? "crawling" : "pending",
          ingested_urls: null,
          created_at: new Date().toISOString(),
        });

        ok.push({ url: u, id });
      }

      const next = [...added, ...current];
      saveSites(next);
      setSites(next);

      setBulkResult({ total: urls.length, ok, ng });
      setBulkText("");

      // auto ingest なら順に実行（UIが分かりやすい）
      if (autoIngest) {
        const ids = ok
          .map((x) => x.id)
          .filter((v): v is number => typeof v === "number");
        for (const id of ids) {
          await startIngest(id);
        }
      } else {
        await fetchSites();
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** 削除（ローカル） */
  const deleteSite = async (id: number) => {
    if (!confirm("このWebサイトを削除しますか？")) return;

    setLoading(true);
    try {
      const after = loadSites().filter((s) => s.id !== id);
      saveSites(after);
      setSites(after);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
    // ローカルならポーリング不要だけど、UI互換で残すならOK
    const timer = setInterval(fetchSites, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-40 left-10 h-96 w-96 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <div className="text-xs text-zinc-400">Sites</div>
              <h1 className="text-xl font-semibold tracking-tight">
                Webサイト管理（フロントのみ動作）
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              sites: {sites.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              mode: local
            </span>
          </div>
        </div>

        {/* Add site card */}
        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">新しいWebサイトを追加</div>
              <p className="text-sm text-zinc-400">
                ※このページは「フロントだけ」で動作します（実際のクロールは行いません）。
              </p>
            </div>

            <button
              onClick={() => {
                setBulkMode((v) => !v);
                setBulkResult(null);
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
              title="入力モード切替"
            >
              {bulkMode ? "単一入力へ" : "一括入力へ"}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {!bulkMode ? (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
              />
            ) : (
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`https://example.com/\nhttps://example.org/\nhttps://example.net/`}
                rows={6}
                className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
              />
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "single" | "all")}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              >
                <option value="single">このURLのみ（基本）</option>
                <option value="all">配下すべて</option>
              </select>

              <div className="hidden sm:block" />
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={autoIngest}
                onChange={(e) => setAutoIngest(e.target.checked)}
                className="h-4 w-4"
              />
              追加後に「擬似取り込み」を開始する
            </label>

            <button
              onClick={bulkMode ? addSitesBulk : addSite}
              disabled={submitting}
              className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? bulkMode
                  ? "一括追加中…"
                  : "追加中…"
                : bulkMode
                ? "＋ Webサイトを一括追加"
                : "＋ Webサイトを追加"}
            </button>

            {bulkMode && (
              <div className="text-xs text-zinc-400">
                ※ 改行/スペース/カンマ区切りOK・重複URLは自動で除外します
              </div>
            )}

            {bulkResult && (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-zinc-300">
                <div className="font-semibold">
                  一括追加結果：{bulkResult.total}件中 {bulkResult.ok.length}件成功 /{" "}
                  {bulkResult.ng.length}件失敗
                </div>

                {bulkResult.ng.length > 0 && (
                  <div className="mt-2 space-y-1 text-red-200">
                    {bulkResult.ng.slice(0, 5).map((x) => (
                      <div key={x.url} className="truncate">
                        NG: {x.url}（{x.reason}）
                      </div>
                    ))}
                    {bulkResult.ng.length > 5 && (
                      <div className="text-zinc-400">…他 {bulkResult.ng.length - 5} 件</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* List card */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">登録済みWebサイト一覧</div>
            <button
              onClick={fetchSites}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? "更新中…" : "更新"}
            </button>
          </div>

          {sites.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-zinc-400">
              まだWebサイトが登録されていません
            </div>
          ) : (
            <div className="space-y-3">
              {sites.map((site) => (
                <div
                  key={site.id}
                  className="rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{site.url}</div>
                        <span className="text-xs text-zinc-500">#{site.id}</span>
                      </div>

                      <div className="mt-1 text-xs text-zinc-400">
                        {site.type} / {site.scope}
                        {site.ingested_urls != null && site.status === "done" && (
                          <span className="ml-2 text-emerald-300">
                            ・{site.ingested_urls}ページ取り込み
                          </span>
                        )}
                        {site.error_message && (
                          <span className="ml-2 text-red-200">・{site.error_message}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusBadge status={site.status} />

                      <button
                        onClick={() => startIngest(site.id)}
                        disabled={loading || site.status === "crawling"}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                        title="取り込み開始（擬似）"
                      >
                        ▶ 取
                      </button>

                      {(site.status === "done" || site.status === "error") && (
                        <button
                          onClick={() => startIngest(site.id)}
                          disabled={loading}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                          title="再取り込み（擬似）"
                        >
                          🔄 再
                        </button>
                      )}

                      <button
                        onClick={() => deleteSite(site.id)}
                        disabled={loading}
                        className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-60"
                        title="削除"
                      >
                        🗑 削
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-8 text-center text-xs text-zinc-500">Sites Dashboard</div>
      </div>
    </div>
  );
}
