import * as React from "react";
import { Disc } from "lucide-react";

interface TrackThumbnailProps {
  src?: string | null;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
  fallback?: React.ReactNode;
}

const HIGH_RES_THUMB_REGEX = /\/(?:maxresdefault|hq720|sddefault)(\.[a-zA-Z0-9]+(?:\?.*)?)$/i;

const isAllowedUrl = (url?: string): boolean =>
  Boolean(url && (/^https?:\/\//i.test(url) || url.startsWith("/")));

export function TrackThumbnail({
  src,
  alt = "",
  className = "h-full w-full object-cover",
  loading = "lazy",
  fallback,
}: TrackThumbnailProps) {
  const cleanSrc = src?.trim() && isAllowedUrl(src.trim()) ? src.trim() : undefined;
  const [prevSrc, setPrevSrc] = React.useState(cleanSrc);
  const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(cleanSrc);
  const [isFailed, setIsFailed] = React.useState(!cleanSrc);

  // Synchronously reset state during render when src prop changes to avoid 1-frame stale image flicker
  if (cleanSrc !== prevSrc) {
    setPrevSrc(cleanSrc);
    setCurrentSrc(cleanSrc);
    setIsFailed(!cleanSrc);
  }

  const handleError = () => {
    // If high-res thumbnail fails, fall back to reliable hqdefault
    if (currentSrc && HIGH_RES_THUMB_REGEX.test(currentSrc)) {
      setCurrentSrc(currentSrc.replace(HIGH_RES_THUMB_REGEX, "/hqdefault$1"));
    } else {
      setIsFailed(true);
    }
  };

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // YouTube CDN trap: When an image is missing or video is unavailable/deleted/private,
    // YouTube returns a 120x90 gray placeholder image instead of an image decode failure.
    // Browsers successfully decode this 120x90 image and fire onLoad instead of onError.
    if (
      img.naturalWidth === 120 &&
      img.naturalHeight === 90 &&
      currentSrc &&
      /(?:ytimg|youtube)\.com|googleusercontent\.com\/vi(?:_webp)?\//i.test(currentSrc)
    ) {
      handleError();
    }
  };

  if (isFailed || !currentSrc) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    const containerClass = className
      .replace(/\bobject-(?:cover|contain|fill|none|scale-down)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return (
      <div className={`flex items-center justify-center text-muted-foreground bg-muted ${containerClass}`}>
        <Disc className="h-6 w-6 opacity-40" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={loading}
      draggable={false}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
