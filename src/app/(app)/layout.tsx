import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTopBar, MobileBottomNav } from "@/components/layout/MobileNav";
import { SectionTabs } from "@/components/layout/SectionTabs";
import { LiveRefresh } from "@/components/LiveRefresh";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-h-dvh flex-col md:flex-row">
      <LiveRefresh />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <main className="flex-1 overflow-y-auto px-4 py-4 pb-20 md:px-6 md:py-6 md:pb-6">
          <SectionTabs />
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
