import Link from "next/link";

type Props = {
  bundleId: string;
  /** Optional focus deep-link, e.g. "segment:bike" → ?focus=segment:bike */
  focus?: string;
  variant?: "primary" | "ghost" | "floating";
  label?: string;
};

const VARIANT_CLASSES: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "inline-flex items-center gap-1.5 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition hover:border-cyan-400/55 hover:bg-cyan-500/20",
  ghost:
    "inline-flex items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.86)] transition hover:border-[rgba(255,255,255,0.18)]",
  floating:
    "inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-[11px] font-medium text-cyan-300 shadow-sm backdrop-blur transition hover:border-cyan-400/60 hover:bg-cyan-500/25"
};

export function AskCoachButton({ bundleId, focus, variant = "primary", label = "Ask Coach about this race" }: Props) {
  const href = focus ? `/races/${bundleId}/coach?focus=${encodeURIComponent(focus)}` : `/races/${bundleId}/coach`;
  return (
    <Link href={href} className={VARIANT_CLASSES[variant]}>
      <span>{label}</span>
      <span aria-hidden>→</span>
    </Link>
  );
}
