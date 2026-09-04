import type { HTMLAttributes, ReactNode } from "react";
import "./Button.css";

interface ButtonProps extends HTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  disabled?: boolean;
  className?:string;
}

export function Button(props:ButtonProps) {
  const { children, ...rest } = props;

  return <button {...rest}>{children}</button>
}
