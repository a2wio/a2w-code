import { DashboardShell } from "@/components/DashboardShell";
import { requireDashboardData } from "@/src/lib/dashboard";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const data = await requireDashboardData();

  return (
    <DashboardShell workspace={data.workspace} chats={data.chats} messages={data.messages} plans={data.plans}>
      {children}
    </DashboardShell>
  );
}
