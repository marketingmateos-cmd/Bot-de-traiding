export interface NavItem {
  href: string;
  label: string;
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Panel Principal", group: "Resumen" },
  { href: "/markets", label: "Mercados", group: "Resumen" },
  { href: "/intelligence", label: "Inteligencia Cripto", group: "Resumen" },
  { href: "/news", label: "Noticias", group: "Resumen" },
  { href: "/sentiment", label: "Sentimiento", group: "Resumen" },
  { href: "/onchain", label: "On-Chain", group: "Resumen" },

  { href: "/strategies", label: "Estrategias", group: "Trading" },
  { href: "/paper-trading", label: "Paper Trading", group: "Trading" },
  { href: "/portfolio", label: "Cartera", group: "Trading" },
  { href: "/journal", label: "Diario de Operaciones", group: "Trading" },

  { href: "/research", label: "Laboratorio de IA", group: "Investigación" },
  { href: "/experiments", label: "Experimentos", group: "Investigación" },
  { href: "/backtesting", label: "Backtesting", group: "Investigación" },
  { href: "/walk-forward", label: "Walk Forward", group: "Investigación" },
  { href: "/monte-carlo", label: "Monte Carlo", group: "Investigación" },
  { href: "/robustness", label: "Laboratorio de Robustez", group: "Investigación" },

  { href: "/risk", label: "Centro de Riesgo", group: "Gobernanza" },
  { href: "/league", label: "Liga de Estrategias", group: "Gobernanza" },
  { href: "/luck-vs-edge", label: "Suerte vs Ventaja", group: "Gobernanza" },
  { href: "/system-health", label: "Salud del Sistema", group: "Gobernanza" },
  { href: "/settings", label: "Ajustes", group: "Gobernanza" },
];

export const NAV_GROUPS = ["Resumen", "Trading", "Investigación", "Gobernanza"] as const;
