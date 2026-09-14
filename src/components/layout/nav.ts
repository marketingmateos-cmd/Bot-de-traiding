// V3 redesign: the sidebar/mobile nav now shows only these 7 sections
// (spec §2) instead of the previous 21 flat items. Nothing was deleted —
// every old page still lives at its original route; SUB_NAV just groups
// them so <SectionTabs> can render a tab strip at the top of each page
// within a section, without the risk of moving/renaming route folders.
export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/markets", label: "Markets" },
  { href: "/paper-trading", label: "Positions" },
  { href: "/journal", label: "Journal" },
  { href: "/strategies", label: "Strategies" },
  { href: "/research", label: "Research" },
  { href: "/backtesting", label: "Backtest" },
  { href: "/settings", label: "Settings" },
];

export const SUB_NAV: Record<string, NavItem[]> = {
  "/paper-trading": [
    { href: "/paper-trading", label: "Abiertas" },
    { href: "/portfolio", label: "Cartera" },
  ],
  "/strategies": [
    { href: "/strategies", label: "Estrategias" },
    { href: "/league", label: "Liga de Estrategias" },
  ],
  "/research": [
    { href: "/research", label: "Laboratorio IA" },
    { href: "/news", label: "Noticias" },
    { href: "/sentiment", label: "Sentimiento" },
    { href: "/onchain", label: "On-Chain" },
    { href: "/intelligence", label: "Inteligencia" },
    { href: "/experiments", label: "Experimentos" },
  ],
  "/backtesting": [
    { href: "/backtesting", label: "Backtesting" },
    { href: "/replay", label: "Historical Replay" },
    { href: "/walk-forward", label: "Walk Forward" },
    { href: "/monte-carlo", label: "Monte Carlo" },
    { href: "/robustness", label: "Robustez" },
  ],
  "/settings": [
    { href: "/settings", label: "Ajustes" },
    { href: "/risk", label: "Riesgo" },
    { href: "/accounts", label: "Accounts" },
    { href: "/system-health", label: "Salud del Sistema" },
    { href: "/luck-vs-edge", label: "Suerte vs Ventaja" },
  ],
};

/** Which section (if any) a given pathname's tab strip should show. */
export function findSectionForPath(pathname: string): NavItem[] | null {
  for (const items of Object.values(SUB_NAV)) {
    if (items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))) {
      return items;
    }
  }
  return null;
}
