export interface NavItem {
  href: string;
  label: string;
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", group: "Overview" },
  { href: "/markets", label: "Markets", group: "Overview" },
  { href: "/intelligence", label: "Crypto Intelligence", group: "Overview" },
  { href: "/news", label: "News", group: "Overview" },
  { href: "/sentiment", label: "Sentiment", group: "Overview" },
  { href: "/onchain", label: "On-Chain", group: "Overview" },

  { href: "/strategies", label: "Strategies", group: "Trading" },
  { href: "/paper-trading", label: "Paper Trading", group: "Trading" },
  { href: "/portfolio", label: "Portfolio", group: "Trading" },
  { href: "/journal", label: "Trade Journal", group: "Trading" },

  { href: "/research", label: "AI Research Lab", group: "Research" },
  { href: "/experiments", label: "Experiments", group: "Research" },
  { href: "/backtesting", label: "Backtesting", group: "Research" },
  { href: "/walk-forward", label: "Walk Forward", group: "Research" },
  { href: "/monte-carlo", label: "Monte Carlo", group: "Research" },
  { href: "/robustness", label: "Robustness Lab", group: "Research" },

  { href: "/risk", label: "Risk Center", group: "Governance" },
  { href: "/league", label: "Strategy League", group: "Governance" },
  { href: "/luck-vs-edge", label: "Luck vs Edge", group: "Governance" },
  { href: "/system-health", label: "System Health", group: "Governance" },
  { href: "/settings", label: "Settings", group: "Governance" },
];

export const NAV_GROUPS = ["Overview", "Trading", "Research", "Governance"] as const;
