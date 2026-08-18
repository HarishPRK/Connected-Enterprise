import { useId, useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Clock3,
  Globe2,
  KeyRound,
  Network,
  Router,
  Search,
  Server,
  ShieldCheck,
  Signal,
  Tags,
} from 'lucide-react';
import {
  PROFILE_CATEGORIES,
  PROFILE_PARAMETERS,
  type ProfileCategory,
  type ProfileParameterDefinition,
} from './profileCatalog';
import type { ProfileParameterValue } from './types';

interface ProfileParameterEditorProps {
  values: Record<string, ProfileParameterValue>;
  onChange?: (key: string, value: ProfileParameterValue) => void;
  readOnly?: boolean;
  compact?: boolean;
}

const CATEGORY_ICONS = {
  identity: Tags,
  network: Network,
  dhcp: Server,
  wan: Router,
  dns: Globe2,
  firewall: ShieldCheck,
  vpn: KeyRound,
  cellular: Signal,
  locale: Clock3,
  health: Activity,
} as const;

const SEARCH_SYNONYMS: Record<string, string[]> = {
  wifi: ['wireless', 'credential', 'secret'],
  wireless: ['wifi'],
  password: ['credential', 'secret', 'reference'],
  credential: ['password', 'secret', 'vpn'],
  mtu: ['packet', 'wan'],
  subnet: ['prefix', 'cidr', 'lan'],
  dhcp: ['lease', 'pool', 'automatic', 'address'],
  resolver: ['dns', 'nameserver'],
  nameserver: ['dns', 'resolver'],
  route: ['gateway', 'metric', 'wan'],
  clock: ['ntp', 'time'],
  restart: ['reboot', 'recovery'],
  reboot: ['restart', 'recovery'],
  timezone: ['clock', 'time', 'locale'],
  cellular: ['mobile', '5g', 'backup'],
  failover: ['backup', 'cellular'],
  tunnel: ['vpn', 'ipsec', 'wireguard'],
};

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matchesParameter(parameter: ProfileParameterDefinition, category: ProfileCategory, query: string): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  const haystack = tokenize(`${parameter.label} ${parameter.description} ${parameter.key} ${category.title} ${category.description}`);
  return queryTokens.every((token) => {
    const variants = [token, ...(SEARCH_SYNONYMS[token] ?? [])];
    return variants.some((variant) => haystack.some((word) => word.includes(variant) || variant.includes(word)));
  });
}

function Highlight({ children, query }: { children: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{children}</>;
  const index = children.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return <>{children}</>;
  return (
    <>
      {children.slice(0, index)}
      <mark className="ce-onb-highlight">{children.slice(index, index + trimmed.length)}</mark>
      {children.slice(index + trimmed.length)}
    </>
  );
}

function displayValue(parameter: ProfileParameterDefinition, value: ProfileParameterValue): string {
  if (parameter.control.kind === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (parameter.control.kind === 'select') {
    return parameter.control.options.find((option) => option.value === String(value))?.label ?? String(value);
  }
  if (parameter.control.kind === 'secret-reference') return value ? String(value) : 'Not configured';
  const unit = parameter.control.kind === 'number' ? parameter.control.unit : undefined;
  return `${String(value)}${unit ? ` ${unit}` : ''}`;
}

function ParameterControl({
  parameter,
  value,
  inputId,
  labelId,
  readOnly,
  onChange,
}: {
  parameter: ProfileParameterDefinition;
  value: ProfileParameterValue;
  inputId: string;
  labelId: string;
  readOnly: boolean;
  onChange?: (value: ProfileParameterValue) => void;
}) {
  if (readOnly) {
    return (
      <span className={`ce-onb-param-value${parameter.control.kind === 'secret-reference' ? ' is-reference' : ''}`} aria-labelledby={labelId}>
        {displayValue(parameter, value)}
      </span>
    );
  }

  switch (parameter.control.kind) {
    case 'boolean':
      return (
        <div className="ce-onb-segment" role="group" aria-labelledby={labelId}>
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              className={Boolean(value) === option ? 'is-selected' : ''}
              aria-pressed={Boolean(value) === option}
              onClick={() => onChange?.(option)}
            >
              {option ? 'Enabled' : 'Disabled'}
            </button>
          ))}
        </div>
      );
    case 'select':
      return (
        <span className="ce-onb-select-wrap">
          <select id={inputId} value={String(value)} onChange={(event) => onChange?.(event.target.value)}>
            {parameter.control.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      );
    case 'number':
      return (
        <span className="ce-onb-input-unit">
          <input
            id={inputId}
            type="number"
            min={parameter.control.min}
            max={parameter.control.max}
            step={parameter.control.step}
            value={Number(value)}
            onChange={(event) => onChange?.(Number(event.target.value))}
          />
          {parameter.control.unit && <span>{parameter.control.unit}</span>}
        </span>
      );
    case 'secret-reference':
      return (
        <span className="ce-onb-secret-reference">
          <KeyRound size={14} aria-hidden="true" />
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={String(value)}
            placeholder={parameter.control.placeholder}
            onChange={(event) => onChange?.(event.target.value)}
          />
          <span>Reference only</span>
        </span>
      );
    case 'text':
      return (
        <input
          id={inputId}
          type="text"
          value={String(value)}
          placeholder={parameter.control.placeholder}
          onChange={(event) => onChange?.(event.target.value)}
        />
      );
  }
}

