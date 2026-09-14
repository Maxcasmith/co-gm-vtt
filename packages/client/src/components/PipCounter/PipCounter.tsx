import "./PipCounter.css";

type PipShape = "circle" | "square";

interface PipCounterProps {
  /** Token matched against the `data-pip-color` palette in PipCounter.css (e.g. "action", "rage"). */
  color: string;
  shape: PipShape;
  max: number;
  current: number;
  title?: string;
  active?: boolean;
}

// Past 5, individual dots stop scaling — one dot plus a number stands in until it drops back to 5.
export function PipCounter({ color, shape, max, current, title, active }: PipCounterProps) {
  const compressed = max >= 6 && current >= 6;
  const dots = compressed ? 1 : max >= 6 ? current : max;

  return (
    <div
      className="pip-counter"
      data-pip-color={color}
      data-pip-shape={shape}
      data-active={active ? "true" : undefined}
      title={title}
    >
      {Array.from({ length: dots }, (_, n) => (
        <div
          key={n}
          data-pip-color={color}
          data-pip-shape={shape}
          className={`pip-counter-dot${!compressed && max < 6 && n >= current ? " pip-counter-dot--spent" : ""}`}
        />
      ))}
      {compressed && <span className="pip-counter-count">×{current}</span>}
    </div>
  );
}
