import pattern from "@/assets/pattern-motif.jpg";

/**
 * Very faint tiled cultural motif behind the translator panels, filling what used to be
 * flat empty paper. Deliberately near-invisible so text contrast is untouched.
 */
export default function MotifBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 opacity-[0.07] mix-blend-multiply"
      style={{
        backgroundImage: `url(${pattern})`,
        backgroundSize: "300px 300px",
        backgroundRepeat: "repeat",
      }}
    />
  );
}
