interface Props {
  text: string;
}

export default function InfoTooltip({ text }: Props) {
  return (
    <span className="create-info-icon sheet-ac-tooltip" data-tooltip={text} aria-label={text}>
      i
    </span>
  );
}
