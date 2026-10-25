import { useAuth, isStaff } from '../../shared/auth.jsx';
import { Button, Card } from '../../shared/ui.jsx';
import { STORE_NAME, STORE_TAGLINE } from '../../shared/config.js';

// The five things the store sells. Part 1's catalog reads the real categories from the database.
const SECTIONS = [
  { name: 'Video games', text: 'New releases and pre-owned favorites for every console.' },
  { name: 'Consoles', text: 'Current and retro systems, new and refurbished.' },
  { name: 'Merchandise', text: 'Apparel, posters and gear from the games you love.' },
  { name: 'Collectibles', text: 'Figures, statues and limited editions.' },
  { name: 'Gift cards', text: 'Let someone else pick the game.' },
];

export default function Home() {
  const { user } = useAuth();

  return (
    <>
      <section className="hero">
        <h1>Welcome to {STORE_NAME}</h1>
        <p>{STORE_TAGLINE}</p>
        <div className="row">
          <Button to="/shop">Browse the shop</Button>
          {!user && <Button variant="secondary" to="/register">Create an account</Button>}
          {user && !isStaff(user) && <Button variant="secondary" to="/orders">My orders</Button>}
          {isStaff(user) && <Button variant="secondary" to="/staff">Go to the staff area</Button>}
        </div>
      </section>

      <div className="grid">
        {SECTIONS.map((s) => (
          <Card key={s.name} title={s.name} to="/shop">
            <p className="card-muted">{s.text}</p>
          </Card>
        ))}
      </div>
    </>
  );
}