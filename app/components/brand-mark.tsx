export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src="/images/converge-logo.svg"
      width={40}
      height={40}
      alt=""
      aria-hidden="true"
    />
  );
}
