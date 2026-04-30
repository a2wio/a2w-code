export function Icon({ name, className = "" }: { name: string; className?: string }) {
  const prefix = name.startsWith("fa-brands") ? name : `fa-solid ${name}`;
  return <i className={`${prefix} ${className}`} aria-hidden="true" />;
}
