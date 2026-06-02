"use client";

import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import StatusBadge from "@/components/StatusBadge";

type UiStatus = "pending" | "processing" | "done" | "error";

type FileItem = {
  id: number;
  filename: string;
  status: UiStatus;
  ingested_chunks?: number | null;
  error_message?: string | null;
  created_at?: string;
};

const LS_KEY = "ingest_files_v1";

/** localStorage から読み込み */
function loadFiles(): FileItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FileItem[];
  } catch {
    return [];
  }
}

/** localStorage へ保存 */
function saveFiles(files: FileItem[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(files));
}

/** 疑似 ingest：少し待って done にする（チャンク数も適当につける） */
async function fakeIngest(): Promise<{ ingested_chunks: number }> {
  const ms = 600 + Math.floor(Math.random() * 800);
  await new Promise((r) => setTimeout(r, ms));
  return { ingested_chunks: 5 + Math.floor(Math.random() * 20) };
}

export default function IngestPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  /** 一覧取得（ローカル） */
  const fetchFiles = async () => {
    const list: FileItem[] = loadFiles().sort((a, b) => b.id - a.id);
    setFiles(list);
  };

  /** 1件アップロード（ローカル登録）＋疑似 ingest */
  const uploadOne = async (file: File) => {
    const newId = Date.now(); // 簡易ID

    const item: FileItem = {
      id: newId,
      filename: file.name,
      status: "processing",
      ingested_chunks: null,
      error_message: null,
      created_at: new Date().toISOString(),
    };

    // 追加
    const next: FileItem[] = [item, ...loadFiles()];
    saveFiles(next);
    setFiles(next);

    // 疑似 ingest
    const r = await fakeIngest();

    // ✅ ここが肝：after を FileItem[] として確定させる
    const after: FileItem[] = loadFiles().map((f) =>
      f.id === newId
        ? { ...f, status: "done", ingested_chunks: r.ingested_chunks }
        : f
    );

    saveFiles(after);
    setFiles(after);

    return { id: newId, ingested_chunks: r.ingested_chunks };
  };

  /** 複数アップロード */
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    const pdfs = selected.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );

    if (pdfs.length === 0) {
      setStatus("PDFファイルが選択されていません。");
      e.target.value = "";
      return;
    }

    setLoading(true);
    try {
      setStatus(`アップロード開始：${pdfs.length}件`);

      let ok = 0;
      let ng = 0;

      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setStatus(`(${i + 1}/${pdfs.length}) 処理中：${file.name}`);

        try {
          await uploadOne(file);
          ok++;
        } catch (err) {
          console.error("[UPLOAD NG]", file.name, err);
          ng++;
        }
      }

      setStatus(`完了：成功 ${ok}件 / 失敗 ${ng}件`);
      await fetchFiles();
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  /** 再取り込み（疑似） */
  const reingestFile = async (id: number) => {
    setLoading(true);
    setStatus("再取り込み中…");

    // ✅ before を FileItem[] として確定
    const before: FileItem[] = loadFiles().map((f) =>
      f.id === id ? { ...f, status: "processing" } : f
    );
    saveFiles(before);
    setFiles(before);

    try {
      const r = await fakeIngest();

      // ✅ after を FileItem[] として確定
      const after: FileItem[] = loadFiles().map((f) =>
        f.id === id
          ? { ...f, status: "done", ingested_chunks: r.ingested_chunks }
          : f
      );

      saveFiles(after);
      setFiles(after);

      setStatus(`再取り込み完了（${r.ingested_chunks} チャンク）`);
    } catch (e) {
      console.error(e);

      const afterErr: FileItem[] = loadFiles().map((f) =>
        f.id === id ? { ...f, status: "error" } : f
      );

      saveFiles(afterErr);
      setFiles(afterErr);
      setStatus("再取り込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  /** 削除（ローカル） */
  const deleteFile = async (id: number) => {
    if (!confirm("このファイルを削除しますか？")) return;

    setLoading(true);
    try {
      const after: FileItem[] = loadFiles().filter((f) => f.id !== id);
      saveFiles(after);
      setFiles(after);
      setStatus("削除しました。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    const timer = setInterval(fetchFiles, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              <div className="text-xs text-zinc-400">Ingest</div>
              <h1 className="text-xl font-semibold tracking-tight">ファイル管理</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              files: {files.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              mode: local
            </span>
          </div>
        </div>

        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-2 text-sm font-semibold">アップロード</div>
          <p className="text-sm text-zinc-400">
            ※このページは「フロントだけ」で動作します（実際のインデックス化は行いません）。
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex w-fit cursor-pointer items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90">
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={uploadFile}
                disabled={loading}
                className="hidden"
              />
              ＋ ファイルを選択（複数可）
            </label>

            <div className="text-xs text-zinc-400">
              {loading ? "処理中…" : "PDFのみ対応"}
            </div>
          </div>

          {status && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-zinc-200">
              {status}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">ファイル一覧</div>
            <button
              onClick={fetchFiles}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? "更新中…" : "更新"}
            </button>
          </div>

          {files.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-zinc-400">
              まだファイルがありません
            </div>
          ) : (
            <div className="space-y-3">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">
                          {file.filename}
                        </div>
                        <span className="text-xs text-zinc-500">#{file.id}</span>
                      </div>

                      <div className="mt-1 text-xs text-zinc-400">
                        {file.ingested_chunks != null && file.status === "done" && (
                          <>・{file.ingested_chunks} チャンク</>
                        )}
                        {file.error_message && <>・エラー: {file.error_message}</>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusBadge status={file.status} />

                      {(file.status === "done" || file.status === "error") && (
                        <button
                          onClick={() => reingestFile(file.id)}
                          disabled={loading}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                          title="再取り込み"
                        >
                          🔄 再
                        </button>
                      )}

                      <button
                        onClick={() => deleteFile(file.id)}
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

        <div className="mt-8 text-center text-xs text-zinc-500">
          Ingest Dashboard
        </div>
      </div>
    </div>
  );
}
