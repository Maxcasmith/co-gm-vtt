import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./TileButton.css";

interface TileButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  sigil: ReactNode;
  label: ReactNode;
  description: ReactNode;
}

export function TileButton({ sigil, label, description, className, ...rest }: TileButtonProps) {
  const classes = ["tile-btn", className ?? ""].filter(Boolean).join(" ");

  return (
    <button className={classes} {...rest}>
      <span className="tile-btn__sigil" aria-hidden="true">{sigil}</span>
      <span className="tile-btn__label">{label}</span>
      <span className="tile-btn__description">{description}</span>
    </button>
  );
}
