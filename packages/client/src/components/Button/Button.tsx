import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import "./Button.css";

type ButtonVariant = "fill" | "outline" | "ghost";
type ButtonColor = "primary" | "secondary" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: ButtonVariant;
  color?: ButtonColor;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  navigate?: string;
  [dataAttr: `data-${string}`]: unknown;
}

export function Button({
  children,
  variant = "fill",
  color = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  navigate,
  className,
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (navigate) {
      window.location.href = navigate;
    }
  };

  const classes = [
    "btn",
    `btn--${variant}`,
    `btn--${color}`,
    `btn--${size}`,
    !children && (leftIcon || rightIcon) ? "btn--icon-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} onClick={handleClick} {...rest}>
      {leftIcon && <span className="btn__icon btn__icon--left">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="btn__icon btn__icon--right">{rightIcon}</span>}
    </button>
  );
}
