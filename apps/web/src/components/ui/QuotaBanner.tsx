import { useQuota } from '../../lib/api';

export default function QuotaBanner() {
  const { data, isLoading } = useQuota();

  if (isLoading || !data?.data) return null;

  const { plan, used, limit, remaining, resetsAt, beta } = data.data;

  if (plan === 'pro' || plan === 'admin') return null;

  if (beta) {
    return (
      <div className="rounded-lg border border-green-800 bg-green-950/30 px-4 py-3 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white">
              Beta — Unlimited profiling runs
            </span>
            <span className="text-xs text-gray-400">
              {used} run{used !== 1 ? 's' : ''} this month · No limits during beta
            </span>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-green-900/60 text-green-300 text-xs font-semibold uppercase tracking-wide">
            Beta
          </span>
        </div>
      </div>
    );
  }

  const pct = limit ? Math.round((used / limit) * 100) : 0;
  const resetsDate = new Date(resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const isExhausted = remaining === 0;

  return (
    <div className={`rounded-lg border px-4 py-3 mb-6 ${isExhausted ? 'border-red-700 bg-red-950/40' : 'border-gray-700 bg-gray-800/60'}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white">
              {isExhausted
                ? 'Monthly profiling limit reached'
                : `${remaining} of ${limit} free profiling runs remaining`}
            </span>
            <span className="text-xs text-gray-400">Free plan · Resets {resetsDate}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap">{used}/{limit}</span>
          </div>
          <a
            href="mailto:hello@realbench.dev?subject=RealBench Pro upgrade"
            className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium transition whitespace-nowrap"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    </div>
  );
}
