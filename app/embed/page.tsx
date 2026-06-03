import ChatWidget from "@/components/ChatWidget";

export const dynamic = "force-dynamic";

export default function EmbedPage() {
  return (
    <>
      <style>{`
        :root, html, body, #__next, [data-nextjs-scroll-focus-boundary] {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: transparent !important;
          overflow: hidden;
        }

        .embed-root, .embedNuke {
          background: transparent !important;
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