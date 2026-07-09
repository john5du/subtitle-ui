export function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-subtle p-3">
      <p className="text-caption font-semibold uppercase tracking-label text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold">{value}</p>
    </div>
  );
}
