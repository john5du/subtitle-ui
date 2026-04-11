import { useI18n } from "@/lib/i18n";
import type { OperationLog } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import { PanelLoadingOverlay } from "../shared/pending-state";

export function LogsPanel({
  logs,
  pending,
  formatTime
}: {
  logs: OperationLog[];
  pending: boolean;
  formatTime: (value: string | undefined | null) => string;
}) {
  const { t } = useI18n();
  return (
    <Card className="animate-fade-in-up flex h-full min-h-[420px] flex-col">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="text-lg">{t("logs.title")}</CardTitle>
        <Badge variant="secondary">{pending ? t("logs.refreshing") : t("logs.recentCount", { count: logs.length })}</Badge>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1 p-4 pt-0">
        <ScrollArea className={cn("min-h-0 flex-1 border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)]", pending && "animate-pulse-soft")}>
          <ul className="divide-y divide-[rgba(255,255,255,0.1)]">
            {logs.map((log) => (
              <li key={log.id} className="animate-fade-in-up space-y-1 p-3 text-sm">
                <p className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</p>
                <p className="font-semibold">{log.action}</p>
                <p className="break-all text-xs text-muted-foreground">{log.targetPath || "-"}</p>
                <p className="text-xs text-muted-foreground">{t("logs.videoStatus", { videoId: log.videoId, status: log.status })}</p>
                {log.message && <p className="break-all text-xs text-muted-foreground">{t("logs.details", { details: log.message })}</p>}
              </li>
            ))}

            {logs.length === 0 && (
              <li className="p-8 text-center text-sm text-muted-foreground">{t("logs.empty")}</li>
            )}
          </ul>
        </ScrollArea>
        {pending && <PanelLoadingOverlay label={t("logs.refreshing")} />}
      </CardContent>
    </Card>
  );
}
