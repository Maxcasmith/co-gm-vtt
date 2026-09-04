import './Card.css'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
}

export function Card(props: CardProps) {
  const {children} = props;

  return <div className="card--wrapper">{children}</div>
}
