import type { ProviderRateLimitWindowHistory } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { memo } from "react";

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5 hour",
  seven_day: "7 day",
  seven_day_opus: "7 day · Opus",
  seven_day_sonnet: "7 day · Sonnet",
  overage: "Overage",
  primary: "Primary",
  secondary: "Secondary",
};

function formatWindowLabel(windowKey: string): string {
  return WINDOW_LABELS[windowKey] ?? windowKey;
}

function formatResetLabel(resetsAt: DateTime.Utc | null, nowMs: number): string | null {
  if (!resetsAt) return null;
  const remainingMs = DateTime.toEpochMillis(resetsAt) - nowMs;
  if (!Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return "resets soon";
  const hours = remainingMs / (60 * 60 * 1000);
  if (hours < 1) return `resets in ${Math.max(1, Math.round(remainingMs / 60_000))}m`;
  if (hours < 48) return `resets in ${Math.round(hours)}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 24;

function RateLimitSparkline({ samples }: { samples: ProviderRateLimitWindowHistory["samples"] }) {
  const points = samples.filter(
    (sample): sample is typeof sample & { usedPercent: number } => sample.usedPercent !== null,
  );
  if (points.length < 2) return null;

  const timestamps = points.map((point) => DateTime.toEpochMillis(point.capturedAt));
  const minTime = Math.min(...timestamps);
  const spanTime = Math.max(1, Math.max(...timestamps) - minTime);

  const coords = points
    .map((point, index) => {
      const x = ((timestamps[index]! - minTime) / spanTime) * SPARKLINE_WIDTH;
      const usedPercent = Math.max(0, Math.min(100, point.usedPercent));
      const y = SPARKLINE_HEIGHT - (usedPercent / 100) * SPARKLINE_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      className="h-6 w-full text-muted-foreground"
      aria-hidden="true"
    >
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Compact usage-over-time view for one account's rate-limit windows, shown in provider settings. */
export const ProviderRateLimitUsage = memo(function ProviderRateLimitUsage({
  windows,
}: {
  windows: ReadonlyArray<ProviderRateLimitWindowHistory>;
}) {
  if (windows.length === 0) return null;
  const nowMs = Date.now();

  return (
    <div className="flex flex-col gap-3">
      {windows.map((window) => {
        const usedPercent = window.latest.usedPercent;
        const resetLabel = formatResetLabel(window.latest.resetsAt, nowMs);
        return (
          <div key={window.windowKey} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-secondary-label">{formatWindowLabel(window.windowKey)}</span>
              <span className="tabular-nums text-secondary-label">
                {usedPercent === null ? "—" : `${Math.round(usedPercent)}%`}
                {resetLabel ? ` · ${resetLabel}` : ""}
              </span>
            </div>
            <RateLimitSparkline samples={window.samples} />
          </div>
        );
      })}
    </div>
  );
});
