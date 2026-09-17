/** The label and section shapes the settings forms are built from. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

export function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-4 first:pt-0 last:pb-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
      <div className="mt-3 grid grid-cols-2 items-start gap-4">{children}</div>
    </section>
  );
}
