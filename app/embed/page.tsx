import ChatWidget from "@/components/ChatWidget";

export const dynamic = "force-dynamic";

export default function EmbedPage() {
  return (
    <>
      <style>{`
        :root, html, body, #__next {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: transparent !important;
          overflow: hidden;
        }

        /* ★このページ内の“うっすら四角”を徹底的に殺す */
        .embedNuke, .embedNuke * {
          display: block;
          box-shadow: none !important;
          filter: none !important;
          outline: 0 !important;
        }
      `}</style>

      <div className="embedNuke">
        <ChatWidget />
      </div>
    </>
  );
}