type AppLogoProps = {
  className?: string;
  roundedClassName?: string;
  decorative?: boolean;
};

export function AppLogo({
  className = "h-10 w-10",
  roundedClassName = "rounded-2xl",
  decorative = false
}: AppLogoProps) {
  return (
    <img
      src="/a2w-codex-logo.png"
      alt={decorative ? "" : "A2W Codex Terraform"}
      aria-hidden={decorative || undefined}
      className={`${className} ${roundedClassName} object-cover shadow-sm`}
    />
  );
}
