import { ExternalLink } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { imdbTitleUrl, tmdbTitleUrl } from "@/lib/subtitle-manager/media-metadata";
import type { MediaType } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface MediaExternalLinksProps {
  imdbId?: string;
  tmdbId?: string;
  mediaType: MediaType;
}

export function MediaExternalLinks({ imdbId, tmdbId, mediaType }: MediaExternalLinksProps) {
  const { t } = useI18n();
  const imdbUrl = imdbTitleUrl(imdbId);
  const tmdbUrl = tmdbTitleUrl(tmdbId, mediaType);
  if (!imdbUrl && !tmdbUrl) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {imdbUrl ? (
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" asChild>
          <a href={imdbUrl} target="_blank" rel="noreferrer" aria-label={t("common.openImdb")}>
            <span>{t("common.imdb")}</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        </Button>
      ) : null}
      {tmdbUrl ? (
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" asChild>
          <a href={tmdbUrl} target="_blank" rel="noreferrer" aria-label={t("common.openTmdb")}>
            <span>{t("common.tmdb")}</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
