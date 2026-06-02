// components/ChatContainer.tsx
export default function ChatContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      {children}
    </div>
  );
}
