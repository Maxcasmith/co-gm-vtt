import type { WorldConcept } from 'shared';

interface Props {
  title: string;
  concepts: WorldConcept[];
  selectedConcept: WorldConcept | null;
  onSelect: (concept: WorldConcept) => void;
  onRefresh: () => void;
  loading: boolean;
}

export default function ConceptsStep({ title, concepts, selectedConcept, onSelect, onRefresh, loading }: Props) {
  return (
    <div className="create-step">
      <div className="modal-header concepts-header">
        <div>
          <h1 className="modal-title">{title}</h1>
          <p className="modal-hint">Select the concept that speaks to you.</p>
        </div>
        <button className="btn-refresh" onClick={onRefresh} disabled={loading} title="Regenerate concepts">
          {loading ? '…' : '↻'}
        </button>
      </div>
      <div className="concept-tiles">
        {concepts.map(concept => (
          <button
            key={concept.name}
            className={`concept-tile ${selectedConcept?.name === concept.name ? 'concept-tile--selected' : ''}`}
            onClick={() => onSelect(concept)}
          >
            <span className="concept-tile-name">{concept.name}</span>
            <span className="concept-tile-desc">{concept.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