export function ProfileParameterEditor({
  values,
  onChange,
  readOnly = false,
  compact = false,
}: ProfileParameterEditorProps) {
  const instanceId = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => PROFILE_CATEGORIES.map((category) => ({
    category,
    parameters: PROFILE_PARAMETERS.filter(
      (parameter) => parameter.categoryId === category.id && matchesParameter(parameter, category, query),
    ),
  })).filter((group) => group.parameters.length > 0), [query]);

  const setAll = (open: boolean) => {
    setCollapsed(Object.fromEntries(PROFILE_CATEGORIES.map((category) => [category.id, !open])));
  };

  return (
    <div className={`ce-onb-parameter-editor${compact ? ' is-compact' : ''}`}>
      <div className="ce-onb-editor-tools">
        <label className="ce-onb-search-field">
          <span className="ce-onb-sr-only">Search profile parameters</span>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search settings, intent, or protocol…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="ce-onb-editor-actions" aria-label="Parameter section controls">
          <button type="button" onClick={() => setAll(true)}>Expand all</button>
          <button type="button" onClick={() => setAll(false)}>Collapse all</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="ce-onb-editor-empty" role="status">
          No profile settings match “{query.trim()}”. Try a protocol, feature, or field name.
        </div>
      ) : (
        <div className="ce-onb-category-list">
          {visible.map(({ category, parameters }) => {
            const Icon = CATEGORY_ICONS[category.id as keyof typeof CATEGORY_ICONS] ?? Tags;
            const forcedOpen = query.trim().length > 0;
            const open = forcedOpen || !collapsed[category.id];
            const panelId = `${instanceId}-${category.id}`;
            return (
              <section key={category.id} className="ce-onb-category" data-tone={category.tone}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setCollapsed((current) => ({ ...current, [category.id]: !current[category.id] }))}
                  >
                    <span className="ce-onb-category-icon"><Icon size={16} aria-hidden="true" /></span>
                    <span className="ce-onb-category-copy">
                      <span><Highlight query={query}>{category.title}</Highlight></span>
                      <small>{category.description}</small>
                    </span>
                    <span className="ce-onb-category-count">{parameters.length}</span>
                    <ChevronDown className="ce-onb-category-chevron" size={17} aria-hidden="true" />
                  </button>
                </h3>
                {open && (
                  <div id={panelId} className="ce-onb-category-panel">
                    {parameters.map((parameter) => {
                      const inputId = `${instanceId}-${parameter.key}`;
                      const labelId = `${inputId}-label`;
                      const included = Object.prototype.hasOwnProperty.call(values, parameter.key);
                      const value = values[parameter.key] ?? parameter.defaultValue;
                      const labelable = !readOnly && parameter.control.kind !== 'boolean';
                      return (
                        <div key={parameter.key} className="ce-onb-parameter-row">
                          <div className="ce-onb-parameter-copy">
                            <label id={labelId} htmlFor={labelable ? inputId : undefined}><Highlight query={query}>{parameter.label}</Highlight></label>
                            <span>{parameter.description}</span>
                          </div>
                          <div className="ce-onb-parameter-control">
                            {readOnly && !included ? (
                              <span className="ce-onb-param-value" aria-labelledby={labelId}>Not included in this version</span>
                            ) : (
                              <ParameterControl
                                parameter={parameter}
                                value={value}
                                inputId={inputId}
                                labelId={labelId}
                                readOnly={readOnly}
                                onChange={(next) => onChange?.(parameter.key, next)}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
