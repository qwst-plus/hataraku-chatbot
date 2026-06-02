type Status = "pending" | "crawling" | "done" | "error";

// APIから想定外の値が来ても落ちないように string も許容
export default function StatusBadge({ status }: { status?: Status | string | null }) {
  const map: Record<Status, { label: string; className: string }> = {
    pending: {
      label: "準備中",
      className: "bg-yellow-900 text-yellow-300",
    },
    crawling: {
      label: "クロール中",
      className: "bg-blue-900 text-blue-300 animate-pulse",
    },
    done: {
      label: "完了",
      className: "bg-green-900 text-green-300",
    },
    error: {
      label: "エラー",
      className: "bg-red-900 text-red-300",
    },
  };

  const key = (status ?? "pending").toString() as Status;
  const s = map[key];

  // ✅ 想定外のstatusでも必ず表示できるフォールバック
  const fallback = {
    label: status ? `不明: ${status}` : "不明",
    className: "bg-zinc-800 text-zinc-200",
  };

  const view = s ?? fallback;

  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${view.className}`}>
      {view.label}
    </span>
  );
}
