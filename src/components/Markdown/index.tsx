import React from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

export function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={["github-light", "github-dark"]}
      components={COMPONENTS as any}
      controls={{
        table: true,
        code: true,
        mermaid: {
          download: true,
          copy: true,
          fullscreen: false,
          panZoom: false,
        },
      }}
    >
      {children}
    </Streamdown>
  );
}

const COMPONENTS = {
  a: ({ children, href, ...props }: any) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (href) {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(href);
        } catch (error) {
          console.error("Failed to open URL:", error);
          // Fallback to window.open
          window.open(href, "_blank");
        }
      }
    };

    return (
      <a
        href={href}
        className="text-gaming underline underline-offset-2 hover:text-gaming/80 cursor-pointer transition-colors"
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  },
};

export default Markdown;
