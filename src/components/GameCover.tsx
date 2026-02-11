import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn, getGameInitials, getCardColor } from "@/lib/utils";
import { Gamepad2 } from "lucide-react";

interface GameCoverProps {
  gameId: string;
  gameName: string;
  coverUrl?: string | null;
  customCoverPath?: string | null;
  className?: string;
  /** Show single initial character (for small thumbnails) */
  singleChar?: boolean;
  /** Font size override for initials text */
  initialsClassName?: string;
  /** Minimum natural resolution to consider "good quality" (default 200px) */
  qualityThreshold?: number;
}

/**
 * Graceful game cover image component.
 * - Shows skeleton shimmer while loading
 * - Falls back to a styled initials card on error or missing URL
 * - Never shows a broken image icon
 * - Auto-blurs low-quality/pixelated images for a polished look
 * - Resets state when image source changes
 */
export default function GameCover({
  gameId,
  gameName,
  coverUrl,
  customCoverPath,
  className,
  singleChar = false,
  initialsClassName,
  qualityThreshold = 200,
}: GameCoverProps) {
  const rawSrc = customCoverPath || coverUrl;
  // Convert local file paths to Tauri asset URLs so <img> can load them
  const src = rawSrc && rawSrc.trim().length > 0 && !rawSrc.startsWith('http') && !rawSrc.startsWith('blob:') && !rawSrc.startsWith('data:')
    ? convertFileSrc(rawSrc)
    : rawSrc;
  const hasValidSrc = !!src && src.trim().length > 0;

  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [isLowQuality, setIsLowQuality] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevSrcRef = useRef(src);

  // Reset state when image source changes
  useEffect(() => {
    if (prevSrcRef.current !== src) {
      setLoaded(false);
      setErrored(false);
      setIsLowQuality(false);
      prevSrcRef.current = src;
    }
  }, [src]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    // Check image resolution quality
    const img = imgRef.current;
    if (img) {
      const { naturalWidth, naturalHeight } = img;
      // If the natural resolution is very low, flag as low-quality
      if (naturalWidth > 0 && naturalHeight > 0 &&
          (naturalWidth < qualityThreshold || naturalHeight < qualityThreshold)) {
        setIsLowQuality(true);
      }
    }
  }, [qualityThreshold]);

  const handleError = useCallback(() => {
    setErrored(true);
    setLoaded(true);
  }, []);

  const showImage = hasValidSrc && !errored;
  const initials = getGameInitials(gameName);
  const displayText = singleChar ? (initials.charAt(0) || gameName.charAt(0).toUpperCase()) : (initials || gameName.charAt(0).toUpperCase());

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {showImage ? (
        <>
          {/* Skeleton shimmer while loading */}
          {!loaded && (
            <div className="absolute inset-0 skeleton" />
          )}
          {/* Actual image — hidden until loaded, blurred if low quality */}
          <img
            ref={imgRef}
            src={src}
            alt={gameName}
            className={cn(
              "w-full h-full object-cover transition-all duration-300",
              loaded ? "opacity-100" : "opacity-0",
              isLowQuality && "blur-[12px] scale-115 brightness-75 saturate-125"
            )}
            onLoad={handleLoad}
            onError={handleError}
            loading="lazy"
            draggable={false}
          />
          {/* Overlay gradient on low-quality images to mask pixelation */}
          {isLowQuality && loaded && (
            <div className="absolute inset-0 bg-linear-to-br from-black/30 via-transparent to-black/40" />
          )}
        </>
      ) : (
        /* Fallback: gradient card with initials */
        <div
          className={cn(
            "w-full h-full flex flex-col items-center justify-center gap-1 bg-linear-to-br",
            getCardColor(gameId)
          )}
        >
          <Gamepad2 className="size-[20%] text-foreground/15 max-w-8 max-h-8" />
          <span
            className={cn(
              "font-bold text-foreground/50 leading-none tracking-wide",
              initialsClassName || "text-lg"
            )}
          >
            {displayText}
          </span>
        </div>
      )}
    </div>
  );
}
