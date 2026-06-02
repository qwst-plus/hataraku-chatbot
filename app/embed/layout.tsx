// app/embed/layout.tsx
import type { ReactNode } from "react";

export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="embed-root">
      {children}
    </div>
  );
}
