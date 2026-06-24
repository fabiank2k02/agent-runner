export const designDashboardData = {
  mode: "design",
  jobs: [
    {
      id: "snapshot-export",
      shortId: "91e6b13",
      title: "Snapshot export",
      branch: "ops/snapshot",
      status: "running",
      statusLabel: "Running",
      actionLabel: "",
      actionTime: "5m ago",
      elapsed: "41m",
      eta: "8-12m",
      etaShort: "8-12m",
      completion: 68,
      remaining: 2,
      featured: false,
      icon: "cube",
      currentSubgoal: "Upload assets to storage",
      currentEta: "4-6m",
      goals: [
        { id: "snap-1", label: "Export database snapshot", state: "complete", percent: 100 },
        { id: "snap-2", label: "Upload assets to storage", state: "active", percent: 36 }
      ]
    },
    {
      id: "billing-tests",
      shortId: "7c4f2b9",
      title: "Billing tests",
      branch: "feature/billing-tests",
      status: "running",
      statusLabel: "Running",
      actionLabel: "Review",
      actionTime: "5m ago",
      elapsed: "47m",
      eta: "9-14m",
      etaShort: "3-5m",
      completion: 76,
      remaining: 3,
      featured: true,
      icon: "cube",
      currentSubgoal: "Running focused suite",
      currentEta: "3-5m",
      goals: [
        { id: "billing-1", label: "Complete billing test contract", state: "active", percent: 76 },
        { id: "billing-2", label: "Repair failing invoice test", state: "complete", percent: 100 },
        { id: "billing-3", label: "Refresh mock gateway", state: "active", percent: 60 },
        { id: "billing-4", label: "Confirm integration suite", state: "pending", percent: 40 },
        { id: "billing-5", label: "Prepare review patch", state: "pending", percent: 0 }
      ],
      subgoals: [
        { id: "sub-1", label: "Running focused suite", state: "active", percent: 72 },
        { id: "sub-2", label: "Collecting billing trace", state: "pending", percent: 20 }
      ]
    },
    {
      id: "docs-update",
      shortId: "a1f39bd",
      title: "Docs update",
      branch: "docs/update",
      status: "review",
      statusLabel: "Review",
      actionLabel: "Review",
      actionTime: "12m ago",
      elapsed: "23m",
      eta: "7-10m",
      etaShort: "7-10m",
      completion: 42,
      remaining: 4,
      featured: false,
      icon: "book",
      currentSubgoal: "Update API documentation",
      currentEta: "7-10m",
      goals: [
        { id: "docs-1", label: "Update API documentation", state: "active", percent: 42 },
        { id: "docs-2", label: "Publish release notes", state: "pending", percent: 0 }
      ]
    },
    {
      id: "processor-hardening",
      shortId: "55ab7ce",
      title: "Processor hardening",
      branch: "infra/lease-health",
      status: "running",
      statusLabel: "Running",
      actionLabel: "",
      actionTime: "18m ago",
      elapsed: "1h 12m",
      eta: "15-22m",
      etaShort: "15-22m",
      completion: 54,
      remaining: 5,
      icon: "cpu",
      currentSubgoal: "Validate lease renewal",
      currentEta: "9-12m",
      goals: [
        { id: "proc-1", label: "Validate lease renewal", state: "active", percent: 54 },
        { id: "proc-2", label: "Backfill processor tests", state: "pending", percent: 20 }
      ]
    },
    {
      id: "cloud-ledger",
      shortId: "3ac8e71",
      title: "Cloud ledger",
      branch: "cloud/cost-ledger",
      status: "waiting",
      statusLabel: "Waiting",
      actionLabel: "",
      actionTime: "31m ago",
      elapsed: "19m",
      eta: "11-16m",
      etaShort: "11-16m",
      completion: 28,
      remaining: 6,
      icon: "database",
      currentSubgoal: "Trace pod-hour entries",
      currentEta: "11-16m",
      goals: [
        { id: "cloud-1", label: "Trace pod-hour entries", state: "active", percent: 28 },
        { id: "cloud-2", label: "Expose compact spend row", state: "pending", percent: 0 }
      ]
    }
  ],
  usage: {
    allowancePercent: 68,
    allowanceLabel: "68%",
    allowanceDetail: "204K / 300K tokens",
    tokenPulse: "8.4K",
    tokenPulseUnit: "tokens / min",
    costToday: "$3.18",
    costDelta: "9%",
    spark: [31, 34, 38, 35, 42, 47, 43, 51, 38, 46, 55, 59, 68],
    pulse: [43, 51, 49, 66, 61, 52, 72, 59, 65, 78, 69, 74]
  },
  cloud: {
    storage: "128 GB",
    storageDelta: "2.6 GB",
    snapshots: "87 GB",
    snapshotsDelta: "1.1 GB",
    runningPods: "6",
    runningPodsDelta: "2",
    podHours: "24.7 h",
    podHoursDelta: "3.8 h",
    totalSpend: "$6.43",
    spendDelta: "11%",
    spark: [38, 40, 37, 45, 42, 47, 39, 35, 44, 48, 51, 45, 38, 43, 36, 40]
  },
  processor: {
    mode: "Distributed",
    selected: "codespace-auth-7f3",
    health: "Healthy",
    lease: "active",
    pendingStreams: "2",
    behind: "14 seq",
    lastRun: "42s ago"
  }
};

export const emptyDesignDashboardData = {
  mode: "design-empty",
  jobs: [],
  usage: {
    allowancePercent: null,
    allowanceLabel: "No data",
    allowanceDetail: "Waiting for data",
    tokenPulse: "No data",
    tokenPulseUnit: "Mock empty state",
    costToday: "No data",
    costDelta: { label: "No data", tone: "neutral" },
    spark: [24, 26, 25, 27, 26, 28, 27, 29],
    pulse: [28, 29, 28, 30, 29, 31, 30, 32],
    unavailable: true
  },
  cloud: {
    storage: "No data",
    storageDelta: { label: "No data", tone: "neutral" },
    snapshots: "No data",
    snapshotsDelta: { label: "No data", tone: "neutral" },
    runningPods: "No data",
    runningPodsDelta: { label: "No data", tone: "neutral" },
    podHours: "No data",
    podHoursDelta: { label: "No data", tone: "neutral" },
    totalSpend: "No data",
    spendDelta: { label: "No data", tone: "neutral" },
    spark: [29, 30, 29, 31, 30, 32, 31, 33],
    unavailable: true
  },
  processor: {
    mode: "Mock empty",
    selected: "No processor selected",
    health: "No data",
    lease: "none",
    pendingStreams: "No data",
    behind: "No data",
    lastRun: "No data",
    unavailable: true
  }
};
