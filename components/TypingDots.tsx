// components/TypingDots.tsx
export default function TypingDots() {
  return (
    <span className="inline-flex gap-1 align-middle">
      <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"></span>
      <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce [animation-delay:120ms]"></span>
      <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce [animation-delay:240ms]"></span>
    </span>
  );
}
