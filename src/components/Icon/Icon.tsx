type IconProps = {
  /** Icon filename (without extension) inside `/public/icons/`. */
  name: string;
  /** CSS color value applied to the icon. Defaults to `currentColor` so the icon inherits text color. */
  color?: string;
  /** Extra Tailwind classes. Defaults to `w-6 h-6`. */
  class?: string;
};

/**
 * Preact counterpart of `Icon.astro`. Renders an SVG from `/public/icons/`
 * via CSS `mask`, allowing the icon color to be controlled with `color` /
 * `currentColor` and inherited from the surrounding text color.
 */
export function Icon({ name, color = "currentColor", class: className = "w-6 h-6" }: IconProps) {
  return (
    <div
      class={`aspect-square ${className}`}
      style={{
        mask: `url(/icons/${name}.svg) no-repeat center`,
        maskSize: "contain",
        backgroundColor: color,
      }}
    />
  );
}
