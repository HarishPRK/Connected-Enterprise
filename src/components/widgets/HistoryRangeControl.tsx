import { HISTORY_RANGES, type HistoryRange } from '../../ui/historyRange';
import './HistoryCharts.css';

export function HistoryRangeControl({ value, onChange, label }: {
  value: HistoryRange;
  onChange: (value: HistoryRange) => void;
  label: string;
}) {
  return (
    <div className="chart-history-ranges" role="group" aria-label={`${label} history range`}>
      {HISTORY_RANGES.map((range) => (
        <button key={range.value} type="button" aria-pressed={value === range.value}
          onClick={() => onChange(range.value)}>
          {range.label}
        </button>
      ))}
    </div>
  );
}

export function HistoryStatus({ loading, error, empty, observedAt }: {
  loading: boolean;
  error?: string;
  empty: boolean;
  observedAt?: number;
}) {
  return (
    <div className="chart-history-status" role="status">
      {error
        ? `${error}${empty ? '' : ' Showing saved observations.'}`
        : loading ? 'Loading saved history…'
          : empty ? 'No observations in this range yet. The graph updates as data arrives.'
            : `Observed ${observedAt ? new Date(observedAt).toLocaleString() : 'in the selected range'} · updates automatically`}
    </div>
  );
}
