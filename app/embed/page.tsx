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

        /* ラッパー自体のアーティファクトだけ除去（子要素の shadow/filter は残す） */
        .embedNuke {
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