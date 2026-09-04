import type { ReactNode } from 'react'
import './CardHeader.css'

interface CardHeaderProps {
  children: ReactNode
}

export function CardHeader(props: CardHeaderProps) {
  const {children} = props;

  return <div className="card--header--wrapper">{children}</div>
}
