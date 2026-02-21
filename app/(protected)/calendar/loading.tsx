export default function CalendarLoading() {
  return (
    <section className="space-y-3 animate-pulse">
      <div className="surface h-28" />
      <div className="surface h-24" />
      <div className="grid gap-3 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="surface h-72" />
        ))}
      </div>
    </section>
  );
}
