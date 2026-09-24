interface Props {
  name: string;
  blurb?: string;
  perks: string[];
}

export default function TileDetailPanel({ name, blurb, perks }: Props) {
  return (
    <div className="tile-detail-panel">
      <p className="tile-detail-title">{name}</p>
      {blurb && <p className="tile-detail-blurb">{blurb}</p>}
      {perks.length > 0 && (
        <ul className="tile-detail-perks">
          {perks.map(perk => <li key={perk}>{perk}</li>)}
        </ul>
      )}
    </div>
  );
}
