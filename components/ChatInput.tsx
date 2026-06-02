// components/ChatInput.tsx
export default function ChatInput({
  value, onChange, onSend, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        className="flex-1 border rounded-lg px-3 py-2"
        placeholder="質問を入力..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSend();
        }}
      />
      <button
        className="bg-blue-600 text-white px-4 rounded-lg disabled:opacity-50"
        onClick={onSend}
        disabled={disabled}
      >
        送信
      </button>
    </div>
  );
}
