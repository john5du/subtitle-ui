export function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-surface-subtle p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold">{value}</p>
    </div>
  );
}
