import * as React from "react";
import { Disc } from "lucide-react";
import { cn } from "../lib/utils";

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
  className = "w-full h-full object-cover",
  loading = "lazy",
  fallback,
}: TrackThumbnailProps) {
  const cleanSrc = React.useMemo(() => (isAllowedUrl(src?.trim()) ? src!.trim() : undefined), [src]);
  const [prevSrc, setPrevSrc] = React.useState(cleanSrc);
  const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(cleanSrc);
  const [isFailed, setIsFailed] = React.useState(!cleanSrc);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);

  // Synchronously reset state during render when src prop changes to avoid 1-frame stale image flicker
  if (cleanSrc !== prevSrc) {
    setPrevSrc(cleanSrc);
    setCurrentSrc(cleanSrc);
    setIsFailed(!cleanSrc);
    setIsLoaded(false);
  }

  React.useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      if (
        !(
          imgRef.current.naturalWidth === 120 &&
          imgRef.current.naturalHeight === 90 &&
          currentSrc &&
          /(?:ytimg|youtube)\.com|googleusercontent\.com\/vi(?:_webp)?\//i.test(currentSrc)
        )
      ) {
        setIsLoaded(true);
      }
    }
  }, [currentSrc]);

  const handleError = () => {
    // If high-res thumbnail fails, fall back to reliable hqdefault
    if (currentSrc && HIGH_RES_THUMB_REGEX.test(currentSrc)) {
      setCurrentSrc(currentSrc.replace(HIGH_RES_THUMB_REGEX, "/hqdefault$1"));
      setIsLoaded(false);
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
    } else {
      setIsLoaded(true);
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
      ref={imgRef}
      src={currentSrc}
      alt={alt}
      className={cn(
        className,
        "transition-opacity duration-200 ease-out",
        isLoaded ? "opacity-100" : "opacity-0 bg-secondary/40 animate-pulse"
      )}
      loading={loading}
      draggable={false}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
