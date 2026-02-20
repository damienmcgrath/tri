import Link from "next/link";

type NavItem = {
  label: string;
  href: string;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Plan", href: "/plan" },
  { label: "Calendar", href: "/calendar" },
  { label: "AI Coach", href: "/ai-coach" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col p-6 md:flex-row md:gap-8">
      <aside className="mb-6 rounded-2xl bg-slateBlue p-5 text-white md:mb-0 md:w-64">
        <h1 className="text-xl font-semibold tracking-tight">TriCoach AI</h1>
        <p className="mt-1 text-sm text-blue-100">Week 1 foundation build</p>
        <nav className="mt-6 space-y-2">
          {navItems.map((item) => (
            <Link
              className="block rounded-lg px-3 py-2 text-sm transition hover:bg-white/10"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 rounded-2xl bg-white/80 p-6 shadow-sm backdrop-blur">{children}</main>
    </div>
  );
}
