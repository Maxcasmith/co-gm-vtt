import type { ReactNode } from 'react'
import "./CardBody.css"

interface CardBoduProps {
  children: ReactNode
}

export function CardBody(props: CardBoduProps) {
  const {children} = props;

  return <div className="card--body--wrapper">{children}</div>
}
