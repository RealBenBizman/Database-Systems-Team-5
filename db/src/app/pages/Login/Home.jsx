import { Link } from 'react-router-dom';
import { useAuth, isStaff } from '../../../shared/auth.jsx';
import { Button } from '../../../shared/ui.jsx';
import { STORE_TAGLINE } from '../../../shared/config.js';
import { ConsoleIcon, FigureIcon, GamepadIcon, GiftIcon, ShirtIcon } from '../../../shared/icons.jsx';

// The five things the store sells. Part 1's catalog reads the real categories from the database.
const SECTIONS = [
  { name: 'Video games', text: 'New releases and pre-owned favorites.', Icon: GamepadIcon },
  { name: 'Consoles', text: 'Current and retro, new and refurbished.', Icon: ConsoleIcon },
  { name: 'Merchandise', text: 'Apparel, posters and gear.', Icon: ShirtIcon },
  { name: 'Collectibles', text: 'Figures, statues and limited editions.', Icon: FigureIcon },
  { name: 'Gift cards', text: 'Let someone else pick the game.', Icon: GiftIcon },
];

export default function Home() {
  const { user } = useAuth();
  const staff = isStaff(user);

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">Online and in store</span>
            <h1>Level up your <em>library.</em></h1>
            <p className="hero-lead">{STORE_TAGLINE}</p>
            <div className="row">
              <Button to="/shop" size="lg">Browse the shop</Button>
              {!user && <Button variant="outline" size="lg" to="/register">Create an account</Button>}
              {user && !staff && <Button variant="outline" size="lg" to="/orders">My orders</Button>}
              {staff && <Button variant="outline" size="lg" to="/staff">Go to the staff area</Button>}
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="cover-card cover-left" />
            <div className="cover-card cover-right" />
            <div className="cover-card cover-main">
              <small>NEW ARRIVALS</small>
              <span>Find your next game</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="categories-title">
        <div className="section-head">
          <h2 id="categories-title">Shop by category</h2>
          <p>Five aisles, one cart.</p>
        </div>
        <div className="tiles">
          {SECTIONS.map(({ name, text, Icon }) => (
            <Link key={name} to="/shop" className="tile">
              <Icon size={44} />
              <div>
                <div className="tile-title">{name}</div>
                <div className="tile-text">{text}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* PART 1: a "New arrivals" row goes here once /api/products exists. Use <ProductCard/> from
          shared/ui.jsx inside <div className="product-grid">, with Spinner / EmptyState / ErrorBanner. */}

      <section className="section" aria-labelledby="rewards-title">
        <div className="loyalty">
          <div className="loyalty-copy">
            <span className="eyebrow eyebrow-pink">Loyalty rewards</span>
            <h2 id="rewards-title">Rank up. Get 15% off your next order.</h2>
            <p>Every time you reach a new loyalty tier we unlock one reward for you: 15% off your next order, up to $500 saved, valid for 90 days.</p>
            {!user && <Button size="lg" to="/register">Create an account</Button>}
            {user && !staff && <Button size="lg" to="/rewards">See my rewards</Button>}
          </div>
          <div className="loyalty-card">
            <ul className="perks">
              <li><span className="perk-value">15%</span><span className="perk-label">off your next order when you reach a new tier</span></li>
              <li><span className="perk-value">$500</span><span className="perk-label">the most a single reward can save</span></li>
              <li><span className="perk-value">90 days</span><span className="perk-label">to use it once it is unlocked</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" aria-label="Featured">
        <div className="spotlights">
          <Link to="/shop" className="spotlight spotlight-collect">
            <small>Collectibles</small>
            <span>Figures and limited editions for the shelf</span>
          </Link>
          <Link to="/shop" className="spotlight spotlight-gift">
            <small>Gift cards</small>
            <span>Not sure what they play? Let them pick.</span>
          </Link>
        </div>
      </section>
      <div style={{ height: 'var(--space-8)' }} />
    </>
  );
}
