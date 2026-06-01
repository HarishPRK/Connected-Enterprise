import { PageHeader } from '../components/PageHeader';
import { AskAiPanel } from '../components/widgets/AskAiPanel';
import { AlertsWidget } from '../components/widgets/AlertsWidget';
import { alerts } from '../data/mock';

export function AskAiPage() {
  return (
    <>
      <PageHeader
        title="Ask AI"
        subtitle="Quick triage and resolution suggestions backed by GenAI / agentic AI"
      />
      <div className="grid">
        <div className="col-8"><AskAiPanel /></div>
        <div className="col-4"><AlertsWidget alerts={alerts} /></div>
      </div>
    </>
  );
}
