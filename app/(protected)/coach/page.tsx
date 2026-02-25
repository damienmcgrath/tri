import { PageHeader } from "../page-header";
import { CoachChat } from "./coach-chat";

export default function CoachPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        title="Coach"
        objective="Get concise, evidence-linked guidance from your plan and workout data so your next decision is clear and actionable."
        actions={[
          { href: "/dashboard", label: "Review dashboard" },
          { href: "/calendar", label: "Open calendar", variant: "secondary" }
        ]}
      />

      <CoachChat />
    </section>
  );
}
