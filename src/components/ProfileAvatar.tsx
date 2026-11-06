export function ProfileAvatar({ name, className = "h-11 w-11 text-base" }: {
  name: string;
  className?: string;
}) {
  return <span aria-hidden="true" className={`profile-avatar inline-flex shrink-0 items-center justify-center rounded-full bg-forest font-semibold text-ink ${className}`}>
    {Array.from(name.trim())[0]?.toUpperCase()}
  </span>;
}
