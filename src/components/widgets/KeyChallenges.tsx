import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const challenges = [
  { title: 'Device visibility', detail: 'Disconnected IT / OT systems make issues harder to spot.' },
  { title: 'Service continuity', detail: 'Network outages interrupt everyday enterprise operations.' },
  { title: 'Operating costs', detail: 'Manual support, site visits and energy use add up.' },
  { title: 'Safety & experience', detail: 'Teams need timely visibility into safety risks and service delays.' },
];

export function KeyChallenges() {
  return (
    <section className="key-challenges" aria-labelledby="key-challenges-title">
      <div className="key-challenges-heading">
        <h2 id="key-challenges-title">Key enterprise challenges</h2>
        <Link to="/service-offerings">Explore Solution Offerings <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
      <ul className="key-challenges-list">
        {challenges.map(({ title, detail }) => (
          <li key={title}><h3>{title}</h3><p>{detail}</p></li>
        ))}
      </ul>
    </section>
  );
}
