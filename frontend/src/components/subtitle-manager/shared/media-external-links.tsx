import { ExternalLink } from "lucide-react";

import { imdbTitleUrl, tmdbTitleUrl } from "@/lib/subtitle-manager/media-metadata";
import type { MediaType } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface MediaExternalLinksProps {
  imdbId?: string;
  tmdbId?: string;
  mediaType: MediaType;
}

export function MediaExternalLinks({ imdbId, tmdbId, mediaType }: MediaExternalLinksProps) {
  const imdbUrl = imdbTitleUrl(imdbId);
  const tmdbUrl = tmdbTitleUrl(tmdbId, mediaType);
  if (!imdbUrl && !tmdbUrl) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {imdbUrl ? (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" asChild>
          <a href={imdbUrl} target="_blank" rel="noreferrer" aria-label="Open IMDb record">
            <span>IMDb</span>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </Button>
      ) : null}
      {tmdbUrl ? (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" asChild>
          <a href={tmdbUrl} target="_blank" rel="noreferrer" aria-label="Open TMDb record">
            <span>TMDb</span>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
