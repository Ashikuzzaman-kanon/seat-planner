import DashboardShell from "@/components/layout/DashboardShell";
import { ProfileProvider } from "@/components/people/ProfileProvider";

export default function DashboardLayout({ children }) {
  return (
    <DashboardShell>
      <ProfileProvider>{children}</ProfileProvider>
    </DashboardShell>
  );
}
