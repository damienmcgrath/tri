import { PageHeader } from "../page-header";
import { CoachChat } from "./coach-chat";

export default function CoachPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        title="Coach"
        objective="Get concise guidance from your recent plan and workout data so your next session is clear and actionable."
        actions={[
          { href: "/dashboard", label: "Review dashboard" },
          { href: "/calendar", label: "Open calendar", variant: "secondary" }
        ]}
      />

      <CoachChat />
    </section>
  );
}
