import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { CheckIcon } from '../../components/icons/Icons';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { PRODUCTS } from '../../data/products';
import { writeJourneySelection } from '../Signup/journeySession';
import './Products.css';

export function Products() {
  const navigate = useNavigate();

  function choosePlan(id: (typeof PRODUCTS)[number]['id']) {
    writeJourneySelection({ productId: id });
    navigate('/signup');
  }

  return (
    <ParchmentLayout
      header={<PageHeader />}
      skeleton={
        <>
          <div className="products--intro parchment-container">
            <span className="skeleton products--skeleton--title" />
            <span className="skeleton products--skeleton--subtitle" />
          </div>
          <div className="products--grid parchment-container">
            {[0, 1].map(i => (
              <section className="products--card" key={i}>
                <span className="skeleton products--skeleton--icon" />
                <span className="skeleton products--skeleton--card-title" />
                <span className="skeleton products--skeleton--tagline" />
                <span className="skeleton products--skeleton--price" />
                <div className="products--card--features">
                  {[0, 1, 2, 3].map(j => (
                    <span className="skeleton products--skeleton--feature" key={j} />
                  ))}
                </div>
                <span className="skeleton products--skeleton--button" />
              </section>
            ))}
          </div>
        </>
      }
    >
      <div className="products--intro parchment-container">
        <h1 className="products--intro--title">Two ways to play</h1>
        <p className="products--intro--subtitle">
          Run your table from the browser with the cloud subscription, or own the desktop app outright with a single license.
        </p>
      </div>

      <div className="products--grid parchment-container">
        {PRODUCTS.map(plan => (
          <section className="products--card" key={plan.id}>
            <plan.icon className="products--card--icon" />
            <h2 className="products--card--title">{plan.title}</h2>
            <p className="products--card--tagline">{plan.tagline}</p>
            <p className="products--card--price">{plan.price}<span>{plan.priceSuffix}</span></p>
            <ul className="products--card--features">
              {plan.features.map(f => (
                <li key={f}><CheckIcon className="products--card--check" /> {f}</li>
              ))}
            </ul>
            <Button variant={plan.ctaVariant} onClick={() => choosePlan(plan.id)}>{plan.cta}</Button>
          </section>
        ))}
      </div>
    </ParchmentLayout>
  );
}
