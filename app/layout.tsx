// app/layout.tsx
import "./globals.css";
import ClientWidgets from "./ClientWidgets";

export const metadata = {
  title: "Chatbot",
  description: "RAG Chatbot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <ClientWidgets />
      </body>
    </html>
  );
}