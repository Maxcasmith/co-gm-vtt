import type { ReactNode } from "react";
import "./Tag.css";

interface iTag {
  children: ReactNode;
}

export function Tag(props: iTag) {
  const { children } = props;

  return <div className="tag--gold">{children}</div>;
}
