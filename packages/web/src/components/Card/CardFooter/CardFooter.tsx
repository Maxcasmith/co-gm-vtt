import type { ReactNode } from 'react'
import "./CardFooter.css"

interface CardFooterProps {
  children: ReactNode
}

export function CardFooter(props: CardFooterProps) {
  const {children} = props;

  return <div className="card--footer--wrapper">{children}</div>
}

