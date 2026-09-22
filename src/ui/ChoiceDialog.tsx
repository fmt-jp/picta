export interface Choice {
  label: string;
  /** One line under the label saying what the choice actually does. */
  description?: string;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  title: string;
  message?: string;
  choices: Choice[];
  cancelLabel?: string;
  onCancel: () => void;
}

/** A confirmation that asks *which* destructive action, not just yes/no. */
export default function ChoiceDialog({
  title,
  message,
  choices,
  cancelLabel = 'キャンセル',
  onCancel,
}: Props) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {message ? <p>{message}</p> : null}

        <div className="choice-list">
          {choices.map((choice) => (
            <button
              key={choice.label}
              className={choice.danger ? 'choice danger' : 'choice'}
              onClick={choice.onSelect}
            >
              <span className="choice-label">{choice.label}</span>
              {choice.description ? (
                <span className="choice-description">{choice.description}</span>
              ) : null}
            </button>
          ))}
        </div>

        <button className="button block" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
