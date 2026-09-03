import type { ProviderRateLimitHistoryInput } from "@t3tools/contracts";

import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

/** Rate-limit history rarely needs more than the last few days to chart a trend. */
export const DEFAULT_RATE_LIMIT_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function useProviderRateLimitHistory(input: ProviderRateLimitHistoryInput) {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.providerRateLimitHistory({ environmentId, input }),
  );
}
